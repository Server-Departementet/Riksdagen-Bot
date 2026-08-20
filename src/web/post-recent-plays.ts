import "dotenv/config";
import { extractImageColor } from "./extract-image-color";
import type { Prisma } from "@/lib/prisma-web/generated/client";
import { PrismaClient } from "@/lib/prisma-web/generated/client";
import { makeMariaDBAdapter } from "@/lib/prisma";
import { webTargets } from "@/lib/web-targets";
import { refreshSpotifyAccessToken } from "./spotify-auth";
import type SpotifyApi from "spotify-web-api-node";
import type { UsersRecentlyPlayedTracksResponse } from "./types/spotify";

// Import each connected minister's recently played Spotify tracks into every
// configured web database, and record each user's outcome in TrackPlayFetch
// (shown on the web app's /spotify/log). Spotify is queried ONCE per user;
// the same data is written to every target. SpotifyAccount rows are read from
// the FIRST target (prod) only, and rotated refresh tokens are written back
// there — the other targets' token copies are never spent, so the two
// environments cannot invalidate each other's tokens.

if (webTargets.length === 0) {
  throw new Error("No web databases configured (WEB_DATABASE_URL_PROD/_DEV)");
}

type Target = { name: string; prisma: PrismaClient };

addRecentTrackPlays()
  .then(() => {
    console.log("Finished adding recent track plays.");
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("Error adding recent track plays:", err);
    process.exit(1);
  });

async function addRecentTrackPlays() {
  console.info(`Starting recent track plays import (targets: ${webTargets.map((t) => t.name).join(", ")}).`);

  const targets: Target[] = webTargets.map((target) => ({
    name: target.name,
    prisma: new PrismaClient(makeMariaDBAdapter(target.url)),
  }));
  const source = targets[0] as Target; // Prod when configured; token source of truth

  // Every user's outcome this run is recorded under one timestamp
  const runAt = new Date();
  async function logFetch(target: Target, userId: string, status: string, inserted: number, skipped: number, detail?: string) {
    await target.prisma.trackPlayFetch.create({ data: { runAt, userId, status, inserted, skipped, detail } })
      .catch((err: unknown) => {
        console.error(`Error recording fetch log in ${target.name}:`, err);
      });
  }
  async function logFetchAll(userId: string, status: string, inserted: number, skipped: number, detail?: string) {
    for (const target of targets) {
      await logFetch(target, userId, status, inserted, skipped, detail);
    }
  }

  try {
    console.info(`Fetching connected Spotify accounts from ${source.name}.`);
    const spotifyAccounts = await source.prisma.spotifyAccount.findMany({ include: { user: true } });
    console.info(`Found ${spotifyAccounts.length} connected Spotify accounts.`);

    for (const account of spotifyAccounts) {
      const dbUser = account.user;
      const username = dbUser.name ?? dbUser.id;
      console.info(`Processing user: ${username} (${dbUser.id}).`);

      /*
       * Get a fresh spotify access token for the user
       */
      const refreshed = await refreshSpotifyAccessToken(account.refreshToken);
      if (!refreshed) {
        console.warn(`Could not refresh Spotify token for user: ${username}. They may need to reconnect at /spotify.`);
        await logFetchAll(dbUser.id, "token-failed", 0, 0, "Koppla om ditt Spotify-konto på /spotify");
        continue;
      }
      if (refreshed.newRefreshToken) {
        await source.prisma.spotifyAccount.update({
          where: { userId: dbUser.id },
          data: { refreshToken: refreshed.newRefreshToken },
        });
      }
      const spotifyToken = refreshed.accessToken;
      console.info(`Spotify token resolved for ${username}.`);

      /*
       * Get recently played tracks from Spotify API
       */
      const recentlyPlayedTracks = await getRecentlyPlayedTracks(spotifyToken, username);
      if (!recentlyPlayedTracks) {
        await logFetchAll(dbUser.id, "fetch-failed", 0, 0, "Spotify svarade med fel");
        continue;
      }
      if (recentlyPlayedTracks.items.length === 0) {
        console.info(`No recently played tracks found for user: ${username}`);
        await logFetchAll(dbUser.id, "ok", 0, 0);
        continue;
      }
      console.info(`Fetched ${recentlyPlayedTracks.items.length} recent plays for ${username}.`);

      /*
       * Prepare data for upserting: Spotify is queried once, using the union of
       * what is missing across the targets, so every target can be fully served
       */
      const albums = recentlyPlayedTracks.items.map((item) => item.track.album);
      const tracks = [...new Map(recentlyPlayedTracks.items.map((item) => [item.track.id, item.track])).values()];

      const existingArtistIdsByTarget = new Map<string, Set<string>>();
      const existingTrackIdsByTarget = new Map<string, Set<string>>();
      for (const target of targets) {
        existingArtistIdsByTarget.set(target.name, new Set(
          (await target.prisma.artist.findMany({ select: { id: true } })).map((artist) => artist.id),
        ));
        existingTrackIdsByTarget.set(target.name, new Set(
          (await target.prisma.track.findMany({
            where: { id: { in: tracks.map((track) => track.id) } },
            select: { id: true },
          })).map((track) => track.id),
        ));
      }

      const allArtistsSimple = [...new Map(
        recentlyPlayedTracks.items
          .flatMap((item) => item.track.artists as SpotifyApi.ArtistObjectSimplified[])
          .map((artist) => [artist.id, artist]),
      ).values()];
      const missingArtistsSimple = allArtistsSimple.filter((artist) =>
        targets.some((target) => !existingArtistIdsByTarget.get(target.name)?.has(artist.id)),
      );
      console.info(`Missing artists to fetch: ${missingArtistsSimple.length}.`);
      const artists = await getSpotifyArtists(missingArtistsSimple, spotifyToken);
      const genres = artists.flatMap((artist) => artist.genres ?? []);
      console.info(`Prepared ${artists.length} artists, ${albums.length} albums, ${tracks.length} tracks, ${genres.length} genres.`);

      // Recently-played track objects no longer include external_ids, so ISRCs
      // for tracks new to any target database are resolved via the single-track endpoint
      const isrcByTrackId: Record<string, string> = {};
      for (const track of tracks) {
        const existsEverywhere = targets.every((target) => existingTrackIdsByTarget.get(target.name)?.has(track.id));
        if (existsEverywhere) continue;
        const isrc = track.external_ids?.isrc ?? await getTrackISRC(track.id, spotifyToken);
        if (isrc) isrcByTrackId[track.id] = isrc;
        else console.warn(`No ISRC found for track ${track.name} (${track.id}). Skipping where not already stored.`);
      }

      // Colors
      const colors: Record<string, string> = {};
      const allImageUrls = [
        ...artists.map((artist) => artist.images[0]?.url).filter((url): url is string => !!url),
        ...albums.map((album) => album.images[0]?.url).filter((url): url is string => !!url),
      ];
      await Promise.all(allImageUrls.map(async (url) => {
        if (colors[url]) return;
        const color = await extractImageColor(url);
        if (!color) return;
        colors[url] = color;
      }));
      console.info(`Resolved ${Object.keys(colors).length} image colors.`);

      /*
       * Write to every target database; one failing must not stop the others
       */
      for (const target of targets) {
        const existingTrackIds = existingTrackIdsByTarget.get(target.name) as Set<string>;
        const existingArtistIds = existingArtistIdsByTarget.get(target.name) as Set<string>;

        const counts = await writeUserData(target, {
          username,
          userId: dbUser.id,
          recentlyPlayedTracks,
          albums,
          tracks,
          artists,
          genres,
          isrcByTrackId,
          colors,
          existingTrackIds,
          existingArtistIds,
        })
          .catch((err: unknown) => {
            console.error(`Error upserting data for user ${username} in ${target.name}:`, err);
            return { error: err instanceof Error ? err.message : String(err) };
          });

        if ("error" in counts) {
          await logFetch(target, dbUser.id, "write-failed", 0, 0, counts.error);
        }
        else {
          await logFetch(target, dbUser.id, "ok", counts.inserted, counts.skipped);
        }
      }
    }

    // The log only needs to cover recent history
    for (const target of targets) {
      await target.prisma.trackPlayFetch.deleteMany({
        where: { runAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }).catch((err: unknown) => {
        console.error(`Error pruning fetch log in ${target.name}:`, err);
      });
    }
  } finally {
    console.info("Disconnecting Prisma.");
    for (const target of targets) {
      await target.prisma.$disconnect();
    }
  }

  return;
}

type RecentTrack = UsersRecentlyPlayedTracksResponse["items"][number]["track"];

type UserWriteData = {
  username: string;
  userId: string;
  recentlyPlayedTracks: UsersRecentlyPlayedTracksResponse;
  albums: RecentTrack["album"][];
  tracks: RecentTrack[];
  artists: SpotifyApi.ArtistObjectFull[];
  genres: string[];
  isrcByTrackId: Record<string, string>;
  colors: Record<string, string>;
  existingTrackIds: Set<string>;
  existingArtistIds: Set<string>;
};

/** Write one user's genres, artists, albums, tracks and plays to one target in a transaction. */
async function writeUserData(target: Target, data: UserWriteData): Promise<{ inserted: number; skipped: number }> {
  const {
    username, userId, recentlyPlayedTracks, albums, tracks, artists, genres,
    isrcByTrackId, colors, existingTrackIds, existingArtistIds,
  } = data;

  return await target.prisma.$transaction(async (prisma) => {
    console.info(`Writing data for ${username} to ${target.name} in a transaction.`);
    // Insert Genres, skip dupes
    await prisma.genre.createMany({
      skipDuplicates: true,
      data: [
        ...genres.map((genre) => ({ name: genre })),
      ] satisfies Prisma.GenreCreateManyInput[],
    });

    // Upsert Albums
    for (const album of albums) {
      const imageUrl = album.images[0]?.url || null;
      const albumData = {
        name: album.name,
        url: album.external_urls.spotify,
        image: imageUrl,
        color: imageUrl ? colors[imageUrl] : undefined,
        releaseDate: new Date(album.release_date),
      };
      await prisma.album.upsert({
        where: { id: album.id },
        update: albumData,
        create: { id: album.id, ...albumData },
      });
    }

    // Upsert tracks
    for (const track of tracks) {
      const ISRC = isrcByTrackId[track.id];
      if (!ISRC) {
        if (!existingTrackIds.has(track.id)) continue; // No ISRC resolvable, warned above
        // Known track: refresh metadata, keep the stored ISRC
        await prisma.track.update({
          where: { id: track.id },
          data: {
            name: track.name,
            url: track.external_urls.spotify,
            duration: track.duration_ms,
            albumId: track.album.id,
          },
        });
        continue;
      }

      const trackData = {
        name: track.name,
        url: track.external_urls.spotify,
        duration: track.duration_ms,
        albumId: track.album.id,
        ISRC,
      };
      await prisma.track.upsert({
        where: { id: track.id },
        update: trackData,
        create: { id: track.id, ...trackData },
      });
    }

    // Upsert Artists (only the ones missing somewhere were fetched in full)
    for (const artist of artists) {
      const imageUrl = artist.images[0]?.url || null;
      const artistData = {
        name: artist.name,
        url: artist.external_urls.spotify,
        image: imageUrl,
        color: imageUrl ? colors[imageUrl] : undefined,
        genres: {
          connect: (artist.genres ?? []).map((genre) => ({ name: genre })),
        },
        tracks: {
          connect: tracks
            .filter((track) => existingTrackIds.has(track.id) || isrcByTrackId[track.id])
            .filter((track) => track.artists.some((a) => a.id === artist.id))
            .map((track) => ({ id: track.id })),
        },
      };
      await prisma.artist.upsert({
        where: { id: artist.id },
        update: artistData,
        create: { id: artist.id, ...artistData },
      });
    }

    // Really ensure Track-Artist relations
    const knownArtistIds = new Set([
      ...existingArtistIds,
      ...artists.map((a) => a.id),
    ]);
    for (const track of tracks) {
      // Skip tracks that are not in the database (no ISRC resolvable)
      if (!existingTrackIds.has(track.id) && !isrcByTrackId[track.id]) continue;
      for (const artist of track.artists) {
        // Skip artists that are not in the database (fetch failed)
        if (!knownArtistIds.has(artist.id)) continue;
        await prisma.track.update({
          where: { id: track.id },
          data: { artists: { connect: { id: artist.id } } },
        });
      }
    }

    // Insert TrackPlays, skip dupes. Plays for tracks that could not be
    // created (no ISRC) are dropped — they would violate the FK
    const candidatePlays = recentlyPlayedTracks.items
      .filter((item) => existingTrackIds.has(item.track.id) || isrcByTrackId[item.track.id])
      .map((item) => ({
        playedAt: new Date(item.played_at),
        userId,
        trackId: item.track.id,
      })) satisfies Prisma.TrackPlayCreateManyInput[];

    // The API reports played_at exactly as it stored it, so re-reading the same play
    // across runs collides on the (trackId, playedAt, userId) PK and skipDuplicates
    // handles it. No tolerance window here — a repeat play seconds after the last one
    // is real listening, and dropping it loses data permanently. Takeout imports are
    // the only source with drifting timestamps, and they dedupe on their own side.
    const inserted = await prisma.trackPlay.createMany({
      skipDuplicates: true,
      data: candidatePlays,
    });
    console.info(`Inserted ${inserted.count} track plays into ${target.name} (${candidatePlays.length - inserted.count} already stored).`);
    return { inserted: inserted.count, skipped: candidatePlays.length - inserted.count };
  });
}

/** GET with one retry after Spotify's Retry-After on 429 */
async function fetchWithRetry(url: string, token: string): Promise<Response> {
  let response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 429) {
    const retryAfter = Math.min(Number(response.headers.get("Retry-After") ?? 1), 30);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }
  return response;
}

async function getTrackISRC(trackId: string, token: string): Promise<string | null> {
  const response = await fetchWithRetry(`https://api.spotify.com/v1/tracks/${trackId}`, token);
  if (!response.ok) {
    console.error(`Error fetching track ${trackId}: Status ${response.status} Response: ${await response.text()}`);
    return null;
  }
  const data = await response.json() as SpotifyApi.SingleTrackResponse;
  return data.external_ids?.isrc ?? null;
}

async function getSpotifyArtists(artistsSimple: SpotifyApi.ArtistObjectSimplified[], token: string): Promise<SpotifyApi.ArtistObjectFull[]> {
  const artistDetails: SpotifyApi.ArtistObjectFull[] = [];

  for (const artist of artistsSimple) {
    const response = await fetchWithRetry(artist.href, token);

    if (!response.ok) {
      console.error(`Error fetching artist details for ${artist.name}: Status ${response.status}`);
      console.error(`Response: ${await response.text()}`);
      continue;
    }

    const data = await response.json() as SpotifyApi.SingleArtistResponse;
    artistDetails.push(data);
  }

  return artistDetails;
}

async function getRecentlyPlayedTracks(token: string, username: string): Promise<UsersRecentlyPlayedTracksResponse | null> {
  const recentlyPlayedTracksResponse = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=50", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!recentlyPlayedTracksResponse.ok) {
    console.error(`Error for user ${username}: Status ${recentlyPlayedTracksResponse.status} Response: ${await recentlyPlayedTracksResponse.text()}`);
    return null;
  }
  const recentlyPlayedTracks = await recentlyPlayedTracksResponse.json() as UsersRecentlyPlayedTracksResponse;
  // Filter out local tracks; an empty list is a valid result, not an error
  recentlyPlayedTracks.items = (recentlyPlayedTracks.items ?? []).filter((item) => !item.track.is_local);

  return recentlyPlayedTracks;
}
