import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME } from '@mediescare/config';
import { I18nProvider } from '@/i18n/client';
import { messagesFor } from '@/i18n/messages';
import { getT } from '@/i18n/server';
import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME}: pharmacy POS and hospital management`,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, dir } = await getT();
  return (
    <html lang={locale} dir={dir}>
      <body className="min-h-screen bg-white antialiased">
        <I18nProvider locale={locale} messages={messagesFor(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
