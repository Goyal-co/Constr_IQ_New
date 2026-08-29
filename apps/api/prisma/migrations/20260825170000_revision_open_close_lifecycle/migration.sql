-- Revisions are raised, then closed out.
--
-- Previously a revision was created already issued, which lost the gap between
-- "this drawing needs changing" and "the new sheet has landed". That gap is
-- exactly the period worth seeing: site knows a change is coming and has
-- nothing to build from.

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('OPEN', 'ISSUED');

-- AlterTable
ALTER TABLE "drawing_revisions" ADD COLUMN     "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "openedById" UUID,
ADD COLUMN     "status" "RevisionStatus" NOT NULL DEFAULT 'OPEN';

-- Every revision that already exists was created by the old one-step route, so
-- it is issued by definition. Without this backfill they would all default to
-- OPEN and a project's drawing history would read as if nothing had ever been
-- issued.
UPDATE "drawing_revisions" SET "status" = 'ISSUED';

-- Their opener is whoever issued them — the only person the old model recorded.
UPDATE "drawing_revisions" SET "openedById" = "issuedById" WHERE "openedById" IS NULL;

-- CreateIndex
CREATE INDEX "drawing_revisions_openedById_idx" ON "drawing_revisions"("openedById");

-- AddForeignKey
ALTER TABLE "drawing_revisions" ADD CONSTRAINT "drawing_revisions_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An issued revision must carry its issue date, and an open one must not. The
-- application enforces this too; the constraint is what makes it true.
ALTER TABLE "drawing_revisions"
  ADD CONSTRAINT "drawing_revisions_issued_has_date"
  CHECK ("status" <> 'ISSUED' OR "issuedDate" IS NOT NULL);
