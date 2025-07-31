import type { Attachment, Collection, Embed, MessageMentions, MessageReference, MessageSnapshot, ReactionManager, Snowflake, TopLevelComponent, User } from "discord.js";

export type Message = {
  attachments: Collection<Snowflake, Attachment>;
  author: User;
  components: TopLevelComponent[];
  content: string;
  createdTimestamp: number;
  editedTimestamp: number | null;
  embeds: Embed[];
  id: Snowflake;
  mentions: MessageMentions;
  pinned: boolean;
  reactions: ReactionManager;
  url: string;
  reference: MessageReference | null;
  messageSnapshots: Collection<Snowflake, MessageSnapshot>;
};