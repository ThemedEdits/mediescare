import Link from 'next/link';
import { getT } from '@/i18n/server';
import { requirePage } from '@/server/page-auth';
import { SignOutButton } from '../sign-out-button';
import { ChangePasswordForm } from './change-password-form';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const auth = await requirePage(undefined, { allowPendingPasswordChange: true });
  const { t } = await getT();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      {/* A temporary password must be replaced before anything else, so the only way out is signing out. */}
      <div className="flex">
        {auth.mustChangePassword ? (
          <SignOutButton />
        ) : (
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-sm font-medium text-primary-600 hover:bg-primary-50"
          >
            <span aria-hidden="true" className="rtl:rotate-180">
              ←
            </span>
            {t('common.back')}
          </Link>
        )}
      </div>
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
