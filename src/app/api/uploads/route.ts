import { NextRequest, NextResponse } from 'next/server';
import { getOwnerHash } from '@/lib/session';
import { getStorage } from '@/lib/storage';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const ALLOWED_MIMES = ['image/jpeg', 'image/png'];
const MAX_SIZE = 8 * 1024 * 1024; // 8MB
const MAX_ESSAY_PAGES = 3;

const MAGIC_BYTES: Record<string, Buffer> = {
  'image/jpeg': Buffer.from([0xFF, 0xD8, 0xFF]),
  'image/png': Buffer.from([0x89, 0x50, 0x4E, 0x47]),
};

function validateMagicBytes(buffer: Buffer, expectedMime: string): boolean {
  const magic = MAGIC_BYTES[expectedMime];
  if (!magic) return false;
  if (buffer.length < magic.length) return false;
  return buffer.subarray(0, magic.length).equals(magic);
}

export async function POST(request: NextRequest) {
  try {
    const ownerHash = await getOwnerHash();
    const formData = await request.formData();

    const files: { file: File; role: string }[] = [];
    const roles = formData.getAll('role');
    const fileEntries = formData.getAll('file');

    for (let i = 0; i < fileEntries.length; i++) {
      const file = fileEntries[i] as File;
      const role = (roles[i] as string) || 'essay';
      files.push({ file, role });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const essayFiles = files.filter(f => f.role === 'essay');
    if (essayFiles.length > MAX_ESSAY_PAGES) {
      return NextResponse.json({ error: `Maximum ${MAX_ESSAY_PAGES} essay pages allowed` }, { status: 400 });
    }

    const storage = getStorage();
    const uploadIds: string[] = [];
    const client = getSupabaseClient();

    for (const { file, role } of files) {
      if (!ALLOWED_MIMES.includes(file.type)) {
        return NextResponse.json({ error: `Invalid file type: ${file.type}. Only JPG/PNG allowed.` }, { status: 400 });
      }

      if (file.size > MAX_SIZE) {
        return NextResponse.json({ error: `File too large: ${file.name}. Maximum 8MB.` }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (!validateMagicBytes(buffer, file.type)) {
        return NextResponse.json({ error: `File content does not match declared type: ${file.name}` }, { status: 400 });
      }

      const prefix = role === 'task' ? 'task-images' : 'essay-pages';
      const storageKey = await storage.uploadFile({
        fileContent: buffer,
        fileName: `${prefix}/${file.name}`,
        contentType: file.type,
      });

      const { data, error } = await client
        .from('uploads')
        .insert({
          owner_hash: ownerHash,
          storage_key: storageKey,
          original_name: file.name,
          mime_type: file.type,
          role,
          size_bytes: file.size,
        })
        .select('id')
        .single();

      if (error) throw new Error(`DB insert failed: ${error.message}`);
      uploadIds.push(data.id);
    }

    return NextResponse.json({ uploadIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
