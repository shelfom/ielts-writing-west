'use client';

import { useLanguage } from './LanguageContext';

export function LangToggle() {
  const { lang, toggle } = useLanguage();

  return (
    <button
      onClick={toggle}
      className="px-3 py-1.5 text-sm border border-[#E5E0D5] rounded hover:bg-[#EDE8DC] transition-colors"
      aria-label="Toggle language"
    >
      {lang === 'zh' ? 'EN' : '中文'}
    </button>
  );
}
