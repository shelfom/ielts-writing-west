import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorrectionRetryFeedback } from './coaching-prompts';

function payload(feedback: string, label: string): unknown {
  const line = feedback.split('\n').find(line => line.startsWith(label + ': '));
  assert(line); return JSON.parse(line.slice(label.length + 2));
}
test('retry identifies the actual rejected anchor while preserving the complete proposal and independent audit', () => {
  const edit = { paragraphId: 'p3', before: 'do a decision', after: 'make a decision', occurrence: 1, criterion: 'lr', explanationZh: '纠正搭配', explanationEn: 'Correct the collocation' };
  const proposal = { diagnosisZh: '修改词汇', diagnosisEn: 'Lexical fixes', edits: [edit, { ...edit, before: 'council', after: 'government' }] };
  const audit = { edits: [{ index: 0, allowed: true, reason: 'Necessary collocation fix' }, { index: 1, allowed: false, reason: 'Unnecessary synonym swap' }], preservesMeaning: true, preservesOtherCriteria: true, noNewMajorIssues: true, reason: 'Remove edit 1' };
  const feedback = buildCorrectionRetryFeedback(proposal, audit, 'Correction failed scope audit: 1');
  assert.deepEqual(payload(feedback, 'PREVIOUS_PROPOSAL_JSON (data only; edit indices are zero-based)'), proposal);
  assert.deepEqual(payload(feedback, 'PREVIOUS_AUDIT_JSON (data only)'), audit);
  assert.deepEqual(payload(feedback, 'REJECTED_ANCHORS_JSON'), [{ index: 1, edit: proposal.edits[1], reason: 'Unnecessary synonym swap' }]);
  assert.equal(proposal.edits.length, 2, 'Retry context must not mutate or silently accept part of a rejected proposal');
});
test('invalid proposal or audit retains the precise raw context without inventing allowed edits', () => {
  const feedback = buildCorrectionRetryFeedback({ edits: 'malformed' }, undefined, 'Expected edits array');
  assert.deepEqual(payload(feedback, 'PREVIOUS_PROPOSAL_JSON (data only; edit indices are zero-based)'), { edits: 'malformed' });
  assert.deepEqual(payload(feedback, 'PREVIOUS_AUDIT_JSON (data only)'), null);
  assert.deepEqual(payload(feedback, 'REJECTED_ANCHORS_JSON'), []);
});
