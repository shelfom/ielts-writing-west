// Doubao Seed 2 Pro on Volcengine Ark (OpenAI-compatible chat completions).
// Needs ARK_API_KEY; ARK_BASE_URL and ARK_MODEL are optional overrides.

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'high' | 'low' };
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface LLMConfig {
  model?: string;
  thinking?: 'enabled' | 'disabled';
  caching?: 'enabled' | 'disabled';
  temperature?: number;
}

export const MODEL_ID = process.env.ARK_MODEL || 'doubao-seed-2-0-pro-260215';

const BASE_URL = (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
const TIMEOUT_MS = 10 * 60_000;

export class LLMClient {
  async invoke(messages: Message[], config: LLMConfig = {}): Promise<{ content: string }> {
    const key = process.env.ARK_API_KEY;
    if (!key) throw new Error('ARK_API_KEY is not set');
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: config.model || MODEL_ID,
        messages,
        temperature: config.temperature ?? 0.1,
        thinking: { type: config.thinking || 'disabled' },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Model request failed (${res.status}): ${json?.error?.message || 'no detail'}`);
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Model returned no content');
    return { content };
  }
}

export function createLLMClient(_forwardHeaders?: Record<string, string>): LLMClient {
  return new LLMClient();
}

// Kept so route handlers stay unchanged; Ark needs no forwarded headers.
export function extractHeaders(_headers: Headers): Record<string, string> {
  return {};
}
