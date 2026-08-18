import "dotenv/config";
import type { PrismaConfig } from "prisma/config";

// Config for the client against the Riksdagen web app's databases.
// The web repo owns that schema; this is a mirror of the Quote table only.
// Generate with: yarn prisma generate --config prisma.web.config.ts
// The URL is only needed by CLI commands that connect; generate never does,
// so a placeholder keeps `yarn generate` working where no web DB is configured.
export default {
  schema: "prisma/web.schema.prisma",
  datasource: {
    url: process.env.WEB_DATABASE_URL_PROD ?? "mysql://unused:unused@localhost:3306/unused",
  },
} satisfies PrismaConfig;
