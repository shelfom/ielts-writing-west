import { z } from 'zod';
import type { Paragraph } from './types';

export type Criterion = 'ta_tr' | 'cc' | 'lr' | 'gra';
export const CRITERION_ORDER: Criterion[] = ['ta_tr', 'cc', 'lr', 'gra'];

export type ExaminerStage = {
  criterion: Criterion;
  diagnosisZh: string;
  diagnosisEn: string;
  paragraphs: {
    paragraphId: string;
    correctedText: string;
    reasons: {
      criterion: string;
      quote: string;
      explanationZh: string;
      explanationEn: string;
    }[];
  }[];
  duration_ms?: number;
  provider_model?: string;
};

export const reasonSchema = z.object({
  criterion: z.string(),
  quote: z.string(),
  explanationZh: z.string(),
  explanationEn: z.string(),
});

export const outputParagraphSchema = z.object({
  paragraphId: z.string(),
  correctedText: z.string(),
  reasons: z.array(reasonSchema),
});

/** Model now returns a single object, not an array. */
export const examinerOutputSchema = z.object({
  diagnosisZh: z.string().min(1),
  diagnosisEn: z.string().min(1),
  paragraphs: z.array(outputParagraphSchema).min(1),
});

export type RawExaminerOutput = z.infer<typeof examinerOutputSchema>;

/**
 * Parse model output that may be wrapped in markdown fences.
 * Accepts only the object form: {diagnosisZh, diagnosisEn, paragraphs}
 */
export function parseExaminerOutput(text: string): RawExaminerOutput {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
  const parsed: unknown = JSON.parse(jsonStr);
  return examinerOutputSchema.parse(parsed);
}

/**
 * Validate model output against the document the examiner actually received.
 * - every code-assigned paragraph id must appear exactly once
 * - no unknown / duplicate ids
 * - correctedText must be a non-empty string
 * - every reason.criterion must equal the current examiner
 * - unchanged paragraphs must not carry bogus reasons
 */
export function validateExaminerOutput(
  raw: RawExaminerOutput,
  inputParagraphs: Paragraph[],
  expectedCriterion: Criterion
): ExaminerStage['paragraphs'] {
  if (raw.paragraphs.length !== inputParagraphs.length) {
    throw new Error(
      `Expected ${inputParagraphs.length} paragraphs, got ${raw.paragraphs.length}`
    );
  }

  const seen = new Set<string>();
  for (const p of raw.paragraphs) {
    if (seen.has(p.paragraphId)) {
      throw new Error(`Duplicate paragraphId: ${p.paragraphId}`);
    }
    seen.add(p.paragraphId);
  }

  const result: ExaminerStage['paragraphs'] = [];
  for (const input of inputParagraphs) {
    const match = raw.paragraphs.find(p => p.paragraphId === input.id);
    if (!match) throw new Error(`Missing paragraph ${input.id}`);
    if (!match.correctedText.trim()) {
      throw new Error(`Empty correctedText for ${input.id}`);
    }

    const normalizedReasons = match.reasons
      .filter(
        r =>
          typeof r.quote === 'string' &&
          typeof r.explanationZh === 'string' &&
          typeof r.explanationEn === 'string'
      )
      .map(r => ({
        criterion: expectedCriterion,
        quote: r.quote,
        explanationZh: r.explanationZh,
        explanationEn: r.explanationEn,
      }));

    // Reject any reason that names a different examiner remit
    const rawCriterions = match.reasons.map(r => r.criterion);
    for (const c of rawCriterions) {
      if (normalizeCriterion(c) !== expectedCriterion) {
        throw new Error(
          `Reason criterion "${c}" does not match current examiner "${expectedCriterion}"`
        );
      }
    }

    const unchanged = match.correctedText === input.text;
    result.push({
      paragraphId: input.id,
      correctedText: match.correctedText,
      // Correct / unchanged passages must not carry invented error reasons
      reasons: unchanged ? [] : normalizedReasons,
    });
  }

  return result;
}

export function normalizeCriterion(code: string): Criterion {
  const c = code.trim().toLowerCase();
  if (c === 'ta' || c === 'tr' || c === 'ta_tr' || c === 'task achievement' || c === 'task response') {
    return 'ta_tr';
  }
  if (c === 'cc' || c === 'coherence' || c === 'coherence and cohesion') return 'cc';
  if (c === 'lr' || c === 'lexical' || c === 'lexical resource') return 'lr';
  if (c === 'gra' || c === 'grammar' || c === 'grammar range and accuracy') return 'gra';
  throw new Error(`Unknown criterion code: ${code}`);
}
