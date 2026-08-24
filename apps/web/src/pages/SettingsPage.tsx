import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STATUSES,
  PHASE_COLOUR_CHOICES,
  TEMPLATE_ITEM_KIND_LABELS,
  TEMPLATE_ITEM_KIND_PLURALS,
  TEMPLATE_ITEM_KINDS,
  type Category,
  type OrganisationSettings,
  type Phase,
  type TemplateDetail,
  type TemplateItemKind,
} from '@ciq/shared';
import { useAuth } from '@/lib/auth';
import {
  useCategories,
  useCreateCategory,
  useCreatePhase,
  useCreateTemplate,
  useDeleteCategory,
  useDeletePhase,
  useDeleteTemplate,
  useDuplicateTemplate,
  useOrganisationSettings,
  usePhases,
  useSetTemplateItems,
  useTemplate,
  useTemplates,
  useUpdateCategory,
  useUpdatePhase,
  useUpdateSettings,
} from '@/lib/queries';
import { ApiRequestError } from '@/lib/api';
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  SkeletonRows,
  Switch,
  useToast,
} from '@/components/ui';
import {
  IconLayers,
  IconPlus,
  IconSettings,
  IconTag,
  IconTemplate,
  IconTrash,
} from '@/components/ui/Icons';
import { PageHeader } from '@/components/domain';

/**
 * Settings.
 *
 * This is where the "no hard-coded anything" promise is actually kept. Phases,
 * categories, templates and every threshold in the engine are edited here, and
 * changing one moves the numbers on every other screen immediately.
 */
export function SettingsPage() {
  const { can } = useAuth();

  const tabs = [
    { to: 'thresholds', label: 'Thresholds & rules', icon: <IconSettings size={15} /> },
    { to: 'phases', label: 'Phases', icon: <IconLayers size={15} /> },
    { to: 'categories', label: 'Categories', icon: <IconTag size={15} /> },
    { to: 'templates', label: 'Templates', icon: <IconTemplate size={15} /> },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Everything the engine calculates from. Nothing here ships with the product — it is all yours to define."
      />

      {!can('org:update') && (
        <Callout tone="info">
          You can view this configuration but not change it. Ask an owner or administrator to make
          edits.
        </Callout>
      )}

      <nav className="tabs" style={{ margin: 'var(--space-4) 0 var(--space-5)' }}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/settings/${tab.to}`}
            className="tab"
            aria-selected={window.location.pathname.endsWith(tab.to)}
          >
            {tab.icon}
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<Navigate to="thresholds" replace />} />
        <Route path="thresholds" element={<ThresholdsPanel />} />
        <Route path="phases" element={<PhasesPanel />} />
        <Route path="categories" element={<CategoriesPanel />} />
        <Route path="templates" element={<TemplatesPanel />} />
      </Routes>
    </>
  );
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

function ThresholdsPanel() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, isLoading } = useOrganisationSettings();
  const updateSettings = useUpdateSettings();

  const [draft, setDraft] = useState<OrganisationSettings | null>(null);
  const editable = can('org:update');

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  if (isLoading || !draft) return <SkeletonRows rows={3} height={140} />;

  const set = <K extends keyof OrganisationSettings>(key: K, value: OrganisationSettings[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);

  return (
    <div className="stack gap-5">
      <Callout tone="info">
        These numbers are the only tuning in the system. Change one and every percentage, badge and
        report figure recalculates from it — there is no second copy of these rules in the code.
      </Callout>

      <Card
        title="Procurement warning"
        description="How much notice you want before a purchase order must be raised."
      >
        <div className="grid grid-2">
          <Field
            label="Order-soon window (days)"
            hint={`A material turns amber this many days before its order-by date. Currently ${draft.orderSoonWindowDays} days.`}
          >
            {(props) => (
              <input
                {...props}
                className="input"
                type="number"
                min={0}
                max={365}
                disabled={!editable}
                value={draft.orderSoonWindowDays}
                onChange={(event) => set('orderSoonWindowDays', Number(event.target.value))}
              />
            )}
          </Field>
          <Field
            label="Default lead time (weeks)"
            hint="Applied to a new material when no lead time is given."
          >
            {(props) => (
              <input
                {...props}
                className="input"
                type="number"
                min={0}
                max={104}
                disabled={!editable}
                value={draft.defaultLeadTimeWeeks}
                onChange={(event) => set('defaultLeadTimeWeeks', Number(event.target.value))}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card
        title="Risk rules"
        description="What causes a project to be flagged at risk on the dashboard and in the report."
      >
        <div className="grid grid-2" style={{ marginBottom: 'var(--space-4)' }}>
          <Field
            label="Handover window (days)"
            hint="Drawing progress is only judged once handover is within this many days."
          >
            {(props) => (
              <input
                {...props}
                className="input"
                type="number"
                min={0}
                max={730}
                disabled={!editable}
                value={draft.riskHandoverWindowDays}
                onChange={(event) => set('riskHandoverWindowDays', Number(event.target.value))}
              />
            )}
          </Field>
          <Field
            label="Drawing threshold (%)"
            hint="Inside that window, drawings below this percentage flag the project."
          >
            {(props) => (
              <input
                {...props}
                className="input"
                type="number"
                min={0}
                max={100}
                disabled={!editable}
                value={draft.riskDrawingThresholdPct}
                onChange={(event) => set('riskDrawingThresholdPct', Number(event.target.value))}
              />
            )}
          </Field>
        </div>

        <div className="stack gap-3">
          <ToggleRow
            label="Flag on overdue material orders"
            hint="A single order past its order-by date marks the project at risk."
            checked={draft.riskOnOverdueOrder}
            disabled={!editable}
            onChange={(value) => set('riskOnOverdueOrder', value)}
          />
          <ToggleRow
            label="Flag on activities behind plan"
            hint="Any activity past its planned end without an actual end marks the project at risk."
            checked={draft.riskOnSlippedActivity}
            disabled={!editable}
            onChange={(value) => set('riskOnSlippedActivity', value)}
          />
        </div>
      </Card>

      <Card
        title="Execution weighting"
        description="What each activity status contributes to the execution percentage."
      >
        <div className="grid grid-auto-sm">
          {ACTIVITY_STATUSES.map((status) => (
            <Field
              key={status}
              label={ACTIVITY_STATUS_LABELS[status]}
              hint={status === 'BLOCKED' ? 'Blocked work is stalled, not partial.' : undefined}
            >
              {(props) => (
                <input
                  {...props}
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  disabled={!editable}
                  value={draft.activityStatusWeights[status]}
                  onChange={(event) =>
                    set('activityStatusWeights', {
                      ...draft.activityStatusWeights,
                      [status]: Number(event.target.value),
                    })
                  }
                />
              )}
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Regional and scheduling" description="Formatting and when the digest goes out.">
        <div className="grid grid-2">
          <Field
            label="Locale"
            hint="Drives date and number formatting across the app and exports."
          >
            {(props) => (
              <select
                {...props}
                className="select"
                disabled={!editable}
                value={draft.locale}
                onChange={(event) => set('locale', event.target.value)}
              >
                <option value="en-GB">English (United Kingdom)</option>
                <option value="en-IN">English (India)</option>
                <option value="en-US">English (United States)</option>
                <option value="en-AE">English (United Arab Emirates)</option>
              </select>
            )}
          </Field>
          <Field label="Default currency" hint="ISO 4217 code used for new projects.">
            {(props) => (
              <input
                {...props}
                className="input"
                maxLength={3}
                disabled={!editable}
                value={draft.defaultCurrency}
                onChange={(event) => set('defaultCurrency', event.target.value.toUpperCase())}
              />
            )}
          </Field>
          <Field label="Digest day" hint="Which day the weekly management email is sent.">
            {(props) => (
              <select
                {...props}
                className="select"
                disabled={!editable}
                value={draft.digestDayOfWeek}
                onChange={(event) => set('digestDayOfWeek', Number(event.target.value))}
              >
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                  (day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ),
                )}
              </select>
            )}
          </Field>
          <Field label="Handover reminder (days)" hint="How far ahead the nightly sweep warns.">
            {(props) => (
              <input
                {...props}
                className="input"
                type="number"
                min={0}
                max={365}
                disabled={!editable}
                value={draft.handoverReminderDays}
                onChange={(event) => set('handoverReminderDays', Number(event.target.value))}
              />
            )}
          </Field>
        </div>
      </Card>

      {editable && (
        <div className="row gap-3" style={{ position: 'sticky', bottom: 'var(--space-4)' }}>
          <Button
            variant="primary"
            disabled={!dirty}
            loading={updateSettings.isPending}
            onClick={() =>
              updateSettings.mutate(draft, {
                onSuccess: () =>
                  toast.success('Settings saved', 'Every figure has been recalculated.'),
                onError: (error) =>
                  toast.error(
                    'Could not save settings',
                    error instanceof ApiRequestError ? error.message : undefined,
                  ),
              })
            }
          >
            Save changes
          </Button>
          {dirty && <Button onClick={() => data && setDraft(data)}>Discard</Button>}
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="row-between gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-tertiary">{hint}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

function PhasesPanel() {
  const { can } = useAuth();
  const toast = useToast();
  const { data: phases, isLoading } = usePhases(true);
  const createPhase = useCreatePhase();
  const updatePhase = useUpdatePhase();
  const deletePhase = useDeletePhase();

  const [name, setName] = useState('');
  const [colour, setColour] = useState<string>(PHASE_COLOUR_CHOICES[0]);
  const [pendingDelete, setPendingDelete] = useState<Phase | null>(null);

  const editable = can('org:update');

  if (isLoading) return <SkeletonRows rows={3} height={64} />;

  return (
    <div className="stack gap-5">
      <Callout tone="info">
        Phases are the columns your work is organised into. Name them however your contracts do —
        three or fifteen, "Design / Civil / Finishing" or "RIBA 0–7". Drawings, materials and
        activities all attach to one.
      </Callout>

      <Card
        title="Your phases"
        description="Drag order is the order they appear everywhere."
        padded={false}
      >
        {phases && phases.length > 0 ? (
          <div className="scroll-x">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Phase</th>
                  <th>Colour</th>
                  <th className="num">In use by</th>
                  <th>Status</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {phases.map((phase) => (
                  <tr key={phase.id}>
                    <td data-label="Phase">
                      {editable ? (
                        <input
                          className="input input-sm"
                          style={{ maxWidth: 220 }}
                          aria-label={`Name for ${phase.name}`}
                          defaultValue={phase.name}
                          onBlur={(event) => {
                            const next = event.target.value.trim();
                            if (next && next !== phase.name) {
                              updatePhase.mutate({ id: phase.id, name: next });
                            }
                          }}
                        />
                      ) : (
                        <span className="font-medium">{phase.name}</span>
                      )}
                    </td>
                    <td data-label="Colour">
                      <div className="row gap-1">
                        {PHASE_COLOUR_CHOICES.map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            aria-label={`Set ${phase.name} colour`}
                            disabled={!editable}
                            onClick={() => updatePhase.mutate({ id: phase.id, colour: choice })}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 5,
                              background: choice,
                              border:
                                phase.colour.toLowerCase() === choice.toLowerCase()
                                  ? '2px solid var(--text-primary)'
                                  : '1px solid var(--border-default)',
                            }}
                          />
                        ))}
                      </div>
                    </td>
                    <td data-label="In use by" className="num text-sm text-secondary">
                      {phase.usageCount ?? 0}
                    </td>
                    <td data-label="Status">
                      {phase.isArchived ? (
                        <Badge tone="neutral">Archived</Badge>
                      ) : (
                        <Badge tone="success" dot>
                          Active
                        </Badge>
                      )}
                    </td>
                    <td>
                      {editable && (
                        <div className="row gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              updatePhase.mutate({ id: phase.id, isArchived: !phase.isArchived })
                            }
                          >
                            {phase.isArchived ? 'Restore' : 'Archive'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            iconOnly
                            aria-label={`Delete ${phase.name}`}
                            onClick={() => setPendingDelete(phase)}
                          >
                            <IconTrash size={14} />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 'var(--space-6)' }}>
            <EmptyState
              icon={<IconLayers size={20} />}
              title="No phases yet"
              message="Add the first one below. Until at least one exists you cannot add drawings, materials or activities to a project."
            />
          </div>
        )}
      </Card>

      {editable && (
        <Card title="Add a phase">
          <form
            className="row gap-3 wrap"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              createPhase.mutate(
                { name: name.trim(), colour },
                {
                  onSuccess: () => {
                    setName('');
                    toast.success('Phase added');
                  },
                  onError: (error) =>
                    toast.error(
                      'Could not add the phase',
                      error instanceof ApiRequestError ? error.message : undefined,
                    ),
                },
              );
            }}
          >
            <input
              className="input"
              style={{ flex: '1 1 240px' }}
              placeholder="Phase name, e.g. Fit-out"
              aria-label="Phase name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="row gap-1">
              {PHASE_COLOUR_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-label={`Choose colour ${choice}`}
                  onClick={() => setColour(choice)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: choice,
                    border:
                      colour === choice
                        ? '2px solid var(--text-primary)'
                        : '1px solid var(--border-default)',
                  }}
                />
              ))}
            </div>
            <Button type="submit" variant="primary">
              <IconPlus size={14} />
              Add phase
            </Button>
          </form>
        </Card>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          message={
            (pendingDelete.usageCount ?? 0) > 0
              ? `${pendingDelete.usageCount} items reference this phase, so it cannot be deleted. Archive it instead to hide it from new work while keeping history intact.`
              : 'This phase is not used by anything and can be removed safely.'
          }
          confirmLabel="Delete phase"
          destructive
          loading={deletePhase.isPending}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() =>
            deletePhase.mutate(pendingDelete.id, {
              onSuccess: () => {
                toast.success('Phase deleted');
                setPendingDelete(null);
              },
              onError: (error) => {
                toast.error(
                  'Could not delete the phase',
                  error instanceof ApiRequestError ? error.message : undefined,
                );
                setPendingDelete(null);
              },
            })
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function CategoriesPanel() {
  const { can } = useAuth();
  const toast = useToast();
  const { data: categories, isLoading } = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);

  const editable = can('org:update');

  if (isLoading) return <SkeletonRows rows={3} height={64} />;

  return (
    <div className="stack gap-5">
      <Callout tone="info">
        Categories group your projects — marketing suites, corporate floors, show flats, whatever
        you actually build. The dashboard and report break the portfolio down by these.
      </Callout>

      <Card title="Your categories" padded={false}>
        {categories && categories.length > 0 ? (
          <div className="scroll-x">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Description</th>
                  <th className="num">Projects</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td data-label="Category">
                      {editable ? (
                        <input
                          className="input input-sm"
                          style={{ maxWidth: 240 }}
                          aria-label={`Name for ${category.name}`}
                          defaultValue={category.name}
                          onBlur={(event) => {
                            const next = event.target.value.trim();
                            if (next && next !== category.name) {
                              updateCategory.mutate({ id: category.id, name: next });
                            }
                          }}
                        />
                      ) : (
                        <span className="font-medium">{category.name}</span>
                      )}
                    </td>
                    <td data-label="Description" className="text-sm text-secondary">
                      {category.description ?? '—'}
                    </td>
                    <td data-label="Projects" className="num">
                      {category.projectCount ?? 0}
                    </td>
                    <td>
                      {editable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          aria-label={`Delete ${category.name}`}
                          onClick={() => setPendingDelete(category)}
                        >
                          <IconTrash size={14} />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 'var(--space-6)' }}>
            <EmptyState
              icon={<IconTag size={20} />}
              title="No categories yet"
              message="Add at least one before creating a project — every project belongs to a category."
            />
          </div>
        )}
      </Card>

      {editable && (
        <Card title="Add a category">
          <form
            className="row gap-3 wrap"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              createCategory.mutate(
                { name: name.trim(), description: description.trim() || null },
                {
                  onSuccess: () => {
                    setName('');
                    setDescription('');
                    toast.success('Category added');
                  },
                  onError: (error) =>
                    toast.error(
                      'Could not add the category',
                      error instanceof ApiRequestError ? error.message : undefined,
                    ),
                },
              );
            }}
          >
            <input
              className="input"
              style={{ flex: '1 1 220px' }}
              placeholder="Category name"
              aria-label="Category name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className="input"
              style={{ flex: '2 1 280px' }}
              placeholder="Short description (optional)"
              aria-label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <Button type="submit" variant="primary">
              <IconPlus size={14} />
              Add
            </Button>
          </form>
        </Card>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          message={
            (pendingDelete.projectCount ?? 0) > 0
              ? `This category still holds ${pendingDelete.projectCount} project(s). Move them elsewhere first.`
              : 'This category is empty and can be removed.'
          }
          confirmLabel="Delete category"
          destructive
          loading={deleteCategory.isPending}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() =>
            deleteCategory.mutate(pendingDelete.id, {
              onSuccess: () => {
                toast.success('Category deleted');
                setPendingDelete(null);
              },
              onError: (error) => {
                toast.error(
                  'Could not delete the category',
                  error instanceof ApiRequestError ? error.message : undefined,
                );
                setPendingDelete(null);
              },
            })
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function TemplatesPanel() {
  const { can } = useAuth();
  const toast = useToast();
  const templates = useTemplates();
  const phases = usePhases();
  const createTemplate = useCreateTemplate();
  const duplicateTemplate = useDuplicateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [newName, setNewName] = useState('');

  const editable = can('org:update');
  const selected = useTemplate(selectedId ?? templates.data?.[0]?.id);

  if (templates.isLoading || phases.isLoading) return <SkeletonRows rows={3} height={90} />;

  if (phases.data && phases.data.length === 0) {
    return (
      <EmptyState
        icon={<IconTemplate size={20} />}
        title="Define your phases first"
        message="Every template row belongs to a phase, so you need at least one before you can build a template."
        action={
          <NavLink to="/settings/phases" className="btn btn-primary">
            Go to phases
          </NavLink>
        }
      />
    );
  }

  return (
    <div className="stack gap-5">
      <Callout tone="info">
        A template is a playbook: the drawings, activities and materials a new project starts with.
        Activity offsets are days relative to handover, so a template describes a shape rather than
        fixed dates.
      </Callout>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)' }}>
        <Card title="Templates" padded={false}>
          <div className="stack" style={{ padding: 'var(--space-2)' }}>
            {templates.data?.map((template) => (
              <button
                key={template.id}
                type="button"
                className="menu-item"
                style={{
                  background:
                    (selectedId ?? templates.data?.[0]?.id) === template.id
                      ? 'var(--surface-active)'
                      : undefined,
                }}
                onClick={() => setSelectedId(template.id)}
              >
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="text-sm font-medium truncate">{template.name}</div>
                  <div className="text-2xs text-tertiary">{template.itemCount} items</div>
                </div>
                {template.isDefault && <Badge tone="info">Default</Badge>}
              </button>
            ))}
            {templates.data?.length === 0 && (
              <p className="text-sm text-secondary" style={{ padding: 'var(--space-3)' }}>
                No templates yet.
              </p>
            )}
          </div>

          {editable && (
            <form
              className="row gap-2"
              style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)' }}
              onSubmit={(event) => {
                event.preventDefault();
                if (!newName.trim()) return;
                createTemplate.mutate(
                  { name: newName.trim(), isDefault: templates.data?.length === 0 },
                  {
                    onSuccess: (created) => {
                      setSelectedId(created.id);
                      setNewName('');
                      toast.success('Template created');
                    },
                    onError: (error) =>
                      toast.error(
                        'Could not create the template',
                        error instanceof ApiRequestError ? error.message : undefined,
                      ),
                  },
                );
              }}
            >
              <input
                className="input input-sm"
                placeholder="New template name"
                aria-label="New template name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                iconOnly
                aria-label="Create template"
              >
                <IconPlus size={14} />
              </Button>
            </form>
          )}
        </Card>

        {selected.data ? (
          <TemplateEditor
            key={selected.data.id}
            template={selected.data}
            phases={phases.data ?? []}
            editable={editable}
            onDuplicate={() =>
              duplicateTemplate.mutate(selected.data!.id, {
                onSuccess: (copy) => {
                  setSelectedId(copy.id);
                  toast.success('Template duplicated');
                },
              })
            }
            onDelete={() =>
              deleteTemplate.mutate(selected.data!.id, {
                onSuccess: () => {
                  setSelectedId(undefined);
                  toast.success('Template deleted');
                },
              })
            }
          />
        ) : (
          <EmptyState
            icon={<IconTemplate size={20} />}
            title="No template selected"
            message="Create one on the left to start building a playbook."
          />
        )}
      </div>
    </div>
  );
}

interface DraftItem {
  kind: TemplateItemKind;
  /** Null for DESIGN_FILE — a document belongs to no work phase. */
  phaseId: string | null;
  name: string;
  leadTimeWeeks: number | null;
  offsetStartDays: number | null;
  offsetEndDays: number | null;
}

function TemplateEditor({
  template,
  phases,
  editable,
  onDuplicate,
  onDelete,
}: {
  template: TemplateDetail;
  phases: Phase[];
  editable: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const setItems = useSetTemplateItems();

  const [items, setLocalItems] = useState<DraftItem[]>(() =>
    template.items.map((item) => ({
      kind: item.kind,
      phaseId: item.phase?.id ?? null,
      name: item.name,
      leadTimeWeeks: item.leadTimeWeeks,
      offsetStartDays: item.offsetStartDays,
      offsetEndDays: item.offsetEndDays,
    })),
  );
  const [kind, setKind] = useState<TemplateItemKind>('DESIGN_FILE');
  const [draft, setDraft] = useState('');
  const [draftPhase, setDraftPhase] = useState(phases[0]?.id ?? '');

  const dirty =
    JSON.stringify(items) !==
    JSON.stringify(
      template.items.map((item) => ({
        kind: item.kind,
        phaseId: item.phase?.id ?? null,
        name: item.name,
        leadTimeWeeks: item.leadTimeWeeks,
        offsetStartDays: item.offsetStartDays,
        offsetEndDays: item.offsetEndDays,
      })),
    );

  const grouped = TEMPLATE_ITEM_KINDS.map((itemKind) => ({
    kind: itemKind,
    rows: items.filter((item) => item.kind === itemKind),
  }));

  return (
    <Card
      title={template.name}
      description={`${items.length} items${template.isDefault ? ' · pre-selected for new projects' : ''}`}
      actions={
        editable && (
          <>
            <Button size="sm" onClick={onDuplicate}>
              Duplicate
            </Button>
            <Button size="sm" variant="danger-quiet" onClick={onDelete}>
              Delete
            </Button>
          </>
        )
      }
    >
      <div className="stack gap-5">
        {grouped.map(({ kind: itemKind, rows }) => (
          <div key={itemKind}>
            <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
              {TEMPLATE_ITEM_KIND_PLURALS[itemKind]} · {rows.length}
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-tertiary">None yet.</p>
            ) : (
              <div className="checklist">
                {rows.map((item) => {
                  const index = items.indexOf(item);
                  const phase = phases.find((p) => p.id === item.phaseId);
                  return (
                    <div key={`${itemKind}-${index}`} className="check-row">
                      <span
                        className="phase-swatch"
                        style={{ background: phase?.colour ?? 'var(--neutral-solid)' }}
                      />
                      <span className="check-row-name">{item.name}</span>
                      {itemKind === 'MATERIAL' && (
                        <span className="text-2xs text-tertiary shrink-0">
                          {item.leadTimeWeeks ?? '—'}w lead
                        </span>
                      )}
                      {itemKind === 'WORK_ITEM' && (
                        <span className="text-2xs text-tertiary shrink-0">
                          {item.offsetStartDays ?? '—'} → {item.offsetEndDays ?? '—'} days
                        </span>
                      )}
                      <span className="text-2xs text-tertiary shrink-0">
                        {phase?.name ?? 'No phase'}
                      </span>
                      {editable && (
                        <button
                          type="button"
                          className="row-action"
                          aria-label={`Remove ${item.name}`}
                          onClick={() =>
                            setLocalItems((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          <IconTrash size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {editable && (
          <form
            className="row gap-2 wrap"
            style={{ paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)' }}
            onSubmit={(event) => {
              event.preventDefault();
              // Only phase-scoped kinds require a phase.
              if (!draft.trim()) return;
              if (kind !== 'DESIGN_FILE' && !draftPhase) return;
              setLocalItems((current) => [
                ...current,
                {
                  kind,
                  phaseId: kind === 'DESIGN_FILE' ? null : draftPhase,
                  name: draft.trim(),
                  leadTimeWeeks: kind === 'MATERIAL' ? 6 : null,
                  offsetStartDays: kind === 'WORK_ITEM' ? -28 : null,
                  offsetEndDays: kind === 'WORK_ITEM' ? -7 : null,
                },
              ]);
              setDraft('');
            }}
          >
            <select
              className="select"
              style={{ flex: '0 0 130px' }}
              aria-label="Item type"
              value={kind}
              onChange={(event) => setKind(event.target.value as TemplateItemKind)}
            >
              {TEMPLATE_ITEM_KINDS.map((itemKind) => (
                <option key={itemKind} value={itemKind}>
                  {TEMPLATE_ITEM_KIND_LABELS[itemKind]}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ flex: '0 0 150px' }}
              aria-label="Phase"
              value={draftPhase}
              disabled={kind === 'DESIGN_FILE'}
              title={kind === 'DESIGN_FILE' ? 'Design files are not phase-scoped' : undefined}
              onChange={(event) => setDraftPhase(event.target.value)}
            >
              {phases.map((phase) => (
                <option key={phase.id} value={phase.id}>
                  {phase.name}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ flex: '1 1 200px' }}
              placeholder={`New ${TEMPLATE_ITEM_KIND_LABELS[kind].toLowerCase()} name`}
              aria-label="Item name"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" variant="secondary">
              <IconPlus size={14} />
              Add
            </Button>
          </form>
        )}

        {editable && dirty && (
          <div className="row gap-3">
            <Button
              variant="primary"
              loading={setItems.isPending}
              onClick={() =>
                setItems.mutate(
                  { id: template.id, items },
                  {
                    onSuccess: () => toast.success('Template saved'),
                    onError: (error) =>
                      toast.error(
                        'Could not save the template',
                        error instanceof ApiRequestError ? error.message : undefined,
                      ),
                  },
                )
              }
            >
              Save template
            </Button>
            <Button
              onClick={() =>
                setLocalItems(
                  template.items.map((item) => ({
                    kind: item.kind,
                    phaseId: item.phase?.id ?? null,
                    name: item.name,
                    leadTimeWeeks: item.leadTimeWeeks,
                    offsetStartDays: item.offsetStartDays,
                    offsetEndDays: item.offsetEndDays,
                  })),
                )
              }
            >
              Discard
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
