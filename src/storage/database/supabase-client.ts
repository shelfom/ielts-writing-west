import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getReportBuffer, createWrappedFetch } from 'coze-coding-dev-sdk';

// Project environment variables (Supabase/Bucket/LLM) are eagerly loaded by
// src/server.ts via the workload-identity OAuth2 token-exchange flow before
// Next.js boots, so handlers can read them synchronously here.

function getSupabaseClient(token?: string): SupabaseClient {
  const url = process.env.COZE_SUPABASE_URL;
  const anonKey = process.env.COZE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('COZE_SUPABASE_URL is not set');
  const resolvedKey = token ? anonKey : (serviceRoleKey ?? anonKey);
  if (!resolvedKey) throw new Error('COZE_SUPABASE_ANON_KEY/COZE_SUPABASE_SERVICE_ROLE_KEY not set');

  const globalOptions: Record<string, any> = {};
  if (token) globalOptions.headers = { Authorization: `Bearer ${token}` };
  try {
    const buffer = getReportBuffer();
    if (buffer) globalOptions.fetch = createWrappedFetch(buffer, 'supabase');
  } catch { /* silent */ }
  return createClient(url, resolvedKey, {
    global: globalOptions,
    db: { timeout: 60000 },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export { getSupabaseClient };
