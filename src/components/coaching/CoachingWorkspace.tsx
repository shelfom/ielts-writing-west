'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { LangToggle } from '@/components/LangToggle';
import { CharacterAvatar, JOURNEY_CAST, criterionLabel } from '@/components/journey/CharacterAvatar';
import { useLanguage } from '@/components/LanguageContext';
import type { Assessment, Paragraph, TaskType } from '@/lib/types';
import type { CoachingAction, CoachingState, GateCheck } from '@/lib/coaching-types';
import { getCoachingRubric, MAX_FAILED_REVIEWS } from '@/lib/coaching-rubric';
import type { Criterion, ExaminerStage } from '../theatre/theatre-engine';
import { SingleStagePlayer } from './SingleStagePlayer';
import './coaching.css';

export type CoachingSubmission = {
  id: string; task_type: TaskType; prompt_text: string; original_text: string; paragraphs: Paragraph[];
  task_image_url?: string; assessment: Assessment | null;
  correction: { stages: ExaminerStage[]; coaching?: CoachingState } | null;
  status?: string; error_message?: string | null;
};
const CAST = JOURNEY_CAST.map(cast => ({ key: cast.key, zh: cast.nameZh, en: cast.nameEn, labelZh: cast.key === 'ta_tr' ? '任务回应' : cast.titleZh, labelEn: cast.key === 'ta_tr' ? 'Task Response' : cast.titleEn, color: cast.color, lineZh: cast.lineZh, lineEn: cast.lineEn }));

export async function readSubmission(id: string): Promise<CoachingSubmission> {
  const response = await fetch(`/api/submissions/${id}`, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Could not read your saved essay.');
  return payload;
}

export function OriginalScores({ assessment, taskType }: { assessment: Assessment; taskType: TaskType }) {
  const { t } = useLanguage();
  return <section className="cw-score-section">
    <div className="cw-score-caption"><span>{t('原稿估分 · 永久保留', 'ORIGINAL ESSAY · SCORES PRESERVED')}</span><small>{t('修改后的稿件不会覆盖原稿评分', 'Later drafts do not replace these scores')}</small></div>
    <div className="cw-scores" data-testid="original-scores">
      {CAST.map((c, index) => <div key={c.key} style={{ color: c.color }}><small>{index === 0 ? (taskType === 'task2' ? 'TR' : 'TA') : c.key.toUpperCase()}</small><strong data-testid={`score-${c.key}`}>{assessment.scores[c.key].score.toFixed(1)}</strong><span>{index === 0 && taskType !== 'task2' ? t('任务完成度', 'Task Achievement') : t(c.labelZh, c.labelEn)}</span></div>)}
      <div><small>{t('本篇估分', 'ESTIMATE')}</small><strong data-testid="score-overall">{assessment.overall.toFixed(1)}</strong><span>{t('四项等权平均', 'Four equally weighted criteria')}</span></div>
    </div>
    <p className="cw-score-note">{t('本篇作文的练习估分，非官方 IELTS 成绩。四项平均后取最近的半分。', 'A practice estimate for this essay, not an official IELTS result. The average is rounded to the nearest half band.')}</p>
  </section>;
}

function highlightQuotes(text: string, checks: GateCheck[], paragraphId: string): ReactNode {
  const ranges = checks.filter(c => !c.passed).flatMap(c => c.evidence.filter(e => e.paragraphId === paragraphId).flatMap(e => {
    const start = text.indexOf(e.quote);
    return start >= 0 && e.quote.length ? [{ start, end: start + e.quote.length }] : [];
  })).sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  let cursor = 0;
  const fragments: ReactNode[] = [];
  merged.forEach((range, i) => {
    fragments.push(text.slice(cursor, range.start));
    fragments.push(<mark key={i} data-testid="issue-highlight">{text.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  });
  fragments.push(text.slice(cursor));
  return fragments;
}

export function CoachingWorkspace({ data, onUpdate }: { data: CoachingSubmission; onUpdate: (data: CoachingSubmission) => void }) {
  const { t, lang } = useLanguage();
  const state = data.correction!.coaching!;
  const currentIndex = CAST.findIndex(c => c.key === state.currentCriterion);
  const examiner = CAST[currentIndex];
  const round = state.rounds.find(r => r.criterion === state.currentCriterion);
  const review = round?.reviews[round.reviews.length - 1];
  const reviewIsCurrent = review?.revision === state.revision;
  const failedCount = new Set(round?.reviews.filter(r => !r.passed).map(r => r.draftText)).size;
  const rubric = getCoachingRubric(state.currentCriterion, data.task_type);
  const canEdit = state.phase === 'needs_review' || state.phase === 'rewrite_required';
  const [draft, setDraft] = useState(state.draftText);
  const [editorView, setEditorView] = useState<'marked' | 'edit' | 'original'>('marked');
  const [busy, setBusy] = useState<CoachingAction['action'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<CoachingAction['action'] | null>(null);
  const [copied, setCopied] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [playRevision, setPlayRevision] = useState<number | null>(null);
  const [finalView, setFinalView] = useState<'student' | 'original' | 'model'>('student');
  const [replayCriterion, setReplayCriterion] = useState<Criterion | null>(null);
  const busyRef = useRef(false);
  const autoReviewed = useRef(new Set<string>());
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== state.draftText;
  const wordCount = draft.trim().split(/\s+/).filter(Boolean).length;
  const storageKey = `band-autopsy-draft:${data.id}`;

  useEffect(() => {
    let next = state.draftText;
    let restored = false;
    try {
      const cached = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (canEdit && cached?.revision === state.revision && typeof cached.text === 'string' && cached.text !== next) {
        next = cached.text; restored = true;
      }
    } catch { /* Browser storage may be disabled. Server history remains available. */ }
    setDraft(next); setRecovered(restored);
    setEditorView(restored ? 'edit' : 'marked');
  }, [state.revision, state.draftText, storageKey, canEdit]);

  const execute = useCallback(async (action: CoachingAction): Promise<CoachingSubmission> => {
    const response = await fetch(`/api/submissions/${data.id}/coaching`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
    });
    const payload = await response.json();
    if (response.status >= 500) throw new Error(t('这一步暂时没能完成。已保存的稿件和进度仍保留，请重试；技术故障不计入重写失败次数。', 'This step could not finish. Your saved draft and progress are safe. Please retry; technical failures do not count as failed rewrites.'));
    if (!response.ok) throw new Error(payload.error || 'This step could not finish. Your saved draft is safe.');
    // Playback only receives the state read back from persistent storage.
    const saved = await readSubmission(data.id);
    onUpdate(saved);
    return saved;
  }, [data.id, onUpdate, t]);

  const perform = useCallback(async (action: CoachingAction['action']) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(action); setError(null); setLastAction(action);
    try {
      let revision = state.revision;
      if (action === 'rewrite' || (action === 'review' && draft !== state.draftText)) {
        if (!draft.trim() || wordCount > 1500) throw new Error(t('作文需有内容，且不超过 1500 词。', 'Write some essay text and keep it under 1,500 words.'));
        const rewritten = await execute({ action: 'rewrite', revision, text: draft });
        revision = rewritten.correction!.coaching!.revision;
        try { localStorage.removeItem(storageKey); } catch { /* Optional local recovery only. */ }
        setRecovered(false);
      }
      if (action !== 'rewrite') {
        const saved = await execute({ action, revision });
        if (action === 'correct') setPlayRevision(saved.correction!.coaching!.revision);
        if (action === 'finalise') setFinalView('model');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('这一步没有完成，请重试。', 'This step did not finish. Please retry.'));
      // A dropped connection may follow a successful write. Recover the saved phase before retry.
      try { onUpdate(await readSubmission(data.id)); } catch { /* Keep the last known saved state. */ }
    } finally { busyRef.current = false; setBusy(null); }
  }, [draft, execute, onUpdate, data.id, state.revision, state.draftText, wordCount, storageKey, t]);

  useEffect(() => {
    const key = `${state.currentCriterion}:${state.revision}`;
    if (state.phase === 'needs_review' && !round?.reviews.length && !dirty && !busy && !error && !autoReviewed.current.has(key)) {
      autoReviewed.current.add(key);
      void perform('review');
    }
  }, [state.phase, state.currentCriterion, state.revision, round?.reviews.length, dirty, busy, error, perform]);

  function updateDraft(text: string) {
    setDraft(text); setRecovered(false);
    try { localStorage.setItem(storageKey, JSON.stringify({ revision: state.revision, text })); } catch { /* Saving to server still works. */ }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setError(t('复制失败，请选中文字后手动复制。', 'Copy failed. Select the text and copy it manually.')); }
  }
  function editNow() { setEditorView('edit'); setTimeout(() => { editorRef.current?.focus(); editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 20); }
  function showEvidence(paragraphId: string) {
    setEditorView('marked');
    setTimeout(() => document.getElementById(`draft-${paragraphId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 20);
  }
  const statusLabel = busy ? ({ review: t('检查当前三条标准，并确认此前关卡仍然达标…', 'Reviewing this draft and checking earlier passes still hold…'), rewrite: t('正在保存你的修改…', 'Saving your rewrite…'), correct: t('只精修当前这一项…', 'Correcting this criterion only…'), advance: t('进入下一关…', 'Opening the next pass…'), finalise: t('生成目标分范文，并另行估分…', 'Writing the target model, then assessing it independently…') }[busy]) : null;
  const nextAction = state.phase === 'stage_complete' ? <button className="cw-primary" data-testid="coaching-continue" disabled={!!busy} onClick={() => void perform('advance')}>{t('继续：', 'Continue: ')}{t(CAST[currentIndex + 1]?.zh || '', CAST[currentIndex + 1]?.en || '')} →</button> : state.phase === 'completed' && !state.final ? <button className="cw-primary" data-testid="coaching-finalise" disabled={!!busy} onClick={() => void perform('finalise')}>{t(`生成目标 ${state.targetBand} 分范文`, `Create the band ${state.targetBand} target model`)} →</button> : null;
  const replayRound = state.rounds.find(r => r.criterion === replayCriterion);
  const planText = `${state.draftText}\n\n${t('练习计划', 'Practice plan')}\n${review ? t(review.summaryZh, review.summaryEn) : ''}\n${review?.checks.filter(c => !c.passed).map(c => `• ${t(c.reasonZh, c.reasonEn)}\n${t(c.actionZh, c.actionEn)}`).join('\n\n') || ''}`;
  const finalText = finalView === 'original' ? data.original_text : finalView === 'model' ? state.final!.modelText : state.draftText;

  return <div className={`cw-root ${(round?.correction && !state.final) || replayRound?.correction ? 'cw-has-player' : ''}`} style={{ '--criterion': CAST.find(c => c.key === replayCriterion)?.color || examiner.color } as CSSProperties} data-testid="coaching-workspace" data-phase={state.phase} data-criterion={state.currentCriterion} data-revision={state.revision}>
    <header className="cw-header"><Link href="/" className="cw-brand"><small>IELTS WRITING WEST</small>{t('雅思写作西游记', 'IELTS Writing West')}</Link><LangToggle /></header>
    <main className="cw-main">
      <div className="cw-heading"><div><p className="cw-kicker">{t('过四关，让作文脱胎换骨', 'FOUR PASSES. TRANSFORM YOUR WRITING.')}</p><h1>{t('这一稿，再向前一步。', 'One draft. One step further.')}</h1></div><span className="cw-target">{t('目标', 'TARGET')} <b>{state.targetBand}</b></span></div>
      {data.assessment && <OriginalScores assessment={data.assessment} taskType={data.task_type} />}
      <details className="cw-question"><summary>{t('题目与原稿诊断', 'Question & original diagnosis')}</summary><p>{data.prompt_text}</p>{data.task_image_url && <img src={data.task_image_url} alt={t('原始题目图', 'Original task image')} />}{data.assessment && <p>{t(data.assessment.diagnosisZh, data.assessment.diagnosisEn)}</p>}</details>
      <nav className="cw-rail" aria-label={t('四位考官的训练进度', 'Four examiner progress')}>{CAST.map((cast, index) => {
        const complete = !!state.rounds.find(r => r.criterion === cast.key)?.correction;
        return <button disabled={!complete || !!busy} onClick={() => setReplayCriterion(cast.key)} key={cast.key} className={`${index === currentIndex ? 'active' : ''} ${index > currentIndex ? 'locked' : ''}`} style={{ '--rail-color': cast.color } as CSSProperties} data-testid={`coaching-examiner-${cast.key}`} aria-current={index === currentIndex ? 'step' : undefined}><span className="journey-rail-face"><CharacterAvatar criterion={cast.key} size={36} /><b>{complete ? '✓' : String(index + 1).padStart(2, '0')}</b></span><span className="journey-rail-name">{t(cast.zh, cast.en)}<small>{criterionLabel(cast.key, data.task_type, lang)}</small><em>{index > currentIndex ? t('尚未解锁', 'Locked') : complete ? t('已完成 · 可重播', 'Done · replay') : t('当前关卡', 'Current pass')}</em></span></button>;
      })}</nav>
      {statusLabel && <div className="cw-busy" role="status" data-testid="coaching-busy"><span className="cw-spinner" />{statusLabel}<small>{t('进度会保存；刷新不会丢失已完成的步骤。', 'Completed steps are saved and survive a refresh.')}</small></div>}
      {error && <div className="cw-error" role="alert" data-testid="coaching-error"><p>{error}</p><div>{lastAction && <button disabled={!!busy} onClick={() => void perform(lastAction)}>{t('重试这一步', 'Retry this step')}</button>}<button disabled={!!busy} onClick={async () => { try { onUpdate(await readSubmission(data.id)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not reload'); } }}>{t('读取已保存进度', 'Reload saved progress')}</button></div></div>}

      {replayRound?.correction && replayRound.inputParagraphs ? <SingleStagePlayer taskType={data.task_type} key={`replay-${replayCriterion}`} input={replayRound.inputParagraphs} stage={replayRound.correction} autoPlay continueAction={<button className="cw-primary" data-testid="return-current" onClick={() => setReplayCriterion(null)}>{t('返回当前练习', 'Return to current practice')} →</button>} /> : state.final ? <section className="cw-final" data-testid="coaching-final">
        <div className="cw-final-header"><span className="cw-kicker">{t('四关完成 · 两份成果', 'FOUR PASSES COMPLETE · TWO DIFFERENT RESULTS')}</span><h2>{t('你的改稿，和一篇目标分范文。', 'Your revised essay, plus a target model.')}</h2><p>{t('你的改稿保留四关的训练过程。范文另行生成，以你完善后的观点为基础，供学习参考。', 'Your revised essay records the four passes. The separate model uses your developed ideas as a study reference.')}</p></div>
        <div className="cw-final-outcome" data-testid="target-outcome" data-target-met={state.final.targetMet}><strong>{t('范文独立估分', 'Model essay estimate')} <b>{state.final.assessment.overall.toFixed(1)}</b></strong><span>{state.final.targetMet ? t('达到本次目标估分', 'Meets this target estimate') : t('尚未达到目标估分', 'Below this target estimate')}</span><p>{t(state.final.noteZh, state.final.noteEn)}</p><small>{t('这是 AI 练习估分，不保证真实考试成绩。', 'This is an AI practice estimate, not a guarantee of an exam result.')}</small></div>
        <div className="cw-model-scores">{CAST.map(c => <span key={c.key}>{c.key === 'ta_tr' ? data.task_type === 'task2' ? 'TR' : 'TA' : c.key.toUpperCase()} <b>{state.final!.assessment.scores[c.key].score.toFixed(1)}</b></span>)}</div>
        <div className="cw-paper"><div className="cw-paper-heading"><div className="cw-tabs">{(['student', 'original', 'model'] as const).map(v => <button data-testid={`final-tab-${v}`} key={v} aria-pressed={finalView === v} onClick={() => setFinalView(v)}>{v === 'student' ? t('你的改稿', 'Your revised essay') : v === 'original' ? t('原稿', 'Original') : t('目标分范文', 'Target model')}</button>)}</div><button className="cw-copy" data-testid="copy-final" onClick={() => void copy(finalText)}>{copied ? t('已复制', 'Copied') : t('复制', 'Copy')}</button></div><div className="cw-document" data-testid="final-document">{finalText.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}</div></div>
        <Link className="cw-new-practice" href="/">{t('开始下一篇练习', 'Start another essay')} →</Link>
      </section> : round?.correction && round.inputParagraphs ? <SingleStagePlayer taskType={data.task_type} key={`${state.currentCriterion}-${state.revision}`} input={round.inputParagraphs} stage={round.correction} autoPlay={playRevision === state.revision} continueAction={nextAction} /> : <div className="cw-columns">
        <section className="cw-paper">
          <div className="cw-paper-heading"><span>{t('你的稿件', 'YOUR DRAFT')} <small>v{state.revision + 1}</small></span><div className="cw-tabs"><button aria-pressed={editorView === 'marked'} onClick={() => setEditorView('marked')}>{t('查看标记', 'Marked draft')}</button>{canEdit && <button data-testid="open-editor" aria-pressed={editorView === 'edit'} onClick={editNow}>{t('直接重写', 'Rewrite here')}</button>}<button aria-pressed={editorView === 'original'} onClick={() => setEditorView('original')}>{t('原稿', 'Original')}</button></div></div>
          {editorView === 'edit' && canEdit ? <div className="cw-editor-wrap">
            <label className="cw-editor-label" htmlFor="coaching-editor">{t('针对反馈中未通过的标准，自己改写。', 'Rewrite to address the failed checks in the feedback.')}</label>
            {recovered && <p className="cw-local-note">{t('已恢复此浏览器里尚未提交的草稿。', 'Your unsubmitted draft was recovered from this browser.')}</p>}
            <textarea id="coaching-editor" data-testid="coaching-editor" ref={editorRef} value={draft} onChange={e => updateDraft(e.target.value)} disabled={!!busy} spellCheck={false} maxLength={18000} />
            <div className="cw-editor-meta"><span>{wordCount}/1500 {t('词', 'words')}</span><span>{dirty ? t('尚未保存到服务器', 'Not saved to the server yet') : t('已保存', 'Saved')}</span></div>
            <div className="cw-editor-actions"><button className="cw-primary" data-testid="save-review" disabled={!!busy || !dirty || wordCount > 1500 || !draft.trim()} onClick={() => void perform('review')}>{t('保存并重新检查', 'Save & review again')}</button><button data-testid="save-draft" disabled={!!busy || !dirty || wordCount > 1500 || !draft.trim()} onClick={() => void perform('rewrite')}>{t('只保存草稿', 'Save draft')}</button></div>
          </div> : <div className="cw-document" data-testid="coaching-draft">{(editorView === 'original' ? data.paragraphs : state.paragraphs).map((p, i) => <p id={`draft-${p.id}`} key={p.id} data-testid="draft-paragraph"><small>{String(i + 1).padStart(2, '0')}</small>{editorView === 'marked' && reviewIsCurrent ? highlightQuotes(p.text, review.checks, p.id) : p.text}</p>)}</div>}
          {canEdit && editorView !== 'edit' && <button className="cw-text-action" onClick={editNow}>{t('直接在这里重写', 'Rewrite directly here')} →</button>}
          {state.phase === 'practice_paused' && <button className="cw-text-action" onClick={() => void copy(state.draftText)}>{copied ? t('已复制', 'Copied') : t('复制当前稿件', 'Copy current draft')}</button>}
        </section>
        <aside className="cw-feedback" data-testid="coaching-feedback">
          <div className="journey-workspace-persona"><CharacterAvatar criterion={state.currentCriterion} size={48} /><div><span className="cw-kicker">{t('AI 角色 · 第', 'AI CHARACTER · CHAPTER ')}{currentIndex + 1}{t('关', '')}</span><strong>{t(examiner.zh, examiner.en)}</strong><span className="journey-feedback-criterion">{criterionLabel(state.currentCriterion, data.task_type, lang)}</span></div></div><p className="journey-persona-line">{t(examiner.lineZh, examiner.lineEn)}</p>
          <h2>{state.phase === 'practice_paused' ? t('先停一下，把问题练透。', 'Pause this round. Work on the essentials.') : state.phase === 'ready_to_correct' ? t('过关。现在只精修这一项。', 'Passed. Now refine this criterion.') : review && !review.passed ? t('先重写，这一关还没过。', 'Rewrite first. This pass is not cleared.') : t('先看标准，再看问题。', 'The rules come first.')}</h2>
          <p className="cw-verdict" data-testid="review-summary">{review ? t(review.summaryZh, review.summaryEn) : t('三条全部通过，才由考官做少量修改。其他项目留给后面的考官。', 'All three checks must pass before the examiner makes small corrections. Later criteria stay with later examiners.')}</p>
          {review && !reviewIsCurrent && canEdit && <p className="cw-local-note">{t('以下是上一稿的意见。新稿已保存，等待重新检查。', 'This feedback is for your previous draft. The saved rewrite needs a new review.')}</p>}
          <div className="cw-gate-rule"><strong>{t('固定过关线：3 / 3', 'FIXED GATE: 3 / 3')}</strong><span>{t('这是训练门槛，不是 IELTS 官方分数线。', 'This is a training gate, not an official IELTS cutoff.')}</span><a className="cw-rubric-link" href="https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf" target="_blank" rel="noreferrer">{t('IELTS 官方评分标准 ↗', 'Official IELTS descriptors ↗')}</a><span>{t('改写若破坏已过关的项目，会回到对应关卡；历史保留。', 'A rewrite that undoes an earlier pass reopens that pass; history is kept.')}</span></div>
          <ol className="cw-checks">{rubric.map((rule, index) => {
            const result = review?.checks.find(check => check.id === rule.id);
            return <li key={rule.id} data-testid={`gate-${rule.id}`} data-passed={result?.passed === undefined ? 'pending' : String(result.passed)} className={result ? result.passed ? 'passed' : 'failed' : ''}>
              <div className="cw-check-title"><b>{result ? result.passed ? '✓' : '!' : index + 1}</b><strong>{t(rule.titleZh, rule.titleEn)}</strong></div>
              <details className="cw-rule-detail"><summary>{t('判定标准', 'The rule')}</summary><p>{t(rule.ruleZh, rule.ruleEn)}</p></details>
              {result && <><p>{t(result.reasonZh, result.reasonEn)}</p>{!result.passed && <p className="cw-action-item"><strong>{t('你要做：', 'Your move: ')}</strong>{t(result.actionZh, result.actionEn)}</p>}{result.evidence.map((e, i) => <button className="cw-evidence" key={i} disabled={!reviewIsCurrent || editorView === 'original'} onClick={() => showEvidence(e.paragraphId)} title={t('在稿件中查看', 'Show in the draft')}>“{e.quote}”</button>)}</>}
            </li>;
          })}</ol>
          {state.phase === 'ready_to_correct' && <><p className="cw-scope-note">{t('通过训练门槛不等于达到目标分。接下来只修当前项目，后续错误暂时保留。', 'Passing the gate does not mean reaching your target band. Only this criterion is corrected next; later errors remain for later passes.')}</p><button className="cw-primary" data-testid="coaching-correct" disabled={!!busy} onClick={() => void perform('correct')}>{t('观看本关精修', 'Watch focused corrections')} →</button></>}
          {canEdit && <div className="cw-review-actions">{state.phase === 'rewrite_required' && <button className="cw-primary" data-testid="rewrite-now" disabled={!!busy} onClick={editNow}>{t('我来重写', 'I’ll rewrite it')}</button>}{(state.phase === 'needs_review' || dirty) && <button className={state.phase === 'needs_review' ? 'cw-primary' : 'cw-text-action'} data-testid="coaching-review" disabled={!!busy || wordCount > 1500 || !draft.trim()} onClick={() => void perform('review')}>{dirty ? t('保存并重新检查', 'Save & review again') : t('检查当前稿件', 'Review this draft')}</button>}<p className="cw-attempt-note">{t(`本关未通过 ${failedCount} / ${MAX_FAILED_REVIEWS} 次。第三次未通过会保存练习计划并暂停，不会强行放行。`, `${failedCount} / ${MAX_FAILED_REVIEWS} failed reviews in this pass. A third failure saves a practice plan and pauses the round; it never grants an automatic pass.`)}</p></div>}
          {state.phase === 'practice_paused' && <div className="cw-paused" data-testid="practice-paused"><p>{t('三次未通过。你的稿件和意见都已保存。先按这份计划练习，再用新稿开始下一轮。', 'Three failed reviews. Your draft and feedback are saved. Practise with this plan, then start a fresh round with a new draft.')}</p><button className="cw-primary" data-testid="copy-plan" onClick={() => void copy(planText)}>{copied ? t('已复制', 'Copied') : t('复制稿件与练习计划', 'Copy draft & practice plan')}</button><Link href="/">{t('开始新一轮练习', 'Start a fresh practice')} →</Link></div>}
        </aside>
      </div>}
      {!round?.correction && !state.final && !replayRound?.correction && <div className="cw-mobile-pin"><strong>{t(examiner.zh, examiner.en)} · {criterionLabel(state.currentCriterion, data.task_type, lang)} · {busy ? t('检查中', 'Working') : state.phase === 'ready_to_correct' ? t('3 / 3 通过', '3 / 3 passed') : `${review?.checks.filter(c => c.passed).length || 0} / 3`}</strong><span>{busy ? statusLabel : review ? t(review.checks.find(c => !c.passed)?.actionZh || review.summaryZh, review.checks.find(c => !c.passed)?.actionEn || review.summaryEn) : t('全部通过后，才开始精修。', 'All checks must pass before corrections.')}</span></div>}
    </main>
  </div>;
}
