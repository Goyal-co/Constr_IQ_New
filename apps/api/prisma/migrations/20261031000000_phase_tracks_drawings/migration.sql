-- Whether a phase's activities carry a drawing track.
--
-- Defaults to true so every existing phase keeps the behaviour it has today:
-- this migration changes what is possible, not what is shown. An organisation
-- opts a phase out from Settings -> Phases afterwards.
ALTER TABLE "phases" ADD COLUMN "tracksDrawings" BOOLEAN NOT NULL DEFAULT true;
