import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createProjectSchema,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type CreateProjectDto,
  type ProjectDetail,
} from '@ciq/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  useCategories,
  useCreateCategory,
  useCreateProject,
  useTemplates,
  useUpdateProject,
  useUsers,
} from '@/lib/queries';
import { Button, Callout, Field, Modal, useToast } from '@/components/ui';
import { IconX } from '@/components/ui/Icons';

/** Sentinel for the "create one" option in the category select. */
const NEW_CATEGORY = '__new__';

/**
 * react-hook-form types a preprocessed field's error as a nested object, so the
 * message is read defensively rather than asserted to be a string.
 */
const messageOf = (error: unknown): string | undefined => {
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message : undefined;
};

/**
 * Create or edit a project.
 *
 * Category, manager and template options all come from the database. A category
 * can also be created inline: making somebody abandon a half-filled form, go to
 * Settings and come back is the kind of friction that gets a tool worked around.
 */
export function ProjectFormModal({
  project,
  onClose,
  onCreated,
}: {
  project?: ProjectDetail;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const isEdit = Boolean(project);
  const toast = useToast();
  const { settings, can } = useAuth();

  const categories = useCategories();
  const templates = useTemplates();
  const users = useUsers();

  const createProject = useCreateProject();
  const updateProject = useUpdateProject(project?.id ?? '');
  const createCategory = useCreateCategory();

  /**
   * Inline category creation. `null` means pick from the list; a string means
   * the user is typing a new one.
   */
  const [newCategoryName, setNewCategoryName] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const defaultTemplateId = templates.data?.find((template) => template.isDefault)?.id;

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectDto>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: project
      ? {
          name: project.name,
          code: project.code ?? '',
          categoryId: project.category.id,
          consultant: project.consultant ?? '',
          vendor: project.vendor ?? '',
          status: project.status,
          handoverDate: project.handoverDate ?? undefined,
          siteAddress: project.siteAddress ?? '',
          description: project.description ?? '',
          budgetAmount: project.budgetAmount ?? undefined,
          currency: project.currency,
          managerId: project.manager?.id ?? undefined,
        }
      : {
          status: 'DISCUSSION',
          currency: settings.defaultCurrency,
          categoryId: categories.data?.[0]?.id,
          templateId: defaultTemplateId,
        },
  });

  const noCategories = categories.isSuccess && categories.data.length === 0;
  const canCreateCategory = can('category:create');

  // With nothing to choose from, drop straight into the text field rather than
  // presenting an empty dropdown and asking the user to find the one option.
  useEffect(() => {
    if (noCategories && canCreateCategory && newCategoryName === null) setNewCategoryName('');
  }, [noCategories, canCreateCategory, newCategoryName]);

  /**
   * Creates a pending category before validation runs.
   *
   * The project schema requires a uuid, which a not-yet-created category cannot
   * supply — so it is created first and its id written back into the form.
   * Returns false when creation failed, so the caller can stop.
   */
  const ensureCategory = async (): Promise<boolean> => {
    if (newCategoryName === null) return true;

    const name = newCategoryName.trim();
    if (!name) {
      setCategoryError('Enter a name for the new category.');
      return false;
    }

    // Reuse an existing category rather than colliding on its unique name.
    const existing = categories.data?.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setValue('categoryId', existing.id, { shouldValidate: true });
      setNewCategoryName(null);
      setCategoryError(null);
      return true;
    }

    try {
      const created = await createCategory.mutateAsync({ name, description: null });
      setValue('categoryId', created.id, { shouldValidate: true });
      setNewCategoryName(null);
      setCategoryError(null);
      return true;
    } catch (error) {
      setCategoryError(
        error instanceof ApiRequestError
          ? error.message
          : 'Could not create that category. Try a different name.',
      );
      return false;
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    // Empty strings from the form mean "not set", not "set to empty".
    const payload = {
      ...values,
      code: values.code || null,
      consultant: values.consultant || null,
      vendor: values.vendor || null,
      siteAddress: values.siteAddress || null,
      description: values.description || null,
      handoverDate: values.handoverDate || null,
      managerId: values.managerId || null,
      budgetAmount: values.budgetAmount ?? null,
    };

    try {
      if (isEdit && project) {
        const { templateId: _ignored, ...updates } = payload;
        await updateProject.mutateAsync(updates);
        toast.success('Project updated');
      } else {
        const created = await createProject.mutateAsync(payload);
        toast.success(
          'Project created',
          payload.templateId ? 'Its checklists were seeded from the template.' : undefined,
        );
        onCreated?.(created.id);
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError && error.details) {
        // Map server-side field errors back onto the form so they appear inline.
        for (const [field, messages] of Object.entries(error.details)) {
          setError(field as keyof CreateProjectDto, { message: messages[0] });
        }
        return;
      }
      toast.error(
        'Could not save the project',
        error instanceof ApiRequestError ? error.message : undefined,
      );
    }
  });

  return (
    <Modal
      title={isEdit ? 'Edit project' : 'New project'}
      description={
        isEdit
          ? undefined
          : 'Applying a template seeds the drawing checklist, activities and material schedule.'
      }
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={isSubmitting}
            disabled={noCategories && !canCreateCategory}
            onClick={() => {
              // The category has to exist before the project schema will accept
              // its id, so it is created first.
              void (async () => {
                if (await ensureCategory()) await onSubmit();
              })();
            }}
          >
            {isEdit ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      {noCategories &&
        (canCreateCategory ? (
          <Callout tone="info">
            You have no categories yet. Choose “＋ New category…” below and type a name — it will be
            created when you save.
          </Callout>
        ) : (
          <Callout tone="warning">
            You have no project categories yet, and your role cannot create one. Ask an
            administrator to add one in Settings → Categories.
          </Callout>
        ))}

      <form className="stack gap-4" onSubmit={(event) => event.preventDefault()} noValidate>
        <Field label="Project name" error={errors.name?.message} required>
          {(props) => (
            <input
              {...props}
              {...register('name')}
              className="input"
              autoFocus
              placeholder="e.g. Whitefield Marketing Office"
            />
          )}
        </Field>

        <div className="grid grid-2">
          <Field
            label="Category"
            error={categoryError ?? errors.categoryId?.message}
            hint={
              newCategoryName !== null
                ? 'This will be created when you save the project.'
                : undefined
            }
            required
          >
            {(props) =>
              newCategoryName !== null ? (
                <div className="row gap-2">
                  <input
                    {...props}
                    className="input"
                    autoFocus
                    placeholder="New category, e.g. Sales Lounge"
                    value={newCategoryName}
                    onChange={(event) => {
                      setNewCategoryName(event.target.value);
                      setCategoryError(null);
                    }}
                  />
                  {(categories.data?.length ?? 0) > 0 && (
                    <Button
                      size="sm"
                      iconOnly
                      aria-label="Pick an existing category instead"
                      title="Pick an existing category instead"
                      onClick={() => {
                        setNewCategoryName(null);
                        setCategoryError(null);
                      }}
                    >
                      <IconX size={14} />
                    </Button>
                  )}
                </div>
              ) : (
                <select
                  {...props}
                  {...register('categoryId')}
                  className="select"
                  onChange={(event) => {
                    if (event.target.value === NEW_CATEGORY) {
                      setNewCategoryName('');
                      return;
                    }
                    setValue('categoryId', event.target.value, { shouldValidate: true });
                  }}
                >
                  {categories.data?.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                  {canCreateCategory && <option value={NEW_CATEGORY}>＋ New category…</option>}
                </select>
              )
            }
          </Field>

          <Field label="Status" error={errors.status?.message}>
            {(props) => (
              <select {...props} {...register('status')} className="select">
                {PROJECT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {PROJECT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <div className="grid grid-2">
          <Field
            label="Handover date"
            error={messageOf(errors.handoverDate)}
            hint="Order-by dates for every material are worked back from this."
          >
            {(props) => (
              <input {...props} {...register('handoverDate')} className="input" type="date" />
            )}
          </Field>

          <Field label="Project code" error={errors.code?.message} hint="Optional, must be unique.">
            {(props) => (
              <input {...props} {...register('code')} className="input" placeholder="PRJ-001" />
            )}
          </Field>
        </div>

        <div className="grid grid-2">
          <Field label="Consultant" error={errors.consultant?.message}>
            {(props) => (
              <input
                {...props}
                {...register('consultant')}
                className="input"
                placeholder="Design consultant"
              />
            )}
          </Field>

          <Field label="Vendor" error={errors.vendor?.message}>
            {(props) => (
              <input
                {...props}
                {...register('vendor')}
                className="input"
                placeholder="Main contractor"
              />
            )}
          </Field>
        </div>

        <div className="grid grid-2">
          <Field label="Project manager" error={messageOf(errors.managerId)}>
            {(props) => (
              <select {...props} {...register('managerId')} className="select">
                <option value="">Unassigned</option>
                {users.data?.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="Budget"
            error={messageOf(errors.budgetAmount)}
            hint={`In ${settings.defaultCurrency}.`}
          >
            {(props) => (
              <input
                {...props}
                {...register('budgetAmount')}
                className="input"
                type="number"
                min={0}
                step="1000"
                placeholder="Optional"
              />
            )}
          </Field>
        </div>

        <Field label="Site address" error={errors.siteAddress?.message}>
          {(props) => <input {...props} {...register('siteAddress')} className="input" />}
        </Field>

        {!isEdit && (
          <Field
            label="Template"
            error={messageOf(errors.templateId)}
            hint={
              templates.data?.length
                ? 'Seeds drawings, activities and materials. Choose “None” to start empty.'
                : 'You have no templates yet — the project will start empty. Build one in Settings → Templates.'
            }
          >
            {(props) => (
              <select {...props} {...register('templateId')} className="select">
                <option value="">None — start empty</option>
                {templates.data?.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.itemCount} items)
                    {template.isDefault ? ' · default' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <Field label="Notes" error={errors.description?.message}>
          {(props) => (
            <textarea
              {...props}
              {...register('description')}
              className="textarea"
              placeholder="Scope notes, constraints, anything the team should know."
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
