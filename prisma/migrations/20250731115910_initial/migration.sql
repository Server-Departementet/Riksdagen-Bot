-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attachments" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "components" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdTimestamp" TEXT NOT NULL,
    "editedTimestamp" TEXT,
    "embeds" TEXT NOT NULL,
    "mentions" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL,
    "reactions" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "reference" TEXT,
    "messageSnapshots" TEXT NOT NULL
);
