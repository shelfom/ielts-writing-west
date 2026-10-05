'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { CharacterAvatar, JOURNEY_CAST, criterionLabel } from '@/components/journey/CharacterAvatar';
import { phaseAt, type ExaminerStage, type Paragraph, type Piece } from '../theatre/theatre-engine';
import { buildStageFilm } from './single-stage-film';

export function SingleStagePlayer({ input, stage, autoPlay, continueAction, taskType }: {
  input: Paragraph[]; stage: ExaminerStage; autoPlay: boolean; continueAction: ReactNode; taskType: string;
}) {
  const { t, lang } = useLanguage();
  const character = JOURNEY_CAST.find(c => c.key === stage.criterion)!;
  const film = useMemo(() => buildStageFilm(input, stage), [input, stage]);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState<'motion' | 'before' | 'after'>('motion');
  const activeRef = useRef<HTMLParagraphElement>(null);
  const finished = position >= film.duration;
  const shotIndex = finished ? film.shots.length : Math.max(0, film.shots.findIndex(s => position < s.end));
  const shot = film.shots[Math.min(shotIndex, film.shots.length - 1)];
  const phase = phaseAt(shot, position);
  useEffect(() => {
    if (!playing || view !== 'motion' || finished) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const delta = Math.min(now - last, 200); last = now;
      setPosition(current => Math.min(film.duration, current + delta * speed));
    }, 40);
    return () => clearInterval(timer);
  }, [playing, speed, film.duration, view, finished]);
  useEffect(() => { if (finished) setPlaying(false); }, [finished]);
  useEffect(() => { if (autoPlay) { setPosition(0); setPlaying(true); } }, [autoPlay]);
  useEffect(() => {
    if (shot.paragraphId && view === 'motion' && playing) activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [shot.paragraphId, view, playing]);
  const replay = () => { setView('motion'); setPosition(0); setPlaying(true); };
  function renderPiece(piece: Piece, index: number) {
    if (piece.kind === 'same') return <span key={index}>{piece.text}</span>;
    if (piece.eventIndex < shotIndex) return <span key={index}>{piece.after}</span>;
    if (piece.eventIndex > shotIndex) return <span key={index}>{piece.before}</span>;
    if (phase.name === 'settle') return <span key={index} className="cw-added">{piece.after}</span>;
    return <span key={index} data-testid="stage-active-change">
      {piece.before && <span className={phase.name === 'highlight' ? 'cw-highlight' : 'cw-removed'}>{piece.before}</span>}
      {phase.name === 'insert' && <span className="cw-added">{piece.after.slice(0, phase.inserted)}<i className="cw-caret" /></span>}
      {!piece.before && phase.name === 'highlight' && <span className="cw-caret" />}
    </span>;
  }
  const explanation = shot.kind === 'edit' && !finished ? shot.reasons.map(r => t(r.explanationZh, r.explanationEn)).join(' ') : t(stage.diagnosisZh, stage.diagnosisEn);
  return <div className="cw-stage" data-testid="stage-player" data-progress={Math.round(position)} data-phase={finished ? 'complete' : phase.name} data-playing={playing}>
    <div className="cw-columns">
      <section className="cw-paper">
        <div className="cw-paper-heading"><span>{t('只修改这一项', 'THIS CRITERION ONLY')}</span><div className="cw-tabs">
          {(['motion', 'before', 'after'] as const).map(v => <button key={v} onClick={() => { setView(v); if (v !== 'motion') setPlaying(false); }} aria-pressed={view === v}>{v === 'motion' ? t('动画', 'Motion') : v === 'before' ? t('修改前', 'Before') : t('修改后', 'After')}</button>)}
        </div></div>
        <div className="cw-document" data-testid="stage-document">{input.map((p, i) => <p key={p.id} data-testid="stage-paragraph" className={shot.paragraphId === p.id && !finished && view === 'motion' ? 'cw-active-paragraph' : ''} ref={shot.paragraphId === p.id ? activeRef : undefined}>{view === 'before' ? p.text : view === 'after' || finished ? film.final[i].text : film.pieces[p.id].map(renderPiece)}</p>)}</div>
      </section>
      <aside className="cw-feedback cw-motion-feedback">
        <div className="journey-workspace-persona"><CharacterAvatar criterion={stage.criterion} size={48} /><div><span className="cw-kicker">{t('AI 角色', 'AI CHARACTER')}</span><strong>{t(character.nameZh, character.nameEn)}</strong><span className="journey-feedback-criterion">{criterionLabel(stage.criterion, taskType, lang)}</span></div></div>
        <span className="cw-kicker">{finished ? t('本关完成', 'PASS COMPLETE') : t('改哪里，为什么', 'WHAT CHANGES, AND WHY')}</span>
        <h2>{finished ? t('这一关，走完了。', 'One criterion stronger.') : t('看清每一处修改。', 'Watch each correction.')}</h2>
        <p>{t(stage.diagnosisZh, stage.diagnosisEn)}</p>
        {!finished && shot.kind === 'edit' && <div className="cw-live-reason"><blockquote>{shot.before || t('在这里补充', 'Insert here')}</blockquote><p>{explanation}</p></div>}
        {finished && <p>{t('本关结果已保存。原稿评分保持不变。', 'This result is saved. Your original scores stay unchanged.')}</p>}
        <div className="cw-next-action">{continueAction}</div>
      </aside>
    </div>
    <footer className="cw-transport">
      <div className="cw-mobile-explanation">{finished ? t('本关完成。可以进入下一步。', 'Pass complete. Ready for the next step.') : explanation}</div>
      <div className="cw-player-controls">
        <button data-testid="stage-play" onClick={() => { if (finished) replay(); else { setView('motion'); setPlaying(v => !v); } }}>{playing ? t('暂停', 'Pause') : t('播放', 'Play')}</button>
        <button data-testid="stage-replay" onClick={replay}>{t('重播', 'Replay')}</button>
        <button data-testid="stage-speed" onClick={() => setSpeed(v => v === 1 ? 2 : 1)}>{speed}×</button>
        <div className="cw-progress" role="progressbar" aria-label={t('修改进度', 'Correction progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position / film.duration * 100)}><i style={{ width: `${position / film.duration * 100}%` }} /></div>
        <button data-testid="stage-skip" onClick={() => { setPosition(film.duration); setPlaying(false); setView('motion'); }}>{t('看结果', 'Skip to result')}</button>
      </div>
    </footer>
  </div>;
}
