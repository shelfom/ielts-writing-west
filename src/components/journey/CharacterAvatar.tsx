import Image from 'next/image';
import type { CSSProperties } from 'react';
import './journey.css';

export type JourneyCriterion = 'ta_tr' | 'cc' | 'lr' | 'gra';
export const JOURNEY_CAST = [
  { key: 'ta_tr' as const, nameZh: '唐僧', nameEn: 'Tang Sanzang', avatar: 'tangsanzang', color: '#087e82', titleZh: '任务完成 / 回应', titleEn: 'Task Achievement / Response', mannerZh: '耐心，把题意讲透。', mannerEn: 'Patient. Makes the task clear.', lineZh: '先读清题意，再核对回应，一步一步来。', lineEn: 'First the task, then your response. One step at a time.' },
  { key: 'cc' as const, nameZh: '孙悟空', nameEn: 'Sun Wukong', avatar: 'sunwukong', color: '#4566bb', titleZh: '连贯与衔接', titleEn: 'Coherence & Cohesion', mannerZh: '嘴利，专挑逻辑断点。', mannerEn: 'Sharp. Calls out gaps in logic.', lineZh: '专看段落推进与逻辑衔接。', lineEn: 'A sharp eye on paragraph progression and logical links.' },
  { key: 'lr' as const, nameZh: '猪八戒', nameEn: 'Zhu Bajie', avatar: 'zhubajie', color: '#a56a09', titleZh: '词汇资源', titleEn: 'Lexical Resource', mannerZh: '好聊，让用词更贴切。', mannerEn: 'Friendly. Finds the right words.', lineZh: '咱们把话说准，再挑合适的词。', lineEn: 'Let’s make the meaning clear and find words that fit.' },
  { key: 'gra' as const, nameZh: '沙僧', nameEn: 'Sha Wujing', avatar: 'shawujing', color: '#a84e76', titleZh: '语法多样性与准确性', titleEn: 'Grammatical Range & Accuracy', mannerZh: '话少，把句子修稳。', mannerEn: 'Calm. Few words, precise fixes.', lineZh: '语法逐句检查，改动有据。', lineEn: 'Sentence-by-sentence grammar checks. Every change has a reason.' },
];

export function criterionLabel(criterion: JourneyCriterion, taskType: string, lang: 'zh' | 'en') {
  const cast = JOURNEY_CAST.find(c => c.key === criterion)!;
  if (criterion === 'ta_tr') return taskType === 'task2' ? lang === 'zh' ? '任务回应' : 'Task Response' : lang === 'zh' ? '任务完成度' : 'Task Achievement';
  return lang === 'zh' ? cast.titleZh : cast.titleEn;
}

export function CharacterAvatar({ criterion, size = 40, className = '' }: { criterion: JourneyCriterion; size?: number; className?: string }) {
  const cast = JOURNEY_CAST.find(c => c.key === criterion)!;
  return <span className={`journey-avatar ${className}`} style={{ '--avatar-size': `${size}px`, '--avatar-color': cast.color } as CSSProperties}>
    <Image src={`/avatars/${cast.avatar}.png`} alt={cast.nameZh} width={size} height={size} sizes={`${size}px`} />
  </span>;
}
