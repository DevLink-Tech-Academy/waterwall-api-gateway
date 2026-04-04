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
      <body className="min-h-screen bg-slate-50">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
