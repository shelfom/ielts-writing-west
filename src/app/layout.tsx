import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Band Autopsy - Writing Lab',
  description: 'IELTS Writing assessment and correction tool. See your essay improve sentence by sentence.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh">
      <body className="antialiased min-h-screen bg-ivory">
        {children}
      </body>
    </html>
  );
}
