import { redirect } from 'next/navigation';
import { APP_NAME } from '@mediescare/config';
import { LanguageSwitcher } from '@/i18n/language-switcher';
import { getT } from '@/i18n/server';
import { initialized } from '@/server/runtime';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  if (initialized()) redirect('/login');
  const { t } = await getT();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-8">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <img src="/brand/mediescare-logo.svg" alt={APP_NAME} className="mx-auto h-32" />
      <div>
        <h1 className="text-2xl font-semibold">{t('setup.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('setup.intro')}</p>
      </div>
      <SetupForm />
    </main>
  );
}
