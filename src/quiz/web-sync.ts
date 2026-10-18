import { Prisma as WebPrisma, PrismaClient as WebPrismaClient } from "@/lib/prisma-web/generated/client";
import type { PrismaClient } from "@/lib/prisma/generated/client";
import { makeMariaDBAdapter } from "@/lib/prisma";
import { webTargets } from "@/lib/web-targets";

// The web apps read quiz rounds for /citat/stats from their own databases. The
// tables are small, so every sync replaces them wholesale with the bot's copy;
// a web database whose migration hasn't landed yet (prod lags dev until the web
// repo's dev branch is merged) is skipped and caught up by a later run.

/** Replace the quiz tables in every configured web database with the bot's. Never throws. */
export async function syncQuizToWebDatabases(prisma: PrismaClient): Promise<void> {
  if (webTargets.length === 0) {
    console.info("No web databases configured (WEB_DATABASE_URL_PROD/_DEV unset), skipping quiz sync.");
    return;
  }

  let rounds, votes;
  try {
    [rounds, votes] = await Promise.all([prisma.quizRound.findMany(), prisma.quizVote.findMany()]);
  }
  catch (error) {
    console.error("Failed to read the quiz tables for the web sync:", error);
    return;
  }

  for (const target of webTargets) {
    const webPrisma = new WebPrismaClient(makeMariaDBAdapter(target.url));
    try {
      await webPrisma.$transaction([
        webPrisma.quizVote.deleteMany(),
        webPrisma.quizRound.deleteMany(),
        webPrisma.quizRound.createMany({
          data: rounds.map(r => ({ ...r, options: r.options ?? WebPrisma.JsonNull })),
        }),
        webPrisma.quizVote.createMany({ data: votes }),
      ]);
      console.info(`Synced ${rounds.length} quiz rounds and ${votes.length} votes to the ${target.name} web database.`);
    }
    catch (error) {
      // P2021: table does not exist. Either way the other databases still get synced.
      if (error instanceof WebPrisma.PrismaClientKnownRequestError && error.code === "P2021") {
        console.warn(`The ${target.name} web database has no quiz tables yet, skipping it.`);
      }
      else {
        console.error(`Failed to sync the quiz to the ${target.name} web database:`, error);
      }
    }
    finally {
      await webPrisma.$disconnect();
    }
  }
}
