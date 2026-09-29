import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME } from '@mediescare/config';
import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME}: pharmacy POS and hospital management`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-screen bg-white antialiased">{children}</body>
    </html>
  );
}
