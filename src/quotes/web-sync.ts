import { Prisma as WebPrisma, PrismaClient as WebPrismaClient } from "@/lib/prisma-web/generated/client";
import { makeMariaDBAdapter } from "@/lib/prisma";
import { webTargets } from "@/lib/web-targets";
import type { Quote } from "./types";

// The prod bot deployment (main branch) feeds BOTH web databases; the dev bot
// deployment leaves both unset and injects nothing. Attachments stay on this
// server — the web apps relay /quote-attachments/* misses to the asset server.

/** Upsert the crawled quotes into every configured web database. */
export async function syncQuotesToWebDatabases(quotes: Quote[]): Promise<void> {
  if (webTargets.length === 0) {
    console.info("No web databases configured (WEB_DATABASE_URL_PROD/_DEV unset), skipping quote injection.");
    return;
  }

  for (const target of webTargets) {
    const webPrisma = new WebPrismaClient(makeMariaDBAdapter(target.url));
    try {
      for (const quote of quotes) {
        const data: WebPrisma.QuoteUncheckedCreateInput = {
          id: quote.id,
          authorId: quote.authorId,
          createdTimestamp: quote.createdTimestamp,
          link: quote.link,
          originalLink: quote.originalLink ?? null,
          sender: quote.sender,
          body: quote.body,
          quotee: quote.quotee,
          quoteeId: quote.quoteeId ?? null,
          context: quote.context ?? null,
          attachments: quote.attachments ?? WebPrisma.JsonNull,
        };
        await webPrisma.quote.upsert({
          where: { id: quote.id },
          create: data,
          update: data,
        });
      }
      console.info(`Injected ${quotes.length} quotes into the ${target.name} web database.`);
    } finally {
      await webPrisma.$disconnect();
    }
  }
}
