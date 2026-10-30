import { randomUUID } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

// Uploaded images live on disk under DATA_DIR/files. Images are handed to the
// model and the browser as data: URLs, so nothing needs to be publicly hosted.

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const FILES_DIR = path.join(DATA_DIR, 'files');

function resolveKey(key: string): string {
  const full = path.resolve(FILES_DIR, key);
  if (!full.startsWith(path.resolve(FILES_DIR) + path.sep)) throw new Error('Invalid storage key');
  return full;
}

const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

class LocalStorage {
  async uploadFile({ fileContent, fileName }: { fileContent: Buffer; fileName: string; contentType?: string }): Promise<string> {
    const dir = path.dirname(fileName).replace(/[^a-z0-9-]/gi, '') || 'misc';
    const ext = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const key = `${dir}/${randomUUID()}${ext}`;
    const full = resolveKey(key);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, fileContent);
    return key;
  }

  async generatePresignedUrl({ key }: { key: string; expireTime?: number }): Promise<string> {
    const buffer = readFileSync(resolveKey(key));
    const mime = MIME_BY_EXT[path.extname(key).toLowerCase()]
      || (buffer[0] === 0x89 ? 'image/png' : 'image/jpeg');
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }
}

let storageInstance: LocalStorage | null = null;

export function getStorage(): LocalStorage {
  if (!storageInstance) storageInstance = new LocalStorage();
  return storageInstance;
}
