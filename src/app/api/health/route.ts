import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.from('submissions').select('id').limit(1);
    if (error) throw new Error(error.message);
    return NextResponse.json({ status: 'ok', db: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ status: 'error', db: false, message }, { status: 500 });
  }
}
