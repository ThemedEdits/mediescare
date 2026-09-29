import { requirePage } from '@/server/page-auth';
import { ChangePasswordForm } from './change-password-form';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const auth = await requirePage(undefined, { allowPendingPasswordChange: true });
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">
        {auth.mustChangePassword ? 'Choose a new password' : 'Change password'}
      </h1>
      {auth.mustChangePassword ? (
        <p className="text-sm text-muted">
          You signed in with a temporary password. Choose your own to continue.
        </p>
      ) : null}
      <ChangePasswordForm />
    </main>
  );
}
