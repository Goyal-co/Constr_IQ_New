-- AlterEnum
BEGIN;
CREATE TYPE "AttachmentEntity_new" AS ENUM ('PROJECT', 'DESIGN_FILE', 'MATERIAL', 'WORK_ITEM');
ALTER TABLE "attachments" ALTER COLUMN "entityType" TYPE "AttachmentEntity_new" USING ("entityType"::text::"AttachmentEntity_new");
ALTER TYPE "AttachmentEntity" RENAME TO "AttachmentEntity_old";
ALTER TYPE "AttachmentEntity_new" RENAME TO "AttachmentEntity";
DROP TYPE "public"."AttachmentEntity_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TemplateItemKind_new" AS ENUM ('DESIGN_FILE', 'WORK_ITEM', 'MATERIAL');
ALTER TABLE "template_items" ALTER COLUMN "kind" TYPE "TemplateItemKind_new" USING ("kind"::text::"TemplateItemKind_new");
ALTER TYPE "TemplateItemKind" RENAME TO "TemplateItemKind_old";
ALTER TYPE "TemplateItemKind_new" RENAME TO "TemplateItemKind";
DROP TYPE "public"."TemplateItemKind_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_assigneeId_fkey";

-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_projectId_fkey";

-- DropForeignKey
ALTER TABLE "drawings" DROP CONSTRAINT "drawings_completedById_fkey";

-- DropForeignKey
ALTER TABLE "drawings" DROP CONSTRAINT "drawings_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "drawings" DROP CONSTRAINT "drawings_projectId_fkey";

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "orderByDate" DATE,
ADD COLUMN     "workItemId" UUID,
ALTER COLUMN "leadTimeWeeks" DROP NOT NULL,
ALTER COLUMN "leadTimeWeeks" DROP DEFAULT;

-- AlterTable
ALTER TABLE "template_items" ALTER COLUMN "phaseId" DROP NOT NULL;

-- DropTable
DROP TABLE "activities";

-- DropTable
DROP TABLE "drawings";

-- CreateTable
CREATE TABLE "design_files" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_items" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "phaseId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "designComplete" BOOLEAN NOT NULL DEFAULT false,
    "designCompletedAt" TIMESTAMP(3),
    "designedById" UUID,
    "executionStatus" "ActivityStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "plannedStart" DATE,
    "plannedEnd" DATE,
    "actualStart" DATE,
    "actualEnd" DATE,
    "assigneeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "design_files_projectId_position_idx" ON "design_files"("projectId", "position");

-- CreateIndex
CREATE INDEX "work_items_projectId_phaseId_position_idx" ON "work_items"("projectId", "phaseId", "position");

-- CreateIndex
CREATE INDEX "work_items_projectId_executionStatus_idx" ON "work_items"("projectId", "executionStatus");

-- CreateIndex
CREATE INDEX "work_items_projectId_plannedEnd_idx" ON "work_items"("projectId", "plannedEnd");

-- CreateIndex
CREATE INDEX "work_items_assigneeId_idx" ON "work_items"("assigneeId");

-- CreateIndex
CREATE INDEX "work_items_phaseId_idx" ON "work_items"("phaseId");

-- CreateIndex
CREATE INDEX "materials_projectId_orderByDate_idx" ON "materials"("projectId", "orderByDate");

-- CreateIndex
CREATE INDEX "materials_workItemId_idx" ON "materials"("workItemId");

-- AddForeignKey
ALTER TABLE "design_files" ADD CONSTRAINT "design_files_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_files" ADD CONSTRAINT "design_files_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "phases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_designedById_fkey" FOREIGN KEY ("designedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

