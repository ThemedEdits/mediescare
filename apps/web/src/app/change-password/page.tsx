import { getT } from '@/i18n/server';
import { requirePage } from '@/server/page-auth';
import { ChangePasswordForm } from './change-password-form';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const auth = await requirePage(undefined, { allowPendingPasswordChange: true });
  const { t } = await getT();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">
        {auth.mustChangePassword
          ? t('changePassword.titleChoose')
          : t('changePassword.titleChange')}
      </h1>
      {auth.mustChangePassword ? (
        <p className="text-sm text-muted">{t('changePassword.tempHint')}</p>
      ) : null}
      <ChangePasswordForm />
    </main>
  );
}
