import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Waterwall API Gateway - Developer Portal',
  description: 'Discover, subscribe to, and manage APIs through the Waterwall API Gateway Developer Portal',
  keywords: ['API', 'gateway', 'developer portal', 'API management', 'API catalog'],
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/favicon-180.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Runtime config (window.__ENV) written by the container entrypoint,
            so a single image can be configured per deployment. */}
        <script src="/__env.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
