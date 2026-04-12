import type { ReactNode } from 'react';

export const metadata = {
  title: 'SEP Operator Console',
  description: 'Malaysia Secure Exchange Platform — Operator Dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
