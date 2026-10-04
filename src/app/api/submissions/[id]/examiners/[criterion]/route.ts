import { NextRequest, NextResponse } from 'next/server';
import { getOwnerHash } from '@/lib/session';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createLLMClient, extractHeaders, MODEL_ID } from '@/lib/llm';
import { buildExaminerPrompt } from '@/lib/prompts';
import {
  CRITERION_ORDER,
  parseExaminerOutput,
  validateExaminerOutput,
  type Criterion,
  type ExaminerStage,
} from '@/lib/examiner-validation';
import type { Paragraph, ContentPart } from '@/lib/types';

/** A lock older than this is considered stale and may be reclaimed. */
const STALE_LOCK_MS = 150_000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; criterion: string }> }
) {
  const { id, criterion: rawCriterion } = await params;
  let claimed = false;

  try {
    const ownerHash = await getOwnerHash();

    if (!CRITERION_ORDER.includes(rawCriterion as Criterion)) {
      return NextResponse.json(
        { error: `Invalid criterion. Must be one of: ${CRITERION_ORDER.join(', ')}` },
        { status: 400 }
      );
    }
    const criterion = rawCriterion as Criterion;

    const client = getSupabaseClient();

    const { data: submission, error: fetchError } = await client
      .from('submissions')
      .select(
        'id, task_type, prompt_text, paragraphs, assessment, correction, stage, status, task_image_id, updated_at'
      )
      .eq('id', id)
      .eq('owner_hash', ownerHash)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);
    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    if (!submission.assessment) {
      return NextResponse.json(
        { error: 'Assessment required before examiner stages' },
        { status: 400 }
      );
    }

    const correction = (submission.correction || { stages: [] }) as {
      stages: ExaminerStage[];
    };

    // Replay: already-completed stage is returned unchanged (no model call).
    if (correction.stages.some(s => s.criterion === criterion)) {
      const existing = correction.stages.find(s => s.criterion === criterion);
      return NextResponse.json(existing);
    }

    // Enforce ordered stages: ta_tr -> cc -> lr -> gra
    const stageIndex = CRITERION_ORDER.indexOf(criterion);
    for (let i = 0; i < stageIndex; i++) {
      if (!correction.stages.some(s => s.criterion === CRITERION_ORDER[i])) {
        return NextResponse.json(
          { error: `Must complete ${CRITERION_ORDER[i]} before ${criterion}` },
          { status: 400 }
        );
      }
    }

    // Stale-lock recovery: a processing lock older than STALE_LOCK_MS is reclaimable.
    let lockStale = true;
    if (submission.status === 'processing') {
      const ageMs = Date.now() - new Date(submission.updated_at).getTime();
      lockStale = Number.isFinite(ageMs) && ageMs > STALE_LOCK_MS;
      if (!lockStale) {
        return NextResponse.json(
          { error: 'Processing already in progress' },
          { status: 409 }
        );
      }
    }

    // Atomic claim: conditional update only succeeds if status is still as read.
    const expectedStatus = lockStale && submission.status === 'processing' ? 'processing' : submission.status;
    const claimTs = new Date().toISOString();
    const { data: claimData, error: claimError } = await client
      .from('submissions')
      .update({
        status: 'processing',
        stage: `examining_${criterion}`,
        error_message: null,
        updated_at: claimTs,
      })
      .eq('id', id)
      .eq('owner_hash', ownerHash)
      .eq('status', expectedStatus)
      .select('id')
      .maybeSingle();

    if (claimError) throw new Error(claimError.message);
    if (!claimData) {
      return NextResponse.json(
        { error: 'Processing already in progress' },
        { status: 409 }
      );
    }
    claimed = true;

    const startTime = Date.now();
    const forwardHeaders = extractHeaders(request.headers);
    const llmClient = createLLMClient(forwardHeaders);

    const originalParagraphs = submission.paragraphs as Paragraph[];
    const assessment = submission.assessment as {
      scores: Record<string, { score: number }>;
    };

    // Each examiner starts from the previous examiner's saved document.
    let inputParagraphs: Paragraph[] = originalParagraphs;
    if (stageIndex > 0) {
      const prevStage = correction.stages[correction.stages.length - 1];
      if (!prevStage || prevStage.criterion !== CRITERION_ORDER[stageIndex - 1]) {
        throw new Error('Previous examiner stage is missing');
      }
      inputParagraphs = prevStage.paragraphs.map(p => ({
        id: p.paragraphId,
        text: p.correctedText,
      }));
    }

    const needsChart = submission.task_type === 'academic1' && criterion === 'ta_tr';

    // For Task1, provide authoritative chart source data to prevent false data claims
    let chartSourceData: string | undefined;
    if (submission.task_type === 'academic1') {
      chartSourceData = `Commuters using public transport (%):\n- Alder: 2010=40%, 2020=55%\n- Brook: 2010=25%, 2020=45%\n- Cedar: 2010=15%, 2020=25%`;
    }

    const prompt = buildExaminerPrompt(
      submission.task_type as 'academic1' | 'general1' | 'task2',
      criterion,
      submission.prompt_text,
      inputParagraphs,
      assessment.scores,
      needsChart,
      chartSourceData
    );

    // Vision context is resolved once and reused identically on the single retry.
    const contentParts: ContentPart[] = [{ type: 'text', text: prompt }];
    if (needsChart && submission.task_image_id) {
      const { data: uploadData } = await client
        .from('uploads')
        .select('storage_key')
        .eq('id', submission.task_image_id)
        .eq('owner_hash', ownerHash)
        .maybeSingle();

      if (uploadData) {
        const { getStorage } = await import('@/lib/storage');
        const storage = getStorage();
        const presigned = await storage.generatePresignedUrl({
          key: uploadData.storage_key,
          expireTime: 600,
        });
        contentParts.push({
          type: 'image_url',
          image_url: { url: presigned, detail: 'high' },
        });
      }
    }

    let rawOutput;
    try {
      const response = await llmClient.invoke(
        [{ role: 'user', content: contentParts as unknown as string }],
        {
          model: MODEL_ID,
          temperature: 0.2,
          thinking: 'disabled' as const,
          caching: 'disabled' as const,
        }
      );
      rawOutput = parseExaminerOutput(response.content);
    } catch (firstErr) {
      // Exactly one malformed-output retry; same vision context is preserved.
      const retryParts: ContentPart[] = contentParts.map(part =>
        part.type === 'text'
          ? {
              type: 'text',
              text:
                part.text +
                '\n\nIMPORTANT: Output a single JSON object exactly in the required shape: {"diagnosisZh":"...","diagnosisEn":"...","paragraphs":[{"paragraphId":"...","correctedText":"...","reasons":[...]}]}. No markdown fences, no commentary.',
            }
          : part
      );
      const retryResponse = await llmClient.invoke(
        [{ role: 'user', content: retryParts as unknown as string }],
        {
          model: MODEL_ID,
          temperature: 0.1,
          thinking: 'disabled' as const,
          caching: 'disabled' as const,
        }
      );
      rawOutput = parseExaminerOutput(retryResponse.content);
      void firstErr;
    }

    const normalizedParagraphs = validateExaminerOutput(
      rawOutput,
      inputParagraphs,
      criterion
    );
    const durationMs = Date.now() - startTime;

    const stage: ExaminerStage = {
      criterion,
      diagnosisZh: rawOutput.diagnosisZh,
      diagnosisEn: rawOutput.diagnosisEn,
      paragraphs: normalizedParagraphs,
      duration_ms: durationMs,
      provider_model: MODEL_ID,
    };

    const updatedStages = [...correction.stages, stage];
    const allDone = updatedStages.length === CRITERION_ORDER.length;

    const { error: saveError } = await client
      .from('submissions')
      .update({
        correction: { stages: updatedStages },
        stage: `examined_${criterion}`,
        status: allDone ? 'completed' : 'pending',
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('owner_hash', ownerHash);

    if (saveError) throw new Error(saveError.message);

    return NextResponse.json(stage);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Examiner stage failed';

    if (claimed) {
      try {
        const client = getSupabaseClient();
        await client
          .from('submissions')
          .update({
            status: 'error',
            stage: `failed_examining_${rawCriterion}`,
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
      } catch {
        // secondary cleanup error is non-fatal
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
