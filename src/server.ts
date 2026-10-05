import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

// Eagerly load project env vars (Supabase / Bucket / LLM) before Next.js
// boots, so SSR and API handlers can read them synchronously. Implements
// the same OAuth2 token-exchange flow as the official Python
// coze_workload_identity SDK (client_credentials id_token -> token-exchange
// access_token -> GET /env) using only Node built-ins so we don't depend
// on Python being present in the production vefaas runtime.
async function loadProjectEnv(): Promise<void> {
  if (process.env.COZE_SUPABASE_URL && process.env.COZE_BUCKET_ENDPOINT_URL) return;

  // dotenv (local dev)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
  } catch { /* ignore */ }
  if (process.env.COZE_SUPABASE_URL && process.env.COZE_BUCKET_ENDPOINT_URL) return;

  const endpoint = process.env.COZE_OUTBOUND_AUTH_ENDPOINT;
  const clientId = process.env.COZE_WORKLOAD_IDENTITY_CLIENT_ID;
  const clientSecret = process.env.COZE_WORKLOAD_IDENTITY_CLIENT_SECRET;
  const tokenEndpoint = process.env.COZE_WORKLOAD_IDENTITY_TOKEN_ENDPOINT;
  const accessEndpoint = process.env.COZE_WORKLOAD_ACCESS_TOKEN_ENDPOINT;
  const lane = process.env.COZE_SERVER_ENV || process.env.COZE_PROJECT_ENV || 'prod';

  if (endpoint && clientId && clientSecret && tokenEndpoint && accessEndpoint) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const formBody = (obj: Record<string, string>) =>
        new URLSearchParams(obj).toString();

      // Step 1: obtain id_token via client_credentials
      const idRes = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-tt-env': lane,
        },
        body: formBody({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials',
        }),
        signal: ctrl.signal,
      });
      const idJson: any = await idRes.json().catch(() => ({}));
      const idToken = idJson?.access_token as string | undefined;
      if (!idToken) {
        console.error('[env] id_token exchange failed:', idRes.status, JSON.stringify(idJson).slice(0, 200));
      } else {
        // Step 2: exchange id_token for access_token
        const acRes = await fetch(accessEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-tt-env': lane,
          },
          body: formBody({
            client_id: clientId,
            subject_token: idToken,
            subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          }),
          signal: ctrl.signal,
        });
        const acJson: any = await acRes.json().catch(() => ({}));
        const accessToken = acJson?.access_token as string | undefined;
        if (!accessToken) {
          console.error('[env] access_token exchange failed:', acRes.status, JSON.stringify(acJson).slice(0, 200));
        } else {
          // Step 3: fetch env secrets
          const envRes = await fetch(`${endpoint.replace(/\/$/, '')}/env`, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'x-tt-env': lane,
            },
            signal: ctrl.signal,
          });
          const envJson: any = await envRes.json().catch(() => ({}));
          const pairs: Array<{ key: string; value: string }> =
            Array.isArray(envJson?.data?.secrets) ? envJson.data.secrets :
            Array.isArray(envJson?.secrets) ? envJson.secrets : [];
          let n = 0;
          for (const { key, value } of pairs) {
            if (key && typeof value === 'string' && !process.env[key]) {
              process.env[key] = value;
              n++;
            }
          }
          console.error(`[env] workload identity -> loaded ${n} vars, SUPABASE=${!!process.env.COZE_SUPABASE_URL}, BUCKET=${!!process.env.COZE_BUCKET_ENDPOINT_URL}`);
        }
      }
      clearTimeout(timer);
    } catch (err) {
      console.error('[env] workload identity flow failed:', (err as Error).message);
    }
  }

  if (process.env.COZE_SUPABASE_URL && process.env.COZE_BUCKET_ENDPOINT_URL) return;

  // Fallback: outbound-auth with raw WL key (kept for compatibility)
  if (endpoint) {
    const wlKey = process.env.COZE_WORKLOAD_IDENTITY_API_KEY;
    const wlToken = process.env.COZE_WORKLOAD_API_TOKEN || process.env.COZE_LOOP_API_TOKEN;
    const attempts: Array<[string, string]> = [];
    if (wlKey) {
      attempts.push(['Authorization', `Bearer ${wlKey}`]);
      attempts.push(['X-Workload-Api-Key', wlKey]);
    }
    if (wlToken) attempts.push(['Authorization', `Bearer ${wlToken}`]);
    for (const [header, value] of attempts) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${endpoint.replace(/\/$/, '')}/env`, {
          headers: { [header]: value, 'x-tt-env': lane },
          signal: ctrl.signal,
        });
        if (res.ok) {
          const data: any = await res.json();
          const pairs: Array<{ key: string; value: string }> =
            Array.isArray(data?.data?.secrets) ? data.data.secrets :
            Array.isArray(data?.secrets) ? data.secrets : [];
          let n = 0;
          for (const { key, value } of pairs) {
            if (key && typeof value === 'string' && !process.env[key]) {
              process.env[key] = value; n++;
            }
          }
          console.error(`[env] outbound-auth ${header} -> ${n} vars, SUPABASE=${!!process.env.COZE_SUPABASE_URL}`);
          if (process.env.COZE_SUPABASE_URL && process.env.COZE_BUCKET_ENDPOINT_URL) {
            clearTimeout(timer);
            return;
          }
        }
        clearTimeout(timer);
      } catch { /* next */ }
    }
  }
}

// Boot Next.js and start HTTP listener.
async function main() {
  await loadProjectEnv();

  const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
  const hostname = process.env.HOSTNAME || '0.0.0.0';
  const port = parseInt(process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000', 10);

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, hostname, () => {
    console.log(`> Server listening at http://${hostname}:${port} as ${dev ? 'development' : process.env.COZE_PROJECT_ENV}`);
  });
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
