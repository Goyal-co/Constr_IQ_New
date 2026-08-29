import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STATUSES,
  type ActivityStatus,
  DESIGN_FILES_LABEL,
  formatRevision,
  MATERIAL_STATUS_LABELS,
  MATERIAL_STATUSES,
  type DesignFile,
  type Material,
  type Phase,
  type ProjectDetail,
  type WorkItem,
} from '@ciq/shared';
import { ApiRequestError, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRowExpansion } from '@/lib/useRowExpansion';
import {
  useBulkDesign,
  useBulkDesignFiles,
  useCreateDesignFile,
  useCreateMaterial,
  useCreateWorkItem,
  useDeleteDesignFile,
  useDeleteMaterial,
  useDeleteProject,
  useDeleteWorkItem,
  usePhases,
  useProject,
  useUpdateDesignFile,
  useUpdateMaterial,
  useUpdateWorkItem,
  useUsers,
} from '@/lib/queries';
import { formatCountdown, formatIso } from '@/lib/format';
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  ConfirmDialog,
  DeleteButton,
  EmptyState,
  Kpi,
  Menu,
  MenuItem,
  Modal,
  Progress,
  RowToggle,
  SkeletonRows,
  useToast,
} from '@/components/ui';
import {
  IconAlert,
  IconCalendar,
  IconCheck,
  IconDownload,
  IconDrawing,
  IconEdit,
  IconGantt,
  IconLayers,
  IconMessage,
  IconMore,
  IconPlus,
  IconProcurement,
  IconTrash,
  IconX,
} from '@/components/ui/Icons';
import {
  ActivityStatusBadge,
  PageHeader,
  ProcurementBadge,
  ProjectStatusBadge,
  SlippageChip,
} from '@/components/domain';
import { ActivityDrawer, CommentPrompt } from '@/components/domain/ActivityDrawer';
import { ProgrammeChart } from '@/components/domain/ProgrammeChart';
import { ProjectFormModal } from '@/components/domain/ProjectFormModal';

/**
 * A project has three sections.
 *
 *   Drawing     → Drawing Files, then one block per work phase
 *   Materials   → the buying list, each item tagged and optionally gating an item
 *   Execution   → the same work phases, showing the same rows as Drawing
 *
 * Drawing → Civil and Execution → Civil render the identical work items. There is
 * no synchronisation step because there is nothing to synchronise: one row, two
 * views of it.
 */
type SectionId = 'design' | 'materials' | 'execution';

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  // The id stays `design` — it is in every saved `?section=` link and in the
  // audit history. Only the label changed.
  { id: 'design', label: 'Drawing', icon: <IconDrawing size={15} /> },
  { id: 'materials', label: 'Materials', icon: <IconProcurement size={15} /> },
  { id: 'execution', label: 'Execution', icon: <IconGantt size={15} /> },
];

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const { can, settings } = useAuth();

  const { data: project, isLoading } = useProject(projectId);
  const section = (params.get('section') as SectionId | null) ?? 'design';
  const navigate = useNavigate();
  const removeProject = useDeleteProject();
  const toast = useToast();
  // Outside the Menu, which unmounts its children when it closes.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (isLoading) {
    return (
      <>
        <PageHeader title="Loading…" />
        <SkeletonRows rows={4} height={110} />
      </>
    );
  }

  if (!project) {
    return (
      <EmptyState
        title="Project not found"
        message="It may have been deleted, or you may not have access to it."
        action={
          <Link to="/projects" className="btn btn-primary">
            Back to projects
          </Link>
        }
      />
    );
  }

  const m = project.metrics;
  const hasDatedWork = project.workItems.some(
    (w) => w.plannedStart || w.plannedEnd || w.actualStart || w.actualEnd,
  );

  const setSection = (id: SectionId) => {
    const next = new URLSearchParams(params);
    if (id === 'design') next.delete('section');
    else next.set('section', id);
    next.delete('sub');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/projects">Projects</Link>
            <span>/</span>
            <span>{project.category.name}</span>
          </>
        }
        title={project.name}
        subtitle={
          <span className="row gap-3 wrap">
            <ProjectStatusBadge status={project.status} />
            <span className="row gap-1 text-sm">
              <IconCalendar size={14} />
              {project.handoverDate ? (
                <>
                  Handover {formatIso(project.handoverDate, settings.locale)} ·{' '}
                  <span
                    style={{
                      color:
                        (m.daysToHandover ?? 0) < 0
                          ? 'var(--danger-text)'
                          : (m.daysToHandover ?? 0) < 30
                            ? 'var(--warning-text)'
                            : 'inherit',
                    }}
                  >
                    {formatCountdown(m.daysToHandover)}
                  </span>
                </>
              ) : (
                <span className="text-warning">No handover date set</span>
              )}
            </span>
            {project.consultant && <span className="text-sm">· {project.consultant}</span>}
          </span>
        }
        actions={
          <>
            {can('report:export') && (
              <Button
                onClick={() =>
                  void downloadFile(`/exports/projects/${project.id}.xlsx`).catch(() => undefined)
                }
              >
                <IconDownload size={15} />
                Export
              </Button>
            )}
            {can('project:update') && (
              <Button variant="primary" onClick={() => setEditing(true)}>
                <IconEdit size={15} />
                Edit
              </Button>
            )}
            {can('project:delete') && (
              <Menu
                trigger={(triggerProps) => (
                  <Button iconOnly aria-label="More project actions" {...triggerProps}>
                    <IconMore size={16} />
                  </Button>
                )}
              >
                {(close) => (
                  <MenuItem
                    danger
                    onClick={() => {
                      close();
                      setConfirmingDelete(true);
                    }}
                  >
                    <IconTrash size={14} />
                    Delete project
                  </MenuItem>
                )}
              </Menu>
            )}
          </>
        }
      />

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete project"
          confirmLabel="Delete project"
          destructive
          loading={removeProject.isPending}
          message={
            <>
              <strong>{project.name}</strong> will be removed along with everything inside it:{' '}
              {project.designFiles.length} drawing file
              {project.designFiles.length === 1 ? '' : 's'}, {project.workItems.length} work item
              {project.workItems.length === 1 ? '' : 's'} and {project.materials.length} material
              {project.materials.length === 1 ? '' : 's'}. Portfolio figures and reports will stop
              counting it. This cannot be undone from the app.
            </>
          }
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            removeProject.mutate(project.id, {
              onSuccess: () => {
                toast.success('Project deleted', `${project.name} was removed.`);
                navigate('/projects');
              },
              onError: (error) =>
                toast.error(
                  'Could not delete this project',
                  error instanceof ApiRequestError ? error.message : undefined,
                ),
            });
          }}
        />
      )}

      {m.atRisk && (
        <div className="callout" data-tone="danger" style={{ marginBottom: 'var(--space-5)' }}>
          <IconAlert size={16} />
          <div>
            <strong>
              This project is flagged at risk — {m.riskReasons.length} rule
              {m.riskReasons.length === 1 ? '' : 's'} failing.
            </strong>
            <ul className="reason-chips" style={{ marginTop: 'var(--space-2)' }}>
              {m.riskReasons.map((reason) => (
                <li key={reason} className="reason-chip">
                  <IconAlert size={10} />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-auto-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <Kpi
          value={`${m.designPct}%`}
          label="Drawings"
          hint={`${m.designComplete} of ${m.designTotal} issued`}
          tone={m.designPct === 100 ? 'success' : undefined}
        />
        <Kpi
          value={`${m.executionPct}%`}
          label="Execution"
          hint={`${m.workItemsTotal} work items`}
        />
        <Kpi
          value={m.executionBlocked}
          label="Blocked"
          hint={m.executionBlocked === 0 ? 'Nothing waiting on materials' : 'Waiting on materials'}
          tone={m.executionBlocked > 0 ? 'danger' : 'success'}
        />
        <Kpi
          value={m.materialsOverdue}
          label="Orders overdue"
          hint={`${m.materialsOrdered} of ${m.materialsTotal} ordered`}
          tone={m.materialsOverdue > 0 ? 'danger' : 'success'}
        />
      </div>

      {/* The programme sits above the tabs, not inside Execution.
          It describes the whole project, and burying it in one section meant
          the schedule was invisible while reading drawings or materials —
          which is exactly when somebody asks whether the dates still hold. */}
      {/* Always rendered, never hidden.
          It used to disappear when nothing had a date, which is exactly when a
          reader most needs telling why — an absent chart reads as a broken one.
          Empty, it says what to fill in instead. */}
      <Card
        title="Timeline"
        icon={<IconGantt size={16} />}
        description="Built from each work item's own planned and actual dates. Hatched bars are late or blocked on materials."
        className="no-print"
      >
        {hasDatedWork ? (
          <ProgrammeChart
            workItems={project.workItems}
            designFiles={project.designFiles}
            handoverDate={project.handoverDate}
            locale={settings.locale}
          />
        ) : (
          <EmptyState
            icon={<IconGantt size={20} />}
            title="No dates set yet"
            message={
              project.workItems.length === 0
                ? 'Add work items under Drawing or Execution, then give them planned start and end dates. The timeline draws itself from those.'
                : `${project.workItems.length} work item${project.workItems.length === 1 ? ' has' : 's have'} no planned dates. Set a planned start and end under Execution and they appear here.`
            }
          />
        )}
      </Card>

      <nav className="tabs" style={{ marginBottom: 'var(--space-5)', marginTop: 'var(--space-5)' }}>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="tab"
            aria-selected={section === entry.id}
            onClick={() => setSection(entry.id)}
          >
            {entry.icon}
            {entry.label}
            <span className="tab-count">
              {entry.id === 'design'
                ? project.designFiles.length + project.workItems.length
                : entry.id === 'materials'
                  ? project.materials.length
                  : project.workItems.length}
            </span>
          </button>
        ))}
      </nav>

      {section === 'design' && <DrawingSection project={project} />}
      {section === 'materials' && <MaterialsSection project={project} />}
      {section === 'execution' && <ExecutionSection project={project} />}

      {editing && <ProjectFormModal project={project} onClose={() => setEditing(false)} />}
    </>
  );
}

/**
 * The work phases a project can use.
 *
 * Every active phase the organisation has defined, not merely the ones this
 * project already touches. Deriving it from rows in use created a deadlock: a
 * new project had no Civil sub-section, so there was nowhere to add the first
 * Civil work item.
 *
 * Phases already carrying rows are kept even if since archived, so history does
 * not vanish from a project that used them.
 */
function useProjectPhases(project: ProjectDetail): Phase[] {
  const { data: orgPhases } = usePhases();

  return useMemo(() => {
    const map = new Map<string, Phase>();
    for (const phase of orgPhases ?? []) map.set(phase.id, phase);
    for (const item of project.workItems) map.set(item.phase.id, item.phase);
    for (const material of project.materials) map.set(material.phase.id, material.phase);
    return [...map.values()].sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name),
    );
  }, [orgPhases, project.workItems, project.materials]);
}

// ---------------------------------------------------------------------------
// Section 1 — Drawing
// ---------------------------------------------------------------------------

/**
 * Everything on one scrolling page rather than a tab per phase.
 *
 * The sub-sections were tabs, which meant Civil and Finishing could not be read
 * together — and they are read together constantly, because a drawing package
 * is reviewed as a whole. Tabs also hid how much was outstanding in the phase
 * you were not looking at. Stacked, the whole drawing position is one scroll.
 *
 * The jump links stay: they scroll rather than switch, so they are a table of
 * contents rather than a filter.
 */
function DrawingSection({ project }: { project: ProjectDetail }) {
  const phases = useProjectPhases(project);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="stack gap-5">
      {phases.length > 0 && (
        <nav className="jump-nav no-print" aria-label="Jump to a drawing block">
          <button type="button" onClick={() => jump('drawing-files')}>
            {DESIGN_FILES_LABEL}
            <span className="jump-count">{project.designFiles.length}</span>
          </button>
          {phases.map((phase) => (
            <button key={phase.id} type="button" onClick={() => jump(`drawing-${phase.id}`)}>
              <span className="phase-swatch" style={{ background: phase.colour }} />
              {phase.name}
              <span className="jump-count">
                {project.workItems.filter((w) => w.phase.id === phase.id).length}
              </span>
            </button>
          ))}
        </nav>
      )}

      <div id="drawing-files" className="scroll-anchor">
        <DesignFilesPanel project={project} />
      </div>

      {phases.length === 0 ? (
        <NoPhasesYet />
      ) : (
        phases.map((phase) => (
          <div key={phase.id} id={`drawing-${phase.id}`} className="scroll-anchor">
            <DesignPhasePanel project={project} phase={phase} />
          </div>
        ))
      )}
    </div>
  );
}

function DesignFilesPanel({ project }: { project: ProjectDetail }) {
  const { can, settings } = useAuth();
  const toast = useToast();
  const update = useUpdateDesignFile(project.id);
  const create = useCreateDesignFile(project.id);
  const remove = useDeleteDesignFile(project.id);
  const bulk = useBulkDesignFiles(project.id);
  const [draft, setDraft] = useState('');

  /** The drawing whose comments and revisions are open, if any. */
  const rows = useRowExpansion();
  const [openFile, setOpenFile] = useState<string | null>(null);
  /** The drawing being marked issued, held while its note is written. */
  const [approving, setApproving] = useState<DesignFile | null>(null);

  const done = project.designFiles.filter((f) => f.isComplete).length;
  const overdue = project.designFiles.filter((f) => f.isOverdue).length;
  const allDone = done === project.designFiles.length && done > 0;
  const canEdit = can('drawing:update');

  return (
    <Card
      title={DESIGN_FILES_LABEL}
      icon={<IconDrawing size={16} />}
      description={
        overdue > 0
          ? `Drawings and documents. ${done} of ${project.designFiles.length} issued · ${overdue} past their expected date.`
          : `Drawings and documents. ${done} of ${project.designFiles.length} issued.`
      }
      actions={
        canEdit &&
        project.designFiles.length > 0 && (
          <Button
            size="sm"
            onClick={() =>
              bulk.mutate(
                { isComplete: !allDone },
                {
                  onSuccess: (r) =>
                    toast.success(
                      allDone ? 'Reopened' : 'Marked issued',
                      `${(r as { updated: number }).updated} document(s).`,
                    ),
                },
              )
            }
          >
            {allDone ? <IconX size={13} /> : <IconCheck size={13} />}
            {allDone ? 'Reopen all' : 'Mark all issued'}
          </Button>
        )
      }
    >
      {project.designFiles.length === 0 ? (
        <EmptyState
          icon={<IconDrawing size={20} />}
          title="No documents yet"
          message="Add the drawing set — concept, layouts, RCP, GFC and so on. These are issued rather than built, so they carry no site status."
        />
      ) : (
        <>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Progress
              value={Math.round((done / project.designFiles.length) * 100)}
              label="Drawing files issued"
            />
          </div>

          <div className="scroll-x">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Document</th>
                  <th>Rev</th>
                  <th>Expected</th>
                  <th>Issued</th>
                  <th>Issued by</th>
                  <th style={{ width: 96 }} />
                </tr>
              </thead>
              <tbody>
                {project.designFiles.map((file) => (
                  <tr key={file.id} {...rows.rowProps(file.id)}>
                    <td data-summary>
                      <Checkbox
                        checked={file.isComplete}
                        disabled={!canEdit}
                        label={`Mark ${file.name} issued`}
                        onChange={(next) => {
                          // Issuing prompts for a note; un-issuing does not —
                          // reversing a tick is usually a correction, and asking
                          // every time trains people to dismiss the dialog.
                          if (next) setApproving(file);
                          else update.mutate({ id: file.id, isComplete: false });
                        }}
                      />
                    </td>
                    <td data-label="Document">
                      <span
                        style={{
                          textDecoration: file.isComplete ? 'line-through' : undefined,
                          color: file.isComplete ? 'var(--text-tertiary)' : undefined,
                        }}
                      >
                        {file.name}
                      </span>
                      {/* Only while the row is collapsed on mobile — the Rev
                          column below carries it everywhere else, and showing
                          both put the same chip on screen twice. */}
                      <span
                        className="rev-chip rev-chip--summary"
                        data-issued={file.currentRevision > 0}
                      >
                        {formatRevision(file.currentRevision)}
                      </span>
                      <RowToggle expanded={rows.isOpen(file.id)} label={file.name} />
                    </td>
                    <td data-label="Rev">
                      <span className="rev-chip" data-issued={file.currentRevision > 0}>
                        {formatRevision(file.currentRevision)}
                      </span>
                    </td>
                    <td data-label="Expected">
                      {canEdit ? (
                        <input
                          className="input input-sm"
                          style={{ width: 138 }}
                          type="date"
                          aria-label={`Expected date for ${file.name}`}
                          defaultValue={file.expectedDate ?? ''}
                          onChange={(event) =>
                            update.mutate({
                              id: file.id,
                              expectedDate: event.target.value || null,
                            })
                          }
                        />
                      ) : (
                        <span className="text-xs">
                          {formatIso(file.expectedDate, settings.locale)}
                        </span>
                      )}
                      {file.isOverdue && (
                        <div
                          className="text-2xs"
                          style={{ marginTop: 2, color: 'var(--danger-text)' }}
                        >
                          {Math.abs(file.daysUntilExpected ?? 0)}d overdue
                        </div>
                      )}
                    </td>
                    <td data-label="Issued">
                      {/* Stamped automatically on completion, but editable so a
                          document issued last week keeps its real date. */}
                      {file.isComplete ? (
                        canEdit ? (
                          <input
                            className="input input-sm"
                            style={{ width: 138 }}
                            type="date"
                            aria-label={`Issued date for ${file.name}`}
                            defaultValue={file.completedDate ?? ''}
                            onChange={(event) =>
                              update.mutate({
                                id: file.id,
                                completedDate: event.target.value || null,
                              })
                            }
                          />
                        ) : (
                          <span className="text-xs">
                            {formatIso(file.completedDate, settings.locale)}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-tertiary">Not issued</span>
                      )}
                      {file.daysLate !== null && file.daysLate > 0 && (
                        <div
                          className="text-2xs"
                          style={{ marginTop: 2, color: 'var(--warning-text)' }}
                        >
                          {file.daysLate}d late
                        </div>
                      )}
                      {file.daysLate !== null && file.daysLate <= 0 && (
                        <div
                          className="text-2xs"
                          style={{ marginTop: 2, color: 'var(--success-text)' }}
                        >
                          {file.daysLate === 0 ? 'on time' : `${Math.abs(file.daysLate)}d early`}
                        </div>
                      )}
                    </td>
                    <td data-label="Issued by" className="text-xs text-secondary">
                      {file.completedBy?.name ?? '—'}
                    </td>
                    <td>
                      <span className="row gap-1">
                        <button
                          type="button"
                          className="row-action"
                          aria-label={`Comments and revisions for ${file.name}`}
                          title="Comments and revisions"
                          onClick={() => setOpenFile(file.id)}
                        >
                          <IconMessage size={13} />
                          {file.comments.length > 0 && (
                            <span className="row-action-count">{file.comments.length}</span>
                          )}
                        </button>

                        {can('drawing:delete') && (
                          <DeleteButton
                            label={file.name}
                            title="Delete drawing"
                            message={
                              <>
                                <strong>{file.name}</strong> will be removed from this
                                project&rsquo;s design list, along with its comments and revision
                                history. The drawing percentage is recalculated without it.
                              </>
                            }
                            onDelete={() => remove.mutate(file.id)}
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {openFile && (
        <ActivityDrawer
          projectId={project.id}
          subject={{
            kind: 'designFile',
            // Read back from the project rather than held in state, so a new
            // comment appears the moment the query invalidates.
            file: project.designFiles.find((f) => f.id === openFile) ?? project.designFiles[0],
          }}
          onClose={() => setOpenFile(null)}
        />
      )}

      {approving && (
        <CommentPrompt
          title="Mark drawing issued"
          confirmLabel="Mark issued"
          loading={update.isPending}
          message={
            <>
              <strong>{approving.name}</strong> will be recorded as issued.
            </>
          }
          onCancel={() => setApproving(null)}
          onConfirm={(comment) => {
            update.mutate(
              { id: approving.id, isComplete: true, comment },
              {
                onError: (error) =>
                  toast.error(
                    'Could not mark that issued',
                    error instanceof ApiRequestError ? error.message : undefined,
                  ),
              },
            );
            setApproving(null);
          }}
        />
      )}

      {can('drawing:create') && (
        <form
          className="add-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            create.mutate({ name: draft.trim() }, { onSuccess: () => setDraft('') });
          }}
        >
          <input
            className="input input-sm"
            placeholder="Add a drawing or document…"
            aria-label="Drawing file name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" variant="primary">
            <IconPlus size={14} />
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}

function DesignPhasePanel({ project, phase }: { project: ProjectDetail; phase?: Phase }) {
  const { can, settings } = useAuth();
  const toast = useToast();
  const update = useUpdateWorkItem(project.id);
  const create = useCreateWorkItem(project.id);
  const createMaterial = useCreateMaterial(project.id);
  const remove = useDeleteWorkItem(project.id);
  const bulk = useBulkDesign(project.id);
  const [draft, setDraft] = useState('');

  const rows = useRowExpansion();
  /** The activity whose comments and revisions are open, if any. */
  const [openItem, setOpenItem] = useState<string | null>(null);
  /** The activity being marked designed, held while its note is written. */
  const [approving, setApproving] = useState<WorkItem | null>(null);
  /** The activity a material is being raised against. */
  const [sourcing, setSourcing] = useState<WorkItem | null>(null);
  const [materialName, setMaterialName] = useState('');
  const [materialDate, setMaterialDate] = useState('');

  if (!phase) return <EmptyState title="No phases in use on this project yet" />;

  const items = project.workItems.filter((w) => w.phase.id === phase.id);
  const done = items.filter((w) => w.designComplete).length;
  const allDone = done === items.length && done > 0;
  const canEdit = can('drawing:update');

  return (
    <Card
      title={
        <span className="row gap-2">
          <span className="phase-swatch" style={{ background: phase.colour }} />
          {phase.name}
        </span>
      }
      description={`${done} of ${items.length} drawings issued. Site work cannot start on an item until its drawing is issued here.`}
      actions={
        canEdit &&
        items.length > 0 && (
          <Button
            size="sm"
            onClick={() =>
              bulk.mutate(
                { phaseId: phase.id, designComplete: !allDone },
                {
                  onSuccess: (r) =>
                    toast.success(
                      allDone ? 'Reopened' : 'Marked designed',
                      `${(r as { updated: number }).updated} item(s) in ${phase.name}.`,
                    ),
                },
              )
            }
          >
            {allDone ? <IconX size={13} /> : <IconCheck size={13} />}
            {allDone ? 'Reopen all' : 'Mark all designed'}
          </Button>
        )
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<IconLayers size={20} />}
          title={`No ${phase.name.toLowerCase()} work items yet`}
          message={`Add the packages of work in this phase — blockwork, flooring, and so on. Each appears here to track its design, and under Execution → ${phase.name} to track the build.`}
        />
      ) : (
        <>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Progress
              value={Math.round((done / items.length) * 100)}
              colour={phase.colour}
              label={`${phase.name} design`}
            />
          </div>

          <div className="scroll-x">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Work item</th>
                  <th>Rev</th>
                  <th>Drawing expected</th>
                  <th>Drawing issued</th>
                  <th>Build status</th>
                  <th style={{ width: 132 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} {...rows.rowProps(item.id)}>
                    <td data-summary>
                      <Checkbox
                        checked={item.designComplete}
                        disabled={!canEdit}
                        label={`Mark ${item.name} designed`}
                        onChange={(next) => {
                          // Approving opens the note prompt; un-approving does
                          // not — reversing a tick is usually a correction, and
                          // asking for a reason every time trains people to
                          // dismiss the dialog without reading it.
                          if (next) setApproving(item);
                          else update.mutate({ id: item.id, designComplete: false });
                        }}
                      />
                    </td>
                    <td data-summary data-label="Work item">
                      <span
                        className="grow truncate"
                        style={{
                          textDecoration: item.designComplete ? 'line-through' : undefined,
                          color: item.designComplete ? 'var(--text-tertiary)' : undefined,
                        }}
                      >
                        {item.name}
                      </span>
                      <RowToggle expanded={rows.isOpen(item.id)} label={item.name} />
                    </td>
                    <td data-label="Rev">
                      <span className="rev-chip" data-issued={item.currentRevision > 0}>
                        {formatRevision(item.currentRevision)}
                      </span>
                    </td>
                    <td data-label="Drawing expected">
                      {canEdit ? (
                        <input
                          className="input input-sm"
                          style={{ width: 138 }}
                          type="date"
                          aria-label={`Drawing expected date for ${item.name}`}
                          defaultValue={item.designExpectedDate ?? ''}
                          onChange={(event) =>
                            update.mutate({
                              id: item.id,
                              designExpectedDate: event.target.value || null,
                            })
                          }
                        />
                      ) : (
                        <span className="text-xs">
                          {formatIso(item.designExpectedDate, settings.locale)}
                        </span>
                      )}
                      {item.designOverdue && (
                        <div
                          className="text-2xs"
                          style={{ marginTop: 2, color: 'var(--danger-text)' }}
                        >
                          overdue
                        </div>
                      )}
                    </td>
                    <td data-label="Drawing issued">
                      {item.designComplete ? (
                        canEdit ? (
                          <input
                            className="input input-sm"
                            style={{ width: 138 }}
                            type="date"
                            aria-label={`Drawing issued date for ${item.name}`}
                            defaultValue={item.designCompletedDate ?? ''}
                            onChange={(event) =>
                              update.mutate({
                                id: item.id,
                                designCompletedDate: event.target.value || null,
                              })
                            }
                          />
                        ) : (
                          <span className="text-xs">
                            {formatIso(item.designCompletedDate, settings.locale)}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-tertiary">Not issued</span>
                      )}
                    </td>
                    <td data-label="Build status">
                      <ActivityStatusBadge status={item.executionStatus} />
                    </td>
                    <td>
                      <span className="row gap-1">
                        {/* Comment count doubles as the affordance: an activity
                            with discussion advertises it, one without still has
                            a way in. */}
                        <button
                          type="button"
                          className="row-action"
                          aria-label={`Comments and revisions for ${item.name}`}
                          title="Comments and revisions"
                          onClick={() => setOpenItem(item.id)}
                        >
                          <IconMessage size={13} />
                          {item.comments.length > 0 && (
                            <span className="row-action-count">{item.comments.length}</span>
                          )}
                        </button>

                        {can('material:create') && (
                          <button
                            type="button"
                            className="row-action"
                            aria-label={`Order a material for ${item.name}`}
                            title="Order a material for this item"
                            onClick={() => {
                              setSourcing(item);
                              setMaterialName('');
                              setMaterialDate('');
                            }}
                          >
                            <IconProcurement size={13} />
                          </button>
                        )}

                        {can('activity:delete') && (
                          <DeleteButton
                            label={item.name}
                            title="Delete work item"
                            message={
                              <>
                                <strong>{item.name}</strong> will be removed from both Drawing
                                &rarr; {phase.name} and Execution &rarr; {phase.name} — they are one
                                row shown twice, not two. Its comments and revision history go with
                                it. Any material linked to it stays, but loses its link.
                              </>
                            }
                            onDelete={() => remove.mutate(item.id)}
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {openItem && (
        <ActivityDrawer
          projectId={project.id}
          // Read back from the project rather than held in state, so the panel
          // re-renders with a new comment the moment the query invalidates.
          subject={{ kind: 'workItem', item: items.find((w) => w.id === openItem) ?? items[0] }}
          onClose={() => setOpenItem(null)}
        />
      )}

      {approving && (
        <CommentPrompt
          title="Mark drawing issued"
          confirmLabel="Mark issued"
          loading={update.isPending}
          message={
            <>
              <strong>{approving.name}</strong> will be recorded as issued, which unblocks site work
              on it once its materials have arrived.
            </>
          }
          onCancel={() => setApproving(null)}
          onConfirm={(comment) => {
            update.mutate(
              { id: approving.id, designComplete: true, comment },
              {
                onError: (error) =>
                  toast.error(
                    'Could not mark that issued',
                    error instanceof ApiRequestError ? error.message : undefined,
                  ),
              },
            );
            setApproving(null);
          }}
        />
      )}

      {/* Raising a material from the drawing rather than from the Materials
          section. Same row either way — the phase and the link are simply
          implied by where it was raised, instead of being re-selected. */}
      {sourcing && (
        <Modal
          title="Order a material"
          description={
            <>
              Tagged <strong>{phase.name}</strong> and linked to <strong>{sourcing.name}</strong>,
              which cannot be completed until it arrives.
            </>
          }
          onClose={() => setSourcing(null)}
          footer={
            <>
              <Button onClick={() => setSourcing(null)}>Cancel</Button>
              <Button
                variant="primary"
                loading={createMaterial.isPending}
                disabled={!materialName.trim()}
                onClick={() => {
                  createMaterial.mutate(
                    {
                      phaseId: phase.id,
                      name: materialName.trim(),
                      orderByDate: materialDate || null,
                      workItemId: sourcing.id,
                    },
                    {
                      onSuccess: () => {
                        toast.success(
                          'Material added',
                          `${materialName.trim()} now gates ${sourcing.name}.`,
                        );
                        setSourcing(null);
                      },
                      onError: (error) =>
                        toast.error(
                          'Could not add that material',
                          error instanceof ApiRequestError ? error.message : undefined,
                        ),
                    },
                  );
                }}
              >
                <IconPlus size={14} />
                Add material
              </Button>
            </>
          }
        >
          <div className="field">
            <label className="label" htmlFor="quick-material-name">
              Material
            </label>
            <input
              id="quick-material-name"
              className="input"
              autoFocus
              placeholder="e.g. Floor tiles"
              value={materialName}
              onChange={(event) => setMaterialName(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="quick-material-date">
              Order by <span className="text-tertiary">(optional)</span>
            </label>
            <input
              id="quick-material-date"
              className="input"
              type="date"
              value={materialDate}
              onChange={(event) => setMaterialDate(event.target.value)}
            />
            <p className="text-2xs text-tertiary">
              Leave blank if the date is not known yet — it can be set later in Materials.
            </p>
          </div>
        </Modal>
      )}

      {can('activity:create') && (
        <form
          className="add-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            create.mutate(
              { phaseId: phase.id, name: draft.trim() },
              {
                onSuccess: () => {
                  setDraft('');
                  toast.success('Work item added', `It is now in Execution → ${phase.name} too.`);
                },
              },
            );
          }}
        >
          <input
            className="input input-sm"
            placeholder={`Add a ${phase.name.toLowerCase()} work item…`}
            aria-label="Work item name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" variant="primary">
            <IconPlus size={14} />
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Materials
// ---------------------------------------------------------------------------

function MaterialsSection({ project }: { project: ProjectDetail }) {
  const { can, settings } = useAuth();
  const phases = usePhases();
  const update = useUpdateMaterial(project.id);
  const remove = useDeleteMaterial(project.id);

  const canEdit = can('material:update');

  const ordered = useMemo(
    () =>
      [...project.materials].sort((a, b) => {
        if (!a.orderByDate && !b.orderByDate) return a.name.localeCompare(b.name);
        if (!a.orderByDate) return 1;
        if (!b.orderByDate) return -1;
        return a.orderByDate.localeCompare(b.orderByDate);
      }),
    [project.materials],
  );

  const blocking = ordered.filter((m) => m.isBlocking);

  return (
    <div className="stack gap-5">
      {blocking.length > 0 && (
        <Callout tone="warning">
          <strong>
            {blocking.length} order{blocking.length === 1 ? '' : 's'} currently holding up work.
          </strong>{' '}
          A work item cannot be completed until every material linked to it is marked delivered.
        </Callout>
      )}

      <Card
        title="Materials"
        icon={<IconProcurement size={16} />}
        description={`Order-by dates you set. An item turns amber ${settings.orderSoonWindowDays} days before its date.`}
        padded={false}
      >
        {ordered.length === 0 ? (
          <div style={{ padding: 'var(--space-6) var(--space-5)' }}>
            <EmptyState
              icon={<IconProcurement size={20} />}
              title="Nothing to buy yet"
              message="Add what needs purchasing, tag it with a phase, and link it to the work item it holds up. That item then cannot be completed until this is marked delivered."
            />
          </div>
        ) : (
          <div className="scroll-x">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Order by</th>
                  <th>Material</th>
                  <th>Tag</th>
                  <th>Linked activity</th>
                  <th>Status</th>
                  <th>Supplier</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {ordered.map((material) => (
                  <MaterialRow
                    key={material.id}
                    material={material}
                    project={project}
                    canEdit={canEdit}
                    canDelete={can('material:delete')}
                    locale={settings.locale}
                    onUpdate={(patch) => update.mutate({ id: material.id, ...patch })}
                    onDelete={() => remove.mutate(material.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {can('material:create') && phases.data && phases.data.length > 0 && (
        <AddMaterialForm project={project} phases={phases.data} />
      )}
    </div>
  );
}

function MaterialRow({
  material,
  project,
  canEdit,
  canDelete,
  locale,
  onUpdate,
  onDelete,
}: {
  material: Material;
  project: ProjectDetail;
  canEdit: boolean;
  canDelete: boolean;
  locale: string;
  onUpdate: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  // The tag constrains the link: only work items in the same phase are offered.
  const linkable = project.workItems.filter((w) => w.phase.id === material.phase.id);

  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap' }}>
        {canEdit ? (
          <input
            className="input input-sm"
            style={{ width: 138 }}
            type="date"
            aria-label={`Order-by date for ${material.name}`}
            defaultValue={material.orderByDate ?? ''}
            onChange={(event) => onUpdate({ orderByDate: event.target.value || null })}
          />
        ) : (
          <span className="text-sm">{formatIso(material.orderByDate, locale)}</span>
        )}
        {material.daysUntilOrderBy !== null && (
          <div
            className="text-2xs"
            style={{
              marginTop: 2,
              color:
                material.daysUntilOrderBy < 0
                  ? 'var(--danger-text)'
                  : material.daysUntilOrderBy <= 21
                    ? 'var(--warning-text)'
                    : 'var(--text-tertiary)',
            }}
          >
            {material.daysUntilOrderBy < 0
              ? `${Math.abs(material.daysUntilOrderBy)}d overdue`
              : `in ${material.daysUntilOrderBy}d`}
          </div>
        )}
      </td>

      <td className="font-medium">{material.name}</td>

      <td>
        {canEdit ? (
          <select
            className="select input-sm"
            style={{ width: 118 }}
            aria-label={`Tag for ${material.name}`}
            value={material.phase.id}
            // Changing the tag can invalidate the link, so clear it here too.
            onChange={(event) => onUpdate({ phaseId: event.target.value, workItemId: null })}
          >
            {[...new Map(project.workItems.map((w) => [w.phase.id, w.phase])).values()].map(
              (phase) => (
                <option key={phase.id} value={phase.id}>
                  {phase.name}
                </option>
              ),
            )}
          </select>
        ) : (
          <span className="phase-chip">
            <span className="phase-swatch" style={{ background: material.phase.colour }} />
            {material.phase.name}
          </span>
        )}
      </td>

      <td>
        {canEdit ? (
          <select
            className="select input-sm"
            style={{ width: 200 }}
            aria-label={`Linked activity for ${material.name}`}
            value={material.linkedWorkItem?.id ?? ''}
            onChange={(event) => onUpdate({ workItemId: event.target.value || null })}
          >
            <option value="">Not linked</option>
            {linkable.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs">{material.linkedWorkItem?.name ?? '—'}</span>
        )}
      </td>

      <td>
        {canEdit ? (
          <select
            className="select input-sm"
            style={{ width: 118 }}
            aria-label={`Status for ${material.name}`}
            value={material.status}
            onChange={(event) => onUpdate({ status: event.target.value })}
          >
            {MATERIAL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {MATERIAL_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        ) : (
          <ProcurementBadge state={material.procurementState} />
        )}
        <div style={{ marginTop: 4 }}>
          {material.isBlocking ? (
            <Badge tone="danger">Blocking</Badge>
          ) : (
            <ProcurementBadge state={material.procurementState} />
          )}
        </div>
      </td>

      <td className="text-xs text-secondary">{material.supplier ?? '—'}</td>

      <td>
        {canDelete && (
          <DeleteButton
            label={material.name}
            title="Delete material"
            message={
              <>
                <strong>{material.name}</strong> will be removed from the buying list.
                {material.linkedWorkItem
                  ? ` ${material.linkedWorkItem.name} is gated on it, and will be free to start once this is deleted.`
                  : ''}
              </>
            }
            onDelete={onDelete}
          />
        )}
      </td>
    </tr>
  );
}

/**
 * Add a material.
 *
 * Choosing the tag filters the linked-activity dropdown to that phase, which is
 * the behaviour the section is built around: tag Civil, and only Civil work
 * items are offered to gate.
 */
function AddMaterialForm({ project, phases }: { project: ProjectDetail; phases: Phase[] }) {
  const toast = useToast();
  const create = useCreateMaterial(project.id);
  const { settings } = useAuth();

  const [name, setName] = useState('');
  const [phaseId, setPhaseId] = useState(phases[0]?.id ?? '');
  const [orderByDate, setOrderByDate] = useState('');
  const [workItemId, setWorkItemId] = useState('');
  const [supplier, setSupplier] = useState('');
  const [leadTimeWeeks, setLeadTimeWeeks] = useState<number | ''>('');

  // The dropdown narrows to the chosen tag. Changing the tag clears a stale pick.
  const linkable = project.workItems.filter((w) => w.phase.id === phaseId);

  const calculateDate = () => {
    if (!project.handoverDate || leadTimeWeeks === '') return;
    const handover = new Date(`${project.handoverDate}T00:00:00Z`);
    handover.setUTCDate(handover.getUTCDate() - Number(leadTimeWeeks) * 7);
    setOrderByDate(handover.toISOString().slice(0, 10));
  };

  return (
    <Card
      title="Add a material"
      description="Tag it with a phase, then link it to the activity it holds up."
    >
      <form
        className="stack gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !phaseId) return;
          create.mutate(
            {
              phaseId,
              name: name.trim(),
              orderByDate: orderByDate || null,
              leadTimeWeeks: leadTimeWeeks === '' ? null : Number(leadTimeWeeks),
              workItemId: workItemId || null,
              supplier: supplier.trim() || null,
            },
            {
              onSuccess: (material) => {
                setName('');
                setOrderByDate('');
                setWorkItemId('');
                setSupplier('');
                setLeadTimeWeeks('');
                toast.success(
                  'Material added',
                  material.linkedWorkItem
                    ? `${material.linkedWorkItem.name} cannot complete until this is delivered.`
                    : undefined,
                );
              },
              onError: (error) =>
                toast.error(
                  'Could not add the material',
                  error instanceof ApiRequestError ? error.message : undefined,
                ),
            },
          );
        }}
      >
        <div className="row gap-3 wrap">
          <input
            className="input"
            style={{ flex: '2 1 220px' }}
            placeholder="Material name, e.g. Floor tiles"
            aria-label="Material name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="row gap-2" style={{ flex: '1 1 200px' }}>
            <input
              className="input"
              type="date"
              aria-label="Order by date"
              value={orderByDate}
              onChange={(event) => setOrderByDate(event.target.value)}
            />
          </div>
        </div>

        <div className="row gap-3 wrap">
          <label className="row gap-2" style={{ flex: '1 1 160px' }}>
            <span className="text-xs text-tertiary shrink-0">Tag</span>
            <select
              className="select"
              aria-label="Tag"
              value={phaseId}
              onChange={(event) => {
                setPhaseId(event.target.value);
                setWorkItemId('');
              }}
            >
              {phases.map((phase) => (
                <option key={phase.id} value={phase.id}>
                  {phase.name}
                </option>
              ))}
            </select>
          </label>

          <label className="row gap-2" style={{ flex: '2 1 260px' }}>
            <span className="text-xs text-tertiary shrink-0">Links to</span>
            <select
              className="select"
              aria-label="Linked activity"
              value={workItemId}
              onChange={(event) => setWorkItemId(event.target.value)}
            >
              <option value="">Nothing — informational only</option>
              {linkable.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="row gap-3 wrap">
          <input
            className="input"
            style={{ flex: '1 1 180px' }}
            placeholder="Supplier (optional)"
            aria-label="Supplier"
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
          />
          <div className="row gap-2" style={{ flex: '1 1 220px' }}>
            <input
              className="input tnum"
              style={{ width: 110 }}
              type="number"
              min={0}
              max={104}
              placeholder="Lead wks"
              aria-label="Lead time in weeks"
              value={leadTimeWeeks}
              onChange={(event) =>
                setLeadTimeWeeks(event.target.value === '' ? '' : Number(event.target.value))
              }
            />
            <Button
              type="button"
              size="sm"
              disabled={!project.handoverDate || leadTimeWeeks === ''}
              onClick={calculateDate}
              title={
                project.handoverDate
                  ? 'Work the order-by date back from handover'
                  : 'Set a handover date on the project first'
              }
            >
              Calculate date
            </Button>
          </div>
          <Button type="submit" variant="primary">
            <IconPlus size={14} />
            Add material
          </Button>
        </div>

        {linkable.length === 0 && (
          <p className="text-xs text-tertiary">
            No work items in this phase yet — add them under Drawing →{' '}
            {phases.find((p) => p.id === phaseId)?.name ?? 'the phase'} first, and they will be
            offered here.
          </p>
        )}
        <p className="text-2xs text-tertiary">
          Currency and default lead time come from your organisation settings (
          {settings.defaultLeadTimeWeeks} weeks).
        </p>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Execution
// ---------------------------------------------------------------------------

/**
 * Execution, stacked like Drawing.
 *
 * Same reasoning: Civil and Finishing are read together, and a tab hid whatever
 * was outstanding in the other one. The Timeline that used to head this section
 * now sits above the tabs, where it describes the whole project.
 */
function ExecutionSection({ project }: { project: ProjectDetail }) {
  const phases = useProjectPhases(project);

  if (phases.length === 0) return <NoPhasesYet />;

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="stack gap-5">
      {phases.length > 1 && (
        <nav className="jump-nav no-print" aria-label="Jump to a phase">
          {phases.map((phase) => (
            <button key={phase.id} type="button" onClick={() => jump(`execution-${phase.id}`)}>
              <span className="phase-swatch" style={{ background: phase.colour }} />
              {phase.name}
              <span className="jump-count">
                {project.workItems.filter((w) => w.phase.id === phase.id).length}
              </span>
            </button>
          ))}
        </nav>
      )}

      {phases.map((phase) => (
        <div key={phase.id} id={`execution-${phase.id}`} className="scroll-anchor">
          <ExecutionPhasePanel
            project={project}
            phase={phase}
            items={project.workItems.filter((w) => w.phase.id === phase.id)}
          />
        </div>
      ))}
    </div>
  );
}

/** Shown when the organisation has defined no work phases at all. */
function NoPhasesYet() {
  const { can } = useAuth();
  return (
    <EmptyState
      icon={<IconLayers size={20} />}
      title="No work phases defined"
      message="Drawing and Execution are organised into phases such as Civil and Finishing. An administrator sets these up once, and every project then uses them."
      action={
        can('org:update') ? (
          <Link to="/settings/phases" className="btn btn-primary">
            Set up phases
          </Link>
        ) : undefined
      }
    />
  );
}

function ExecutionPhasePanel({
  project,
  phase,
  items,
}: {
  project: ProjectDetail;
  phase: Phase;
  items: WorkItem[];
}) {
  const { can, settings } = useAuth();
  const users = useUsers();
  const update = useUpdateWorkItem(project.id);
  const create = useCreateWorkItem(project.id);
  const remove = useDeleteWorkItem(project.id);
  const toast = useToast();
  const [draft, setDraft] = useState('');

  const rows = useRowExpansion();
  const [openItem, setOpenItem] = useState<string | null>(null);
  /**
   * A status change waiting on its note.
   *
   * Only the two that mean something is finished or under way prompt — moving
   * to Blocked or back to Not started is usually a correction, and prompting on
   * every transition trains people to dismiss the dialog unread.
   */
  const [pending, setPending] = useState<{ item: WorkItem; status: ActivityStatus } | null>(null);

  const canEdit = can('activity:update');
  const done = items.filter((w) => w.executionStatus === 'DONE').length;
  // Anything that cannot progress, whether the hold-up is design or materials.
  const blocked = items.filter((w) => !w.gate.canStart && w.executionStatus !== 'DONE');

  const patch = (id: string, name: string, body: Record<string, unknown>) =>
    update.mutate(
      { id, ...body },
      {
        onError: (error) => {
          // A 409 here is the material gate. Show what it named rather than a
          // generic failure — the user needs to know which order to chase.
          if (error instanceof ApiRequestError && error.status === 409) {
            toast.error(`${name} is blocked`, error.message);
          } else {
            toast.error(
              'Could not update this item',
              error instanceof ApiRequestError ? error.message : undefined,
            );
          }
        },
      },
    );

  return (
    <Card
      title={
        <span className="row gap-2">
          <span className="phase-swatch" style={{ background: phase.colour }} />
          {phase.name}
        </span>
      }
      description={`${done} of ${items.length} complete. Same rows as Drawing → ${phase.name}.`}
      padded={false}
    >
      {blocked.length > 0 && (
        <div style={{ padding: 'var(--space-4) var(--space-5) 0' }}>
          <Callout tone="danger">
            <div>
              <strong>
                {blocked.length} item{blocked.length === 1 ? '' : 's'} cannot be started or
                completed yet.
              </strong>
              <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-4)' }}>
                {blocked.map((item) => (
                  <li key={item.id}>
                    {item.name} — {item.gate.reasons.join(' and ')}
                    {item.gate.pendingMaterials.length > 0 &&
                      ` (${item.gate.pendingMaterials.map((m) => m.name).join(', ')})`}
                  </li>
                ))}
              </ul>
            </div>
          </Callout>
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ padding: 'var(--space-6) var(--space-5)' }}>
          <EmptyState
            icon={<IconGantt size={20} />}
            title={`No ${phase.name.toLowerCase()} work items yet`}
            message={`Add the packages of work being built in this phase. Each one also appears under Drawing → ${phase.name}, where you track whether its drawing has been issued.`}
          />
        </div>
      ) : (
        <div className="scroll-x">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>Work item</th>
                <th>Planned start</th>
                <th>Planned end</th>
                <th>Actual start</th>
                <th>Actual end</th>
                <th>Slippage</th>
                <th>Status</th>
                <th>Assignee</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isBlocked = !item.gate.canStart && item.executionStatus !== 'DONE';

                const dateCell = (
                  field: 'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd',
                  label: string,
                ) => (
                  <td data-label="Work item">
                    {canEdit ? (
                      <input
                        className="input input-sm"
                        style={{ width: 132 }}
                        type="date"
                        aria-label={`${label} for ${item.name}`}
                        defaultValue={item[field] ?? ''}
                        onChange={(event) =>
                          patch(item.id, item.name, { [field]: event.target.value || null })
                        }
                      />
                    ) : (
                      <span className="text-xs">{formatIso(item[field], settings.locale)}</span>
                    )}
                  </td>
                );

                return (
                  <tr key={item.id} {...rows.rowProps(item.id)}>
                    <td data-summary data-label="Work item">
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="font-medium truncate">{item.name}</div>
                        {isBlocked && (
                          <div className="text-2xs" style={{ color: 'var(--danger-text)' }}>
                            {item.gate.reasons.join(' · ')}
                            {item.gate.pendingMaterials.length > 0 &&
                              `: ${item.gate.pendingMaterials.map((m) => m.name).join(', ')}`}
                          </div>
                        )}
                      </div>
                      {/* Status rides the summary so a collapsed row still says
                          what the activity is doing — the one thing somebody
                          scanning the list actually wants. */}
                      <span className="row-summary-status">
                        <ActivityStatusBadge status={item.executionStatus} />
                      </span>
                      <RowToggle expanded={rows.isOpen(item.id)} label={item.name} />
                    </td>
                    {dateCell('plannedStart', 'Planned start')}
                    {dateCell('plannedEnd', 'Planned end')}
                    {dateCell('actualStart', 'Actual start')}
                    {dateCell('actualEnd', 'Actual end')}
                    <td data-label="Planned start">
                      <SlippageChip slippage={item.slippage} />
                    </td>
                    <td data-label="Planned end">
                      {canEdit ? (
                        <select
                          className="select input-sm"
                          style={{ width: 130 }}
                          aria-label={`Status for ${item.name}`}
                          title={isBlocked ? item.gate.reasons.join(' and ') : undefined}
                          value={item.executionStatus}
                          onChange={(event) => {
                            const next = event.target.value as ActivityStatus;
                            if (next === 'DONE' || next === 'IN_PROGRESS') {
                              setPending({ item, status: next });
                            } else {
                              patch(item.id, item.name, { executionStatus: next });
                            }
                          }}
                        >
                          {ACTIVITY_STATUSES.map((status) => {
                            // Both progress statuses are gated. Blocked and Not
                            // started stay reachable: flagging a problem must
                            // never itself be blocked, and reverting undoes a
                            // mistake. The server refuses the same transitions —
                            // disabling here just avoids discovering that by
                            // failing.
                            const gated =
                              (status === 'IN_PROGRESS' && !item.gate.canStart) ||
                              (status === 'DONE' && !item.gate.canComplete);
                            return (
                              <option key={status} value={status} disabled={gated}>
                                {ACTIVITY_STATUS_LABELS[status]}
                                {gated ? ' — blocked' : ''}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <ActivityStatusBadge status={item.executionStatus} />
                      )}
                    </td>
                    <td data-label="Actual start">
                      {canEdit ? (
                        <select
                          className="select input-sm"
                          style={{ width: 140 }}
                          aria-label={`Assignee for ${item.name}`}
                          value={item.assignee?.id ?? ''}
                          onChange={(event) =>
                            patch(item.id, item.name, { assigneeId: event.target.value || null })
                          }
                        >
                          <option value="">Unassigned</option>
                          {users.data?.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs">{item.assignee?.name ?? '—'}</span>
                      )}
                    </td>
                    <td>
                      <span className="row gap-1">
                        <button
                          type="button"
                          className="row-action"
                          aria-label={`Comments and revisions for ${item.name}`}
                          title="Comments and revisions"
                          onClick={() => setOpenItem(item.id)}
                        >
                          <IconMessage size={13} />
                          {item.comments.length > 0 && (
                            <span className="row-action-count">{item.comments.length}</span>
                          )}
                        </button>

                        {can('activity:delete') && (
                          <DeleteButton
                            label={item.name}
                            title="Delete work item"
                            message={
                              <>
                                <strong>{item.name}</strong> will be removed from both Execution
                                &rarr; {phase.name} and Drawing &rarr; {phase.name} — they are one
                                row shown twice, not two. Its comments and revision history go with
                                it.
                                {item.gate.pendingMaterials.length > 0 &&
                                  ` The ${item.gate.pendingMaterials.length} material(s) currently gating it stay on the buying list, but lose their link.`}
                              </>
                            }
                            onDelete={() =>
                              remove.mutate(item.id, {
                                onSuccess: () =>
                                  toast.success('Work item deleted', `${item.name} was removed.`),
                                onError: (error) =>
                                  toast.error(
                                    'Could not delete this work item',
                                    error instanceof ApiRequestError ? error.message : undefined,
                                  ),
                              })
                            }
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openItem && (
        <ActivityDrawer
          projectId={project.id}
          subject={{ kind: 'workItem', item: items.find((w) => w.id === openItem) ?? items[0] }}
          onClose={() => setOpenItem(null)}
        />
      )}

      {pending && (
        <CommentPrompt
          title={
            pending.status === 'DONE'
              ? 'Mark complete'
              : `Mark ${ACTIVITY_STATUS_LABELS[pending.status].toLowerCase()}`
          }
          confirmLabel={pending.status === 'DONE' ? 'Mark complete' : 'Confirm'}
          loading={update.isPending}
          message={
            <>
              <strong>{pending.item.name}</strong> will move to{' '}
              {ACTIVITY_STATUS_LABELS[pending.status]}.
            </>
          }
          onCancel={() => setPending(null)}
          onConfirm={(comment) => {
            patch(pending.item.id, pending.item.name, {
              executionStatus: pending.status,
              ...(comment ? { comment } : {}),
            });
            setPending(null);
          }}
        />
      )}

      {can('activity:create') && (
        <form
          className="add-row"
          style={{ margin: '0 var(--space-5) var(--space-4)' }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            create.mutate(
              { phaseId: phase.id, name: draft.trim() },
              {
                onSuccess: () => {
                  setDraft('');
                  toast.success('Work item added', `It is now in Drawing → ${phase.name} too.`);
                },
                onError: (error) =>
                  toast.error(
                    'Could not add the work item',
                    error instanceof ApiRequestError ? error.message : undefined,
                  ),
              },
            );
          }}
        >
          <input
            className="input input-sm"
            placeholder={`Add a ${phase.name.toLowerCase()} work item…`}
            aria-label="Work item name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" variant="primary">
            <IconPlus size={14} />
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}
