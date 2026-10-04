import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export function createLLMClient(forwardHeaders?: Record<string, string>): LLMClient {
  const config = new Config();
  return new LLMClient(config, forwardHeaders);
}

export function extractHeaders(headers: Headers): Record<string, string> {
  return HeaderUtils.extractForwardHeaders(headers as unknown as Request['headers']);
}

export const MODEL_ID = 'doubao-seed-2-0-pro-260215';
