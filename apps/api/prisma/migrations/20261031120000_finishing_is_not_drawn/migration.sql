-- Switch the drawing track off for finishing phases.
--
-- A one-time data correction, not a rule. The previous migration added
-- "tracksDrawings" defaulting to true, which was the safe default for an
-- existing database — it changed what was possible rather than what anybody
-- saw. The consequence was that every organisation then had to go and untick
-- the phases that are not drawn, and "go and untick it" is a poor answer to
-- "this sub-section should not be here".
--
-- So this sets the state everyone was going to set by hand. Matched on name,
-- case-insensitively, because that is the only thing that identifies the phase
-- across organisations — ids differ per tenant.
--
-- It runs ONCE. The Settings toggle stays authoritative afterwards: switching
-- Finishing back on sticks, and a phase created tomorrow still defaults to
-- tracking drawings. Nothing here is enforced by the application, which is why
-- it is a migration and not a filter in the UI — a filter would silently
-- override the setting every time the page rendered, and the toggle in Settings
-- would appear to do nothing.
UPDATE "phases"
SET "tracksDrawings" = false
WHERE lower(trim("name")) = 'finishing';
