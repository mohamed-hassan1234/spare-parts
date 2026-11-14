import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Wrench } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button, Card, Field, Input } from '@/components/ui';

const schema = z.object({
  username: z.string().trim().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
  totpCode: z
    .string()
    .regex(/^\d{6}$/, 'Enter the 6-digit code')
    .optional()
    .or(z.literal('')),
});
type Form = z.infer<typeof schema>;

export function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [error, setError] = useState<string | null>(null);
  const [needTotp, setNeedTotp] = useState(false);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { username: '', password: '', totpCode: '' } });

  if (user) return <Navigate to={loc.state?.from ?? '/'} replace />;

  const onSubmit = async (v: Form) => {
    setError(null);
    try {
      await login(v.username, v.password, v.totpCode || undefined);
      nav(loc.state?.from ?? '/', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTP_REQUIRED') {
        setNeedTotp(true);
        setError(e.message);
      } else setError(e instanceof Error ? e.message : 'Sign in failed');
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-primary/10 via-background to-background p-4">
      <Card className="w-full max-w-sm p-6 sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-white">
            <Wrench className="size-6" />
          </span>
          <h1 className="text-xl font-semibold">AutoParts ERP</h1>
          <p className="text-sm text-muted-foreground">Sign in to manage your shop</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <Field label="Username" htmlFor="username" error={formState.errors.username?.message}>
            <Input id="username" autoComplete="username" autoFocus {...register('username')} aria-invalid={!!formState.errors.username} />
          </Field>
          <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="current-password" {...register('password')} aria-invalid={!!formState.errors.password} />
          </Field>
          {needTotp && (
            <Field label="Authentication code" htmlFor="totp" error={formState.errors.totpCode?.message}>
              <Input id="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...register('totpCode')} autoFocus />
            </Field>
          )}
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" loading={formState.isSubmitting} className="w-full">
            Sign in
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-muted-foreground">There is no public registration. The owner account is created from the server console.</p>
      </Card>
    </div>
  );
}
