import { NextRequest, NextResponse } from 'next/server';
import { getOwnerHash } from '@/lib/session';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createLLMClient, extractHeaders, MODEL_ID } from '@/lib/llm';
import { buildAssessmentPrompt, getCriterionLabels } from '@/lib/prompts';
import { computeOverall } from '@/lib/scoring';
import { getStorage } from '@/lib/storage';
import { z } from 'zod';
import type { Assessment, TaskType, ContentPart } from '@/lib/types';

const assessmentSchema = z.object({
  ta_tr: z.number().int().min(0).max(9),
  cc: z.number().int().min(0).max(9),
  lr: z.number().int().min(0).max(9),
  gra: z.number().int().min(0).max(9),
  diagnosisZh: z.string().min(10),
  diagnosisEn: z.string().min(10),
});

function parseAssessmentJSON(text: string): z.infer<typeof assessmentSchema> {
  // Try to extract JSON from markdown code block
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
  const parsed = JSON.parse(jsonStr);
  return assessmentSchema.parse(parsed);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ownerHash = await getOwnerHash();
    const { id } = await params;

    const client = getSupabaseClient();

    // Fetch submission
    const { data: submission, error: fetchError } = await client
      .from('submissions')
      .select('id, task_type, prompt_text, original_text, task_image_id, assessment, status, stage')
      .eq('id', id)
      .eq('owner_hash', ownerHash)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);
    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    // If already assessed successfully, return cached
    if (submission.assessment && submission.stage === 'assessed' || submission.stage === 'corrected') {
      return NextResponse.json(submission.assessment as Assessment);
    }

    // Concurrency guard: if already processing and recent (< 2 min), reject
    if (submission.status === 'processing') {
      const { data: recent } = await client
        .from('submissions')
        .select('updated_at')
        .eq('id', id)
        .maybeSingle();
      if (recent) {
        const updatedAt = new Date(recent.updated_at).getTime();
        if (Date.now() - updatedAt < 120000) {
          return NextResponse.json({ error: 'Assessment already in progress' }, { status: 409 });
        }
      }
    }

    // Mark as processing
    await client
      .from('submissions')
      .update({ status: 'processing', stage: 'assessing', error_message: null })
      .eq('id', id);

    const startTime = Date.now();
    const forwardHeaders = extractHeaders(request.headers);
    const llmClient = createLLMClient(forwardHeaders);

    const taskType = submission.task_type as TaskType;
    const hasTaskImage = !!submission.task_image_id;

    const prompt = buildAssessmentPrompt(
      taskType,
      submission.prompt_text,
      submission.original_text,
      hasTaskImage
    );

    // Build content parts with image for Task1
    const contentParts: ContentPart[] = [{ type: 'text', text: prompt }];
    if (hasTaskImage && submission.task_image_id) {
      try {
        const { data: uploadData } = await client
          .from('uploads')
          .select('storage_key')
          .eq('id', submission.task_image_id)
          .eq('owner_hash', ownerHash)
          .maybeSingle();
        if (uploadData?.storage_key) {
          const storage = getStorage();
          const presignedUrl = await storage.generatePresignedUrl({
            key: uploadData.storage_key,
            expireTime: 3600,
          });
          contentParts.push({ type: 'image_url', image_url: { url: presignedUrl, detail: 'high' } });
        }
      } catch (imgErr) {
        console.error('Failed to get task image URL:', imgErr);
      }
    }

    // First attempt
    let assessmentData: z.infer<typeof assessmentSchema>;
    let retryUsed = false;

    try {
      const response = await llmClient.invoke(
        [{ role: 'user', content: contentParts as unknown as string }],
        { model: MODEL_ID, temperature: 0.2 }
      );
      assessmentData = parseAssessmentJSON(response.content);
    } catch {
      // Retry once with malformed output
      retryUsed = true;
      const retryResponse = await llmClient.invoke(
        [
          { role: 'user', content: contentParts as unknown as string },
          { role: 'assistant', content: 'I need to provide the assessment in the exact JSON format requested.' },
          { role: 'user', content: 'Please output ONLY the JSON assessment result.' },
        ],
        { model: MODEL_ID, temperature: 0.1 }
      );
      assessmentData = parseAssessmentJSON(retryResponse.content);
    }

    const durationMs = Date.now() - startTime;

    // Compute overall score in code (not LLM)
    const scores = [assessmentData.ta_tr, assessmentData.cc, assessmentData.lr, assessmentData.gra];
    const overall = computeOverall(scores);

    const labels = getCriterionLabels(taskType);

    const assessment: Assessment = {
      scores: {
        ta_tr: { score: assessmentData.ta_tr, labelZh: labels.ta_tr.labelZh, labelEn: labels.ta_tr.labelEn },
        cc: { score: assessmentData.cc, labelZh: labels.cc.labelZh, labelEn: labels.cc.labelEn },
        lr: { score: assessmentData.lr, labelZh: labels.lr.labelZh, labelEn: labels.lr.labelEn },
        gra: { score: assessmentData.gra, labelZh: labels.gra.labelZh, labelEn: labels.gra.labelEn },
      },
      overall,
      diagnosisZh: assessmentData.diagnosisZh,
      diagnosisEn: assessmentData.diagnosisEn,
      provider_model: MODEL_ID,
      duration_ms: durationMs,
    };

    // Save to DB
    await client
      .from('submissions')
      .update({
        assessment,
        stage: 'assessed',
        status: 'completed',
        provider_model: MODEL_ID,
        assess_duration_ms: durationMs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json(assessment);
  } catch (err) {
    const { id } = await params;
    const message = err instanceof Error ? err.message : 'Assessment failed';

    // Save error state
    try {
      const client = getSupabaseClient();
      await client
        .from('submissions')
        .update({
          stage: 'error',
          status: 'error',
          error_message: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
    } catch {
      // ignore secondary error
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
