'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LanguageProvider, useLanguage } from '@/components/LanguageContext';
import { LangToggle } from '@/components/LangToggle';

const EXAMPLE_ESSAY = `The graph below shows the percentage of water used for different purposes in six areas of the world.

Overall, it is clear that agriculture uses the most water in most regions, particularly in South America, Africa, and Southeast Asia. Industrial water use is highest in Europe and North America.

In South America, agriculture accounts for approximately 71% of water consumption, while industry uses 19% and domestic use is 10%. Similarly, in Africa, farming takes up 84% of water, with industrial and domestic usage at 7% and 9% respectively. Southeast Asia shows a comparable pattern, with agriculture at 88%, industry at 5%, and domestic at 7%.

In contrast, Europe uses 53% of its water for industry, 33% for agriculture, and 14% for domestic purposes. North America follows a similar trend, with industrial use at 48%, agricultural at 39%, and domestic at 13%. Central Asia primarily uses water for agriculture at 88%, while industry and domestic use account for 5% and 7%.

In conclusion, developing regions tend to use most water for farming, whereas developed areas have higher industrial water consumption.`;

const EXAMPLE_PROMPT = `The charts below show the percentage of water used for different purposes in six areas of the world.

Summarise the information by selecting and reporting the main features, and make comparisons where relevant.`;

function InputFormInner() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [taskType, setTaskType] = useState<'academic1' | 'general1' | 'task2'>('task2');
  const [promptText, setPromptText] = useState('');
  const [essayText, setEssayText] = useState('');
  const [taskImage, setTaskImage] = useState<File | null>(null);
  const [essayImages, setEssayImages] = useState<File[]>([]);
  const [taskImagePreview, setTaskImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  const loadExample = useCallback(() => {
    setPromptText(EXAMPLE_PROMPT);
    setEssayText(EXAMPLE_ESSAY);
    setTaskType('academic1');
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
  }, [taskType, promptText, essayText, taskImage, essayImages, ocrConfirmed, router, t]);

  return (
    <div className="min-h-screen bg-ivory">
      {/* Header */}
      <header className="border-b border-[#E5E0D5] px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <span className="text-xs tracking-widest uppercase text-[#9CA3AF] zh-font">WRITING LAB</span>
            <h1 className="text-lg font-light tracking-wide text-[#172020]">Band Autopsy</h1>
          </div>
          <LangToggle />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Demo Cards */}
        <div className="mb-12">
          <h2 className="text-sm tracking-widest uppercase text-[#9CA3AF] zh-font mb-4">
            {t('示例回放', 'Demo Replays')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/demo/task1" className="block p-6 border border-[#E5E0D5] rounded hover:border-[#F15B3D] transition-colors bg-white">
              <div className="text-xs tracking-widest uppercase text-[#9CA3AF] mb-2">Academic Task 1</div>
              <h3 className="text-lg font-medium text-[#172020] zh-font mb-2">{t('图表作文', 'Chart Essay')}</h3>
              <p className="text-sm text-[#9CA3AF] zh-font">{t('观看四位考官演示', 'Watch four examiners')}</p>
            </Link>
            <Link href="/demo/task2" className="block p-6 border border-[#E5E0D5] rounded hover:border-[#F15B3D] transition-colors bg-white">
              <div className="text-xs tracking-widest uppercase text-[#9CA3AF] mb-2">Task 2</div>
              <h3 className="text-lg font-medium text-[#172020] zh-font mb-2">{t('议论文', 'Argumentative Essay')}</h3>
              <p className="text-sm text-[#9CA3AF] zh-font">{t('观看四位考官演示', 'Watch four examiners')}</p>
            </Link>
          </div>
        </div>

        {/* Hero */}
        <div className="mb-12">
          <h2 className="text-3xl md:text-4xl font-light text-[#172020] zh-font leading-tight mb-3">
            {t('看见你的作文，一句句变好', 'See your essay improve, sentence by sentence')}
          </h2>
          <p className="text-[#9CA3AF] text-sm zh-font">
            {t('IELTS 写作批改与诊断', 'IELTS Writing assessment & diagnosis')}
          </p>
        </div>

        {/* Task Type Selector */}
        <div className="mb-8">
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

        {/* Question/Prompt Text */}
        <div className="mb-8">
          <label className="block text-sm text-[#9CA3AF] mb-2 zh-font">
            {t('题目要求', 'Question Text')} <span className="text-vermilion">*</span>
          </label>
          <textarea
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
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-8 py-3 bg-[#F15B3D] text-white rounded text-sm font-medium hover:bg-[#d94a2e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed zh-font"
          >
            {isSubmitting
              ? t('处理中...', 'Processing...')
              : t('开始解剖', 'Analyse my essay')
            }
          </button>
          <button
            onClick={loadExample}
            className="px-4 py-3 border border-[#E5E0D5] rounded text-sm text-[#9CA3AF] hover:text-[#172020] hover:border-[#9CA3AF] transition-colors zh-font"
          >
            {t('加载示例', 'Load example')}
          </button>
        </div>

        {/* Note about example */}
        <p className="mt-3 text-xs text-[#9CA3AF] zh-font">
          {t('* 示例仅为填充内容，分析时同样使用真实模型', '* Example is synthetic practice; analysis uses real model like any user essay')}
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
