# Riksdagen-Bot

The Discord bots for the Regeringen server (**quotes**/citat, **quiz**, **discgolf**)
and their cron jobs. The discgolf process is the only persistent gateway connection, so it
also hosts the edit/delete **monitor** (`src/monitor/`) and the `:winroth:` easter egg
(`src/reactions/winroth.ts`: a 1% chance to react to `WINROTH_USER_ID`'s messages, in every guild). The [Riksdagen](https://github.com/Server-Departementet/Riksdagen)
web repo owns the web site and its own data jobs (minister sync, Spotify play import).

This repo is the **data producer** for the web sites:
- `src/quotes/quotes.ts` crawls the quote channel, upserts each quote into the
  bot's own MariaDB (`Quote` table), then injects a copy into every configured
  web database (`src/quotes/web-sync.ts`).
- `src/web/post-recent-plays.ts` fetches each connected minister's recently
  played Spotify tracks ONCE and writes plays + a per-user fetch log
  (`TrackPlayFetch`, shown on the web app's `/spotify/log`) into every
  configured web database. `SpotifyAccount` refresh tokens are read from and
  rotated in the FIRST target (prod) only — where ministers connect — so the
  environments can never invalidate each other's tokens.

The **prod** bot deployment (main branch) sets `WEB_DATABASE_URL_PROD` and
`WEB_DATABASE_URL_DEV` and feeds both web DBs over LAN; the **dev** bot
deployment (dev branch) sets neither and never touches the web databases.
`prisma/web.schema.prisma` is a mirror of the web repo's schema —
the web repo owns that schema and its migrations; keep the mirror in sync.

## Setup

1. `yarn install`
2. Create a `.env` in the repo root (see [`.env.example`](.env.example)). Required:
   - `DATABASE_URL` — the bot's **own** MariaDB (hosts `User` + `Quote`)
   - `DISCORD_BOT_TOKEN`, `DISCORD_BOT_CLIENT_ID`
   - `REGERINGEN_GUILD_ID`, `QUOTE_CHANNEL_ID`, `QUIZ_CHANNEL_ID`, `CANONICAL_URL`
   - `DISCGOLF_GUILD_ID`, `DISCGOLF_READ_CHANNEL_ID`, `DISCGOLF_WRITE_CHANNEL_ID`
   - `WEB_DATABASE_URL_PROD`, `WEB_DATABASE_URL_DEV` — prod deployment only
   - `WINROTH_USER_ID` — optional, enables the `:winroth:` reaction
3. Provide `user-aliases.json` in the repo root — a `{ "<discordId>": ["Name", ...] }`
   map used to resolve quotees to user IDs. Not committed (operator-provided).
4. `yarn prisma migrate deploy` (or `yarn prisma migrate dev` locally) to create the tables.
5. `yarn generate` to generate both Prisma clients (own DB + web Quote mirror).
6. Populate the `User` table (Discord-ID → name): `yarn make-users`

## Scripts

| Command | Purpose |
| --- | --- |
| `yarn make-users` | Upsert ministers into the bot's `User` table (names for quotes/quiz/stats) |
| `yarn post-recent-plays` | Import connected ministers' recent Spotify plays into the web DBs |
| `yarn generate` | Generate both Prisma clients |
| `yarn tsx src/quotes/quotes.ts --fetch` | Crawl the quote channel, upsert quotes, inject into web DBs |
| `yarn tsx src/quiz/quiz.ts` | Post the daily citat quiz (reads quotes from the DB) |
| `yarn tsx src/discgolf/discgolf.ts` | Run the discgolf bot |
| `yarn lint` | Type-check + ESLint |

The quotes crawler downloads attachment images into `public/quote-attachments/`;
`systemd/assets.service` (src/assets/server.ts, port `ASSETS_PORT`, default 3100) serves
them to the web apps, which relay `/quote-attachments/*` misses here via a Next rewrite.

Deployment uses `systemd/` (a `discgolf` + `assets` service + `cron` for quotes/quiz/make-users).
Everything runs as the unprivileged `riks` user with the repo at `/home/riks/Riksdagen-Bot`
(nvm + node installed for that user); the maintenance reboot and the auto-deploy
(`systemd/cron.root`) are root's. Cron logs go to `/var/log/riksdagen-bot/`.
Deploys are automatic: every push to main runs `.github/workflows/deploy.yml` on the
self-hosted LAN runner (container riksdagen-ci), which installs deps, lints, tests,
then SSHes to the bot VM and runs `systemd/update.sh --force` — that reinstalls deps,
regenerates Prisma clients, refreshes crontabs + services and restarts them. Run the
same script with `--force` as root on the VM to redeploy by hand.
