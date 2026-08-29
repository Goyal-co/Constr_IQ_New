-- Comments and revisions on design files as well as work items.
--
-- `work_item_comments` is RENAMED rather than dropped and recreated. Prisma's
-- generated diff wanted to DROP TABLE, which would throw away every comment
-- already written; a rename keeps them and is otherwise identical.

-- --------------------------------------------------------------------------
-- Comments: rename, then widen to cover design files
-- --------------------------------------------------------------------------
ALTER TABLE "work_item_comments" RENAME TO "activity_comments";

ALTER TABLE "activity_comments" RENAME CONSTRAINT "work_item_comments_pkey" TO "activity_comments_pkey";
ALTER TABLE "activity_comments" RENAME CONSTRAINT "work_item_comments_workItemId_fkey" TO "activity_comments_workItemId_fkey";
ALTER TABLE "activity_comments" RENAME CONSTRAINT "work_item_comments_authorId_fkey" TO "activity_comments_authorId_fkey";

ALTER INDEX "work_item_comments_workItemId_createdAt_idx" RENAME TO "activity_comments_workItemId_createdAt_idx";
ALTER INDEX "work_item_comments_authorId_idx" RENAME TO "activity_comments_authorId_idx";

ALTER TABLE "activity_comments"
  ADD COLUMN "designFileId" UUID,
  ALTER COLUMN "workItemId" DROP NOT NULL;

ALTER TABLE "activity_comments"
  ADD CONSTRAINT "activity_comments_designFileId_fkey"
  FOREIGN KEY ("designFileId") REFERENCES "design_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "activity_comments_designFileId_createdAt_idx"
  ON "activity_comments"("designFileId", "createdAt");

-- A comment belongs to exactly one thing. Prisma cannot express this, so it is
-- enforced here — without it, two nullable foreign keys silently permit a
-- comment attached to both, or to nothing at all.
ALTER TABLE "activity_comments"
  ADD CONSTRAINT "activity_comments_one_owner"
  CHECK (("workItemId" IS NOT NULL) <> ("designFileId" IS NOT NULL));

-- --------------------------------------------------------------------------
-- Revisions: same widening
-- --------------------------------------------------------------------------
ALTER TABLE "drawing_revisions"
  ADD COLUMN "designFileId" UUID,
  ALTER COLUMN "workItemId" DROP NOT NULL;

ALTER TABLE "drawing_revisions"
  ADD CONSTRAINT "drawing_revisions_designFileId_fkey"
  FOREIGN KEY ("designFileId") REFERENCES "design_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "drawing_revisions_designFileId_revision_idx"
  ON "drawing_revisions"("designFileId", "revision");

-- Numbering is unique per owner, so two people cannot both create an R3.
CREATE UNIQUE INDEX "drawing_revisions_designFileId_revision_key"
  ON "drawing_revisions"("designFileId", "revision");

ALTER TABLE "drawing_revisions"
  ADD CONSTRAINT "drawing_revisions_one_owner"
  CHECK (("workItemId" IS NOT NULL) <> ("designFileId" IS NOT NULL));

-- --------------------------------------------------------------------------
-- Design files carry the current revision, like work items do
-- --------------------------------------------------------------------------
ALTER TABLE "design_files" ADD COLUMN "currentRevision" INTEGER NOT NULL DEFAULT 0;
