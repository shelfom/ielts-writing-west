import { NextRequest, NextResponse } from 'next/server';
import { getOwnerHash } from '@/lib/session';
import { getStorage } from '@/lib/storage';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createLLMClient, extractHeaders, MODEL_ID } from '@/lib/llm';
import { buildExtractPrompt } from '@/lib/prompts';

export async function POST(request: NextRequest) {
  try {
    const ownerHash = await getOwnerHash();
    const { uploadIds } = await request.json();

    if (!Array.isArray(uploadIds) || uploadIds.length === 0) {
      return NextResponse.json({ error: 'uploadIds array required' }, { status: 400 });
    }

    const client = getSupabaseClient();
    const storage = getStorage();

    // Fetch upload records, verify ownership
    const { data: uploads, error: fetchError } = await client
      .from('uploads')
      .select('id, storage_key, mime_type, role')
      .in('id', uploadIds)
      .eq('owner_hash', ownerHash);

    if (fetchError) throw new Error(fetchError.message);
    if (!uploads || uploads.length !== uploadIds.length) {
      return NextResponse.json({ error: 'One or more uploads not found' }, { status: 404 });
    }

    // Get presigned URLs for images
    const imageUrls: string[] = [];
    for (const upload of uploads) {
      const url = await storage.generatePresignedUrl({
        key: upload.storage_key,
        expireTime: 600,
      });
      imageUrls.push(url);
    }

    // Call vision model for OCR
    const forwardHeaders = extractHeaders(request.headers);
    const llmClient = createLLMClient(forwardHeaders);

    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [
      { type: 'text', text: buildExtractPrompt(uploads.some(u => u.role === 'task')) },
    ];

    for (const url of imageUrls) {
      contentParts.push({
        type: 'image_url',
        image_url: { url, detail: 'high' },
      });
    }

    const response = await llmClient.invoke(
      [{ role: 'user', content: contentParts as unknown as string }],
      { model: MODEL_ID, temperature: 0.1 }
    );

    const extractedText = response.content.trim();

    return NextResponse.json({ text: extractedText });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
