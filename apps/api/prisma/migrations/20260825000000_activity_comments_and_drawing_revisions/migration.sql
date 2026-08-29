-- CreateEnum
CREATE TYPE "CommentKind" AS ENUM ('NOTE', 'DESIGN_APPROVAL', 'STATUS_CHANGE', 'REVISION');

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "currentRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "work_item_comments" (
    "id" UUID NOT NULL,
    "workItemId" UUID NOT NULL,
    "authorId" UUID,
    "kind" "CommentKind" NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "statusFrom" VARCHAR(40),
    "statusTo" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_item_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drawing_revisions" (
    "id" UUID NOT NULL,
    "workItemId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "notes" TEXT,
    "issuedDate" DATE,
    "issuedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drawing_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_item_comments_workItemId_createdAt_idx" ON "work_item_comments"("workItemId", "createdAt");

-- CreateIndex
CREATE INDEX "work_item_comments_authorId_idx" ON "work_item_comments"("authorId");

-- CreateIndex
CREATE INDEX "drawing_revisions_workItemId_revision_idx" ON "drawing_revisions"("workItemId", "revision");

-- CreateIndex
CREATE INDEX "drawing_revisions_issuedById_idx" ON "drawing_revisions"("issuedById");

-- CreateIndex
CREATE UNIQUE INDEX "drawing_revisions_workItemId_revision_key" ON "drawing_revisions"("workItemId", "revision");

-- AddForeignKey
ALTER TABLE "work_item_comments" ADD CONSTRAINT "work_item_comments_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item_comments" ADD CONSTRAINT "work_item_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawing_revisions" ADD CONSTRAINT "drawing_revisions_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawing_revisions" ADD CONSTRAINT "drawing_revisions_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

