import { redirect } from 'next/navigation';
import { APP_NAME } from '@mediescare/config';
import { initialized } from '@/server/runtime';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

export default function SetupPage() {
  if (initialized()) redirect('/login');
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-8">
      <img src="/brand/mediescare-logo.svg" alt={APP_NAME} className="mx-auto h-32" />
      <div>
        <h1 className="text-2xl font-semibold">Set up this server</h1>
        <p className="mt-1 text-sm text-muted">Create your organisation, this branch, and the Super Admin account.</p>
      </div>
      <SetupForm />
    </main>
  );
}
