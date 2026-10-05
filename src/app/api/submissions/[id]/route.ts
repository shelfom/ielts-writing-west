import { NextRequest, NextResponse } from 'next/server';
import { getOwnerHash } from '@/lib/session';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getStorage } from '@/lib/storage';
import type { SubmissionData } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ownerHash = await getOwnerHash();
    const { id } = await params;

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('submissions')
      .select('id, task_type, prompt_text, original_text, task_image_id, paragraphs, assessment, correction, playback, stage, status, error_message, created_at, updated_at')
      .eq('id', id)
      .eq('owner_hash', ownerHash)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    let taskImageUrl: string | null = null;
    if (data.task_image_id) {
      const { data: upload } = await client.from('uploads').select('storage_key').eq('id', data.task_image_id).eq('owner_hash', ownerHash).eq('role', 'task').maybeSingle();
      if (upload?.storage_key) {
        try { taskImageUrl = await getStorage().generatePresignedUrl({ key: upload.storage_key, expireTime: 1800 }); } catch { /* Keep saved essay readable when image signing is temporarily unavailable. */ }
      }
    }

    const submission: SubmissionData = {
      id: data.id,
      task_image_url: taskImageUrl,
      task_type: data.task_type,
      prompt_text: data.prompt_text,
      original_text: data.original_text,
      paragraphs: (data.paragraphs || []) as SubmissionData['paragraphs'],
      assessment: data.assessment as SubmissionData['assessment'],
      correction: data.correction as SubmissionData['correction'],
      playback: data.playback as SubmissionData['playback'],
      stage: data.stage,
      status: data.status,
      error_message: data.error_message,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };

    return NextResponse.json(submission);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch submission';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
