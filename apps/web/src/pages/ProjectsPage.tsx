import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ACTIVE_PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectQueryDto,
  type ProjectStatus,
} from '@ciq/shared';
import { useAuth } from '@/lib/auth';
import { useCategories, useDeleteProject, useProjects } from '@/lib/queries';
import {
  Button,
  EmptyState,
  FilterBar,
  FilterPills,
  SkeletonRows,
  useToast,
} from '@/components/ui';
import { IconFilter, IconPlus, IconProjects } from '@/components/ui/Icons';
import { PageHeader, ProjectCard } from '@/components/domain';
import { ProjectFormModal } from '@/components/domain/ProjectFormModal';

/**
 * Project board.
 *
 * Filters live in the URL so a filtered view is shareable and survives a
 * refresh — "the at-risk marketing offices" is a link someone can send.
 */
export function ProjectsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);

  const categories = useCategories();
  const removeProject = useDeleteProject();

  const query = useMemo<Partial<ProjectQueryDto>>(
    () => ({
      search: params.get('q') ?? undefined,
      categoryId: params.get('category') ?? undefined,
      status: (params.get('status') as ProjectStatus | null) ?? undefined,
      scope: (params.get('scope') as 'all' | 'active' | 'completed' | null) ?? 'active',
      atRisk: params.get('risk') === '1' ? true : undefined,
      sort: (params.get('sort') as ProjectQueryDto['sort'] | null) ?? 'position',
      pageSize: 100,
    }),
    [params],
  );

  const { data, isLoading, isFetching } = useProjects(query);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const scope = query.scope ?? 'active';

  // Memoised, not `data?.items ?? []`: the fallback allocates a fresh array on
  // every render, which would make the grouping memo below recompute each time
  // and defeat its own purpose.
  const projects = useMemo(() => data?.items ?? [], [data]);

  // What the toggle reports on a collapsed panel. Sort is excluded on purpose:
  // it reorders the view but hides nothing, so counting it would imply results
  // are missing when they are not.
  const activeFilters = ['q', 'category', 'status', 'risk', 'scope'].filter((key) =>
    params.get(key),
  ).length;

  // Group by category so the board mirrors how the portfolio is actually
  // organised, rather than presenting one long undifferentiated list.
  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; position: number; items: typeof projects }>();
    for (const project of projects) {
      const existing = groups.get(project.category.id);
      if (existing) existing.items.push(project);
      else
        groups.set(project.category.id, {
          name: project.category.name,
          position: project.category.position,
          items: [project],
        });
    }
    return [...groups.values()].sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name),
    );
  }, [projects]);

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={
          data
            ? `${data.total} project${data.total === 1 ? '' : 's'} matching this view`
            : undefined
        }
        actions={
          can('project:create') && (
            <Button variant="primary" onClick={() => setShowForm(true)}>
              <IconPlus size={15} />
              New project
            </Button>
          )
        }
      />

      <FilterBar
        activeCount={activeFilters}
        onClear={() => setParams(new URLSearchParams(), { replace: true })}
        summary={
          <>
            <label className="visually-hidden" htmlFor="project-search">
              Search projects
            </label>
            <input
              id="project-search"
              className="input input-search"
              placeholder="Search name, code, consultant or vendor…"
              defaultValue={params.get('q') ?? ''}
              onChange={(event) => setParam('q', event.target.value)}
            />
          </>
        }
      >
        <div className="row gap-3 wrap">
          <div className="segmented" role="group" aria-label="Project scope">
            {(['active', 'completed', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setParam('scope', value === 'active' ? null : value)}
              >
                {value === 'active' ? 'Active' : value === 'completed' ? 'Completed' : 'All'}
              </button>
            ))}
          </div>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 150 }}
            aria-label="Sort projects"
            value={query.sort}
            onChange={(event) => setParam('sort', event.target.value)}
          >
            <option value="position">Manual order</option>
            <option value="name">Name</option>
            <option value="handover">Handover date</option>
            <option value="progress">Drawing progress</option>
            <option value="execution">Execution progress</option>
            <option value="risk">Risk</option>
            <option value="updated">Recently updated</option>
          </select>
        </div>

        <FilterPills label="Category">
          <button
            type="button"
            className="filter-pill"
            aria-pressed={!params.get('category')}
            onClick={() => setParam('category', null)}
          >
            All categories
          </button>
          {categories.data?.map((category) => (
            <button
              key={category.id}
              type="button"
              className="filter-pill"
              aria-pressed={params.get('category') === category.id}
              onClick={() =>
                setParam('category', params.get('category') === category.id ? null : category.id)
              }
            >
              {category.name}
              <span className="filter-pill-count">{category.projectCount ?? 0}</span>
            </button>
          ))}
        </FilterPills>

        {scope !== 'completed' && (
          <FilterPills label="Status">
            <button
              type="button"
              className="filter-pill"
              aria-pressed={!params.get('status')}
              onClick={() => setParam('status', null)}
            >
              Any status
            </button>
            {ACTIVE_PROJECT_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className="filter-pill"
                aria-pressed={params.get('status') === status}
                onClick={() => setParam('status', params.get('status') === status ? null : status)}
              >
                {PROJECT_STATUS_LABELS[status]}
              </button>
            ))}
            <button
              type="button"
              className="filter-pill"
              aria-pressed={params.get('risk') === '1'}
              onClick={() => setParam('risk', params.get('risk') === '1' ? null : '1')}
            >
              <IconFilter size={13} />
              At risk only
            </button>
          </FilterPills>
        )}
      </FilterBar>

      {isLoading ? (
        <div className="grid grid-auto-lg">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonRows key={index} rows={1} height={210} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<IconProjects size={20} />}
          title={params.toString() ? 'No projects match these filters' : 'No projects yet'}
          message={
            params.toString()
              ? 'Try widening the search, clearing a category, or switching scope to All.'
              : 'Create your first project. If you have a template set up, its checklists will be applied automatically.'
          }
          action={
            params.toString() ? (
              <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear filters
              </Button>
            ) : (
              can('project:create') && (
                <Button variant="primary" onClick={() => setShowForm(true)}>
                  <IconPlus size={15} />
                  New project
                </Button>
              )
            )
          }
        />
      ) : (
        <div
          className="stack gap-8"
          style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 120ms' }}
        >
          {grouped.map((group) => (
            <section key={group.name}>
              <div className="row-between" style={{ marginBottom: 'var(--space-3)' }}>
                <h2 className="eyebrow">{group.name}</h2>
                <span className="text-xs text-tertiary tnum">
                  {group.items.length} project{group.items.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid grid-auto-lg">
                {group.items.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onDelete={
                      can('project:delete')
                        ? () =>
                            removeProject.mutate(project.id, {
                              onSuccess: () =>
                                toast.success(
                                  'Project deleted',
                                  `${project.name} and its design, materials and work items were removed.`,
                                ),
                              onError: () =>
                                toast.error('Could not delete this project', project.name),
                            })
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {showForm && (
        <ProjectFormModal
          onClose={() => setShowForm(false)}
          onCreated={(id) => navigate(`/projects/${id}`)}
        />
      )}
    </>
  );
}
