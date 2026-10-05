import { NextRequest, NextResponse } from 'next/server';
import { getOwnerHash } from '@/lib/session';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { initialCoaching, assignParagraphs, validateDraft } from '@/lib/coaching-validation';
import type { TaskType } from '@/lib/types';

const VALID_TASK_TYPES: TaskType[] = ['academic1', 'general1', 'task2'];
const MAX_PROMPT_LENGTH = 6000;
const MAX_SUBMISSIONS_PER_HOUR = 20;

export async function POST(request: NextRequest) {
  try {
    const ownerHash = await getOwnerHash();
    const body = await request.json();
    const { taskType, promptText, originalText, taskImageId, targetBand = 7 } = body;
    if (![7, 8, 9].includes(targetBand)) return NextResponse.json({ error: 'Target band must be 7, 8 or 9' }, { status: 400 });
    if (taskImageId !== undefined && taskImageId !== null && (typeof taskImageId !== 'string' || !/^[a-f0-9-]{36}$/i.test(taskImageId))) return NextResponse.json({ error: 'Invalid task image ID' }, { status: 400 });

    // Validate task type
    if (!VALID_TASK_TYPES.includes(taskType)) {
      return NextResponse.json({ error: 'Invalid task type' }, { status: 400 });
    }

    // Validate prompt
    if (!promptText || typeof promptText !== 'string' || promptText.trim().length === 0) {
      return NextResponse.json({ error: 'Question text is required' }, { status: 400 });
    }
    if (promptText.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Prompt text too long (max ${MAX_PROMPT_LENGTH} chars)` }, { status: 400 });
    }

    // Validate essay text
    if (!originalText || typeof originalText !== 'string' || originalText.trim().length === 0) {
      return NextResponse.json({ error: 'Essay text is required' }, { status: 400 });
    }

    let cleanText: string;
    try { cleanText = validateDraft(originalText); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid essay' }, { status: 400 }); }

    // Rate limiting check
    const client = getSupabaseClient();
    if (taskType === 'academic1' && !taskImageId) return NextResponse.json({ error: 'Original task image is required for Academic Task 1' }, { status: 400 });
    if (taskImageId) {
      const { data: image, error: imageError } = await client.from('uploads').select('id').eq('id', taskImageId).eq('owner_hash', ownerHash).eq('role', 'task').maybeSingle();
      if (imageError) throw new Error(imageError.message);
      if (!image) return NextResponse.json({ error: 'Task image not found in your session' }, { status: 400 });
    }
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await client
      .from('submissions')
      .select('*', { count: 'exact', head: true })
      .eq('owner_hash', ownerHash)
      .gte('created_at', oneHourAgo);

    if (countError) throw new Error(countError.message);
    if (count && count >= MAX_SUBMISSIONS_PER_HOUR) {
      return NextResponse.json({ error: 'Rate limit exceeded (20 submissions/hour)' }, { status: 429 });
    }

    // Split into paragraphs
    const paragraphs = assignParagraphs(cleanText);

    // Insert submission
    const { data, error } = await client
      .from('submissions')
      .insert({
        owner_hash: ownerHash,
        task_type: taskType,
        prompt_text: promptText.trim(),
        original_text: cleanText,
        task_image_id: taskImageId || null,
        paragraphs: paragraphs,
        correction: { stages: [], coaching: initialCoaching(cleanText, paragraphs, targetBand) },
        stage: 'created',
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ id: data.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Submission failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
