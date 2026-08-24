import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  assignableRoles,
  inviteUserSchema,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type InviteUserDto,
  type Role,
} from '@ciq/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useInviteUser, useUpdateUser, useUsers } from '@/lib/queries';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  Field,
  Modal,
  SkeletonRows,
  useToast,
} from '@/components/ui';
import { IconPlus, IconUsers } from '@/components/ui/Icons';
import { PageHeader } from '@/components/domain';

/**
 * People and roles.
 *
 * The permission matrix shown here is the same one the API enforces, so what an
 * administrator reads on this page is genuinely what a role can do.
 */
export function PeoplePage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const { data: users, isLoading } = useUsers(true);
  const updateUser = useUpdateUser();

  const [inviting, setInviting] = useState(false);
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  const canManage = can('user:update');
  const grantable = user ? assignableRoles(user.role) : [];

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Roles decide what each person can do. The API enforces this matrix on every request."
        actions={
          can('user:invite') && (
            <Button variant="primary" onClick={() => setInviting(true)}>
              <IconPlus size={15} />
              Add someone
            </Button>
          )
        }
      />

      {issued && (
        <Callout tone="success">
          <div>
            <strong>{issued.email} has been added.</strong> Their temporary password is{' '}
            <code
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--surface-sunken)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {issued.password}
            </code>
            . They will be asked to change it at first sign-in. An email has also been sent — pass
            this on directly if your deployment has no mail relay configured.
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Button size="sm" onClick={() => setIssued(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </Callout>
      )}

      <Card title="Members" padded={false} className="stack">
        {isLoading ? (
          <div style={{ padding: 'var(--space-5)' }}>
            <SkeletonRows rows={4} height={48} />
          </div>
        ) : (
          <div className="scroll-x">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {users?.map((member) => {
                  const isSelf = member.id === user?.id;
                  return (
                    <tr key={member.id}>
                      <td data-label="Name">
                        <span className="row gap-3">
                          <Avatar name={member.name} size="sm" />
                          <span className="font-medium">{member.name}</span>
                          {isSelf && <Badge tone="neutral">You</Badge>}
                        </span>
                      </td>
                      <td data-label="Email" className="text-sm text-secondary">
                        {member.email}
                      </td>
                      <td data-label="Role">
                        {canManage && !isSelf && grantable.includes(member.role) ? (
                          <select
                            className="select input-sm"
                            style={{ width: 170 }}
                            aria-label={`Role for ${member.name}`}
                            value={member.role}
                            onChange={(event) =>
                              updateUser.mutate(
                                { id: member.id, role: event.target.value as Role },
                                {
                                  onSuccess: () => toast.success(`${member.name}'s role updated`),
                                  onError: (error) =>
                                    toast.error(
                                      'Could not change the role',
                                      error instanceof ApiRequestError ? error.message : undefined,
                                    ),
                                },
                              )
                            }
                          >
                            {grantable.map((role) => (
                              <option key={role} value={role}>
                                {ROLE_LABELS[role]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Badge tone={member.role === 'OWNER' ? 'info' : 'neutral'}>
                            {ROLE_LABELS[member.role]}
                          </Badge>
                        )}
                      </td>
                      <td data-label="Status">
                        {member.isActive ? (
                          <Badge tone="success" dot>
                            Active
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Deactivated</Badge>
                        )}
                      </td>
                      <td>
                        {canManage && !isSelf && (
                          <Button
                            size="sm"
                            variant={member.isActive ? 'danger-quiet' : 'secondary'}
                            onClick={() =>
                              updateUser.mutate(
                                { id: member.id, isActive: !member.isActive },
                                {
                                  onSuccess: () =>
                                    toast.success(
                                      member.isActive
                                        ? `${member.name} deactivated`
                                        : `${member.name} reactivated`,
                                    ),
                                  onError: (error) =>
                                    toast.error(
                                      'Could not update this account',
                                      error instanceof ApiRequestError ? error.message : undefined,
                                    ),
                                },
                              )
                            }
                          >
                            {member.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="What each role can do"
        icon={<IconUsers size={16} />}
        description="Enforced server-side. Hiding a control in the interface is not access control, so the API checks this on every request."
      >
        <div className="stack gap-4">
          {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
            <div key={role}>
              <div className="row gap-3">
                <Badge tone={role === 'OWNER' ? 'info' : 'neutral'}>{ROLE_LABELS[role]}</Badge>
                <span className="text-xs text-tertiary tnum">
                  {ROLE_PERMISSIONS[role].length} permissions
                </span>
              </div>
              <p className="text-sm text-secondary" style={{ marginTop: 4 }}>
                {ROLE_DESCRIPTIONS[role]}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {inviting && (
        <InviteModal
          grantable={grantable}
          onClose={() => setInviting(false)}
          onInvited={(email, password) => {
            setIssued({ email, password });
            setInviting(false);
          }}
        />
      )}
    </>
  );
}

function InviteModal({
  grantable,
  onClose,
  onInvited,
}: {
  grantable: Role[];
  onClose: () => void;
  onInvited: (email: string, password: string) => void;
}) {
  const toast = useToast();
  const invite = useInviteUser();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteUserDto>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { role: grantable.includes('VIEWER') ? 'VIEWER' : grantable[0] },
  });

  const submit = handleSubmit(async (values) => {
    try {
      const result = await invite.mutateAsync(values);
      onInvited(result.user.email, result.temporaryPassword);
    } catch (error) {
      toast.error(
        'Could not add this person',
        error instanceof ApiRequestError ? error.message : undefined,
      );
    }
  });

  return (
    <Modal
      title="Add someone"
      description="They receive a temporary password by email and must change it at first sign-in."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={isSubmitting} onClick={() => void submit()}>
            Add person
          </Button>
        </>
      }
    >
      <form className="stack gap-4" onSubmit={(event) => event.preventDefault()} noValidate>
        <Field label="Full name" error={errors.name?.message} required>
          {(props) => <input {...props} {...register('name')} className="input" autoFocus />}
        </Field>
        <Field label="Email" error={errors.email?.message} required>
          {(props) => <input {...props} {...register('email')} className="input" type="email" />}
        </Field>
        <Field
          label="Role"
          error={errors.role?.message}
          hint="You can only grant roles below your own."
          required
        >
          {(props) => (
            <select {...props} {...register('role')} className="select">
              {grantable.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]} — {ROLE_DESCRIPTIONS[role]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </form>
    </Modal>
  );
}
