import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '四大金刚 · Erators | 雅思写作，一关一关变强',
  description: '四位 AI 考官，四轮写作闯关。先读懂评分规则，再亲手改写，最后看见每一处进步。IELTS writing. Stronger with every round.',
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
