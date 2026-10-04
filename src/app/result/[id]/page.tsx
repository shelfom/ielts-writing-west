'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { LangToggle } from '@/components/LangToggle';
import { useLanguage } from '@/components/LanguageContext';
import { ExaminerTheatre, type TheatreData } from '@/components/theatre/ExaminerTheatre';

type Phase = 'loading' | 'assessing' | 'examining' | 'ready' | 'error';

export default function ResultPage() {
  const params = useParams();
  const { lang } = useLanguage();
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
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

  if (phase === 'examining' && data) {
    const labels = [
      data.task_type === 'task2' ? t('任务回应', 'Task Response') : t('任务完成度', 'Task Achievement'),
      t('连贯与衔接', 'Coherence & Cohesion'), t('词汇资源', 'Lexical Resource'), t('语法', 'Grammar'), t('本篇估分', 'Overall estimate'),
    ];
    const values = ['ta_tr', 'cc', 'lr', 'gra'].map(key => data.assessment.scores[key].score).concat(data.assessment.overall);
    const colors = ['#087e82', '#4264c7', '#a97008', '#b34b79', '#172020'];
    return <main style={{minHeight:'100vh',background:'#F7F4EC',padding:'32px 18px',color:'#172020'}}>
      <div style={{maxWidth:960,margin:'auto'}}>
        <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:40}}><Link href="/">Band Autopsy · 作文解剖室</Link><LangToggle/></header>
        <h1 style={{fontSize:26}}>{t('原稿评分已保存。', 'Your original scores are saved.')}</h1>
        <div data-testid="pending-scores" style={{display:'grid',gridTemplateColumns:'repeat(5,minmax(0,1fr))',gap:8,borderTop:'1px solid #172020',borderBottom:'1px solid #172020',padding:'24px 0',margin:'24px 0'}}>
          {values.map((value,i)=><div key={labels[i]} style={{color:colors[i]}}><strong style={{font:'36px Georgia,serif'}}>{value.toFixed(1)}</strong><p style={{fontSize:11,lineHeight:1.6}}>{labels[i]}</p></div>)}
        </div>
        <p style={{fontSize:12,color:'#59635c'}}>{t('本篇作文估分，非官方 IELTS 成绩。四项等权平均，取最近的半分。', 'An estimate for this essay, not an official IELTS result. Four equally weighted criteria, rounded to the nearest half band.')}</p>
        <p style={{lineHeight:1.9}}>{t(data.assessment.diagnosisZh,data.assessment.diagnosisEn)}</p>
        <section role="status" style={{marginTop:28,padding:22,background:'#fffefb',border:'1px solid #e5dfd1'}}>
          <strong>{t('正在准备四位考官的修改…', 'Preparing the four examiner passes…')}</strong>
          <p>{t('已保存', 'Saved')} {data.correction.stages.length}/4 · {labels[['ta_tr','cc','lr','gra'].indexOf(nextCriterion||'ta_tr')]}</p>
          <p style={{fontSize:13}}>{t('完成后将自动播放。刷新可继续，不会重新评分。', 'Playback starts automatically when ready. Refresh resumes saved progress without rescoring.')}</p>
        </section>
      </div>
    </main>;
  }

  if (phase === 'error' || !data) {
    return (
      <div className="min-h-screen bg-[#F7F4EC] flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-2xl font-light text-[#F15B3D] mb-4 zh-font">出错了</div>
          <div className="text-sm text-[#172020] mb-6 zh-font">{error || 'Unknown error'}</div>
          <button onClick={() => window.location.reload()} className="block mx-auto mb-4 underline">重试 / Retry</button>
          <Link href="/" className="inline-block px-6 py-3 bg-[#F15B3D] text-white rounded text-sm hover:bg-[#d94a2e] transition-colors zh-font">
            返回首页 / Back to home
          </Link>
        </div>
      </div>
    );
  }

  return <ExaminerTheatre data={data} demo={false} autoPlay={true} />;
}

function transformToTheatreData(submission: TheatreData): TheatreData {
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

function getNextCriterion(submission: Partial<Pick<TheatreData, 'correction'>>): string | null {
  const order = ['ta_tr', 'cc', 'lr', 'gra'] as const;
  const completed = submission.correction?.stages?.map(s => s.criterion) || [];
  for (const c of order) {
    if (!completed.includes(c)) return c;
  }
  return null;
}
