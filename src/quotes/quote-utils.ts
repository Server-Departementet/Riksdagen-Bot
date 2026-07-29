import type { Quote } from "./types";

export type CustomQuoteMeta = Partial<Pick<Quote, "authorId" | "link" | "sender" | "createdTimestamp">>;

/** A trimmed string, or undefined when the value is missing or blank. */
function nonBlank(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function isCustomQuoteMeta(obj: unknown): obj is CustomQuoteMeta {
  if (typeof obj !== "object" || obj === null) return false;

  if (
    !("authorId" in obj)
    && !("link" in obj)
    && !("sender" in obj)
    && !("createdTimestamp" in obj)
  ) return false;

  if ("authorId" in obj && typeof obj.authorId !== "string") return false;
  if ("link" in obj && typeof obj.link !== "string") return false;
  if ("sender" in obj && typeof obj.sender !== "string") return false;
  if ("createdTimestamp" in obj && typeof obj.createdTimestamp !== "number") return false;

  return true;
}

export function splitCustomQuoteMeta(content: string): { meta?: CustomQuoteMeta; content: string } {
  const match = /^\s*\[\[\s*([\s\S]*?)\s*\]\]\s*\n?/.exec(content);
  if (!match) return { content };

  const metaJson = match[1];
  let meta: CustomQuoteMeta | undefined = undefined;

  try {
    if (!metaJson) throw new Error("Meta JSON is empty");
    const metaObject = JSON.parse(metaJson) as unknown;
    if (!isCustomQuoteMeta(metaObject)) {
      throw new Error("Parsed meta does not have the required structure: " + metaJson);
    }
    if (metaObject && typeof metaObject === "object") {
      // A blank field means "not set" — e.g. `authorId: ""` on a quote imported from
      // another server has to fall through to whoever posted it here
      const maybeAuthorId = nonBlank(metaObject.authorId);
      const maybeSender = nonBlank(metaObject.sender);
      const maybeLink = nonBlank(metaObject.link);

      const parsed: CustomQuoteMeta = {
        ...(maybeAuthorId ? { authorId: maybeAuthorId } : {}),
        ...(maybeSender ? { sender: maybeSender } : {}),
        ...(maybeLink ? {
          link: maybeLink,
          createdTimestamp: getTimestampFromDiscordLink(maybeLink) ?? undefined,
        } : {}),
      };

      meta = Object.keys(parsed).length > 0 ? parsed : undefined;
    }
  }
  catch (error) {
    console.warn("Failed to parse custom quote metadata:", error);
  }

  return {
    meta,
    content: content.slice(match[0].length).trimStart(),
  };
}

export function stripCustomQuoteMeta(content: string): string {
  return splitCustomQuoteMeta(content).content;
}

export function getTimestampFromDiscordLink(link: string): number | null {
  const snowflake = link.split("/").at(-1)?.trim();
  if (!snowflake || !/^\d+$/.test(snowflake)) return null;

  return Number((BigInt(snowflake) >> 22n) + 1420070400000n);
}

// \w and \b only match ASCII in JS regexes (even with the u flag), so names like
// Åsa or Örjan need the explicit Unicode equivalent [\p{L}\p{N}_] instead.

/** Splits `"body" - quotee` on the attribution dash. */
export const quoteAttributionSplitRegex = /(?<="[^"]+?"\s*)-(?=\s*[\p{L}\p{N}_])/u;

/** A global regex matching any of `names` as a whole word, with Unicode-aware boundaries. */
export function wordMatchRegex(names: string[]): RegExp {
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
}

export function isMultiSpeakerQuote(content: string): boolean {
  const isMultiLine =
    content.includes("\n")
    && content.split("\n").every(line => line.trim().startsWith("\"") && line.trim().includes("-"));
  return isMultiLine;
}