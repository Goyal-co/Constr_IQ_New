-- AlterTable
ALTER TABLE "design_files" ADD COLUMN     "completedDate" DATE,
ADD COLUMN     "expectedDate" DATE;

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "designCompletedDate" DATE,
ADD COLUMN     "designExpectedDate" DATE;

