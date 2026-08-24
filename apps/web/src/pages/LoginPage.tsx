import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, registerSchema, type LoginDto, type RegisterDto } from '@ciq/shared';
import { api, ApiRequestError, tokenStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Callout, Field } from '@/components/ui';
import { BrandLogo } from '@/components/brand/Brand';

/**
 * Sign-in, and first-run setup.
 *
 * The API reports whether any organisation exists yet. On a fresh deployment the
 * form becomes a setup wizard that creates the organisation and its first owner;
 * afterwards that path is closed server-side, so this is not an open
 * registration page.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, refreshUser } = useAuth();

  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ needsSetup: boolean }>('/auth/setup-state', { anonymous: true })
      .then((result) => setNeedsSetup(result.needsSetup))
      // If the check itself fails the API is unreachable; show the sign-in form
      // and let the submit surface the real error.
      .catch(() => setNeedsSetup(false));
  }, []);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="auth-brand">
          <BrandLogo surface="auto" showTagline title="Goyal & Co. | Hariyana Group" />
        </div>

        {needsSetup === null ? (
          <div className="skeleton" style={{ height: 240 }} />
        ) : needsSetup ? (
          <SetupForm
            error={formError}
            setError={setFormError}
            onComplete={async () => {
              await refreshUser();
              navigate('/', { replace: true });
            }}
          />
        ) : (
          <SignInForm
            error={formError}
            setError={setFormError}
            onSubmit={async (values) => {
              await login(values);
              navigate(redirectTo, { replace: true });
            }}
          />
        )}
      </div>

      <aside className="auth-aside" aria-hidden="true">
        <blockquote>
          <p className="text-lg" style={{ lineHeight: 1.5 }}>
            Every phase, checklist and threshold in this system is yours to define.
          </p>
          <footer className="text-sm text-secondary" style={{ marginTop: 'var(--space-4)' }}>
            Nothing is hard-coded — the categories you build, the templates you write and the risk
            rules you set are what the reports are computed from.
          </footer>
        </blockquote>
      </aside>

      <style>{`
        .auth-page {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          min-height: 100vh;
          background: var(--surface-canvas);
        }
        .auth-panel {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: var(--space-8);
          padding: var(--space-8);
          max-width: 480px;
          width: 100%;
          margin: 0 auto;
        }
        .auth-brand {
          display: flex;
          align-items: center;
        }
        .auth-aside {
          display: grid;
          place-items: center;
          padding: var(--space-16);
          background:
            radial-gradient(90% 70% at 20% 10%, color-mix(in srgb, var(--accent-solid) 14%, transparent), transparent),
            var(--surface-raised);
          border-left: 1px solid var(--border-subtle);
        }
        .auth-aside blockquote { max-width: 44ch; }
        @media (max-width: 900px) {
          .auth-page { grid-template-columns: minmax(0, 1fr); }
          .auth-aside { display: none; }
        }
      `}</style>
    </div>
  );
}

function SignInForm({
  error,
  setError,
  onSubmit,
}: {
  error: string | null;
  setError: (value: string | null) => void;
  onSubmit: (values: LoginDto) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginDto>({ resolver: zodResolver(loginSchema) });

  return (
    <form
      className="stack gap-4"
      noValidate
      onSubmit={handleSubmit(async (values) => {
        setError(null);
        try {
          await onSubmit(values);
        } catch (submitError) {
          setError(
            submitError instanceof ApiRequestError
              ? submitError.message
              : 'Could not reach the server. Check your connection and try again.',
          );
        }
      })}
    >
      <div>
        <h2 className="text-lg font-semibold">Sign in</h2>
        <p className="text-sm text-secondary">Use the credentials your administrator issued.</p>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      <Field label="Email" error={errors.email?.message} required>
        {(props) => (
          <input
            {...props}
            {...register('email')}
            className="input"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
          />
        )}
      </Field>

      <Field label="Password" error={errors.password?.message} required>
        {(props) => (
          <input
            {...props}
            {...register('password')}
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
          />
        )}
      </Field>

      <Button type="submit" variant="primary" size="lg" block loading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}

function SetupForm({
  error,
  setError,
  onComplete,
}: {
  error: string | null;
  setError: (value: string | null) => void;
  onComplete: () => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterDto>({
    resolver: zodResolver(registerSchema),
    defaultValues: { seedStarterConfiguration: false },
  });

  return (
    <form
      className="stack gap-4"
      noValidate
      onSubmit={handleSubmit(async (values) => {
        setError(null);
        try {
          const result = await api.post<{
            accessToken: string;
            refreshToken: string;
            expiresIn: number;
          }>('/auth/register', values, { anonymous: true });
          tokenStore.set(result);
          await onComplete();
        } catch (submitError) {
          setError(
            submitError instanceof ApiRequestError
              ? submitError.message
              : 'Could not reach the server. Check your connection and try again.',
          );
        }
      })}
    >
      <div>
        <h2 className="text-lg font-semibold">Set up your organisation</h2>
        <p className="text-sm text-secondary">
          This deployment has no organisation yet. Create one and you become its owner.
        </p>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      <Callout tone="info">
        You start with a blank workspace. Define your own phases, project categories and templates
        from Settings afterwards — nothing is created for you.
      </Callout>

      <Field label="Organisation name" error={errors.organisationName?.message} required>
        {(props) => (
          <input
            {...props}
            {...register('organisationName')}
            className="input"
            autoFocus
            placeholder="e.g. Goyal & Co."
          />
        )}
      </Field>

      <Field label="Your name" error={errors.name?.message} required>
        {(props) => (
          <input {...props} {...register('name')} className="input" autoComplete="name" />
        )}
      </Field>

      <Field label="Email" error={errors.email?.message} required>
        {(props) => (
          <input
            {...props}
            {...register('email')}
            className="input"
            type="email"
            autoComplete="email"
          />
        )}
      </Field>

      <Field
        label="Password"
        error={errors.password?.message}
        hint="At least 12 characters. Length matters far more than symbols."
        required
      >
        {(props) => (
          <input
            {...props}
            {...register('password')}
            className="input"
            type="password"
            autoComplete="new-password"
          />
        )}
      </Field>

      <Button type="submit" variant="primary" size="lg" block loading={isSubmitting}>
        Create organisation
      </Button>
    </form>
  );
}
