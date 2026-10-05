import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COACHING_RUBRIC } from './coaching-rubric';
import { advanceCriterion, applyAnchoredCorrection, failedReviewCount, initialCoaching, recordCorrection, recordReview, rewriteDraft, reopenCriterion, sentencesFor, validateDraft, validateReview, validateScopeAudit } from './coaching-validation';
import type { CoachingState, GateReview } from './coaching-types';
import type { Criterion } from './examiner-validation';

const paragraphs = [{ id: 'p1', text: 'Bus are useful. Bus are cheap.' }, { id: 'p2', text: 'They is helpful because people can travel.' }];
const text = paragraphs.map(p => p.text).join('\n\n');
function reviewFor(state: CoachingState, passed = true, id = 'review'): GateReview {
  return { id, criterion: state.currentCriterion, revision: state.revision, passed, checks: COACHING_RUBRIC[state.currentCriterion].map((rule, i) => ({ id: rule.id, passed: passed || i > 0, evidence: [{ paragraphId: state.paragraphs[0].id, quote: state.paragraphs[0].text }], reasonZh: '具体理由', reasonEn: 'Specific reason', actionZh: '具体行动', actionEn: 'Specific action' })), summaryZh: '总结', summaryEn: 'Summary', draftText: state.draftText, inputParagraphs: state.paragraphs, createdAt: new Date().toISOString(), duration_ms: 1, provider_model: 'test-fixture' };
}
function asCriterion(criterion: Criterion): CoachingState { return { ...initialCoaching(text, paragraphs, 7), currentCriterion: criterion }; }

test('a failed review changes no text, snapshots the draft, and pass is derived from checks', () => {
  const state = initialCoaching(text, paragraphs, 7);
  const falseClaim = { ...reviewFor(state, false), passed: true };
  const next = recordReview(state, falseClaim);
  assert.equal(next.phase, 'rewrite_required'); assert.equal(next.rounds[0].reviews[0].passed, false);
  assert.equal(next.draftText, text); assert.deepEqual(next.paragraphs, paragraphs); assert.equal(state.rounds[0].reviews.length, 0);
  assert.equal(next.rounds[0].reviews[0].draftText, text);
  assert.throws(() => recordCorrection(next, { criterion: 'ta_tr', diagnosisZh: 'x', diagnosisEn: 'x', paragraphs: [] }));
  assert.throws(() => recordReview(state, { ...falseClaim, revision: 9 }));
});

test('three distinct failed reviews pause, rewrites remain in history, identical cached review does not add attempt', () => {
  let state = initialCoaching(text, paragraphs, 7);
  state = recordReview(state, reviewFor(state, false, 'A'));
  state = rewriteDraft(state, text + ' A'); state = recordReview(state, reviewFor(state, false, 'B'));
  state = rewriteDraft(state, text); state = recordReview(state, reviewFor(state, false, 'A'));
  assert.equal(failedReviewCount(state), 2); assert.equal(state.phase, 'rewrite_required');
  state = rewriteDraft(state, text + ' C'); state = recordReview(state, reviewFor(state, false, 'C'));
  assert.equal(state.phase, 'practice_paused'); assert.equal(state.history.length, 4);
  assert.equal(state.history[0].text, text); assert.throws(() => rewriteDraft(state, text + ' D'));
});

test('gate evidence is exact and all three fixed checks must occur exactly once', () => {
  const state = initialCoaching(text, paragraphs, 7); const r = reviewFor(state);
  const raw = { checks: r.checks, summaryZh: r.summaryZh, summaryEn: r.summaryEn };
  assert.equal(validateReview(raw, paragraphs, 'ta_tr').checks.length, 3);
  assert.throws(() => validateReview({ ...raw, checks: [r.checks[0], r.checks[0], r.checks[2]] }, paragraphs, 'ta_tr'));
  assert.throws(() => validateReview({ ...raw, checks: r.checks.map((c, i) => i ? c : { ...c, passed: false, evidence: [{ paragraphId: 'p1', quote: 'Bus are nonsense' }] }) }, paragraphs, 'ta_tr'));
  assert.throws(() => validateReview({ ...raw, checks: r.checks.map((c, i) => i ? c : { ...c, passed: false, evidence: [] }) }, paragraphs, 'ta_tr'));
});

test('numerical grammar and lexical failure thresholds are enforced against real evidence', () => {
  const p = [{ id: 'p1', text: 'One sentence. Two sentence. Three sentence. Four sentence. Five sentence.' }, { id: 'p2', text: 'Six sentence.' }];
  const grammar = reviewFor(asCriterion('gra'));
  const raw = { checks: grammar.checks.map(c => ({ ...c, passed: c.id !== 'obstruction', evidence: c.id === 'obstruction' ? [{ paragraphId: 'p1', quote: 'One sentence.' }] : [] })), summaryZh: 'x', summaryEn: 'x' };
  assert.equal(sentencesFor(p).length, 6); assert.throws(() => validateReview(raw, p, 'gra'));
  raw.checks[1].evidence.push({ paragraphId: 'p1', quote: 'Two sentence.' }); assert.doesNotThrow(() => validateReview(raw, p, 'gra'));
  const lr = reviewFor(asCriterion('lr'));
  const lexical = { checks: lr.checks.map(c => ({ ...c, passed: c.id !== 'repeated_misuse', evidence: c.id === 'repeated_misuse' ? [{ paragraphId: 'p1', quote: 'Bus' }, { paragraphId: 'p1', quote: 'Bus' }, { paragraphId: 'p1', quote: 'Bus' }] : [] })), summaryZh: 'x', summaryEn: 'x' };
  assert.throws(() => validateReview(lexical, paragraphs, 'lr'));
  lexical.checks[1].evidence[2] = { paragraphId: 'p2', quote: 'They' }; assert.doesNotThrow(() => validateReview(lexical, paragraphs, 'lr'));
});

test('anchored edits preserve unrelated grammar byte for byte and reject overlap, absent anchors and scope violations', () => {
  const edit = { paragraphId: 'p1', before: 'useful', after: 'practical', occurrence: 1, criterion: 'lr', explanationZh: '测试', explanationEn: 'Test' };
  const raw = { diagnosisZh: '测试', diagnosisEn: 'Test', edits: [edit] };
  const result = applyAnchoredCorrection(raw, paragraphs, 'lr');
  assert.equal(result.stage.paragraphs[0].correctedText, 'Bus are practical. Bus are cheap.');
  assert.equal(result.stage.paragraphs[1].correctedText, paragraphs[1].text);
  assert.throws(() => applyAnchoredCorrection({ ...raw, edits: [edit, edit] }, paragraphs, 'lr'));
  assert.throws(() => applyAnchoredCorrection({ ...raw, edits: [{ ...edit, before: 'not here' }] }, paragraphs, 'lr'));
  assert.throws(() => applyAnchoredCorrection(raw, paragraphs, 'gra'));
  const audit = { edits: [{ index: 0, allowed: false, reason: 'Optional synonym swap' }], preservesMeaning: true, preservesOtherCriteria: true, noNewMajorIssues: true, explanationsAccurate: true, reason: 'Not a necessary correction' };
  assert.throws(() => validateScopeAudit(audit, 1));
  assert.doesNotThrow(() => validateScopeAudit({ ...audit, edits: [{ ...audit.edits[0], allowed: true }] }, 1));
  assert.throws(() => validateScopeAudit({ ...audit, edits: [] }, 1));
});

test('only a current passing review permits correction and ordered advancement', () => {
  let state = initialCoaching(text, paragraphs, 7);
  assert.throws(() => advanceCriterion(state));
  state = recordReview(state, reviewFor(state));
  const { stage } = applyAnchoredCorrection({ diagnosisZh: '无需修改', diagnosisEn: 'No changes needed', edits: [] }, paragraphs, 'ta_tr');
  state = recordCorrection(state, stage);
  assert.equal(state.phase, 'stage_complete'); assert.equal(state.revision, 1);
  assert.deepEqual(state.rounds[0].inputParagraphs, paragraphs);
  state = advanceCriterion(state); assert.equal(state.currentCriterion, 'cc'); assert.equal(state.phase, 'needs_review');
  assert.throws(() => recordCorrection(state, stage));
  assert.equal(state.history[0].source, 'original'); assert.equal(state.history[1].source, 'ta_tr');
});

test('essay limits enforce both words and characters including single unbroken text', () => {
  assert.throws(() => validateDraft('x'.repeat(40001)));
  assert.throws(() => validateDraft(Array(1501).fill('word').join(' ')));
  assert.equal(validateDraft(' A short essay. '), 'A short essay.');
});


test('earlier regression reopens its gate and clears later corrections without losing attempts or archives', () => {
  let state = initialCoaching(text, paragraphs, 7);
  state = recordReview(state, reviewFor(state, false, 'first-failure'));
  state = rewriteDraft(state, text + ' Better support.');
  state = recordReview(state, reviewFor(state, true, 'passing'));
  const { stage } = applyAnchoredCorrection({ diagnosisZh: '无需修改', diagnosisEn: 'No changes', edits: [] }, state.paragraphs, 'ta_tr');
  state = recordCorrection(state, stage); state = advanceCriterion(state);
  state = rewriteDraft(state, 'An unrelated holiday essay.');
  state = reopenCriterion(state, 'ta_tr');
  state = recordReview(state, reviewFor(state, false, 'regression'));
  assert.equal(state.currentCriterion, 'ta_tr'); assert.equal(state.phase, 'rewrite_required');
  assert.equal(state.rounds[0].correction, undefined); assert.equal(failedReviewCount(state), 2);
  assert.equal(state.rounds[0].reviews.length, 3); assert.equal(state.correctionHistory?.length, 1);
  assert.equal(state.draftText, 'An unrelated holiday essay.');
  assert.equal(state.history[0].text, text);
});

test('nested lexical quotes cannot inflate two actual misuses into three', () => {
  const p = [{ id: 'p1', text: 'We make a crime.' }, { id: 'p2', text: 'They make a crime.' }];
  const r = reviewFor(asCriterion('lr'));
  const raw = { checks: r.checks.map(c => ({ ...c, passed: c.id !== 'repeated_misuse', evidence: c.id === 'repeated_misuse' ? [
    { paragraphId: 'p1', quote: 'make a crime' }, { paragraphId: 'p1', quote: 'crime' }, { paragraphId: 'p2', quote: 'make a crime' },
  ] : [] })), summaryZh: 'x', summaryEn: 'x' };
  assert.throws(() => validateReview(raw, p, 'lr'));
});


test('correct grammar edits are rejected when the stage diagnosis teaches the wrong rule', () => {
  const validEditsAudit = { edits: [
    { index: 0, allowed: true, reason: 'Remove -s from depends because commuters is plural' },
    { index: 1, allowed: true, reason: 'Add -s to help because Investing is a singular gerund subject' },
  ], preservesMeaning: true, preservesOtherCriteria: true, noNewMajorIssues: true,
    explanationsAccurate: false, reason: 'The diagnosis wrongly claims both verbs lack third-person singular -s; the first edit removes -s.' };
  assert.throws(() => validateScopeAudit(validEditsAudit, 2), /both verbs lack/);
  assert.doesNotThrow(() => validateScopeAudit({ ...validEditsAudit, explanationsAccurate: true, reason: 'Diagnosis accurately identifies both as subject–verb agreement fixes' }, 2));
  const { explanationsAccurate, ...missingAccuracyCheck } = validEditsAudit;
  assert.equal(explanationsAccurate, false);
  assert.throws(() => validateScopeAudit(missingAccuracyCheck, 2), 'The independent accuracy check is required, never assumed true');
});
