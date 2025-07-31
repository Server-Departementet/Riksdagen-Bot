import type { Attachment, Collection, Embed, MessageMentions, MessageReference, MessageSnapshot, ReactionManager, Snowflake, TopLevelComponent, User } from "discord.js";

export const MessageKeys = [
  "id",
  "attachments",
  "author",
  "components",
  "content",
  "createdTimestamp",
  "editedTimestamp",
  "embeds",
  "mentions",
  "pinned",
  "reactions",
  "url",
  "reference",
  "messageSnapshots",
];
// export type Message = {
//   attachments: Collection<Snowflake, Attachment>;
//   author: User;
//   components: TopLevelComponent[];
//   content: string;
//   createdTimestamp: string;
//   editedTimestamp: string | null;
//   embeds: Embed[];
//   id: Snowflake;
//   mentions: MessageMentions;
//   pinned: boolean;
//   reactions: ReactionManager;
//   url: string;
//   reference: MessageReference | null;
//   messageSnapshots: Collection<Snowflake, MessageSnapshot>;
// };