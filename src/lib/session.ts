import { cookies } from 'next/headers';
import { createHash } from 'crypto';

const COOKIE_NAME = 'ba_owner';
const SALT = 'band_autopsy_v1';

export async function getOwnerHash(): Promise<string> {
  const cookieStore = await cookies();
  let ownerId = cookieStore.get(COOKIE_NAME)?.value;

  if (!ownerId) {
    const { randomUUID } = await import('crypto');
    ownerId = randomUUID();
    cookieStore.set(COOKIE_NAME, ownerId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });
  }

  return createHash('sha256').update(SALT + ownerId).digest('hex');
}
