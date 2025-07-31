import type { Attachment, Collection, Embed, MessageMentions, MessageReference, MessageSnapshot, ReactionManager, Snowflake, TopLevelComponent, User } from "discord.js";

export type Message = {

  // Basic inherited from Discord
  id: Snowflake;
  authorId: User;
  content: string;
  url: string;

  // Extended things from Discord
  attachments: Collection<Snowflake, Attachment>;
  components: TopLevelComponent[];
  createdTimestamp: string;
  editedTimestamp: string | null;
  embeds: Embed[];
  mentions: MessageMentions;
  pinned: boolean;
  reactions: ReactionManager;
  reference: MessageReference | null;
  messageSnapshots: Collection<Snowflake, MessageSnapshot>;
};