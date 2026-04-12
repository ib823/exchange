import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SEP Operator Console',
  description: 'Malaysia Secure Exchange Platform — Operator Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
