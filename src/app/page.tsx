'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LanguageProvider, useLanguage } from '@/components/LanguageContext';
import { LangToggle } from '@/components/LangToggle';
import { CharacterAvatar, JOURNEY_CAST, criterionLabel } from '@/components/journey/CharacterAvatar';

function InputFormInner() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [taskType, setTaskType] = useState<'academic1' | 'general1' | 'task2'>('task2');
  const [targetBand, setTargetBand] = useState<7 | 8 | 9>(7);
  const [promptText, setPromptText] = useState('');
  const [essayText, setEssayText] = useState('');
  const [taskImage, setTaskImage] = useState<File | null>(null);
  const [essayImages, setEssayImages] = useState<File[]>([]);
  const [taskImagePreview, setTaskImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingSample, setLoadingSample] = useState<'task1' | 'task2' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrConfirmed, setOcrConfirmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const essayFileRef = useRef<HTMLInputElement>(null);
  const essayPhotoRef = useRef<HTMLInputElement>(null);

  const handleTaskImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTaskImage(file);
      const reader = new FileReader();
      reader.onload = (ev) => setTaskImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  const handleEssayFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 3) {
      setError(t('最多上传3页作文图片', 'Maximum 3 essay pages allowed'));
      return;
    }
    setEssayImages(files);
    setOcrConfirmed(false);
    setOcrText(null);
  }, [t]);

  const handleTxtUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'text/plain') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setEssayText(ev.target?.result as string);
      };
      reader.readAsText(file, 'utf-8');
    }
  }, []);

  const handleOcr = useCallback(async () => {
    if (essayImages.length === 0) return;
    setError(null);
    setIsOcrProcessing(true);
    try {
      // Upload essay images
      const formData = new FormData();
      for (const img of essayImages) {
        formData.append('file', img);
        formData.append('role', 'essay');
      }
      const uploadRes = await fetch('/api/uploads', { method: 'POST', body: formData });
      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.error || 'Upload failed');
      }
      const { uploadIds } = await uploadRes.json();

      // OCR
      const extractRes = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadIds }),
      });
      if (!extractRes.ok) {
        const err = await extractRes.json();
        throw new Error(err.error || 'OCR failed');
      }
      const { text } = await extractRes.json();
      setOcrText(text);
      setOcrConfirmed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OCR failed');
    } finally {
      setIsOcrProcessing(false);
    }
  }, [essayImages]);

  const handleConfirmOcr = useCallback(() => {
    if (ocrText) {
      setEssayText(ocrText);
      setOcrConfirmed(true);
    }
  }, [ocrText]);

  const loadSample = useCallback(async (slug: 'task1' | 'task2') => {
    setLoadingSample(slug); setError(null);
    try {
      const response = await fetch(`/api/demos?slug=${slug}`, { cache: 'no-store' });
      const sample = await response.json();
      if (!response.ok) throw new Error(sample.error || 'Could not load the practice essay.');
      let chart: File | null = null;
      if (slug === 'task1') {
        const chartResponse = await fetch('/demo-chart.png');
        if (!chartResponse.ok) throw new Error('Could not load the sample chart.');
        chart = new File([await chartResponse.blob()], 'practice-chart.png', { type: 'image/png' });
      }
      setTaskType(sample.task_type);
      setPromptText(sample.prompt_text);
      setEssayText(sample.paragraphs.map((p: { text: string }) => p.text).join('\n\n'));
      setTaskImage(chart);
      setTaskImagePreview(chart ? '/demo-chart.png' : null);
      setEssayImages([]); setOcrText(null); setOcrConfirmed(false);
      document.getElementById('essay-entry')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load the sample.'); }
    finally { setLoadingSample(null); }
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!promptText.trim()) {
      setError(t('请输入题目要求', 'Question text is required'));
      return;
    }
    if (!essayText.trim()) {
      setError(t('请输入作文内容', 'Essay text is required'));
      return;
    }
    // Block if photos uploaded but OCR not confirmed
    if (essayImages.length > 0 && !ocrConfirmed) {
      setError(t('请先确认识别文字', 'Please confirm the transcribed text first'));
      return;
    }

    setIsSubmitting(true);

    try {
      // Step 1: Upload task image if present
      let taskImageId: string | undefined;
      if (taskImage && taskType === 'academic1') {
        const formData = new FormData();
        formData.append('file', taskImage);
        formData.append('role', 'task');
        const uploadRes = await fetch('/api/uploads', { method: 'POST', body: formData });
        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          throw new Error(err.error || 'Upload failed');
        }
        const { uploadIds } = await uploadRes.json();
        taskImageId = uploadIds[0];
      }

      // Step 2: Create submission
      const submitRes = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType,
          targetBand,
          promptText: promptText.trim(),
          originalText: essayText.trim(),
          taskImageId,
        }),
      });

      if (!submitRes.ok) {
        const err = await submitRes.json();
        throw new Error(err.error || 'Submission failed');
      }

      const { id } = await submitRes.json();
      router.push(`/result/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSubmitting(false);
    }
  }, [taskType, targetBand, promptText, essayText, taskImage, essayImages, ocrConfirmed, router, t]);

  return (
    <div className="journey-home min-h-screen bg-ivory">
      {/* Header */}
      <header className="border-b border-[#E5E0D5] px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <span className="journey-brand-kicker">IELTS WRITING WEST</span>
            <h1 className="journey-brand">{t('雅思写作西游记', 'IELTS Writing West')}</h1>
          </div>
          <LangToggle />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="mb-12">
          <p className="journey-prologue"><span className="journey-seal">修</span>{t('一篇作文，四重修炼', 'ONE ESSAY. FOUR CHAPTERS.')}</p>
          <h2 className="journey-hero-title">
            {lang === 'zh' ? <><span>过四关，</span><wbr /><span className="whitespace-nowrap">让作文脱胎换骨。</span></> : 'Four passes. Transform your writing.'}
          </h2>
          <p className="text-[#627064] text-sm leading-7 zh-font">
            {t('跟着唐僧、孙悟空、猪八戒、沙僧，一次攻克一项写作标准。先由你重写关键问题，过关后再看逐句精修。', 'Join Tang Sanzang, Sun Wukong, Zhu Bajie and Sha Wujing. Tackle one writing criterion at a time: rewrite the major problems, then watch focused corrections.')}
          </p>
          <p className="mt-3 text-sm leading-7 text-[#59635c] zh-font">
            {t('读懂评分规则，把每一稿写得更有把握。', 'Learn the scoring rules and make each draft more deliberate.')}
          </p>
          <div className="journey-home-cast" aria-label={t('四位 AI 角色与写作标准', 'Four AI characters and writing criteria')}>
            {JOURNEY_CAST.map((cast, index) => <div key={cast.key} className="journey-cast-card" style={{ '--cast-color': cast.color } as React.CSSProperties}>
              <div className="journey-cast-top"><CharacterAvatar criterion={cast.key} size={64} /><span className="journey-chapter-number">0{index + 1}</span></div>
              <h3>{t(cast.nameZh, cast.nameEn)}</h3>
              <span className="journey-cast-criterion">{criterionLabel(cast.key, taskType, lang)}</span>
              <p>{t(cast.mannerZh, cast.mannerEn)}</p>
            </div>)}
          </div>
          <p className="journey-ai-note">{t('四位角色均为 AI 写作教练，依据公开评分标准开展训练。', 'Four fictional AI writing coaches, guided by the public scoring criteria.')} <a href="https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf" target="_blank" rel="noreferrer" className="underline underline-offset-4">{t('IELTS 官方评分标准 ↗', 'Official IELTS descriptors ↗')}</a></p>
        </div>

        {/* Demo Cards */}
        <div className="mb-12">
          <h2 className="text-sm tracking-widest uppercase text-[#9CA3AF] zh-font mb-4">
            {t('取一篇练习稿，启程', 'Choose a practice essay. Begin the journey.')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(['task1', 'task2'] as const).map(slug => <div key={slug} className="p-6 border border-[#E5E0D5] rounded bg-white">
              <div className="text-xs tracking-widest uppercase text-[#647268] mb-2">{slug === 'task1' ? 'Academic Task 1' : 'Task 2'}</div>
              <h3 className="text-lg font-medium text-[#172020] zh-font mb-2">{slug === 'task1' ? t('图表作文：抓住关键事实', 'Chart essay: get the facts right') : t('议论文：把立场讲清楚', 'Argument essay: make your position clear')}</h3>
              <p className="text-xs leading-6 text-[#647268] zh-font mb-4">{t('载入一篇有待改进的练习稿，亲自体验重写与过关。', 'Load an imperfect practice draft and try the rewrite gates yourself.')}</p>
              <button data-testid={`load-sample-${slug}`} onClick={() => void loadSample(slug)} disabled={!!loadingSample || isSubmitting} className="px-4 py-2 bg-[#172020] text-white text-xs rounded disabled:opacity-50">{loadingSample === slug ? t('载入中…', 'Loading…') : t('载入练习稿', 'Load practice draft')} →</button>
              <Link href={`/demo/${slug}`} className="block text-xs text-[#647268] underline underline-offset-4 mt-4">{t('查看已完成的修改回放', 'Watch a completed correction example')}</Link>
            </div>)}
          </div>
        </div>

        {/* Task Type Selector */}
        <div id="essay-entry" className="mb-8 scroll-mt-6">
          <label className="block text-sm text-[#9CA3AF] mb-3 zh-font">
            {t('任务类型', 'Task Type')}
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'academic1', label: t('学术 Task 1', 'Academic Task 1'), desc: t('图表/地图/流程', 'Chart/Map/Process') },
              { value: 'general1', label: t('培训 Task 1', 'General Task 1'), desc: t('书信', 'Letter') },
              { value: 'task2', label: 'Task 2', desc: t('议论文', 'Essay') },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setTaskType(opt.value as typeof taskType)}
                className={`px-4 py-3 border rounded text-left transition-colors ${
                  taskType === opt.value
                    ? 'border-[#F15B3D] bg-white'
                    : 'border-[#E5E0D5] hover:border-[#9CA3AF]'
                }`}
              >
                <div className="text-sm font-medium text-[#172020] zh-font">{opt.label}</div>
                <div className="text-xs text-[#9CA3AF] zh-font">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <fieldset className="mb-8">
          <legend className="text-sm text-[#59635c] mb-3 zh-font">{t('目标分数', 'Target band')}</legend>
          <div className="flex gap-3">
            {([7, 8, 9] as const).map(band => <button key={band} type="button" data-testid={`target-band-${band}`} aria-pressed={targetBand === band} onClick={() => setTargetBand(band)} className={`px-6 py-3 border rounded text-lg essay-font ${targetBand === band ? 'border-[#172020] bg-[#172020] text-white' : 'border-[#E5E0D5] bg-white text-[#172020]'}`}>{band}</button>)}
          </div>
          <p className="mt-3 text-xs leading-6 text-[#59635c] zh-font">{t('四关完成后，另附以你完善后的观点为基础的目标分范文及独立估分。目标不等于保证。', 'After all four passes, get a separate target-band model based on your developed ideas, with an independent estimate. A target is not a guarantee.')}</p>
        </fieldset>

        {/* Question/Prompt Text */}
        <div className="mb-8">
          <label className="block text-sm text-[#9CA3AF] mb-2 zh-font">
            {t('题目要求', 'Question Text')} <span className="text-vermilion">*</span>
          </label>
          <textarea
            data-testid="question-input"
            aria-label={t('题目要求', 'Question text')}
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            placeholder={t('粘贴或输入题目要求...', 'Paste or type the question prompt...')}
            className="w-full h-32 px-4 py-3 border border-[#E5E0D5] rounded bg-white text-[#172020] text-sm resize-y focus:outline-none focus:border-[#F15B3D] transition-colors zh-font"
            maxLength={6000}
          />
          <div className="text-xs text-[#9CA3AF] mt-1">{promptText.length}/6000</div>
        </div>

        {/* Task Image (Academic Task 1 only) */}
        {taskType === 'academic1' && (
          <div className="mb-8">
            <label className="block text-sm text-[#9CA3AF] mb-2 zh-font">
              {t('题目图片（图表）', 'Task Image (Chart)')} <span className="text-vermilion">*</span>
            </label>
            <div className="flex items-start gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleTaskImageChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 border border-[#E5E0D5] rounded text-sm text-[#172020] hover:border-[#9CA3AF] transition-colors zh-font"
              >
                {t('选择图片', 'Choose Image')}
              </button>
              {taskImagePreview && (
                <div className="relative">
                  <img src={taskImagePreview} alt="Task preview" className="h-24 rounded border border-[#E5E0D5]" />
                  <button
                    onClick={() => { setTaskImage(null); setTaskImagePreview(null); }}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-[#F15B3D] text-white rounded-full text-xs flex items-center justify-center"
                  >
                    x
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-[#9CA3AF] mt-1 zh-font">JPG/PNG, max 8MB</p>
          </div>
        )}

        {/* Essay Text */}
        <div className="mb-8">
          <label className="block text-sm text-[#9CA3AF] mb-2 zh-font">
            {t('作文内容', 'Essay Text')} <span className="text-vermilion">*</span>
          </label>
          <textarea
            data-testid="essay-input"
            aria-label={t('作文内容', 'Essay text')}
            value={essayText}
            onChange={e => setEssayText(e.target.value)}
            placeholder={t('粘贴作文内容，或上传 txt/图片...', 'Paste essay text, or upload txt/images...')}
            className="w-full h-64 px-4 py-3 border border-[#E5E0D5] rounded bg-white text-[#172020] text-sm essay-font resize-y focus:outline-none focus:border-[#F15B3D] transition-colors"
            maxLength={15000}
          />
          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-2 flex-wrap">
              <input
                ref={essayFileRef}
                type="file"
                accept=".txt"
                onChange={handleTxtUpload}
                className="hidden"
              />
              <button
                onClick={() => essayFileRef.current?.click()}
                className="text-xs text-[#9CA3AF] hover:text-[#172020] transition-colors zh-font"
              >
                {t('上传 TXT', 'Upload TXT')}
              </button>
              <span className="text-xs text-[#9CA3AF]">|</span>
              <input
                ref={essayPhotoRef}
                type="file"
                accept="image/jpeg,image/png"
                multiple
                onChange={handleEssayFileChange}
                className="hidden"
              />
              <button
                onClick={() => essayPhotoRef.current?.click()}
                className="text-xs text-[#9CA3AF] hover:text-[#172020] transition-colors zh-font"
              >
                {t('上传作文照片', 'Upload essay photos')}
              </button>
              {essayImages.length > 0 && (
                <span className="text-xs text-[#172020] zh-font">
                  ({essayImages.length} {t('张', 'files')})
                </span>
              )}
            </div>
            <div className="text-xs text-[#9CA3AF] zh-font">
              {essayText.split(/\s+/).filter(w => w).length} {t('词', 'words')}
            </div>
          </div>

          {/* OCR Flow */}
          {essayImages.length > 0 && !ocrConfirmed && (
            <div className="mt-4 p-4 border border-[#E5E0D5] rounded bg-white">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-[#172020] zh-font">
                  {t('照片识别', 'Photo OCR')}
                </span>
                {isOcrProcessing && (
                  <span className="text-xs text-[#9CA3AF] zh-font">{t('识别中...', 'Processing...')}</span>
                )}
              </div>
              {!ocrText && !isOcrProcessing && (
                <button
                  onClick={handleOcr}
                  className="px-4 py-2 bg-[#F15B3D] text-white rounded text-sm hover:bg-[#d94a2e] transition-colors zh-font"
                >
                  {t('开始识别', 'Start OCR')}
                </button>
              )}
              {ocrText && (
                <div>
                  <textarea
                    value={ocrText}
                    onChange={e => setOcrText(e.target.value)}
                    className="w-full h-48 px-3 py-2 border border-[#E5E0D5] rounded text-sm essay-font resize-y focus:outline-none focus:border-[#F15B3D] mb-3"
                    placeholder={t('识别的文字将显示在这里，请检查并修正...', 'Transcribed text will appear here. Please review and edit...')}
                  />
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleConfirmOcr}
                      className="px-4 py-2 bg-[#0D9488] text-white rounded text-sm hover:bg-[#0a7a70] transition-colors zh-font"
                    >
                      {t('确认识别文字', 'Confirm transcription')}
                    </button>
                    <button
                      onClick={() => { setOcrText(null); setOcrConfirmed(false); }}
                      className="px-4 py-2 border border-[#E5E0D5] rounded text-sm text-[#9CA3AF] hover:text-[#172020] transition-colors zh-font"
                    >
                      {t('重新识别', 'Re-OCR')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 px-4 py-3 border border-[#F15B3D] bg-red-50 rounded text-sm text-[#F15B3D] zh-font">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button
            data-testid="submit-essay"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-8 py-3 bg-[#F15B3D] text-white rounded text-sm font-medium hover:bg-[#d94a2e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed zh-font"
          >
            {isSubmitting
              ? t('处理中...', 'Processing...')
              : t('启程，开始闯关', 'Begin the four passes')
            }
          </button>

        </div>

        {/* Note about example */}
        <p className="mt-3 text-xs text-[#9CA3AF] zh-font">
          {t('练习稿为虚构案例。每次新练习都由真实 AI 审阅；不是官方 IELTS 考官评分。', 'Practice drafts are synthetic examples. Each new practice uses real AI review, not official IELTS examiners.')}
        </p>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <LanguageProvider>
      <InputFormInner />
    </LanguageProvider>
  );
}
