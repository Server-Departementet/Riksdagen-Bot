// The web databases the PROD bot deployment injects data into over LAN.
// The dev bot deployment sets neither URL and injects nothing.
// Prod is listed first: it is the source of truth for SpotifyAccount tokens.
export type WebTarget = { name: string; url: string };

const candidates: { name: string; url: string | undefined }[] = [
  { name: "prod", url: process.env.WEB_DATABASE_URL_PROD },
  { name: "dev", url: process.env.WEB_DATABASE_URL_DEV },
];

export const webTargets: WebTarget[] = candidates.filter(
  (target): target is WebTarget => !!target.url,
);
