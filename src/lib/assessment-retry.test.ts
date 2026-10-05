import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentMessages } from './assessment-retry';
import type { ContentPart } from './types';
const parts: ContentPart[] = [{ type: 'text', text: 'Assess the original chart essay.' }, { type: 'image_url', image_url: { url: 'https://example.invalid/owned-chart.png', detail: 'high' } }];

test('malformed assessment repair retains exact provider response, parse error and original vision context', () => {
  const malformed = '{"ta_tr":7,"cc":7,"lr":6,"gra":6,"diagnosisEn":"The phrase "chart compare" is incorrect."}';
  const error = "Expected ',' or '}' after property value in JSON at position 198 (line 6 column 149)";
  const messages = assessmentMessages(parts, malformed, error);
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'user']);
  assert.deepEqual(messages[0].content, parts);
  assert.equal(messages[1].content, malformed, 'Do not replace the malformed response with fabricated assistant commentary');
  assert(typeof messages[2].content === 'string' && messages[2].content.includes(error));
  assert.equal((messages[0].content as ContentPart[])[1].image_url?.url, 'https://example.invalid/owned-chart.png');
});
test('initial call and transport retry do not invent an assistant assessment', () => {
  assert.deepEqual(assessmentMessages(parts), [{ role: 'user', content: parts }]);
  const messages = assessmentMessages(parts, undefined, 'Provider connection failed');
  assert.deepEqual(messages.map(message => message.role), ['user', 'user']);
  assert(typeof messages[1].content === 'string' && messages[1].content.includes('Provider connection failed'));
});
