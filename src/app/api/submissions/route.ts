import { NextRequest, NextResponse } from 'next/server';
import { getOwnerHash } from '@/lib/session';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { randomUUID } from 'crypto';
import type { TaskType, Paragraph } from '@/lib/types';

const VALID_TASK_TYPES: TaskType[] = ['academic1', 'general1', 'task2'];
const MAX_PROMPT_LENGTH = 6000;
const MAX_ESSAY_WORDS = 1500;
const MAX_SUBMISSIONS_PER_HOUR = 20;

function splitParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => ({ id: randomUUID(), text: p }));
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

export async function POST(request: NextRequest) {
  try {
    const ownerHash = await getOwnerHash();
    const body = await request.json();
    const { taskType, promptText, originalText, taskImageId } = body;

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

    const wordCount = countWords(originalText);
    if (wordCount > MAX_ESSAY_WORDS) {
      return NextResponse.json({ error: `Essay too long (${wordCount} words, max ${MAX_ESSAY_WORDS})` }, { status: 400 });
    }

    // Rate limiting check
    const client = getSupabaseClient();
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
    const paragraphs = splitParagraphs(originalText);

    // Insert submission
    const { data, error } = await client
      .from('submissions')
      .insert({
        owner_hash: ownerHash,
        task_type: taskType,
        prompt_text: promptText.trim(),
        original_text: originalText.trim(),
        task_image_id: taskImageId || null,
        paragraphs: paragraphs,
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
