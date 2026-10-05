import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '雅思写作西游记 · IELTS Writing West | 过四关，让作文脱胎换骨',
  description: '跟着唐僧、孙悟空、猪八戒、沙僧四位 AI 写作教练，读懂评分规则，亲手改写，逐关精修。IELTS Writing West: four passes to transform your IELTS writing.',
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
