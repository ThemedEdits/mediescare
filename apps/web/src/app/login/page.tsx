import { redirect } from 'next/navigation';
import { APP_NAME } from '@mediescare/config';
import { LanguageSwitcher } from '@/i18n/language-switcher';
import { initialized } from '@/server/runtime';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  if (!initialized()) redirect('/setup');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <img src="/brand/mediescare-logo.svg" alt={APP_NAME} className="mx-auto h-40" />
      <LoginForm />
    </main>
  );
}
