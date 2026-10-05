import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachingJSONMessages } from './coaching-json-retry';
import type { ContentPart } from './types';
const parts: ContentPart[] = [{ type: 'text', text: 'Return the complete target model in the specified JSON schema.' }, { type: 'image_url', image_url: { url: 'https://example.invalid/owned-chart.png', detail: 'high' } }];

test('malformed multiline modelText is retained exactly with the same prompt/image for one repair', () => {
  const malformed = '{"modelText":"The chart compares three cities.\n\nAlder remained highest."}';
  let parserError = '';
  try { JSON.parse(malformed); } catch (error) { parserError = (error as Error).message; }
  assert(parserError.includes('control character'), 'Fixture must reproduce the actual finalise JSON failure');
  const messages = coachingJSONMessages(parts, malformed, parserError);
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'user']);
  assert.deepEqual(messages[0].content, parts, 'The original task and image must be unchanged');
  assert.equal(messages[1].content, malformed, 'Send the actual malformed output, not invented assistant commentary');
  assert(typeof messages[2].content === 'string' && messages[2].content.includes(parserError));
  assert(typeof messages[2].content === 'string' && messages[2].content.includes('escaped newline sequences'));
});
test('schema failures keep real supported values and transport errors invent no assistant response', () => {
  const raw = '{"modelText":7}';
  const messages = coachingJSONMessages(parts, raw, 'modelText: expected string, received number');
  assert.equal(messages[1].content, raw);
  assert(typeof messages[2].content === 'string' && messages[2].content.includes('modelText: expected string, received number'));
  assert.deepEqual(coachingJSONMessages(parts), [{ role: 'user', content: parts }]);
  assert.deepEqual(coachingJSONMessages(parts, undefined, 'Network failed').map(message => message.role), ['user', 'user']);
});
