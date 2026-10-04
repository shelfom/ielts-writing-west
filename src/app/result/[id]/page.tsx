'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ExaminerTheatre, type TheatreData } from '@/components/theatre/ExaminerTheatre';

type Phase = 'loading' | 'assessing' | 'examining' | 'ready' | 'error';

export default function ResultPage() {
  const params = useParams();
  const id = params.id as string;
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<TheatreData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextCriterion, setNextCriterion] = useState<string | null>(null);

  // Fetch submission data
  useEffect(() => {
    async function fetchSubmission() {
      try {
        const res = await fetch(`/api/submissions/${id}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Submission not found');
        }
        const submission = await res.json();

        if (!submission.assessment) {
          setPhase('assessing');
          // Trigger assessment
          const assessRes = await fetch(`/api/submissions/${id}/assess`, { method: 'POST' });
          if (!assessRes.ok) {
            const err = await assessRes.json();
            throw new Error(err.error || 'Assessment failed');
          }
          // Refetch
          const refetchRes = await fetch(`/api/submissions/${id}`);
          const refetched = await refetchRes.json();
          setData(transformToTheatreData(refetched));
          setPhase(refetched.correction?.stages?.length === 4 ? 'ready' : 'examining');
          setNextCriterion(getNextCriterion(refetched));
        } else {
          setData(transformToTheatreData(submission));
          setPhase(submission.correction?.stages?.length === 4 ? 'ready' : 'examining');
          setNextCriterion(getNextCriterion(submission));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setPhase('error');
      }
    }
    fetchSubmission();
  }, [id]);

  // Run examiner stages sequentially
  useEffect(() => {
    if (phase !== 'examining' || !nextCriterion) return;

    async function runStage() {
      try {
        const res = await fetch(`/api/submissions/${id}/examiners/${nextCriterion}`, { method: 'POST' });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `Stage ${nextCriterion} failed`);
        }
        // Refetch to get updated stages
        const refetchRes = await fetch(`/api/submissions/${id}`);
        const refetched = await refetchRes.json();
        setData(transformToTheatreData(refetched));
        const next = getNextCriterion(refetched);
        if (next) {
          setNextCriterion(next);
        } else {
          setPhase('ready');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Stage failed');
        setPhase('error');
      }
    }
    runStage();
  }, [phase, nextCriterion, id]);

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-[#F7F4EC] flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-light text-[#172020] mb-2 zh-font">加载中...</div>
          <div className="text-sm text-[#9CA3AF] zh-font">Loading...</div>
        </div>
      </div>
    );
  }

  if (phase === 'assessing') {
    return (
      <div className="min-h-screen bg-[#F7F4EC] flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-light text-[#172020] mb-2 zh-font">正在评分...</div>
          <div className="text-sm text-[#9CA3AF] zh-font">Assessing essay...</div>
        </div>
      </div>
    );
  }

  if (phase === 'examining') {
    return (
      <div className="min-h-screen bg-[#F7F4EC] flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-light text-[#172020] mb-2 zh-font">考官批改中...</div>
          <div className="text-sm text-[#9CA3AF] zh-font">Examiners working... ({nextCriterion})</div>
        </div>
      </div>
    );
  }

  if (phase === 'error' || !data) {
    return (
      <div className="min-h-screen bg-[#F7F4EC] flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-2xl font-light text-[#F15B3D] mb-4 zh-font">出错了</div>
          <div className="text-sm text-[#172020] mb-6 zh-font">{error || 'Unknown error'}</div>
          <Link href="/" className="inline-block px-6 py-3 bg-[#F15B3D] text-white rounded text-sm hover:bg-[#d94a2e] transition-colors zh-font">
            返回首页 / Back to home
          </Link>
        </div>
      </div>
    );
  }

  return <ExaminerTheatre data={data} demo={false} autoPlay={true} />;
}

function transformToTheatreData(submission: any): TheatreData {
  return {
    task_type: submission.task_type,
    prompt_text: submission.prompt_text,
    paragraphs: submission.paragraphs,
    assessment: {
      scores: submission.assessment.scores,
      overall: submission.assessment.overall,
      diagnosisZh: submission.assessment.diagnosisZh,
      diagnosisEn: submission.assessment.diagnosisEn,
    },
    correction: {
      stages: submission.correction?.stages || [],
    },
  };
}

function getNextCriterion(submission: any): string | null {
  const order = ['ta_tr', 'cc', 'lr', 'gra'];
  const completed = submission.correction?.stages?.map((s: any) => s.criterion) || [];
  for (const c of order) {
    if (!completed.includes(c)) return c;
  }
  return null;
}
