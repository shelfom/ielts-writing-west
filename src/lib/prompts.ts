import type { TaskType } from './types';

// Bilingual display labels for the four IELTS criteria.
// Task 1 -> Task Achievement (TA); Task 2 -> Task Response (TR).
export interface CriterionLabels {
  code: string;
  labelZh: string;
  labelEn: string;
}

export function getCriterionLabels(taskType: TaskType): Record<string, CriterionLabels> {
  const isTask2 = taskType === 'task2';
  return {
    ta_tr: {
      code: isTask2 ? 'TR' : 'TA',
      labelZh: isTask2 ? '任务回应' : '任务完成度',
      labelEn: isTask2 ? 'Task Response' : 'Task Achievement',
    },
    cc: { code: 'CC', labelZh: '连贯与衔接', labelEn: 'Coherence and Cohesion' },
    lr: { code: 'LR', labelZh: '词汇资源', labelEn: 'Lexical Resource' },
    gra: { code: 'GRA', labelZh: '语法多样性与准确性', labelEn: 'Grammatical Range and Accuracy' },
  };
}

// Kept for backwards compatibility; assess/correct should prefer getCriterionLabels(taskType).
const CRITERIA_LABELS = {
  ta_tr: { zh: '任务完成度', en: 'Task Achievement' },
  cc: { zh: '连贯与衔接', en: 'Coherence and Cohesion' },
  lr: { zh: '词汇资源', en: 'Lexical Resource' },
  gra: { zh: '语法多样性与准确性', en: 'Grammatical Range and Accuracy' },
};

function getTaskSpecificGuidance(taskType: TaskType): string {
  switch (taskType) {
    case 'academic1':
      return `For Academic Task 1 (chart/map/process):
- Check if the overview/main trends are clearly identified
- Check if key features and data points are accurately reported (reference the uploaded chart image)
- Check if the response meets 150 words minimum
- Do NOT invent or hallucinate data not visible in the chart image`;
    case 'general1':
      return `For General Training Task 1 (letter):
- Check if all bullet points in the prompt are addressed
- Check if the purpose of the letter is clear
- Check if the tone (formal/semi-formal/informal) is appropriate
- Check if the response meets 150 words minimum`;
    case 'task2':
      return `For Task 2 (essay):
- Check if the writer's position is clear throughout
- Check if all parts of the prompt are addressed
- Check if ideas are developed and supported with examples
- Check if the response meets 250 words minimum`;
  }
}

export function buildAssessmentPrompt(
  taskType: TaskType,
  promptText: string,
  originalText: string,
  hasTaskImage: boolean,
  chartSourceData?: string
): string {
  const criterionName = taskType === 'task2' ? 'Task Response' : 'Task Achievement';
  const taskGuidance = getTaskSpecificGuidance(taskType);

  return `You are an expert IELTS Writing examiner assistant. Assess the following IELTS ${taskType === 'academic1' ? 'Academic Task 1' : taskType === 'general1' ? 'General Training Task 1' : 'Task 2'} essay.

## Task Prompt
${promptText}

## Student's Essay
${originalText}

${hasTaskImage ? '## Chart/Task Image\nA chart/task image was provided by the student. Use it to verify data accuracy and key features mentioned in the essay.' : ''}

${chartSourceData ? `## Authoritative Chart Source Data\n${chartSourceData}\nThese figures are authoritative. Verify every data claim in the essay against them. Distinguish WRONG UNIT (e.g., "55 commuters" vs "55%") from WRONG VALUE (a figure that does not match). Quote the exact phrase when reporting a data error. Do not claim a fact is wrong when it matches these figures.` : ''}

## Assessment Criteria (based on public IELTS Writing Band Descriptors)

Source: https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf (May 2023).
Choose the best supported descriptor, never a requested target score. These anchors are summaries, not a mechanical checklist.

### ${criterionName} (TA/TR)
${taskType === 'task2'
    ? '- 6: Relevant answer, uneven support. 7: Developed position and supported ideas. 8: Thorough coverage and development. 9: Sustained depth, almost no gaps.'
    : '- 6: Relevant coverage with some gaps. 7: Clear overview/key features (Academic), or clear purpose/all bullets/appropriate tone (General). 8: Effective selection and extension. 9: Fully fulfilled requirements.'}

### Coherence and Cohesion (CC)
- 6: Overall progression, sometimes mechanical links. 7: Logical organisation with minor lapses. 8: Easily followed, effective cohesion. 9: Effortless reading and unobtrusive connections.

### Lexical Resource (LR)
- 6: Adequate but imprecise. 7: Some flexibility and precision. 8: Broad, effective vocabulary with occasional slips. 9: Natural, precise control with extremely rare errors.

### Grammatical Range and Accuracy (GRA)
- 6: Simple/complex mix, errors seldom obscure meaning. 7: Varied complex forms, frequent accurate sentences. 8: Most sentences accurate, errors occasional. 9: Flexible structural control, extremely rare errors.

Scores below 6 remain valid. Missing task coverage, weak progression, restricted vocabulary or frequent communication problems support lower bands. Never inflate scores to reward effort or prior AI editing.

${taskGuidance}

## Instructions
1. Assess the ORIGINAL essay only (not an ideal version)
2. Give integer band scores (0-9) for each criterion
3. Provide a concise bilingual diagnosis (Chinese + English) explaining the main strengths and weaknesses
4. Do NOT claim examiner calibration or official scoring
5. Be honest and constructive
6. Quote the EXACT original phrase for any weakness you cite; do not paraphrase what the student wrote into a different error
7. Distinguish grammar rules from stylistic options: a stylistic preference is NOT an error and must not lower a score
8. Do NOT claim "by + past time requires past perfect", do NOT require optional commas, and do NOT treat natural synonyms (e.g., experienced/saw, increased/rose) as errors
9. Each criterion judgement must concern only that criterion: subject-verb agreement, plural nouns and comparatives are GRA; factual/unit errors are TA/TR

## Output Format (strict JSON)
\`\`\`json
{
  "ta_tr": <number 0-9>,
  "cc": <number 0-9>,
  "lr": <number 0-9>,
  "gra": <number 0-9>,
  "diagnosisZh": "<2-4 sentences in Chinese explaining strengths and areas for improvement>",
  "diagnosisEn": "<2-4 sentences in English explaining strengths and areas for improvement>"
}
\`\`\`

Respond ONLY with the JSON block, no other text.`;
}

export function buildCorrectionPrompt(
  taskType: TaskType,
  promptText: string,
  paragraphs: { id: string; text: string }[],
  assessment: { ta_tr: number; cc: number; lr: number; gra: number }
): string {
  const paragraphsJson = JSON.stringify(paragraphs, null, 2);
  const labels = getCriterionLabels(taskType);
  const taskCriterion = `${labels.ta_tr.labelEn} (${labels.ta_tr.code})`;

  return `You are an expert IELTS Writing correction assistant. Correct the following essay paragraph by paragraph.

## Task Prompt
${promptText}

## Assessment Scores
- ${taskCriterion}: ${assessment.ta_tr}
- Coherence and Cohesion (CC): ${assessment.cc}
- Lexical Resource (LR): ${assessment.lr}
- Grammatical Range and Accuracy (GRA): ${assessment.gra}

## Original Paragraphs (with IDs)
${paragraphsJson}

## Correction Rules
1. Preserve the student's intended meaning, position and paragraph structure exactly
2. Fix grammar, spelling, punctuation errors
3. Improve word choice and collocations at the student's level
4. Improve sentence structure for clarity only where needed
5. Do NOT rewrite into a generic band-9 essay - correct at the student's level
6. Do NOT invent data or facts (especially chart figures) not in the original
7. For paragraphs that are already good, return the original text unchanged and an empty reasons array
8. Keep each explanation to ONE short sentence
9. Each reason must reference one criterion code: ${labels.ta_tr.code}, CC, LR, GRA
10. Output exactly one object per input paragraph; preserve every paragraphId and the original order; no duplicate or missing IDs

## Output Format (strict JSON array, no markdown commentary outside the array)
[
  {
    "paragraphId": "<exact ID from input>",
    "correctedText": "<corrected paragraph text>",
    "reasons": [
      {
        "criterion": "lr",
        "quote": "<the original problematic phrase>",
        "explanationZh": "<one short Chinese sentence>",
        "explanationEn": "<one short English sentence>"
      }
    ]
  }
]

Respond ONLY with the JSON array.`;
}

export function buildExtractPrompt(hasTaskImage: boolean): string {
  if (hasTaskImage) {
    return `You are an OCR assistant. Transcribe the text visible in this image EXACTLY as written, preserving all grammar errors, spelling mistakes, and formatting.

Rules:
1. Transcribe every visible word exactly as written
2. Preserve all spelling and grammar errors
3. If text is unclear or uncertain, mark it with [?]
4. Do NOT correct or improve the text
5. Preserve paragraph breaks
6. Return ONLY the transcribed text, no commentary`;
  }
  return `You are an OCR assistant. Transcribe the handwritten or printed text in this image EXACTLY as written.

Rules:
1. Transcribe every visible word exactly as written
2. Preserve all spelling and grammar errors
3. If text is unclear or uncertain, mark it with [?]
4. Do NOT correct or improve the text
5. Preserve paragraph breaks
6. Return ONLY the transcribed text, no commentary`;
}

export { CRITERIA_LABELS };

export type Criterion = 'ta_tr' | 'cc' | 'lr' | 'gra';

const EXAMINER_PROFILES: Record<Criterion, { zh: string; en: string; focus: string }> = {
  ta_tr: {
    zh: '审题考官',
    en: 'The Strategist',
    focus: 'task coverage, accurate chart reporting, clear position/support',
  },
  cc: {
    zh: '结构考官',
    en: 'The Architect',
    focus: 'organisation, referencing, logical links between ideas',
  },
  lr: {
    zh: '词汇考官',
    en: 'The Wordsmith',
    focus: 'genuinely wrong or awkward word choice and collocations',
  },
  gra: {
    zh: '语法考官',
    en: 'The Grammarian',
    focus: 'grammar, punctuation, and range where needed',
  },
};

export function buildExaminerPrompt(
  taskType: TaskType,
  criterion: Criterion,
  promptText: string,
  paragraphs: { id: string; text: string }[],
  assessment: Record<string, { score: number }>,
  includeChartImage: boolean,
  chartSourceData?: string
): string {
  const profile = EXAMINER_PROFILES[criterion];
  const labels = getCriterionLabels(taskType);
  const criterionLabel = criterion === 'ta_tr'
    ? `${labels.ta_tr.labelEn} (${labels.ta_tr.code})`
    : criterion === 'cc' ? 'Coherence and Cohesion (CC)'
    : criterion === 'lr' ? 'Lexical Resource (LR)'
    : 'Grammatical Range and Accuracy (GRA)';

  const paragraphsJson = JSON.stringify(paragraphs, null, 2);

  return `You are ${profile.en} (${profile.zh}), one of four IELTS examiners. You ONLY correct issues within your remit. Do NOT touch issues belonging to other examiners.

## Your Remit: ${criterionLabel}
Focus: ${profile.focus}

## Task Prompt
${promptText}

## Original Assessment (fixed reference, do NOT change)
- TA/TR: ${assessment.ta_tr?.score ?? 0}
- CC: ${assessment.cc?.score ?? 0}
- LR: ${assessment.lr?.score ?? 0}
- GRA: ${assessment.gra?.score ?? 0}

${chartSourceData ? `## Authoritative Chart Source Data\n${chartSourceData}\nVerify all data claims against these exact figures. Distinguish WRONG UNIT (e.g., "55 commuters" vs "55%") from WRONG VALUE. Do NOT claim a fact is wrong when it matches the source data.` : ''}

## Current Essay Paragraphs
${paragraphsJson}

${includeChartImage ? '## Chart Image\nA chart image was provided. Verify data accuracy against it and the source data above.' : ''}

## Critical Rules
1. Change ONLY issues within your remit. Retain everything else exactly as-is.
2. Preserve the student's intended meaning, position, and paragraph structure.
3. Do NOT invent data, examples, or chart figures not in the original.
4. Do NOT fix grammar already handled by the Grammarian (if you are not GRA).
5. Do NOT invent errors. Optional stylistic preferences (e.g., need->require, experienced->saw) are NOT errors. Never present them as errors or score deductions.
6. Unchanged paragraphs must have an empty reasons array.
7. Each reason must reference your criterion code only.
8. Keep explanations short and precise, bilingual.
9. Output exactly one object per input paragraph; preserve every paragraphId and order.

## Criterion-Specific Guidance
- **GRA**: Subject-verb agreement, plural nouns, comparatives, tense consistency are GRA. Do NOT claim "by + past time requires past perfect" - "By 2020, the figure rose" is grammatically acceptable. Do NOT mandate commas where they are optional.
- **LR**: Fix genuinely wrong collocations only. Both "experienced the biggest rise" and "saw the biggest rise" are natural - do NOT swap them and present it as an error correction.
- **CC**: Do NOT invent causal links to add cohesion. Only fix actual referencing or linking errors.
- **TA/TR**: May change fact/unit wording but must leave unrelated grammar for GRA. Verify data against source figures.

## Output Format (strict JSON object)
{
  "diagnosisZh": "<one short Chinese sentence summarizing your changes>",
  "diagnosisEn": "<one short English sentence summarizing your changes>",
  "paragraphs": [
    {
      "paragraphId": "<exact ID from input>",
      "correctedText": "<corrected paragraph text>",
      "reasons": [
        {
          "criterion": "${criterion}",
          "quote": "<the original problematic phrase from BEFORE text>",
          "explanationZh": "<one short Chinese sentence>",
          "explanationEn": "<one short English sentence>"
        }
      ]
    }
  ]
}

Respond ONLY with the JSON object.`;
}
