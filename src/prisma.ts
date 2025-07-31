import { env } from "node:process";
env.PRISMA_DATABASE_URL = `file:../db/quotes-${new Date().toISOString().replace(/T.*/, "")}.db`;
env.SQLITE_DATABASE_URL = `file:./db/quotes-${new Date().toISOString().replace(/T.*/, "")}.db`;

import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "../prisma/generated/prisma/client.js";

// If the file doesn't exits, make it
new DatabaseSync(env.SQLITE_DATABASE_URL);

export const prisma = new PrismaClient({
  datasourceUrl: env.PRISMA_DATABASE_URL,
});