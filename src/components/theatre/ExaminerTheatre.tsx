'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CharacterAvatar, JOURNEY_CAST } from '@/components/journey/CharacterAvatar';
import { buildFilm, phaseAt, type Criterion, type ExaminerStage, type Paragraph, type Piece } from './theatre-engine';

export type TheatreData = {
  task_type: string;
  prompt_text: string;
  paragraphs: Paragraph[];
  task_image_url?: string;
  assessment: { scores: Record<string, { score: number }>, overall: number, diagnosisZh: string, diagnosisEn: string };
  correction: { stages: ExaminerStage[] };
};
const CAST: { key: Criterion; name: string; zh: string; job: string; enJob: string; color: string }[] = JOURNEY_CAST.map(cast => ({ key: cast.key, name: cast.nameEn, zh: cast.nameZh, job: cast.titleZh, enJob: cast.titleEn, color: cast.color }));

export function ExaminerTheatre({ data, demo = false, autoPlay = false }: { data: TheatreData; demo?: boolean; autoPlay?: boolean }) {
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [position, setPosition] = useState(0), [playing, setPlaying] = useState(autoPlay), [speed, setSpeed] = useState(1);
  const [view, setView] = useState<'film' | 'original' | 'corrected'>('film');
  const [copied, setCopied] = useState(false);
  const film = useMemo(() => buildFilm(data.paragraphs, data.correction.stages), [data]);
  const finished = position >= film.duration;
  const shotIndex = finished ? film.shots.length : Math.max(0, film.shots.findIndex(s => position < s.end));
  const shot = film.shots[Math.min(shotIndex, film.shots.length - 1)];
  const scene = film.scenes[shot?.stageIndex || 0];
  const examiner = CAST[shot?.stageIndex || 0];
  const phase = shot ? phaseAt(shot, position) : { name: 'diagnosis', inserted: 0 };
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const activeRef = useRef<HTMLDivElement>(null);
  const firstLabel = data.task_type === 'task2' ? t('任务回应', 'Task Response') : t('任务完成度', 'Task Achievement');

  useEffect(() => {
    if (!playing || view !== 'film') return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), delta = Math.min(now - previous, 200); previous = now;
      setPosition(p => Math.min(film.duration, p + delta * speed));
    }, 40);
    return () => clearInterval(timer);
  }, [playing, speed, film.duration, view]);
  useEffect(() => { if (finished) setPlaying(false) }, [finished]);
  useEffect(() => {
    if (shot?.paragraphId && view === 'film' && position > 0) activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [shot?.paragraphId, shot?.stageIndex, view]);

  function replay() { setView('film'); setPosition(0); setPlaying(true) }
  function renderPiece(piece: Piece, index: number) {
    if (piece.kind === 'same') return <span key={index}>{piece.text}</span>;
    if (piece.eventIndex < shotIndex) return <span key={index}>{piece.after}</span>;
    if (piece.eventIndex > shotIndex) return <span key={index}>{piece.before}</span>;
    if (phase.name === 'settle') return <span key={index} className="ba-fresh">{piece.after}</span>;
    return <span key={index} className="ba-change" data-testid="active-change">
      {piece.before && <span className={phase.name === 'highlight' ? 'ba-highlight' : 'ba-removed'}>{piece.before}</span>}
      {phase.name === 'insert' && <span className="ba-added">{piece.after.slice(0, phase.inserted)}<span className="ba-caret" /></span>}
      {!piece.before && phase.name === 'highlight' && <span className="ba-insertion-point" aria-label="Insertion point">▏</span>}
    </span>;
  }
  return <div className="ba-theatre" style={{ '--examiner': examiner?.color || '#087e82' } as React.CSSProperties} data-testid="theatre" data-phase={finished ? 'complete' : phase.name} data-examiner={examiner?.key} data-progress={Math.round(position)}>
    <style>{CSS}</style>
    <header className="ba-header"><Link href="/" className="ba-brand"><small>IELTS WRITING WEST</small>{t('雅思写作西游记', 'IELTS Writing West')}</Link>
      <button onClick={() => setLang(v => v === 'zh' ? 'en' : 'zh')} aria-label="Toggle language">{lang === 'zh' ? 'EN' : '中文'}</button>
    </header>
    <main className="ba-main">
      <div className="ba-heading"><div><p className="ba-eyebrow">{demo ? t('AI 角色 · 已完成的修改回放', 'AI CHARACTERS · COMPLETED CORRECTION REPLAY') : t('你的作文 · 四位 AI 角色', 'YOUR ESSAY · FOUR AI CHARACTERS')}</p><h1>{t('过四关，让作文脱胎换骨。', 'Four passes. Transform your writing.')}</h1></div><span className="ba-task">{data.task_type === 'task2' ? 'TASK 2' : 'TASK 1'} / {t('原稿估分', 'ORIGINAL ESSAY')}</span></div>
      <section className="ba-scores" aria-label={t('原稿评分', 'Original essay scores')} data-testid="score-rail">
        {CAST.map((c, i) => <div key={c.key} style={{ color: c.color }}><small>{i === 0 ? (data.task_type === 'task2' ? 'TR' : 'TA') : c.key.toUpperCase()}</small><strong data-testid={`score-${c.key}`}>{data.assessment.scores[c.key].score.toFixed(1)}</strong><span>{i === 0 ? firstLabel : t(c.job, c.enJob)}</span></div>)}
        <div className="ba-overall"><small>{t('本篇估分', 'ESTIMATE')}</small><strong data-testid="score-overall">{data.assessment.overall.toFixed(1)}</strong><span>{t('非官方 IELTS 成绩', 'Not an official IELTS result')}</span></div>
      </section>
      <details className="ba-question"><summary>{t('查看题目与整体诊断', 'Question & overall diagnosis')}</summary><p>{data.prompt_text}</p>{data.task_image_url && <img src={data.task_image_url} alt="Task 1 chart" style={{ maxWidth: '100%', maxHeight: 360 }} />}<p>{t(data.assessment.diagnosisZh, data.assessment.diagnosisEn)}</p></details>
      <nav className="ba-cast" aria-label="Four examiners">{CAST.map((c, i) => <button key={c.key} className={i === (shot?.stageIndex || 0) && !finished ? 'active' : ''} style={{ '--cast-color': c.color } as React.CSSProperties} onClick={() => { const intro = film.shots[film.scenes[i].introIndex]; setPosition(intro.start); setView('film'); setPlaying(true) }} data-testid={`examiner-${c.key}`}><span className="journey-rail-face"><CharacterAvatar criterion={c.key} size={36} /><b>{finished || i < (shot?.stageIndex || 0) ? '✓' : `0${i + 1}`}</b></span><span>{t(c.zh, c.name)}<small>{i === 0 ? firstLabel : t(c.job, c.enJob)}</small></span></button>)}</nav>
      <div className="ba-workspace">
        <section className="ba-paper"><div className="ba-paper-top"><span>{t('你的作文', 'YOUR ESSAY')}</span><div className="ba-tabs">{(['film', 'original', 'corrected'] as const).map(v => <button key={v} aria-pressed={view === v} onClick={() => { setView(v); if (v !== 'film') setPlaying(false) }}>{v === 'film' ? t('观看修改', 'Watch') : v === 'original' ? t('原稿', 'Original') : t('修改稿', 'Corrected')}</button>)}</div></div>
          <div className="ba-document" data-testid="essay-document">{data.paragraphs.map((p, i) => {
            const active = view === 'film' && !finished && shot?.paragraphId === p.id;
            return <div key={p.id} data-testid="essay-paragraph" className={`ba-paragraph ${active ? 'is-active' : ''}`} ref={active ? activeRef : undefined}>
              <span className="ba-paragraph-number">{String(i + 1).padStart(2, '0')}</span>
              <p>{view === 'original' ? p.text : view === 'corrected' || finished ? film.final[i].text : scene?.pieces[p.id]?.map(renderPiece) || p.text}</p>
            </div>
          })}</div>
          {finished && <div className="ba-finish"><strong>{t('四位考官已完成。', 'All four examiners have finished.')}</strong><button onClick={async () => { await navigator.clipboard.writeText(film.final.map(p => p.text).join('\n\n')); setCopied(true) }}>{copied ? t('已复制', 'Copied') : t('复制修改稿', 'Copy corrected essay')}</button></div>}
        </section>
        <aside className="ba-explanation" data-testid="examiner-panel"><div className="journey-theatre-persona"><CharacterAvatar criterion={examiner.key} size={48} /><div><small>{finished ? t('四关完成', 'FOUR PASSES COMPLETE') : t('AI 角色 · 现在出场', 'AI CHARACTER · NOW EXAMINING')}</small><h2>{t(examiner.zh, examiner.name)}</h2><p>{(shot?.stageIndex || 0) === 0 ? firstLabel : t(examiner.job, examiner.enJob)}</p></div></div>
          {!finished && <><p className="ba-stage-summary">{t(scene.stage.diagnosisZh, scene.stage.diagnosisEn)}</p>
            {shot.kind === 'edit' && <div className="ba-specific"><small>{t('正在修改', 'LIVE CORRECTION')} · {t('第', 'PARAGRAPH ')} {scene.before.findIndex(p => p.id === shot.paragraphId) + 1}{lang === 'zh' ? ' 段' : ''}</small>
              <blockquote>{shot.before || t('补充表达', 'Add wording')}</blockquote>
              {shot.reasons.map((r, i) => <p key={i}>{t(r.explanationZh, r.explanationEn)}</p>)}
            </div>}
            {position === 0 && !playing && <button className="ba-start" onClick={() => setPlaying(true)}>{t('▶ 开始四位考官演示', '▶ Watch the four examiners')}</button>}
          </>}
          {finished && <p className="ba-stage-summary">{t('原稿评分保持不变。重播每一步，看看为什么这样改。', 'The original scores stay unchanged. Replay each step to see why it was revised.')}</p>}
        </aside>
      </div>
    </main>
    <footer className="ba-transport"><div className="ba-mobile-now">{finished ? t('演示完成', 'Complete') : t(examiner.zh, examiner.name)}{shot.kind === 'edit' && !finished && <span>{t(shot.reasons[0]?.explanationZh || '观察原文与修改', shot.reasons[0]?.explanationEn || 'Watch the revision')}</span>}</div><div className="ba-controls"><button className="ba-play" onClick={() => { if (finished) replay(); else { setView('film'); setPlaying(p => !p) }}} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '' : '▶'}<span>{playing ? t('暂停', 'Pause') : t('播放', 'Play')}</span></button><button onClick={replay}>{t('重播', 'Replay')}</button><button onClick={() => setSpeed(v => v === 1 ? 2 : 1)} aria-label="Playback speed">{speed}×</button><div className="ba-progress" role="progressbar" aria-valuenow={Math.round(position / film.duration * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${position / film.duration * 100}%` }} /></div><span className="ba-time">{Math.floor(position / 1000)} / {Math.ceil(film.duration / 1000)}s</span><button onClick={() => { setPosition(film.duration); setPlaying(false); setView('film') }}>{t('看结果', 'Skip to result')}</button></div></footer>
  </div>;
}

const CSS = `
.ba-theatre{background:#f7f4ec;color:#172020;min-height:100vh;font-family:"PingFang SC","Microsoft YaHei",sans-serif;padding-bottom:110px}.ba-theatre *{box-sizing:border-box}.ba-theatre button,.ba-theatre a{-webkit-tap-highlight-color:transparent}.ba-theatre button{cursor:pointer;font:inherit;border:0;background:none;color:inherit}.ba-header{height:88px;border-bottom:1px solid #ddd8ce;display:flex;align-items:center;justify-content:space-between;padding:0 max(24px,calc((100vw - 1220px)/2))}.ba-brand{text-decoration:none;color:#172020;font-size:22px;font-weight:650;letter-spacing:-.7px}.ba-brand small{display:block;font-size:9px;letter-spacing:3px;font-weight:500;color:#686d66;margin-bottom:3px}.ba-brand span{font-size:11px;font-weight:400;letter-spacing:1px;margin-left:16px}.ba-header>button{border:1px solid #bdb8ad;padding:8px 12px;font-size:12px}.ba-main{max-width:1220px;margin:auto;padding:32px 24px}.ba-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:26px}.ba-eyebrow{color:#be4a32;font-size:10px;letter-spacing:2px;margin:0 0 10px}.ba-heading h1{font-size:clamp(26px,3vw,40px);font-weight:650;letter-spacing:-1px;margin:0}.ba-task{font-size:10px;letter-spacing:1px;white-space:nowrap;padding-bottom:5px;color:#646860}.ba-scores{display:grid;grid-template-columns:repeat(5,1fr);padding:22px 0;border-top:1px solid #172020;border-bottom:1px solid #172020;gap:12px}.ba-scores>div{display:flex;flex-direction:column;gap:6px;padding:0 15px;border-left:1px solid #dcd7cb}.ba-scores>div:first-child{border-left:0}.ba-scores small{font-size:9px;font-weight:700;letter-spacing:1.5px}.ba-scores strong{font-family:Georgia,serif;font-size:46px;font-weight:400;line-height:1}.ba-scores span{font-size:10px;color:#525b57;line-height:1.5}.ba-overall strong{color:#172020}.ba-question{font-size:12px;color:#56615b;padding:16px 0;border-bottom:1px solid #ddd8ce}.ba-question summary{cursor:pointer}.ba-question p{line-height:1.8;max-width:900px}.ba-cast{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:24px 0}.ba-cast button{display:flex;align-items:center;text-align:left;gap:10px;padding:14px 10px;border-bottom:3px solid #dedad0;transition:background .2s}.ba-cast button.active{border-color:var(--cast-color);background:white}.ba-cast b{font-family:Georgia,serif;font-size:24px;font-weight:400;color:var(--cast-color)}.ba-cast span{font-size:13px;font-weight:650}.ba-cast .journey-rail-face{margin-right:4px}.ba-cast .journey-rail-face>b{font-size:9px;font-weight:400}.ba-cast small{display:block;font-size:9px;font-weight:400;margin-top:4px;color:#63716a}.ba-workspace{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:30px;align-items:start}.ba-paper{background:#fffefb;border:1px solid #e5dfd1;padding:24px 30px 32px;min-width:0}.ba-paper-top{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #e8e3d9;padding-bottom:17px;margin-bottom:24px}.ba-paper-top>span{font-size:10px;letter-spacing:2px;color:#56615b}.ba-tabs{display:flex;gap:3px}.ba-tabs button{font-size:10px;padding:6px 8px;border-radius:3px}.ba-tabs button[aria-pressed=true]{background:#eeeae1}.ba-document{font:18px/1.95 Georgia,"Times New Roman",serif;overflow-wrap:anywhere}.ba-paragraph{position:relative;margin-bottom:24px;scroll-margin-top:120px;transition:background .25s}.ba-paragraph p{margin:0;white-space:pre-wrap}.ba-paragraph-number{position:absolute;left:-21px;top:7px;font:9px/1.2 monospace;color:#9d9b92}.ba-paragraph.is-active{background:#faf8f0;outline:8px solid #faf8f0}.ba-highlight{background:#fce2ac;box-shadow:0 0 0 2px #fce2ac;transition:background .2s}.ba-removed{color:#a95449;text-decoration:line-through;text-decoration-thickness:2px;background:#f8e7df}.ba-added,.ba-fresh{color:#087260;background:#ddf0e3}.ba-insertion-point{color:var(--examiner);font-weight:bold}.ba-caret{display:inline-block;height:1em;border-left:2px solid #087260;vertical-align:-2px;animation:ba-blink .7s infinite}.ba-explanation{position:sticky;top:24px;border-top:3px solid var(--examiner);padding-top:20px}.ba-examiner-label{display:flex;gap:12px;align-items:center}.ba-examiner-label>span{font:42px/1 Georgia,serif;color:var(--examiner)}.ba-examiner-label small{font-size:9px;letter-spacing:1.5px;color:#6b746d}.ba-examiner-label h2{font-size:22px;margin:5px 0;letter-spacing:-.5px}.ba-stage-summary{font-size:13px;line-height:1.9;color:#53615b}.ba-specific{border-top:1px solid #d5d7cb;padding-top:15px;margin-top:20px}.ba-specific small{font-size:9px;color:var(--examiner);letter-spacing:1px}.ba-specific blockquote{font:italic 20px/1.5 Georgia,serif;margin:14px 0;color:#172020;overflow-wrap:anywhere}.ba-specific p{font-size:13px;line-height:1.8;color:#4c5d55}.ba-start{background:#172020!important;color:white!important;padding:14px 18px!important;margin-top:16px;width:100%;font-size:13px!important}.ba-finish{border-top:1px solid #d9ded4;padding-top:20px;display:flex;justify-content:space-between;gap:16px;font-size:12px}.ba-finish button{color:#087260;text-decoration:underline}.ba-transport{position:fixed;z-index:80;bottom:0;left:0;right:0;background:#172020;color:#fffdf8;padding:16px 24px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -4px 20px #17202008}.ba-controls{display:flex;align-items:center;gap:20px;max-width:1172px;margin:auto}.ba-controls button{font-size:12px;white-space:nowrap;padding:7px 0}.ba-play{display:flex;align-items:center;gap:10px;color:#ffae8d!important}.ba-progress{height:3px;background:#4a5550;flex:1;overflow:hidden}.ba-progress i{display:block;background:#f2a07e;height:100%}.ba-time{font:10px monospace;color:#b6bdb4}.ba-mobile-now{display:none}@keyframes ba-blink{50%{opacity:0}}
@media(max-width:760px){.ba-header{height:74px;padding:0 18px}.ba-brand{font-size:19px}.ba-brand span{display:none}.ba-main{padding:25px 18px}.ba-heading{display:block;margin-bottom:23px}.ba-task{display:block;margin-top:14px}.ba-scores{gap:0;padding:18px 0}.ba-scores>div{padding:0 7px}.ba-scores strong{font-size:32px}.ba-scores span{font-size:9px}.ba-scores small{font-size:8px}.ba-cast{gap:0;margin:18px 0}.ba-cast button{display:block;padding:12px 5px}.ba-cast b{font-size:22px}.ba-cast span{font-size:11px;display:block;margin-top:5px}.ba-cast .journey-rail-face{width:36px;margin:0 0 7px}.ba-cast .journey-avatar{margin:0}.ba-cast .journey-rail-face>b{display:block}.ba-cast .journey-rail-face .journey-avatar{display:inline-flex}.ba-cast small{font-size:8px;line-height:1.4}.ba-workspace{display:flex;flex-direction:column;gap:16px}.ba-explanation{position:relative;order:-1;top:auto;width:100%;padding-top:14px}.ba-examiner-label>span{font-size:32px}.ba-examiner-label h2{font-size:19px}.ba-stage-summary{font-size:12px;margin-bottom:0}.ba-specific{display:none}.ba-start{margin:12px 0 0}.ba-paper{padding:18px 18px 25px;width:100%}.ba-document{font-size:17px;line-height:1.95}.ba-paragraph-number{left:-12px;font-size:7px}.ba-paper-top>span{font-size:9px;letter-spacing:1px}.ba-tabs button{font-size:9px;padding:5px 6px}.ba-paragraph{scroll-margin-top:80px}.ba-theatre{padding-bottom:190px}.ba-controls{gap:14px;padding-right:60px}.ba-controls button{font-size:11px}.ba-time{display:none}.ba-transport{padding:12px 18px calc(12px + env(safe-area-inset-bottom))}.ba-mobile-now{display:block;font-size:11px;color:#ffbf9e;margin-bottom:8px}.ba-mobile-now span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11px;line-height:1.6;color:#e2e5da;margin-top:5px}.ba-finish{display:block;line-height:2}.ba-finish button{display:block}}
`;
