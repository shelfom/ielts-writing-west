import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug');

    if (!slug || !['task1', 'task2'].includes(slug)) {
      return NextResponse.json({ error: 'Invalid demo slug. Must be task1 or task2' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('demos')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
    }

    // Return only public fields, never owner_hash or storage secrets
    return NextResponse.json({
      slug: data.slug,
      task_type: data.task_type,
      prompt_text: data.prompt_text,
      paragraphs: data.paragraphs,
      task_image_url: data.task_image_url,
      assessment: data.assessment,
      correction: data.correction,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Demo fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
