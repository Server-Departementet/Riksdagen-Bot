import { Prisma } from "@/lib/prisma/generated/client";
import type { Quote as QuoteRow } from "@/lib/prisma/generated/client";
import type { Quote } from "./types";

/** Convert a DB row into the in-memory {@link Quote} shape used across the bot. */
export function fromQuoteRow(row: QuoteRow): Quote {
  return {
    id: row.id,
    authorId: row.authorId,
    createdTimestamp: Number(row.createdTimestamp),
    link: row.link,
    originalLink: row.originalLink ?? undefined,
    sender: row.sender,
    body: row.body,
    quotee: row.quotee,
    quoteeId: row.quoteeId ?? undefined,
    quoteeKey: row.quoteeKey ?? undefined,
    context: row.context ?? undefined,
    attachments: (row.attachments as string[] | null) ?? undefined,
  };
}

/** Build the create/update payload for upserting a {@link Quote} into the DB. */
export function toQuoteData(quote: Quote): Prisma.QuoteUncheckedCreateInput {
  return {
    id: quote.id,
    authorId: quote.authorId,
    createdTimestamp: quote.createdTimestamp,
    link: quote.link,
    originalLink: quote.originalLink ?? null,
    sender: quote.sender,
    body: quote.body,
    quotee: quote.quotee,
    quoteeId: quote.quoteeId ?? null,
    quoteeKey: quote.quoteeKey ?? null,
    context: quote.context ?? null,
    attachments: quote.attachments ?? Prisma.JsonNull,
  };
}
