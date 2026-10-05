'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { LangToggle } from '@/components/LangToggle';
import { LanguageProvider, useLanguage } from '@/components/LanguageContext';
import { ExaminerTheatre, type TheatreData } from '@/components/theatre/ExaminerTheatre';
import { CoachingWorkspace, OriginalScores, readSubmission, type CoachingSubmission } from '@/components/coaching/CoachingWorkspace';

const inflight = new Map<string, Promise<void>>();
async function postOnce(url: string) {
  let pending = inflight.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'This step could not finish.');
      }
    })();
    inflight.set(url, pending);
    pending.finally(() => inflight.delete(url)).catch(() => {});
  }
  return pending;
}

function ResultInner() {
  const params = useParams();
  const { t } = useLanguage();
  const id = params.id as string;
  const [data, setData] = useState<CoachingSubmission | null>(null);
  const [phase, setPhase] = useState<'loading' | 'assessing' | 'examining' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const updateData = useCallback((saved: CoachingSubmission) => setData(saved), []);

  useEffect(() => {
    let disposed = false;
    const show = (saved: CoachingSubmission) => { if (!disposed) setData(saved); };
    async function load() {
      try {
        setError(null);
        let saved = await readSubmission(id);
        show(saved);
        if (!saved.assessment) {
          if (!disposed) setPhase('assessing');
          await postOnce(`/api/submissions/${id}/assess`);
          saved = await readSubmission(id);
          show(saved);
        }
        if (saved.correction?.coaching) {
          if (!disposed) setPhase('ready');
          return;
        }
        // Older submissions and public demos retain their original saved replay.
        for (const criterion of ['ta_tr', 'cc', 'lr', 'gra'] as const) {
          if (saved.correction?.stages?.some(stage => stage.criterion === criterion)) continue;
          if (disposed) return;
          setPhase('examining');
          await postOnce(`/api/submissions/${id}/examiners/${criterion}`);
          saved = await readSubmission(id);
          show(saved);
        }
        if (!disposed) setPhase('ready');
      } catch (err) {
        if (!disposed) { setError(err instanceof Error ? err.message : 'Could not load your essay.'); setPhase('error'); }
      }
    }
    void load();
    return () => { disposed = true; };
  }, [id, attempt]);

  if (phase === 'ready' && data?.assessment && data.correction?.coaching) return <CoachingWorkspace data={data} onUpdate={updateData} />;
  if (phase === 'ready' && data?.assessment && data.correction?.stages.length === 4) {
    const theatre: TheatreData = { task_type: data.task_type, prompt_text: data.prompt_text, task_image_url: data.task_image_url, paragraphs: data.paragraphs, assessment: data.assessment, correction: { stages: data.correction.stages } };
    return <ExaminerTheatre data={theatre} demo={false} autoPlay />;
  }
  return <div className="cw-root"><header className="cw-header"><Link href="/" className="cw-brand"><small>IELTS WRITING WEST</small>{t('雅思写作西游记', 'IELTS Writing West')}</Link><LangToggle /></header><main className="cw-main">
    <div className="cw-heading"><h1>{phase === 'loading' ? t('正在读取已保存的稿件…', 'Loading your saved essay…') : phase === 'assessing' ? t('先为原稿评分。', 'First, assess the original.') : phase === 'examining' ? t('原稿评分已保存。', 'Your original scores are saved.') : t('这一步还没完成。', 'This step did not finish.')}</h1></div>
    {data?.assessment && <><OriginalScores assessment={data.assessment} taskType={data.task_type} /><p className="mt-6 text-sm leading-8 text-[#59635c]">{t(data.assessment.diagnosisZh, data.assessment.diagnosisEn)}</p></>}
    {phase === 'error' ? <div className="cw-error" role="alert"><p>{error}</p><button onClick={() => { setPhase('loading'); setAttempt(v => v + 1); }}>{t('重试未完成的步骤', 'Retry the unfinished step')}</button></div> : <div className="cw-busy" role="status"><span className="cw-spinner" />{phase === 'assessing' ? t('四项评分与整体诊断准备中。你的原稿会保留。', 'Preparing four criterion scores and an overall diagnosis. Your original stays intact.') : phase === 'examining' ? t(`已保存 ${data?.correction?.stages.length || 0} / 4 位考官的修改。`, `${data?.correction?.stages.length || 0} / 4 examiner passes saved.`) : t('正在连接你的练习记录。', 'Opening your practice record.')}</div>}
    <Link href="/" className="cw-text-action">{t('返回首页', 'Back to home')}</Link>
  </main></div>;
}

export default function ResultPage() { return <LanguageProvider><ResultInner /></LanguageProvider>; }
