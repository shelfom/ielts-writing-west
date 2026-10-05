import { z } from 'zod';
import { randomUUID } from 'crypto';
import { COACHING_RUBRIC, MAX_FAILED_REVIEWS } from './coaching-rubric';
import { CRITERION_ORDER, type Criterion, type ExaminerStage } from './examiner-validation';
import type { CoachingState, GateReview } from './coaching-types';
import type { Paragraph } from './types';

export const MAX_ESSAY_CHARS = 40_000;
export const MAX_ESSAY_WORDS = 1500;
export function validateDraft(text: string): string {
  if (!text.trim()) throw new Error('Essay text is required');
  if (text.length > MAX_ESSAY_CHARS) throw new Error(`Essay exceeds ${MAX_ESSAY_CHARS} characters`);
  if (text.trim().split(/\s+/).length > MAX_ESSAY_WORDS) throw new Error(`Essay exceeds ${MAX_ESSAY_WORDS} words`);
  return text.trim();
}
export function assignParagraphs(text: string): Paragraph[] {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(text => ({ id: randomUUID(), text }));
}
export function initialCoaching(text: string, paragraphs: Paragraph[], targetBand: 7 | 8 | 9): CoachingState {
  return { version: 1, targetBand, revision: 0, currentCriterion: 'ta_tr', phase: 'needs_review', draftText: text, paragraphs,
    rounds: CRITERION_ORDER.map(criterion => ({ criterion, reviews: [] })),
    history: [{ revision: 0, text, paragraphs, source: 'original', createdAt: new Date().toISOString() }] };
}
export function sentencesFor(paragraphs: Paragraph[]): { id: string; paragraphId: string; quote: string }[] {
  return paragraphs.flatMap(p => p.text.split(/(?<=[.!?])\s+/)
    .map(s => s.trim()).filter(Boolean).map((quote, i) => ({ id: `${p.id}:s${i + 1}`, paragraphId: p.id, quote })));
}
const shortText = z.string().trim().min(1).max(2000);
const evidenceSchema = z.object({ paragraphId: z.string().min(1), quote: z.string().min(1).max(MAX_ESSAY_CHARS) }).strict();
const checkSchema = z.object({ id: z.string(), passed: z.boolean(), evidence: z.array(evidenceSchema).max(100),
  reasonZh: shortText, reasonEn: shortText, actionZh: shortText, actionEn: shortText }).strict();
export const reviewSchema = z.object({ checks: z.array(checkSchema).length(3), summaryZh: shortText, summaryEn: shortText }).strict();
export type RawReview = z.infer<typeof reviewSchema>;
export function parseJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1].trim() : text.trim());
}
export function validateReview(raw: unknown, paragraphs: Paragraph[], criterion: Criterion): RawReview {
  const review = reviewSchema.parse(raw);
  const ids = COACHING_RUBRIC[criterion].map(r => r.id);
  if (new Set(review.checks.map(c => c.id)).size !== 3 || review.checks.some(c => !ids.includes(c.id))) throw new Error('Return exactly the three fixed rubric check IDs');
  for (const check of review.checks) {
    for (const evidence of check.evidence) {
      const p = paragraphs.find(p => p.id === evidence.paragraphId);
      if (!p || !p.text.includes(evidence.quote) || !evidence.quote.trim()) throw new Error(`Evidence must be an exact quote in its paragraph: ${check.id}`);
    }
    if (!check.passed && check.evidence.length === 0) throw new Error(`A failed check requires exact evidence: ${check.id}`);
    if (!check.passed && criterion === 'lr' && check.id === 'repeated_misuse') {
      // Count distinct, non-overlapping source spans, never nested quotes of one misuse twice.
      const used: { paragraphId: string; start: number; end: number }[] = [];
      for (const e of [...check.evidence].sort((a, b) => b.quote.length - a.quote.length)) {
        const source = paragraphs.find(p => p.id === e.paragraphId)!.text;
        let start = source.indexOf(e.quote);
        while (start >= 0 && used.some(u => u.paragraphId === e.paragraphId && start < u.end && start + e.quote.length > u.start)) start = source.indexOf(e.quote, start + 1);
        if (start < 0) throw new Error('Repeated lexical evidence must identify distinct non-overlapping occurrences');
        used.push({ paragraphId: e.paragraphId, start, end: start + e.quote.length });
      }
      if (check.evidence.length < 3 || new Set(check.evidence.map(e => e.paragraphId)).size < 2) throw new Error('Repeated lexical misuse needs three exact occurrences across two paragraphs');
    }
    if (!check.passed && criterion === 'gra' && check.id === 'obstruction') {
      const sentences = sentencesFor(paragraphs);
      const affected = new Set(check.evidence.map(e => {
        const sentence = sentences.find(s => s.paragraphId === e.paragraphId && s.quote === e.quote.trim());
        if (!sentence) throw new Error('Grammar obstruction must cite complete sentences from the supplied sentence inventory');
        return sentence.id;
      }));
      if (affected.size / sentences.length < 0.25) throw new Error('Grammar obstruction evidence does not reach 25% of sentences');
    }
  }
  review.checks.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return review;
}
export function failedReviewCount(state: CoachingState): number {
  const round = state.rounds.find(r => r.criterion === state.currentCriterion)!;
  return new Set(round.reviews.filter(r => !r.passed).map(r => r.id)).size;
}
export function recordReview(state: CoachingState, review: GateReview): CoachingState {
  if (review.revision !== state.revision || review.criterion !== state.currentCriterion) throw new Error('Review is not for the current draft');
  if (review.draftText !== state.draftText) throw new Error('Review draft snapshot differs from current text');
  const checks = validateReview({ checks: review.checks, summaryZh: review.summaryZh, summaryEn: review.summaryEn }, state.paragraphs, state.currentCriterion).checks;
  const normalized = { ...review, checks, passed: checks.every(c => c.passed) };
  const next = structuredClone(state);
  const round = next.rounds.find(r => r.criterion === next.currentCriterion)!;
  if (!round.reviews.some(r => r.revision === review.revision)) round.reviews.push(normalized);
  next.phase = normalized.passed ? 'ready_to_correct' : failedReviewCount(next) >= MAX_FAILED_REVIEWS ? 'practice_paused' : 'rewrite_required';
  return next;
}
export function rewriteDraft(state: CoachingState, text: string): CoachingState {
  if (!['needs_review', 'rewrite_required'].includes(state.phase)) throw new Error('This round is not accepting a rewrite');
  const clean = validateDraft(text);
  if (clean === state.draftText) return state;
  const next = structuredClone(state);
  next.revision += 1; next.draftText = clean; next.paragraphs = assignParagraphs(clean); next.phase = 'needs_review';
  next.history.push({ revision: next.revision, text: clean, paragraphs: next.paragraphs, source: 'student', createdAt: new Date().toISOString() });
  return next;
}
export const anchoredCorrectionSchema = z.object({ diagnosisZh: shortText, diagnosisEn: shortText,
  edits: z.array(z.object({ paragraphId: z.string(), before: z.string().min(1).max(MAX_ESSAY_CHARS), after: z.string().max(MAX_ESSAY_CHARS), occurrence: z.number().int().min(1).max(500), criterion: z.enum(['ta_tr', 'cc', 'lr', 'gra']), explanationZh: shortText, explanationEn: shortText }).strict()).max(150) }).strict();
export type AnchoredCorrection = z.infer<typeof anchoredCorrectionSchema>;
export function applyAnchoredCorrection(raw: unknown, paragraphs: Paragraph[], criterion: Criterion): { proposal: AnchoredCorrection; stage: ExaminerStage } {
  const proposal = anchoredCorrectionSchema.parse(raw);
  const anchors = proposal.edits.map((e, index) => {
    if (e.criterion !== criterion) throw new Error('Correction contains a different criterion');
    if (e.before === e.after) throw new Error('Do not return unchanged edits');
    if (e.after.includes('\n')) throw new Error('Targeted corrections must preserve paragraph structure');
    const p = paragraphs.find(p => p.id === e.paragraphId);
    if (!p) throw new Error('Unknown correction paragraph');
    let start = -1;
    for (let n = 0; n < e.occurrence; n++) { start = p.text.indexOf(e.before, start < 0 ? 0 : start + e.before.length); if (start < 0) throw new Error('Correction anchor does not exist exactly'); }
    return { ...e, start, end: start + e.before.length, index };
  });
  const output = paragraphs.map(p => {
    const edits = anchors.filter(e => e.paragraphId === p.id).sort((a, b) => a.start - b.start);
    for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i - 1].end) throw new Error('Correction anchors overlap');
    let correctedText = p.text;
    for (const e of [...edits].reverse()) correctedText = correctedText.slice(0, e.start) + e.after + correctedText.slice(e.end);
    if (!correctedText.trim()) throw new Error('A correction must not erase a paragraph');
    return { paragraphId: p.id, correctedText, reasons: edits.map(e => ({ criterion, quote: e.before, explanationZh: e.explanationZh, explanationEn: e.explanationEn })) };
  });
  validateDraft(output.map(p => p.correctedText).join('\n\n'));
  return { proposal, stage: { criterion, diagnosisZh: proposal.diagnosisZh, diagnosisEn: proposal.diagnosisEn, paragraphs: output } };
}
export const scopeAuditSchema = z.object({ edits: z.array(z.object({ index: z.number().int().min(0), allowed: z.boolean(), reason: shortText }).strict()), preservesMeaning: z.boolean(), preservesOtherCriteria: z.boolean(), noNewMajorIssues: z.boolean(), reason: shortText }).strict();
export function validateScopeAudit(raw: unknown, editCount: number): void {
  const audit = scopeAuditSchema.parse(raw);
  if (audit.edits.length !== editCount || new Set(audit.edits.map(e => e.index)).size !== editCount || audit.edits.some(e => e.index >= editCount)) throw new Error('Scope audit must check every edit exactly once');
  const invalid = audit.edits.filter(e => !e.allowed);
  if (invalid.length || !audit.preservesMeaning || !audit.preservesOtherCriteria || !audit.noNewMajorIssues) throw new Error(`Correction failed scope audit: ${invalid.map(e => `${e.index}: ${e.reason}`).join('; ')} ${audit.reason}`);
}
export function recordCorrection(state: CoachingState, stage: ExaminerStage): CoachingState {
  const review = state.rounds.find(r => r.criterion === state.currentCriterion)?.reviews.find(r => r.revision === state.revision);
  if (state.phase !== 'ready_to_correct' || !review?.passed || stage.criterion !== state.currentCriterion) throw new Error('Current criterion must pass on this exact draft before correction');
  const next = structuredClone(state);
  const round = next.rounds.find(r => r.criterion === next.currentCriterion)!;
  round.inputParagraphs = structuredClone(next.paragraphs); round.correction = stage;
  next.correctionHistory = [...(next.correctionHistory || []), { criterion: next.currentCriterion, revision: next.revision, inputParagraphs: structuredClone(next.paragraphs), correction: stage }];
  next.paragraphs = stage.paragraphs.map(p => ({ id: p.paragraphId, text: p.correctedText }));
  next.draftText = next.paragraphs.map(p => p.text).join('\n\n'); next.revision += 1;
  next.history.push({ revision: next.revision, text: next.draftText, paragraphs: next.paragraphs, source: next.currentCriterion, createdAt: new Date().toISOString() });
  next.phase = next.currentCriterion === 'gra' ? 'completed' : 'stage_complete';
  return next;
}
export function advanceCriterion(state: CoachingState): CoachingState {
  if (state.phase !== 'stage_complete' || !state.rounds.find(r => r.criterion === state.currentCriterion)?.correction) throw new Error('Finish the current correction before advancing');
  const index = CRITERION_ORDER.indexOf(state.currentCriterion);
  if (index >= 3) throw new Error('All examiners are complete');
  const next = structuredClone(state); next.currentCriterion = CRITERION_ORDER[index + 1]; next.phase = 'needs_review'; return next;
}

/** A later rewrite can reopen an earlier failed gate; prior attempts and all snapshots survive. */
export function reopenCriterion(state: CoachingState, criterion: Criterion): CoachingState {
  const next = structuredClone(state);
  const index = CRITERION_ORDER.indexOf(criterion);
  for (const round of next.rounds) {
    if (CRITERION_ORDER.indexOf(round.criterion) >= index) { delete round.correction; delete round.inputParagraphs; }
  }
  next.currentCriterion = criterion; next.phase = 'needs_review'; delete next.final;
  return next;
}
