import type { TaskType } from './types';

const CRITERIA_LABELS = {
  ta_tr: { zh: 'Task Achievement/Response', en: 'Task Achievement/Response' },
  cc: { zh: 'Coherence and Cohesion', en: 'Coherence and Cohesion' },
  lr: { zh: 'Lexical Resource', en: 'Lexical Resource' },
  gra: { zh: 'Grammatical Range and Accuracy', en: 'Grammatical Range and Accuracy' },
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
  hasTaskImage: boolean
): string {
  const criterionName = taskType === 'task2' ? 'Task Response' : 'Task Achievement';
  const taskGuidance = getTaskSpecificGuidance(taskType);

  return `You are an expert IELTS Writing examiner assistant. Assess the following IELTS ${taskType === 'academic1' ? 'Academic Task 1' : taskType === 'general1' ? 'General Training Task 1' : 'Task 2'} essay.

## Task Prompt
${promptText}

## Student's Essay
${originalText}

${hasTaskImage ? '## Chart/Task Image\nA chart/task image was provided by the student. Use it to verify data accuracy and key features mentioned in the essay.' : ''}

## Assessment Criteria (based on public IELTS Writing Band Descriptors)

### ${criterionName} (TA/TR)
- Band 9: Fully addresses all requirements; clear overview/position; well-developed responses
- Band 7: Addresses all requirements; clear position; logical progression
- Band 5: Partially addresses; limited development; may miss key features
- Band 3: Does not adequately address the task; minimal response

### Coherence and Cohesion (CC)
- Band 9: Skillful paragraphing; seamless cohesion; logical progression
- Band 7: Logical organization; clear progression; adequate cohesion
- Band 5: Some organization but lacks overall progression; inadequate cohesion
- Band 3: No clear progression; poorly organized

### Lexical Resource (LR)
- Band 9: Wide range; precise meanings; natural collocations; rare minor errors
- Band 7: Sufficient range; some awareness of style/collocation; occasional errors
- Band 5: Limited range; noticeable errors; but meaning generally clear
- Band 3: Very limited range; frequent errors impeding meaning

### Grammatical Range and Accuracy (GRA)
- Band 9: Wide range; full flexibility; rare minor errors
- Band 7: Variety of complex structures; frequent error-free sentences
- Band 5: Limited range; attempts complex sentences but with errors
- Band 3: Very limited range; subordinate structures rare; errors predominate

${taskGuidance}

## Instructions
1. Assess the ORIGINAL essay only (not an ideal version)
2. Give integer band scores (0-9) for each criterion
3. Provide a concise bilingual diagnosis (Chinese + English) explaining the main strengths and weaknesses
4. Do NOT claim examiner calibration or official scoring
5. Be honest and constructive

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

  return `You are an expert IELTS Writing correction assistant. Correct the following essay paragraph by paragraph.

## Task Prompt
${promptText}

## Assessment Scores
- Task Achievement/Response: ${assessment.ta_tr}
- Coherence and Cohesion: ${assessment.cc}
- Lexical Resource: ${assessment.lr}
- Grammatical Range and Accuracy: ${assessment.gra}

## Original Paragraphs (with IDs)
${paragraphsJson}

## Correction Rules
1. Preserve the student's intended meaning and position
2. Fix grammar, spelling, punctuation errors
3. Improve word choice and collocations at the student's level
4. Improve sentence structure for clarity
5. Do NOT rewrite into a generic band-9 essay - correct at the student's level
6. Do NOT invent data or facts not in the original
7. For paragraphs that are already good, return the original text unchanged
8. Each corrected paragraph must include reasons explaining the changes
9. Reasons must reference the specific criterion (ta_tr, cc, lr, gra)
10. Preserve paragraph order and IDs exactly

## Output Format (strict JSON)
\`\`\`json
[
  {
    "paragraphId": "<exact ID from input>",
    "correctedText": "<corrected paragraph text>",
    "reasons": [
      {
        "criterion": "lr",
        "quote": "<the original problematic phrase>",
        "explanationZh": "<Chinese explanation of the correction>",
        "explanationEn": "<English explanation of the correction>"
      }
    ]
  }
]
\`\`\`

For unchanged paragraphs, provide an empty reasons array [].
Respond ONLY with the JSON array, no other text.`;
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
