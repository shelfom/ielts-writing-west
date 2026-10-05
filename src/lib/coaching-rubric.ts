import type { Criterion } from './examiner-validation';
import type { TaskType } from './types';
export const MAX_FAILED_REVIEWS = 3;
export type RubricCheck = { id: string; titleZh: string; titleEn: string; ruleZh: string; ruleEn: string };
export const COACHING_RUBRIC: Record<Criterion, RubricCheck[]> = {
  ta_tr: [
    { id: 'coverage', titleZh: '完整回应题目', titleEn: 'Answer the whole task', ruleZh: 'Task 2 回答所有问题，需要观点时立场清楚一致；学术 Task 1 有概述与关键特征；书信目的明确、覆盖所有要点且整体语气合适。', ruleEn: 'Task 2: cover all questions with a consistent response and a clear position when asked. Academic Task 1: overview and key features. GT Task 1: clear purpose, all bullets and appropriate overall tone.' },
    { id: 'development', titleZh: '主要观点有充分说明', titleEn: 'Develop the main points', ruleZh: '读者能理解主要观点的依据或关键细节。例子可选，不规定段落公式；不单凭字数判失败。', ruleEn: 'Main points have enough reasoning or relevant details to be understood. Examples are optional; no paragraph formula or automatic word-count failure.' },
    { id: 'consistency', titleZh: '没有重大矛盾或事实错误', titleEn: 'Avoid major contradictions or factual errors', ruleZh: '不能有立场矛盾或重大图表数据错误；理解正确时的轻微数字笔误可留待微调。', ruleEn: 'No contradictory position or material chart/factual error. An isolated minor figure typo with accurate understanding may remain for correction.' },
  ],
  cc: [
    { id: 'progression', titleZh: '思路顺序清楚', titleEn: 'Make the progression understandable', ruleZh: '读者能跟上整体思路，不强制五段式或固定提纲。', ruleEn: 'The overall line of thought is understandable; no compulsory five-paragraph structure or imposed outline.' },
    { id: 'paragraph_focus', titleZh: '每段有明确重心', titleEn: 'Give paragraphs a clear focus', ruleZh: '主要段落能辨认出中心内容。只有重心无法辨认，或反复混杂无关的主要论点才不过关；重心清楚时，个别稍偏题的句子、相关的实施细节或小结不算重大问题。', ruleEn: 'Fail only when a main paragraph has no identifiable focus or repeatedly mixes unrelated main ideas. An isolated slightly tangential sentence, relevant implementation detail or wrap-up is minor when the paragraph focus remains clear.' },
    { id: 'relations', titleZh: '衔接不反复误导', titleEn: 'Keep connections and references clear', ruleZh: '连接关系与代词指代不能反复误导读者；不规定连接词数量。', ruleEn: 'Links and references do not repeatedly mislead the reader; no linker quota.' },
  ],
  lr: [
    { id: 'meaning', titleZh: '用词能传达主要意思', titleEn: 'Express each main claim', ruleZh: '读者能从用词还原每个主要观点。普通词汇本身不构成失败。', ruleEn: 'The reader can recover every main claim from the word choices. Ordinary vocabulary is acceptable.' },
    { id: 'repeated_misuse', titleZh: '没有反复改变意思的误用', titleEn: 'Avoid repeated meaning-changing misuse', ruleZh: '改变意思的词汇误用不能在至少两段内累计出现三次或更多。单纯重复、不完美搭配不算。', ruleEn: 'Fail only for at least three meaning-changing lexical misuses across at least two paragraphs. Mere repetition or imperfect collocations do not qualify.' },
    { id: 'topic_vocabulary', titleZh: '词汇足以区分主要概念', titleEn: 'Distinguish the main ideas', ruleZh: '有足够的主题词汇区分主要意思；不要求生僻词或同义替换。拼写属词汇，语法屈折变化与主谓一致属语法，派生词构成属词汇。', ruleEn: 'Topic vocabulary distinguishes the main ideas; no obscure-word or synonym quota. Spelling and derivational word formation are lexical; grammatical inflections and agreement are grammar.' },
  ],
  gra: [
    { id: 'sentence_meaning', titleZh: '主要观点的句意可理解', titleEn: 'Make each main claim recoverable', ruleZh: '每个主要观点都能从句子中理解，不能因语法崩塌而无法辨认。', ruleEn: 'Every main claim has recoverable sentence meaning rather than being lost through grammar breakdown.' },
    { id: 'obstruction', titleZh: '语法不能大面积阻碍理解', titleEn: 'Keep most sentences understandable', ruleZh: '语法错误阻碍理解的句子必须少于全文的四分之一。常见但意思清楚的小错留待纠正。', ruleEn: 'Grammar must not obstruct meaning in 25% or more of sentences. Frequent but understandable slips remain for correction.' },
    { id: 'complex_relationship', titleZh: '至少成功表达一种复杂关系', titleEn: 'Express one complex relationship successfully', ruleZh: '适用时，至少成功表达一次原因、条件、让步或定语关系；不规定时态与句型配额。', ruleEn: 'Where relevant, express at least one successful reason, condition, concession or relative relationship. No tense or structure quotas.' },
  ],
};
export function getCoachingRubric(criterion: Criterion, taskType?: TaskType): RubricCheck[] {
  if (criterion !== 'ta_tr' || !taskType) return COACHING_RUBRIC[criterion];
  const coverage = taskType === 'task2'
    ? { ruleZh: '回应题目的所有部分。回答必须一致；题目要求观点时，立场要清楚并贯穿全文。', ruleEn: 'Answer all parts consistently. When the question calls for a position, make it clear and consistent throughout.' }
    : taskType === 'academic1'
    ? { ruleZh: '有清晰概述，报告图表、地图或流程的关键特征。', ruleEn: 'Provide a clear overview and report the main features of the chart, map or process.' }
    : { ruleZh: '书信目的明确，覆盖所有要点，整体语气适合收信人和情境。', ruleEn: 'Make the letter purpose clear, address all bullet points, and use an overall tone appropriate to the recipient and situation.' };
  return COACHING_RUBRIC.ta_tr.map(c => c.id === 'coverage' ? { ...c, ...coverage } : c);
}
