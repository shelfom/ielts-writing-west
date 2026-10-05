import { NextRequest, NextResponse } from 'next/server';
import { getOwnerHash } from '@/lib/session';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createLLMClient, extractHeaders, MODEL_ID } from '@/lib/llm';
import { buildAssessmentPrompt, getCriterionLabels } from '@/lib/prompts';
import { computeOverall } from '@/lib/scoring';
import { getStorage } from '@/lib/storage';
import { z } from 'zod';
import { parseJSON } from '@/lib/coaching-validation';
import type { Assessment, TaskType, ContentPart } from '@/lib/types';

const assessmentSchema = z.object({
  ta_tr: z.number().int().min(0).max(9), cc: z.number().int().min(0).max(9),
  lr: z.number().int().min(0).max(9), gra: z.number().int().min(0).max(9),
  diagnosisZh: z.string().min(10), diagnosisEn: z.string().min(10),
});
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerHash = await getOwnerHash();
  const { id } = await params;
  const db = getSupabaseClient();
  let claimTs: string | undefined;
  try {
    const { data: submission, error } = await db.from('submissions')
      .select('id, task_type, prompt_text, original_text, task_image_id, assessment, status, stage, updated_at')
      .eq('id', id).eq('owner_hash', ownerHash).maybeSingle();
    if (error) throw new Error(error.message);
    if (!submission) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    // Immutable original scores remain cached through every later coaching stage.
    if (submission.assessment) return NextResponse.json(submission.assessment as Assessment);
    if (submission.status === 'processing' && Date.now() - new Date(submission.updated_at).getTime() < 10 * 60_000) return NextResponse.json({ error: 'Assessment already in progress' }, { status: 409 });
    claimTs = new Date(Math.max(Date.now(), new Date(submission.updated_at).getTime() + 1)).toISOString();
    const { data: claimed, error: claimError } = await db.from('submissions')
      .update({ status: 'processing', stage: 'assessing', error_message: null, updated_at: claimTs })
      .eq('id', id).eq('owner_hash', ownerHash).eq('status', submission.status).eq('updated_at', submission.updated_at).select('id').maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimed) { claimTs = undefined; return NextResponse.json({ error: 'Assessment already in progress' }, { status: 409 }); }
    const startTime = Date.now();
    const llm = createLLMClient(extractHeaders(request.headers));
    const taskType = submission.task_type as TaskType;
    const parts: ContentPart[] = [{ type: 'text', text: buildAssessmentPrompt(taskType, submission.prompt_text, submission.original_text, !!submission.task_image_id) }];
    if (taskType === 'academic1' && !submission.task_image_id) throw new Error('Task image is required for Academic Task 1');
    if (submission.task_image_id) {
      const { data: upload, error: imageError } = await db.from('uploads').select('storage_key').eq('id', submission.task_image_id).eq('owner_hash', ownerHash).eq('role', 'task').maybeSingle();
      if (imageError || !upload?.storage_key) throw new Error('Unable to load your task image; please retry');
      const url = await getStorage().generatePresignedUrl({ key: upload.storage_key, expireTime: 3600 });
      parts.push({ type: 'image_url', image_url: { url, detail: 'high' } });
    }
    let raw: z.infer<typeof assessmentSchema> | undefined;
    let feedback = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await llm.invoke([{ role: 'user', content: parts.map(p => p.type === 'text' ? { ...p, text: p.text + feedback } : p) as unknown as string }], { model: MODEL_ID, temperature: 0.1, thinking: 'disabled', caching: 'disabled' });
        raw = assessmentSchema.parse(parseJSON(response.content)); break;
      } catch (error) {
        if (attempt === 1) throw error;
        feedback = '\nReturn ONLY the exact requested JSON, with four integer scores 0–9 and both diagnoses. Previous output could not be validated.';
      }
    }
    if (!raw) throw new Error('Assessment could not be validated');
    const labels = getCriterionLabels(taskType);
    const durationMs = Date.now() - startTime;
    const assessment: Assessment = { scores: {
      ta_tr: { score: raw.ta_tr, labelZh: labels.ta_tr.labelZh, labelEn: labels.ta_tr.labelEn },
      cc: { score: raw.cc, labelZh: labels.cc.labelZh, labelEn: labels.cc.labelEn },
      lr: { score: raw.lr, labelZh: labels.lr.labelZh, labelEn: labels.lr.labelEn },
      gra: { score: raw.gra, labelZh: labels.gra.labelZh, labelEn: labels.gra.labelEn },
    }, overall: computeOverall([raw.ta_tr, raw.cc, raw.lr, raw.gra]), diagnosisZh: raw.diagnosisZh, diagnosisEn: raw.diagnosisEn, provider_model: MODEL_ID, duration_ms: durationMs };
    const { data: saved, error: saveError } = await db.from('submissions').update({ assessment, stage: 'assessed', status: 'completed', provider_model: MODEL_ID, assess_duration_ms: durationMs, updated_at: new Date(Math.max(Date.now(), new Date(claimTs!).getTime() + 1)).toISOString() })
      .eq('id', id).eq('owner_hash', ownerHash).eq('status', 'processing').eq('updated_at', claimTs).select('id').maybeSingle();
    if (saveError) throw new Error(saveError.message);
    if (!saved) return NextResponse.json({ error: 'A newer request owns this essay. Refresh its saved state.' }, { status: 409 });
    claimTs = undefined;
    return NextResponse.json(assessment);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Assessment failed';
    if (claimTs) await db.from('submissions').update({ stage: 'error', status: 'error', error_message: message, updated_at: new Date(Math.max(Date.now(), new Date(claimTs!).getTime() + 1)).toISOString() }).eq('id', id).eq('owner_hash', ownerHash).eq('status', 'processing').eq('updated_at', claimTs);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
