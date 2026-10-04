import { NextRequest, NextResponse } from 'next/server';
import { getOwnerHash } from '@/lib/session';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createLLMClient, extractHeaders, MODEL_ID } from '@/lib/llm';
import { buildCorrectionPrompt } from '@/lib/prompts';
import { z } from 'zod';
import { diffWordsWithSpace } from 'diff';
import type { Correction, CorrectedParagraph, PlaybackEvent, Paragraph } from '@/lib/types';

const reasonSchema = z.object({
  criterion: z.enum(['ta_tr', 'cc', 'lr', 'gra']),
  quote: z.string(),
  explanationZh: z.string(),
  explanationEn: z.string(),
});

const correctedParagraphSchema = z.object({
  paragraphId: z.string(),
  correctedText: z.string(),
  reasons: z.array(reasonSchema),
});

function parseCorrectionJSON(text: string): z.infer<typeof correctedParagraphSchema>[] {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) throw new Error('Expected JSON array');
  return z.array(correctedParagraphSchema).parse(parsed);
}

function buildPlaybackEvents(
  originalParagraphs: Paragraph[],
  correctedParagraphs: CorrectedParagraph[]
): PlaybackEvent[] {
  const events: PlaybackEvent[] = [];
  let order = 0;

  for (const origPara of originalParagraphs) {
    const corrected = correctedParagraphs.find(c => c.paragraphId === origPara.id);
    if (!corrected || corrected.correctedText === origPara.text) {
      // Unchanged paragraph - just mark complete
      events.push({ paragraphId: origPara.id, type: 'complete', order: order++ });
      continue;
    }

    // Compute diff
    const diff = diffWordsWithSpace(origPara.text, corrected.correctedText);
    let hasChanges = false;

    for (const part of diff) {
      if (part.added) {
        events.push({ paragraphId: origPara.id, type: 'replace', order: order++ });
        hasChanges = true;
      } else if (part.removed) {
        events.push({ paragraphId: origPara.id, type: 'strikethrough', order: order++ });
        hasChanges = true;
      }
    }

    if (hasChanges) {
      events.push({ paragraphId: origPara.id, type: 'highlight', order: order++ });
    }
    events.push({ paragraphId: origPara.id, type: 'complete', order: order++ });
  }

  return events;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ownerHash = await getOwnerHash();
    const { id } = await params;

    const client = getSupabaseClient();

    // Fetch submission with assessment
    const { data: submission, error: fetchError } = await client
      .from('submissions')
      .select('id, task_type, prompt_text, paragraphs, assessment, correction, stage, status')
      .eq('id', id)
      .eq('owner_hash', ownerHash)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);
    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    // Require assessment first
    if (!submission.assessment) {
      return NextResponse.json({ error: 'Assessment required before correction' }, { status: 400 });
    }

    // If already corrected, return cached
    if (submission.correction && submission.stage === 'corrected') {
      return NextResponse.json(submission.correction as Correction);
    }

    // Concurrency guard
    if (submission.status === 'processing') {
      return NextResponse.json({ error: 'Processing already in progress' }, { status: 409 });
    }

    // Mark as processing
    await client
      .from('submissions')
      .update({ status: 'processing', stage: 'correcting', error_message: null })
      .eq('id', id);

    const startTime = Date.now();
    const forwardHeaders = extractHeaders(request.headers);
    const llmClient = createLLMClient(forwardHeaders);

    const paragraphs = submission.paragraphs as Paragraph[];
    const assessment = submission.assessment as { scores: Record<string, { score: number }> };

    const prompt = buildCorrectionPrompt(
      submission.task_type as 'academic1' | 'general1' | 'task2',
      submission.prompt_text,
      paragraphs,
      {
        ta_tr: assessment.scores.ta_tr.score,
        cc: assessment.scores.cc.score,
        lr: assessment.scores.lr.score,
        gra: assessment.scores.gra.score,
      }
    );

    let correctedData: z.infer<typeof correctedParagraphSchema>[];
    try {
      const response = await llmClient.invoke(
        [{ role: 'user', content: prompt }],
        { model: MODEL_ID, temperature: 0.2 }
      );
      correctedData = parseCorrectionJSON(response.content);
    } catch {
      // Retry once
      const retryResponse = await llmClient.invoke(
        [
          { role: 'user', content: prompt },
          { role: 'assistant', content: 'I will provide the corrected paragraphs in the exact JSON format.' },
          { role: 'user', content: 'Please output ONLY the JSON array of corrected paragraphs.' },
        ],
        { model: MODEL_ID, temperature: 0.1 }
      );
      correctedData = parseCorrectionJSON(retryResponse.content);
    }

    // Validate all paragraph IDs are present
    const origIds = new Set(paragraphs.map(p => p.id));
    const correctedIds = new Set(correctedData.map(c => c.paragraphId));
    for (const origId of origIds) {
      if (!correctedIds.has(origId)) {
        throw new Error(`Missing correction for paragraph ${origId}`);
      }
    }

    const durationMs = Date.now() - startTime;

    // Build corrected paragraphs
    const correctedParagraphs: CorrectedParagraph[] = correctedData.map(c => ({
      paragraphId: c.paragraphId,
      correctedText: c.correctedText,
      reasons: c.reasons,
    }));

    // Build playback events using diffWordsWithSpace
    const events = buildPlaybackEvents(paragraphs, correctedParagraphs);

    const correction: Correction = {
      paragraphs: correctedParagraphs,
      provider_model: MODEL_ID,
      duration_ms: durationMs,
    };

    // Save to DB
    await client
      .from('submissions')
      .update({
        correction,
        playback: { events },
        stage: 'corrected',
        status: 'completed',
        correct_duration_ms: durationMs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json(correction);
  } catch (err) {
    const { id } = await params;
    const message = err instanceof Error ? err.message : 'Correction failed';

    // Save error state but preserve assessment
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
