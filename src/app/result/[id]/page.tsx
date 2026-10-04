'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { LanguageProvider, useLanguage } from '@/components/LanguageContext';
import { LangToggle } from '@/components/LangToggle';
import { diffWordsWithSpace } from 'diff';
import type { Assessment, Correction, Paragraph, PlaybackEvent, SubmissionData } from '@/lib/types';

type Phase = 'loading' | 'assessing' | 'correcting' | 'displaying' | 'error';

function ScoreRail({ assessment, lang }: { assessment: Assessment; lang: string }) {
  const criteria = [
    { key: 'ta_tr', label: lang === 'zh' ? assessment.scores.ta_tr.labelZh : assessment.scores.ta_tr.labelEn, color: 'ta', short: lang === 'zh' ? '任务' : 'TA/TR' },
    { key: 'cc', label: lang === 'zh' ? assessment.scores.cc.labelZh : assessment.scores.cc.labelEn, color: 'cc', short: lang === 'zh' ? '连贯' : 'CC' },
    { key: 'lr', label: lang === 'zh' ? assessment.scores.lr.labelZh : assessment.scores.lr.labelEn, color: 'lr', short: lang === 'zh' ? '词汇' : 'LR' },
    { key: 'gra', label: lang === 'zh' ? assessment.scores.gra.labelZh : assessment.scores.gra.labelEn, color: 'gra', short: lang === 'zh' ? '语法' : 'GRA' },
  ];

  return (
    <div className="border border-[#E5E0D5] rounded bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#9CA3AF] zh-font">
          {lang === 'zh' ? '评分详情' : 'Score Details'}
        </span>
        <span className="text-xs text-[#9CA3AF] zh-font">
          {lang === 'zh' ? '作文/任务估分' : 'Essay/Task Estimate'}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {criteria.map(c => (
          <div key={c.key} className="text-center">
            <div className={`text-2xl font-light text-${c.color} score-number`}>
              {assessment.scores[c.key as keyof typeof assessment.scores].score}
            </div>
            <div className="text-[10px] text-[#9CA3AF] mt-1 zh-font hidden md:block">{c.label}</div>
            <div className="text-[10px] text-[#9CA3AF] mt-1 zh-font md:hidden">{c.short}</div>
          </div>
        ))}
        <div className="text-center border-l border-[#E5E0D5] pl-2">
          <div className="text-2xl font-light text-[#172020] score-number">
            {assessment.overall}
          </div>
          <div className="text-[10px] text-[#9CA3AF] mt-1 zh-font">
            {lang === 'zh' ? '总估分' : 'Overall'}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiagnosisPanel({ assessment, lang }: { assessment: Assessment; lang: string }) {
  return (
    <div className="border border-[#E5E0D5] rounded bg-white p-4">
      <h3 className="text-sm font-medium text-[#172020] mb-2 zh-font">
        {lang === 'zh' ? '诊断' : 'Diagnosis'}
      </h3>
      <p className="text-sm text-[#172020] leading-relaxed zh-font">
        {lang === 'zh' ? assessment.diagnosisZh : assessment.diagnosisEn}
      </p>
    </div>
  );
}

interface ParagraphDiff {
  paragraphId: string;
  parts: Array<{ value: string; added: boolean; removed: boolean }>;
  hasChanges: boolean;
}

function computeParagraphDiffs(
  paragraphs: Paragraph[],
  correction: Correction
): ParagraphDiff[] {
  return paragraphs.map(para => {
    const corrected = correction.paragraphs.find(c => c.paragraphId === para.id);
    if (!corrected || corrected.correctedText === para.text) {
      return { paragraphId: para.id, parts: [{ value: para.text, added: false, removed: false }], hasChanges: false };
    }
    const diff = diffWordsWithSpace(para.text, corrected.correctedText);
    return { paragraphId: para.id, parts: diff, hasChanges: true };
  });
}

function EssayDisplay({
  paragraphs,
  correction,
  activeParagraphId,
  showCorrected,
}: {
  paragraphs: Paragraph[];
  correction: Correction | null;
  activeParagraphId: string | null;
  showCorrected: boolean;
}) {
  const diffs = correction ? computeParagraphDiffs(paragraphs, correction) : null;

  return (
    <div className="essay-font text-base leading-[1.8]">
      {paragraphs.map((para, idx) => {
        const isActive = activeParagraphId === para.id;
        const diff = diffs?.find(d => d.paragraphId === para.id);
        const correctedPara = correction?.paragraphs.find(c => c.paragraphId === para.id);

        return (
          <div
            key={para.id}
            className={`mb-4 transition-all duration-300 ${isActive ? 'paragraph-active' : ''}`}
            id={`para-${para.id}`}
          >
            {showCorrected && correctedPara && diff?.hasChanges ? (
              <p>
                {diff.parts.map((part, i) => {
                  if (part.removed) {
                    return <span key={i} className="text-strikethrough">{part.value}</span>;
                  }
                  if (part.added) {
                    return <span key={i} className="text-replacement">{part.value}</span>;
                  }
                  return <span key={i}>{part.value}</span>;
                })}
              </p>
            ) : (
              <p>{para.text}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReasonPanel({
  correction,
  activeParagraphId,
  lang,
}: {
  correction: Correction | null;
  activeParagraphId: string | null;
  lang: string;
}) {
  if (!correction || !activeParagraphId) return null;
  const activePara = correction.paragraphs.find(p => p.paragraphId === activeParagraphId);
  if (!activePara || activePara.reasons.length === 0) return null;

  const criterionColors: Record<string, string> = {
    ta_tr: 'ta', cc: 'cc', lr: 'lr', gra: 'gra',
  };

  return (
    <div className="border border-[#E5E0D5] rounded bg-white p-4">
      <h3 className="text-sm font-medium text-[#172020] mb-3 zh-font">
        {lang === 'zh' ? '修改说明' : 'Corrections'}
      </h3>
      <div className="space-y-3">
        {activePara.reasons.map((reason, idx) => (
          <div key={idx} className="border-l-2 border-[#E5E0D5] pl-3">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs px-1.5 py-0.5 rounded bg-${criterionColors[reason.criterion]}/10 text-${criterionColors[reason.criterion]} zh-font`}>
                {reason.criterion.toUpperCase()}
              </span>
              <span className="text-xs text-[#9CA3AF] italic">&ldquo;{reason.quote}&rdquo;</span>
            </div>
            <p className="text-sm text-[#172020] zh-font">
              {lang === 'zh' ? reason.explanationZh : reason.explanationEn}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaybackControls({
  isPlaying,
  speed,
  onTogglePlay,
  onSpeedChange,
  onReplay,
  onSkip,
  progress,
  lang,
}: {
  isPlaying: boolean;
  speed: number;
  onTogglePlay: () => void;
  onSpeedChange: (s: number) => void;
  onReplay: () => void;
  onSkip: () => void;
  progress: number;
  lang: string;
}) {
  return (
    <div className="border border-[#E5E0D5] rounded bg-white p-3 flex items-center gap-3">
      <button
        onClick={onTogglePlay}
        className="w-8 h-8 flex items-center justify-center rounded bg-[#F15B3D] text-white hover:bg-[#d94a2e] transition-colors"
      >
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="3" height="8"/><rect x="7" y="2" width="3" height="8"/></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,0 12,6 2,12"/></svg>
        )}
      </button>
      <button
        onClick={onReplay}
        className="text-xs text-[#9CA3AF] hover:text-[#172020] transition-colors zh-font"
      >
        {lang === 'zh' ? '重播' : 'Replay'}
      </button>
      <button
        onClick={onSkip}
        className="text-xs text-[#9CA3AF] hover:text-[#172020] transition-colors zh-font"
      >
        {lang === 'zh' ? '跳过' : 'Skip'}
      </button>
      <div className="flex-1 h-1 bg-[#E5E0D5] rounded overflow-hidden">
        <div className="h-full bg-[#F15B3D] transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>
      <button
        onClick={() => onSpeedChange(speed === 1 ? 2 : 1)}
        className="text-xs text-[#9CA3AF] hover:text-[#172020] transition-colors zh-font"
      >
        {speed}x
      </button>
    </div>
  );
}

function ResultPageInner() {
  const { t, lang } = useLanguage();
  const params = useParams();
  const id = params.id as string;

  const [phase, setPhase] = useState<Phase>('loading');
  const [submission, setSubmission] = useState<SubmissionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCorrected, setShowCorrected] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [activeParagraphId, setActiveParagraphId] = useState<string | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventIndexRef = useRef(0);

  const fetchSubmission = useCallback(async () => {
    try {
      const res = await fetch(`/api/submissions/${id}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data: SubmissionData = await res.json();
      setSubmission(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
      return null;
    }
  }, [id]);

  // Initial load and state management
  useEffect(() => {
    async function init() {
      const data = await fetchSubmission();
      if (!data) return;

      if (data.stage === 'corrected' && data.assessment && data.correction) {
        setPhase('displaying');
        setActiveParagraphId(data.paragraphs[0]?.id || null);
        return;
      }

      if (data.assessment && data.stage === 'assessed') {
        // Has assessment, need correction
        setPhase('correcting');
        try {
          const res = await fetch(`/api/submissions/${id}/correct`, { method: 'POST' });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Correction failed');
          }
          await fetchSubmission();
          setPhase('displaying');
          setActiveParagraphId(data.paragraphs[0]?.id || null);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Correction failed');
          setPhase('error');
        }
        return;
      }

      // Need assessment first
      setPhase('assessing');
      try {
        const assessRes = await fetch(`/api/submissions/${id}/assess`, { method: 'POST' });
        if (!assessRes.ok) {
          const err = await assessRes.json();
          throw new Error(err.error || 'Assessment failed');
        }
        const assessment: Assessment = await assessRes.json();

        // Update local state with assessment
        setSubmission(prev => prev ? { ...prev, assessment } : prev);
        setPhase('correcting');

        // Now correct
        const correctRes = await fetch(`/api/submissions/${id}/correct`, { method: 'POST' });
        if (!correctRes.ok) {
          const err = await correctRes.json();
          throw new Error(err.error || 'Correction failed');
        }
        await fetchSubmission();
        setPhase('displaying');
        setActiveParagraphId(data.paragraphs[0]?.id || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Processing failed');
        setPhase('error');
      }
    }
    init();
  }, [id, fetchSubmission]);

  // Playback animation
  useEffect(() => {
    if (phase !== 'displaying' || !submission?.correction || !submission?.paragraphs) return;
    if (!isPlaying) return;

    const events = submission.playback?.events || [];
    if (events.length === 0) {
      setPlaybackProgress(100);
      return;
    }

    function playNext() {
      if (eventIndexRef.current >= events.length) {
        setIsPlaying(false);
        setPlaybackProgress(100);
        return;
      }

      const event = events[eventIndexRef.current];
      setActiveParagraphId(event.paragraphId);
      setPlaybackProgress(Math.round(((eventIndexRef.current + 1) / events.length) * 100));

      // Scroll to active paragraph
      const el = document.getElementById(`para-${event.paragraphId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      eventIndexRef.current++;
      const delay = 1500 / speed;
      timerRef.current = setTimeout(playNext, delay);
    }

    playNext();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, submission, isPlaying, speed]);

  const handleTogglePlay = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  const handleReplay = useCallback(() => {
    eventIndexRef.current = 0;
    setPlaybackProgress(0);
    setIsPlaying(true);
  }, []);

  const handleSkip = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsPlaying(false);
    setPlaybackProgress(100);
    if (submission?.paragraphs) {
      setActiveParagraphId(submission.paragraphs[submission.paragraphs.length - 1]?.id || null);
    }
  }, [submission]);

  const handleCopy = useCallback(() => {
    if (!submission?.correction) return;
    const text = submission.correction.paragraphs.map(p => p.correctedText).join('\n\n');
    navigator.clipboard.writeText(text);
  }, [submission]);

  // Loading state
  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-ivory flex items-center justify-center">
        <div className="text-[#9CA3AF] zh-font">{t('加载中...', 'Loading...')}</div>
      </div>
    );
  }

  // Error state
  if (phase === 'error' || !submission) {
    return (
      <div className="min-h-screen bg-ivory">
        <header className="border-b border-[#E5E0D5] px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div>
              <span className="text-xs tracking-widest uppercase text-[#9CA3AF] zh-font">WRITING LAB</span>
              <h1 className="text-lg font-light tracking-wide text-[#172020]">Band Autopsy</h1>
            </div>
            <LangToggle />
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center">
            <p className="text-[#F15B3D] mb-4 zh-font">{error || t('处理出错', 'Something went wrong')}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 border border-[#F15B3D] text-[#F15B3D] rounded text-sm hover:bg-[#F15B3D] hover:text-white transition-colors zh-font"
            >
              {t('重试', 'Retry')}
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Processing state
  if (phase === 'assessing' || phase === 'correcting') {
    return (
      <div className="min-h-screen bg-ivory">
        <header className="border-b border-[#E5E0D5] px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div>
              <span className="text-xs tracking-widest uppercase text-[#9CA3AF] zh-font">WRITING LAB</span>
              <h1 className="text-lg font-light tracking-wide text-[#172020]">Band Autopsy</h1>
            </div>
            <LangToggle />
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-2 border-[#F15B3D] border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-[#172020] zh-font">
              {phase === 'assessing'
                ? t('正在评估作文...', 'Assessing essay...')
                : t('正在生成修改建议...', 'Generating corrections...')
              }
            </p>
            <p className="text-sm text-[#9CA3AF] mt-2 zh-font">
              {t('请耐心等待，模型正在分析', 'Please wait, model is analyzing')}
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Display state
  return (
    <div className="min-h-screen bg-ivory">
      <header className="border-b border-[#E5E0D5] px-6 py-4 sticky top-0 bg-ivory z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <span className="text-xs tracking-widest uppercase text-[#9CA3AF] zh-font">WRITING LAB</span>
            <h1 className="text-lg font-light tracking-wide text-[#172020]">Band Autopsy</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCorrected(!showCorrected)}
              className="px-3 py-1.5 text-xs border border-[#E5E0D5] rounded hover:bg-[#EDE8DC] transition-colors zh-font"
            >
              {showCorrected ? t('查看原文', 'View Original') : t('查看修改', 'View Corrected')}
            </button>
            {submission.correction && (
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 text-xs border border-[#E5E0D5] rounded hover:bg-[#EDE8DC] transition-colors zh-font"
              >
                {t('复制修改稿', 'Copy Corrected')}
              </button>
            )}
            <LangToggle />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Score Rail - sticky on desktop */}
        {submission.assessment && (
          <div className="mb-6 md:sticky md:top-16 z-40">
            <ScoreRail assessment={submission.assessment} lang={lang} />
          </div>
        )}

        {/* Diagnosis */}
        {submission.assessment && (
          <div className="mb-6">
            <DiagnosisPanel assessment={submission.assessment} lang={lang} />
          </div>
        )}

        {/* Essay + Explanation Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Essay Column */}
          <div className="md:col-span-2">
            <div className="bg-white border border-[#E5E0D5] rounded p-6 md:p-8">
              <EssayDisplay
                paragraphs={submission.paragraphs}
                correction={submission.correction}
                activeParagraphId={activeParagraphId}
                showCorrected={showCorrected}
              />
            </div>
          </div>

          {/* Explanation Column */}
          <div className="md:col-span-1">
            <div className="md:sticky md:top-48 space-y-4">
              {/* Reason Panel */}
              <ReasonPanel
                correction={submission.correction}
                activeParagraphId={activeParagraphId}
                lang={lang}
              />

              {/* Playback Controls */}
              {submission.correction && (
                <PlaybackControls
                  isPlaying={isPlaying}
                  speed={speed}
                  onTogglePlay={handleTogglePlay}
                  onSpeedChange={setSpeed}
                  onReplay={handleReplay}
                  onSkip={handleSkip}
                  progress={playbackProgress}
                  lang={lang}
                />
              )}
            </div>
          </div>
        </div>

        {/* Mobile: pinned explanation at bottom */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E5E0D5] p-3 z-50">
          {submission.correction && activeParagraphId && (
            <div className="max-h-32 overflow-y-auto mb-2">
              <ReasonPanel
                correction={submission.correction}
                activeParagraphId={activeParagraphId}
                lang={lang}
              />
            </div>
          )}
          {submission.correction && (
            <PlaybackControls
              isPlaying={isPlaying}
              speed={speed}
              onTogglePlay={handleTogglePlay}
              onSpeedChange={setSpeed}
              onReplay={handleReplay}
              onSkip={handleSkip}
              progress={playbackProgress}
              lang={lang}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default function ResultPage() {
  return (
    <LanguageProvider>
      <ResultPageInner />
    </LanguageProvider>
  );
}
