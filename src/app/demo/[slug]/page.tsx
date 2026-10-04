import { notFound } from 'next/navigation';
import { ExaminerTheatre } from '@/components/theatre/ExaminerTheatre';
import type { TheatreData } from '@/components/theatre/ExaminerTheatre';

async function fetchDemo(slug: string): Promise<TheatreData | null> {
  const baseUrl = process.env.COZE_PROJECT_DOMAIN_DEFAULT || 'http://localhost:5000';
  const res = await fetch(`${baseUrl}/api/demos?slug=${slug}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function DemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!['task1', 'task2'].includes(slug)) {
    notFound();
  }

  const data = await fetchDemo(slug);
  if (!data) {
    notFound();
  }

  return <ExaminerTheatre data={data} demo={true} autoPlay={false} />;
}
