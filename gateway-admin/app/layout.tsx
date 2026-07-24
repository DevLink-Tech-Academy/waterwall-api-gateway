import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from './components/AppShell';

export const metadata: Metadata = {
  title: 'Waterwall API Gateway - Admin Console',
  description: 'Platform administration console for Waterwall API Gateway',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/favicon-180.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Runtime config (window.__ENV) written by the container entrypoint,
            so a single image can be configured per deployment. */}
        <script src="/__env.js" />
      </head>
      <body className="min-h-screen bg-slate-50">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
