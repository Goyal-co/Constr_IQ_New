import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  Attachment,
  AuditEntry,
  AuditQueryDto,
  Category,
  CategoryDto,
  BulkDesignDto,
  CreateDesignFileDto,
  CreateMaterialDto,
  CreateProjectDto,
  CreateWorkItemDto,
  DesignFile,
  InviteUserDto,
  Material,
  Notification,
  NotificationQueryDto,
  OrganisationSettings,
  OrganisationSettingsDto,
  Paginated,
  Phase,
  PhaseDto,
  PortfolioReport,
  ProjectDetail,
  ProjectQueryDto,
  ProjectSummary,
  ReportDto,
  ReportQueryDto,
  Template,
  TemplateDetail,
  TemplateDto,
  TemplateItemsDto,
  UpdateDesignFileDto,
  UpdateMaterialDto,
  UpdatePhaseDto,
  UpdateProjectDto,
  UpdateUserDto,
  UpdateWorkItemDto,
  UserSummary,
  WorkItem,
} from '@ciq/shared';
import { api } from './api';

/**
 * Query keys.
 *
 * Hierarchical so a broad invalidation works: invalidating `keys.projects.all`
 * clears every list and detail beneath it. Ad-hoc string keys make that
 * impossible and lead to screens that quietly show stale numbers.
 */
export const keys = {
  me: ['me'] as const,

  phases: {
    all: ['phases'] as const,
    list: (includeArchived?: boolean) => ['phases', 'list', includeArchived ?? false] as const,
  },
  categories: {
    all: ['categories'] as const,
    list: () => ['categories', 'list'] as const,
  },
  templates: {
    all: ['templates'] as const,
    list: () => ['templates', 'list'] as const,
    detail: (id: string) => ['templates', 'detail', id] as const,
  },
  projects: {
    all: ['projects'] as const,
    list: (query: Partial<ProjectQueryDto>) => ['projects', 'list', query] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
    schedule: (id: string) => ['projects', 'schedule', id] as const,
  },
  users: {
    all: ['users'] as const,
    list: (includeInactive?: boolean) => ['users', 'list', includeInactive ?? false] as const,
  },
  reports: {
    all: ['reports'] as const,
    portfolio: (query: Partial<ReportQueryDto>) => ['reports', 'portfolio', query] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: (query: Partial<NotificationQueryDto>) => ['notifications', 'list', query] as const,
    unread: () => ['notifications', 'unread'] as const,
  },
  audit: {
    all: ['audit'] as const,
    list: (query: Partial<AuditQueryDto>) => ['audit', 'list', query] as const,
  },
  attachments: (entityType: string, entityId: string) =>
    ['attachments', entityType, entityId] as const,
  settings: ['organisation', 'settings'] as const,
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Phases change rarely but are read on nearly every screen, so they are cached
 * for five minutes rather than refetched per navigation.
 */
export function usePhases(includeArchived = false) {
  return useQuery({
    queryKey: keys.phases.list(includeArchived),
    queryFn: () => api.get<Phase[]>('/phases', { query: { includeArchived } }),
    staleTime: 5 * 60_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: keys.categories.list(),
    queryFn: () => api.get<Category[]>('/categories'),
    staleTime: 5 * 60_000,
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: keys.templates.list(),
    queryFn: () => api.get<Template[]>('/templates'),
    staleTime: 5 * 60_000,
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: keys.templates.detail(id ?? ''),
    queryFn: () => api.get<TemplateDetail>(`/templates/${id}`),
    enabled: Boolean(id),
  });
}

export function useOrganisationSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => api.get<OrganisationSettings>('/organisation/settings'),
  });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function useProjects(
  query: Partial<ProjectQueryDto>,
  options?: Partial<UseQueryOptions<Paginated<ProjectSummary>>>,
) {
  return useQuery({
    queryKey: keys.projects.list(query),
    queryFn: () => api.get<Paginated<ProjectSummary>>('/projects', { query: query as never }),
    // Keeps the previous page on screen while the next loads, so filtering does
    // not blank the list on every keystroke.
    placeholderData: (previous) => previous,
    ...options,
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: keys.projects.detail(id ?? ''),
    queryFn: () => api.get<ProjectDetail>(`/projects/${id}`),
    enabled: Boolean(id),
  });
}

export function useMaterialSchedule(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.projects.schedule(projectId ?? ''),
    queryFn: () => api.get<Material[]>(`/projects/${projectId}/materials/schedule`),
    enabled: Boolean(projectId),
  });
}

// ---------------------------------------------------------------------------
// Reporting, people, activity
// ---------------------------------------------------------------------------

export function usePortfolioReport(query: Partial<ReportQueryDto> = {}) {
  return useQuery({
    queryKey: keys.reports.portfolio(query),
    queryFn: () => api.get<PortfolioReport>('/reports/portfolio', { query: query as never }),
  });
}

export function useUsers(includeInactive = false) {
  return useQuery({
    queryKey: keys.users.list(includeInactive),
    queryFn: () => api.get<UserSummary[]>('/users', { query: { includeInactive } }),
    staleTime: 60_000,
  });
}

export function useNotifications(query: Partial<NotificationQueryDto> = {}) {
  return useQuery({
    queryKey: keys.notifications.list(query),
    queryFn: () => api.get<Paginated<Notification>>('/notifications', { query: query as never }),
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: keys.notifications.unread(),
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    // Polled rather than pushed. A minute is frequent enough for alerts raised
    // by a nightly job, and avoids holding a socket open per tab.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useAuditLog(query: Partial<AuditQueryDto> = {}) {
  return useQuery({
    queryKey: keys.audit.list(query),
    queryFn: () => api.get<Paginated<AuditEntry>>('/audit', { query: query as never }),
    placeholderData: (previous) => previous,
  });
}

export function useAttachments(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: keys.attachments(entityType, entityId ?? ''),
    queryFn: () => api.get<Attachment[]>('/attachments', { query: { entityType, entityId } }),
    enabled: Boolean(entityId),
  });
}

// ---------------------------------------------------------------------------
// Mutations
//
// Every mutation that alters project data invalidates both the project detail
// and the report: a ticked drawing changes a percentage on the dashboard, and
// leaving that stale is how a tracker starts being distrusted.
// ---------------------------------------------------------------------------

function useProjectMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  projectId?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      if (projectId) {
        void queryClient.invalidateQueries({ queryKey: keys.projects.detail(projectId) });
        void queryClient.invalidateQueries({ queryKey: keys.projects.schedule(projectId) });
      }
      void queryClient.invalidateQueries({ queryKey: keys.projects.all });
      void queryClient.invalidateQueries({ queryKey: keys.reports.all });
    },
  });
}

export const useCreateProject = () =>
  useProjectMutation((dto: CreateProjectDto) => api.post<ProjectDetail>('/projects', dto));

export const useUpdateProject = (projectId: string) =>
  useProjectMutation(
    (dto: UpdateProjectDto) => api.patch<ProjectDetail>(`/projects/${projectId}`, dto),
    projectId,
  );

export const useDeleteProject = () =>
  useProjectMutation((id: string) => api.delete(`/projects/${id}`));

export const useReorderProjects = () =>
  useProjectMutation((ids: string[]) => api.patch('/projects/reorder', { ids }));

// --- Design files (Design -> Design Files) --------------------------------

export const useCreateDesignFile = (projectId: string) =>
  useProjectMutation(
    (dto: CreateDesignFileDto) => api.post<DesignFile>(`/projects/${projectId}/design-files`, dto),
    projectId,
  );

export const useUpdateDesignFile = (projectId: string) =>
  useProjectMutation(
    ({ id, ...dto }: UpdateDesignFileDto & { id: string }) =>
      api.patch<DesignFile>(`/projects/${projectId}/design-files/${id}`, dto),
    projectId,
  );

export const useDeleteDesignFile = (projectId: string) =>
  useProjectMutation(
    (id: string) => api.delete(`/projects/${projectId}/design-files/${id}`),
    projectId,
  );

/** Comment on a drawing. Mirrors `useAddComment` for work items. */
export const useAddDesignFileComment = (projectId: string) =>
  useProjectMutation(
    ({ id, body }: { id: string; body: string }) =>
      api.post<DesignFile>(`/projects/${projectId}/design-files/${id}/comments`, { body }),
    projectId,
  );

/** Issue the next revision of a drawing. The number is assigned server-side. */
export const useAddDesignFileRevision = (projectId: string) =>
  useProjectMutation(
    ({ id, ...dto }: { id: string; notes?: string; issuedDate?: string | null }) =>
      api.post<DesignFile>(`/projects/${projectId}/design-files/${id}/revisions`, dto),
    projectId,
  );

export const useBulkDesignFiles = (projectId: string) =>
  useProjectMutation(
    (dto: { isComplete: boolean }) => api.patch(`/projects/${projectId}/design-files/bulk`, dto),
    projectId,
  );

// --- Work items (Design -> phase AND Execution -> phase) ------------------

export const useCreateWorkItem = (projectId: string) =>
  useProjectMutation(
    (dto: CreateWorkItemDto) => api.post<WorkItem>(`/projects/${projectId}/work-items`, dto),
    projectId,
  );

/**
 * Patches either track. A 409 here means the material gate refused the change —
 * the caller is expected to surface `error.message`, which names the materials.
 */
export const useUpdateWorkItem = (projectId: string) =>
  useProjectMutation(
    ({ id, ...dto }: UpdateWorkItemDto & { id: string }) =>
      api.patch<WorkItem>(`/projects/${projectId}/work-items/${id}`, dto),
    projectId,
  );

/**
 * Comment on an activity without changing anything else.
 *
 * A comment made *with* a change rides on `useUpdateWorkItem`'s `comment`
 * field instead, so the note and the transition it explains commit together.
 */
export const useAddComment = (projectId: string) =>
  useProjectMutation(
    ({ id, body }: { id: string; body: string }) =>
      api.post<WorkItem>(`/projects/${projectId}/work-items/${id}/comments`, { body }),
    projectId,
  );

/** Issues the next revision. The number is assigned by the server. */
export const useAddRevision = (projectId: string) =>
  useProjectMutation(
    ({ id, ...dto }: { id: string; notes?: string; issuedDate?: string | null }) =>
      api.post<WorkItem>(`/projects/${projectId}/work-items/${id}/revisions`, dto),
    projectId,
  );

export const useDeleteWorkItem = (projectId: string) =>
  useProjectMutation(
    (id: string) => api.delete(`/projects/${projectId}/work-items/${id}`),
    projectId,
  );

export const useBulkDesign = (projectId: string) =>
  useProjectMutation(
    (dto: BulkDesignDto) => api.patch(`/projects/${projectId}/work-items/bulk-design`, dto),
    projectId,
  );

// --- Materials -------------------------------------------------------------

export const useCreateMaterial = (projectId: string) =>
  useProjectMutation(
    (dto: CreateMaterialDto) => api.post<Material>(`/projects/${projectId}/materials`, dto),
    projectId,
  );

export const useUpdateMaterial = (projectId: string) =>
  useProjectMutation(
    ({ id, ...dto }: UpdateMaterialDto & { id: string }) =>
      api.patch<Material>(`/projects/${projectId}/materials/${id}`, dto),
    projectId,
  );

export const useDeleteMaterial = (projectId: string) =>
  useProjectMutation(
    (id: string) => api.delete(`/projects/${projectId}/materials/${id}`),
    projectId,
  );

// --- Configuration mutations ---------------------------------------------

function useConfigMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  ...invalidate: readonly (readonly unknown[])[]
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: [...key] });
    },
  });
}

export const useCreatePhase = () =>
  useConfigMutation((dto: PhaseDto) => api.post<Phase>('/phases', dto), keys.phases.all);

export const useUpdatePhase = () =>
  useConfigMutation(
    ({ id, ...dto }: UpdatePhaseDto & { id: string }) => api.patch<Phase>(`/phases/${id}`, dto),
    keys.phases.all,
    keys.projects.all,
  );

export const useDeletePhase = () =>
  useConfigMutation((id: string) => api.delete(`/phases/${id}`), keys.phases.all);

export const useReorderPhases = () =>
  useConfigMutation((ids: string[]) => api.patch('/phases/reorder', { ids }), keys.phases.all);

export const useCreateCategory = () =>
  useConfigMutation(
    (dto: CategoryDto) => api.post<Category>('/categories', dto),
    keys.categories.all,
  );

export const useUpdateCategory = () =>
  useConfigMutation(
    ({ id, ...dto }: Partial<CategoryDto> & { id: string }) =>
      api.patch<Category>(`/categories/${id}`, dto),
    keys.categories.all,
    keys.projects.all,
  );

export const useDeleteCategory = () =>
  useConfigMutation((id: string) => api.delete(`/categories/${id}`), keys.categories.all);

export const useCreateTemplate = () =>
  useConfigMutation(
    (dto: TemplateDto) => api.post<TemplateDetail>('/templates', dto),
    keys.templates.all,
  );

export const useUpdateTemplate = () =>
  useConfigMutation(
    ({ id, ...dto }: Partial<TemplateDto> & { id: string }) =>
      api.patch<TemplateDetail>(`/templates/${id}`, dto),
    keys.templates.all,
  );

export const useSetTemplateItems = () =>
  useConfigMutation(
    ({ id, ...dto }: TemplateItemsDto & { id: string }) =>
      api.put<TemplateDetail>(`/templates/${id}/items`, dto),
    keys.templates.all,
  );

export const useDuplicateTemplate = () =>
  useConfigMutation(
    (id: string) => api.post<TemplateDetail>(`/templates/${id}/duplicate`),
    keys.templates.all,
  );

export const useDeleteTemplate = () =>
  useConfigMutation((id: string) => api.delete(`/templates/${id}`), keys.templates.all);

export const useUpdateSettings = () =>
  useConfigMutation(
    (dto: OrganisationSettingsDto) =>
      api.patch<OrganisationSettings>('/organisation/settings', dto),
    keys.settings,
    // Thresholds feed every derived figure, so lists and reports must refetch.
    keys.projects.all,
    keys.reports.all,
    keys.me,
  );

export const useInviteUser = () =>
  useConfigMutation(
    (dto: InviteUserDto) =>
      api.post<{ user: UserSummary; temporaryPassword: string }>('/users/invite', dto),
    keys.users.all,
  );

export const useUpdateUser = () =>
  useConfigMutation(
    ({ id, ...dto }: UpdateUserDto & { id: string }) => api.patch<UserSummary>(`/users/${id}`, dto),
    keys.users.all,
  );

export const useSaveReportMeta = () =>
  useConfigMutation((dto: ReportDto) => api.patch('/reports/portfolio', dto), keys.reports.all);

// --- Notifications --------------------------------------------------------

export function useNotificationActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: keys.notifications.all });
  };

  return {
    markRead: useMutation({
      mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
      onSuccess: invalidate,
    }),
    markAllRead: useMutation({
      mutationFn: () => api.post('/notifications/read-all'),
      onSuccess: invalidate,
    }),
    dismiss: useMutation({
      mutationFn: (id: string) => api.delete(`/notifications/${id}`),
      onSuccess: invalidate,
    }),
  };
}
