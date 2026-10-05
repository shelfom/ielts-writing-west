import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getOwnerHash } from '@/lib/session';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createLLMClient, extractHeaders, MODEL_ID } from '@/lib/llm';
import { getStorage } from '@/lib/storage';
import { buildAssessmentPrompt, getCriterionLabels } from '@/lib/prompts';
import { computeOverall } from '@/lib/scoring';
import { coachingJSONMessages } from '@/lib/coaching-json-retry';
import { buildGatePrompt, buildAnchoredPrompt, buildScopePrompt, buildTargetModelPrompt, buildCorrectionRetryFeedback } from '@/lib/coaching-prompts';
import { advanceCriterion, applyAnchoredCorrection, parseJSON, recordCorrection, recordReview, rewriteDraft, reopenCriterion, validateDraft, validateReview, validateScopeAudit } from '@/lib/coaching-validation';
import { CRITERION_ORDER, type Criterion } from '@/lib/examiner-validation';
import type { CoachingCorrection, CoachingState, GateReview } from '@/lib/coaching-types';
import type { Assessment, ContentPart, TaskType } from '@/lib/types';

export const maxDuration = 300;
const STALE_LOCK_MS = 10 * 60_000;
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['review', 'correct', 'advance', 'finalise']), revision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('rewrite'), revision: z.number().int().nonnegative(), text: z.string().max(40_000) }).strict(),
]);
const assessmentSchema = z.object({ ta_tr: z.number().int().min(0).max(9), cc: z.number().int().min(0).max(9), lr: z.number().int().min(0).max(9), gra: z.number().int().min(0).max(9), diagnosisZh: z.string().min(1), diagnosisEn: z.string().min(1) });
class RequestFailure extends Error { constructor(message: string, public status: number) { super(message); } }

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ownerHash = await getOwnerHash();
  const db = getSupabaseClient();
  let claimTs: string | undefined;
  let actionName = 'coaching';
  try {
    let body: z.infer<typeof actionSchema>;
    try { body = actionSchema.parse(await request.json()); } catch { throw new RequestFailure('Invalid coaching action or draft (max 40,000 characters)', 400); }
    actionName = body.action;
    const { data: row, error: fetchError } = await db.from('submissions')
      .select('id, task_type, prompt_text, task_image_id, assessment, correction, status, updated_at')
      .eq('id', id).eq('owner_hash', ownerHash).maybeSingle();
    if (fetchError) throw new Error(fetchError.message);
    if (!row) throw new RequestFailure('Submission not found', 404);
    const stored = row.correction as CoachingCorrection | null;
    if (!stored?.coaching || stored.coaching.version !== 1) throw new RequestFailure('This saved essay uses the earlier replay format; start a new submission for coaching', 409);
    const state = stored.coaching;
    if (body.revision !== state.revision) throw new RequestFailure('Your draft changed in another request. Refresh to use the saved draft.', 409);
    if (!row.assessment) throw new RequestFailure('Original assessment is required before coaching', 409);
    const round = state.rounds.find(r => r.criterion === state.currentCriterion);
    if (!round) throw new Error('Saved coaching round is missing');
    let next: CoachingState = state;
    // Cache reads do not claim a lock or call a model.
    if (body.action === 'review' && round.reviews.some(r => r.revision === state.revision)) return NextResponse.json({ coaching: state });
    if (body.action === 'correct' && round.correction && ['stage_complete', 'completed'].includes(state.phase)) return NextResponse.json({ coaching: state });
    if (body.action === 'finalise' && state.final) return NextResponse.json({ coaching: state });
    if (state.phase === 'practice_paused') throw new RequestFailure('Three unsuccessful reviews: this round is paused. Use your saved practice plan and start a new exercise.', 409);
    try {
      if (body.action === 'rewrite') next = rewriteDraft(state, body.text);
      if (body.action === 'advance') next = advanceCriterion(state);
    } catch (error) { throw new RequestFailure(error instanceof Error ? error.message : 'Invalid draft transition', body.action === 'rewrite' && ['needs_review', 'rewrite_required'].includes(state.phase) ? 400 : 409); }
    if (body.action === 'rewrite' && next === state) return NextResponse.json({ coaching: state });
    if (body.action === 'review' && state.phase !== 'needs_review') throw new RequestFailure('Save a changed draft before requesting another review', 409);
    if (body.action === 'correct' && (state.phase !== 'ready_to_correct' || !round.reviews.some(r => r.revision === state.revision && r.passed))) throw new RequestFailure('Pass all three checks on this exact draft before correction', 409);
    if (body.action === 'finalise' && (state.phase !== 'completed' || state.rounds.length !== 4 || !state.rounds.every(r => r.correction))) throw new RequestFailure('Complete all four examiner passes before the target model', 409);
    if (row.status === 'processing' && Date.now() - new Date(row.updated_at).getTime() < STALE_LOCK_MS) throw new RequestFailure('Another request is processing. Please wait and refresh.', 409);

    // Compare-and-swap includes exact version timestamp as well as owner and status.
    // A stale request can never complete over a newer request, even after lock recovery.
    claimTs = new Date(Math.max(Date.now(), new Date(row.updated_at).getTime() + 1)).toISOString();
    const { data: claimed, error: claimError } = await db.from('submissions')
      .update({ status: 'processing', stage: `coaching_${body.action}`, error_message: null, updated_at: claimTs })
      .eq('id', id).eq('owner_hash', ownerHash).eq('status', row.status).eq('updated_at', row.updated_at).select('id').maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimed) { claimTs = undefined; throw new RequestFailure('Another request changed this essay. Refresh the saved draft.', 409); }
    const started = Date.now();
    const taskType = row.task_type as TaskType;
    const model = createLLMClient(extractHeaders(request.headers));
    let imagePart: ContentPart | undefined;
    const recheckEarlier = body.action === 'review' && state.history.at(-1)?.source === 'student' && state.currentCriterion !== 'ta_tr';
    const needsVision = taskType === 'academic1' && (body.action === 'finalise' || recheckEarlier || (['review', 'correct'].includes(body.action) && state.currentCriterion === 'ta_tr'));
    if (needsVision) {
      if (!row.task_image_id) throw new Error('The original Academic Task 1 image is required. Start a new submission with the task image.');
      const { data: upload, error } = await db.from('uploads').select('storage_key').eq('id', row.task_image_id).eq('owner_hash', ownerHash).eq('role', 'task').maybeSingle();
      if (error || !upload?.storage_key) throw new Error('Unable to load your original task image. Please retry.');
      imagePart = { type: 'image_url', image_url: { url: await getStorage().generatePresignedUrl({ key: upload.storage_key, expireTime: 3600 }), detail: 'high' } };
    }
    const invokeRaw = async (prompt: string, previousResponse?: string, validationError?: string): Promise<string> => {
      const content: ContentPart[] = [{ type: 'text', text: prompt }, ...(imagePart ? [imagePart] : [])];
      const messages = coachingJSONMessages(content, previousResponse, validationError);
      const result = await model.invoke(messages.map(message => ({ ...message, content: message.content as unknown as string })), { model: MODEL_ID, temperature: 0.1, thinking: 'disabled', caching: 'disabled' });
      return result.content;
    };
    const invoke = async (prompt: string): Promise<unknown> => parseJSON(await invokeRaw(prompt));
    const validated = async <T,>(prompt: string, validate: (value: unknown) => T): Promise<T> => {
      let previousResponse: string | undefined;
      let validationError: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          previousResponse = await invokeRaw(prompt, previousResponse, validationError);
          return validate(parseJSON(previousResponse));
        } catch (error) {
          if (attempt === 1) throw error;
          validationError = error instanceof Error ? error.message : 'Model response could not be parsed or validated';
        }
      }
      throw new Error('Model validation failed');
    };
    if (body.action === 'review') {
      const reviewCriterion = async (criterion: Criterion): Promise<GateReview> => {
        const criterionRound = next.rounds.find(r => r.criterion === criterion)!;
        const cached = criterionRound.reviews.find(r => r.draftText === state.draftText);
        if (cached) {
          // Reverting to identical text must not charge another attempt or model call.
          const evidenceMap = new Map(cached.inputParagraphs.map((p, i) => [p.id, state.paragraphs[i]?.id]));
          return { ...structuredClone(cached), revision: state.revision, inputParagraphs: structuredClone(state.paragraphs),
            checks: cached.checks.map(c => ({ ...c, evidence: c.evidence.map(e => ({ ...e, paragraphId: evidenceMap.get(e.paragraphId) || e.paragraphId })) })) };
        }
        const reviewStart = Date.now();
        const raw = await validated(buildGatePrompt(taskType, criterion, row.prompt_text, state.paragraphs), value => validateReview(value, state.paragraphs, criterion));
        return { id: randomUUID(), revision: state.revision, criterion, passed: raw.checks.every(c => c.passed), ...raw,
          createdAt: new Date().toISOString(), duration_ms: Date.now() - reviewStart, provider_model: MODEL_ID,
          draftText: state.draftText, inputParagraphs: structuredClone(state.paragraphs) };
      };
      let regression = false;
      if (recheckEarlier) {
        for (const prior of CRITERION_ORDER.slice(0, CRITERION_ORDER.indexOf(state.currentCriterion))) {
          const review = await reviewCriterion(prior);
          if (!review.passed) {
            next = recordReview(reopenCriterion(next, prior), review);
            regression = true; break;
          }
          // Earlier passes were revalidated against this exact student rewrite, without editing it.
          next = { ...recordReview({ ...next, currentCriterion: prior }, review), currentCriterion: state.currentCriterion, phase: 'needs_review' };
        }
      }
      if (!regression) next = recordReview(next, await reviewCriterion(state.currentCriterion));
    }
    if (body.action === 'correct') {
      let feedback = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        let attemptedProposal: unknown;
        let attemptedAudit: unknown;
        try {
          attemptedProposal = await invoke(buildAnchoredPrompt(taskType, state.currentCriterion, row.prompt_text, state.paragraphs) + feedback);
          const { proposal, stage } = applyAnchoredCorrection(attemptedProposal, state.paragraphs, state.currentCriterion);
          // A genuinely independent second model call must approve actual changes.
          if (proposal.edits.length) {
            attemptedAudit = await invoke(buildScopePrompt(taskType, state.currentCriterion, row.prompt_text, state.paragraphs, proposal));
            validateScopeAudit(attemptedAudit, proposal.edits.length);
          }
          next = recordCorrection(state, { ...stage, duration_ms: Date.now() - started, provider_model: MODEL_ID });
          break;
        } catch (error) {
          if (attempt === 1) throw error;
          feedback = buildCorrectionRetryFeedback(attemptedProposal, attemptedAudit, error instanceof Error ? error.message : 'invalid correction');
        }
      }
    }
    if (body.action === 'finalise') {
      const generatePrompt = buildTargetModelPrompt(taskType, row.prompt_text, state.paragraphs, state.targetBand);
      const generate = (feedback = '') => validated(generatePrompt + feedback, value => {
        const result = z.object({ modelText: z.string().min(1).max(40_000) }).strict().parse(value);
        const text = validateDraft(result.modelText);
        const minimum = taskType === 'task2' ? 250 : 150;
        if (text.split(/\s+/).length < minimum) throw new Error(`Teaching model must contain at least ${minimum} words`);
        return text;
      });
      const assess = async (text: string): Promise<Assessment> => {
        const assessmentStart = Date.now();
        // Fresh call: the requested target and the generator's claims are never sent to this assessor.
        const raw = await validated(buildAssessmentPrompt(taskType, row.prompt_text, text, needsVision), value => assessmentSchema.parse(value));
        const labels = getCriterionLabels(taskType);
        return { scores: {
          ta_tr: { score: raw.ta_tr, labelZh: labels.ta_tr.labelZh, labelEn: labels.ta_tr.labelEn },
          cc: { score: raw.cc, labelZh: labels.cc.labelZh, labelEn: labels.cc.labelEn },
          lr: { score: raw.lr, labelZh: labels.lr.labelZh, labelEn: labels.lr.labelEn },
          gra: { score: raw.gra, labelZh: labels.gra.labelZh, labelEn: labels.gra.labelEn },
        }, overall: computeOverall([raw.ta_tr, raw.cc, raw.lr, raw.gra]), diagnosisZh: raw.diagnosisZh, diagnosisEn: raw.diagnosisEn, provider_model: MODEL_ID, duration_ms: Date.now() - assessmentStart };
      };
      const scores = (assessment: Assessment) => Object.values(assessment.scores).map(s => s.score);
      let modelText = await generate();
      let assessment = await assess(modelText);
      let refinementCount = 0;
      if (!scores(assessment).every(score => score >= state.targetBand)) {
        const revised = await generate(`\nYour first teaching model was independently assessed below the desired target. Make ONE focused refinement using this feedback. Retain the student's ideas and position, and never invent facts to improve a score. Previous model: ${JSON.stringify(modelText)}\nIndependent feedback: ${JSON.stringify(assessment)}\nReturn the same modelText JSON shape.`);
        const revisedAssessment = await assess(revised);
        refinementCount = 1;
        const oldMin = Math.min(...scores(assessment));
        const newMin = Math.min(...scores(revisedAssessment));
        // Keep the stronger independently assessed candidate rather than regress on retry.
        if (newMin > oldMin || (newMin === oldMin && revisedAssessment.overall >= assessment.overall)) { modelText = revised; assessment = revisedAssessment; }
      }
      const targetMet = scores(assessment).every(score => score >= state.targetBand);
      next = { ...state, final: { modelText, assessment, targetMet, refinementCount, provider_model: MODEL_ID, duration_ms: Date.now() - started,
        noteZh: targetMet ? `四项独立估分均达到目标 ${state.targetBand} 分。这是另行生成的教学范文，不是学生原作，也不保证真实考试得分。` : `经过一次针对性优化，这篇教学范文仍未在全部四项独立估分中达到目标 ${state.targetBand} 分。保留实际估分，不宣称达标；学生改写稿另行保存。`,
        noteEn: targetMet ? `All four independently estimated criteria meet target ${state.targetBand}. This is a separate teaching model, not the student's own writing or a guarantee of an exam score.` : `After one targeted refinement, this teaching model has not reached target ${state.targetBand} in all four independently estimated criteria. The actual estimate is shown; the student's revised draft remains separately saved.` } };
    }
    const saved: CoachingCorrection = { stages: next.rounds.flatMap(r => r.correction ? [r.correction] : []), coaching: next };
    const { data: updated, error: saveError } = await db.from('submissions').update({ correction: saved, status: next.phase === 'completed' ? 'completed' : 'pending', stage: `coaching_${next.phase}`, error_message: null, updated_at: new Date(Math.max(Date.now(), new Date(claimTs!).getTime() + 1)).toISOString() })
      .eq('id', id).eq('owner_hash', ownerHash).eq('status', 'processing').eq('updated_at', claimTs).select('id').maybeSingle();
    if (saveError) throw new Error(saveError.message);
    if (!updated) throw new RequestFailure('A newer request owns this essay. Refresh to read its saved result.', 409);
    claimTs = undefined;
    return NextResponse.json({ coaching: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Coaching request failed';
    if (claimTs) {
      // Only the owner of this exact lock can recover it. A model/schema failure consumes no review attempt.
      await db.from('submissions').update({ status: 'error', stage: `failed_${actionName}`, error_message: message, updated_at: new Date(Math.max(Date.now(), new Date(claimTs!).getTime() + 1)).toISOString() })
        .eq('id', id).eq('owner_hash', ownerHash).eq('status', 'processing').eq('updated_at', claimTs);
    }
    return NextResponse.json({ error: message }, { status: error instanceof RequestFailure ? error.status : 500 });
  }
}
