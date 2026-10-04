import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFilm, phaseAt, ORDER, type ExaminerStage } from './theatre-engine';

const original = [
  { id: 'p1', text: 'A bus carry people.' },
  { id: 'p2', text: 'It is affordable.' },
];

const texts = [
  'A bus carry people. It uses less space.',
  'A bus carry people. Therefore, it uses less space.',
  'A bus transport people. Therefore, it uses less space.',
  'A bus transports people. Therefore, it uses less space.',
];

const stages: ExaminerStage[] = ORDER.map((criterion, i) => ({
  criterion,
  diagnosisZh: '测试',
  diagnosisEn: 'Test',
  paragraphs: [
    { paragraphId: 'p1', correctedText: texts[i], reasons: [{ criterion, quote: 'carry', explanationZh: '测试', explanationEn: 'Test' }] },
    { paragraphId: 'p2', correctedText: original[1].text, reasons: [] },
  ],
}));

test('each examiner starts with previous saved essay; every diff reconstructs both endpoints', () => {
  const film = buildFilm(original, stages);
  for (const [i, scene] of film.scenes.entries()) {
    assert.deepEqual(scene.before, i ? film.scenes[i - 1].after : original);
    for (const p of scene.before) {
      const pieces = scene.pieces[p.id];
      assert.equal(pieces.map(v => v.kind === 'same' ? v.text : v.before).join(''), p.text);
      assert.equal(pieces.map(v => v.kind === 'same' ? v.text : v.after).join(''), scene.after.find(v => v.id === p.id)!.text);
    }
  }
  assert.equal(film.final[0].text, texts[3]);
  assert.equal(film.final[1].text, original[1].text);
  assert.deepEqual(film.scenes.map(v => v.stage.criterion), ORDER);
});

test('visible phases happen in order and replacement types progressively', () => {
  const film = buildFilm(original, stages);
  const s = film.shots.find(v => v.kind === 'edit')!;
  assert.equal(phaseAt(s, s.start).name, 'highlight');
  assert.equal(phaseAt(s, s.start + 700).name, 'strike');
  assert.equal(phaseAt(s, s.start + 1060).name, 'insert');
  assert.equal(phaseAt(s, s.end - 1).name, 'settle');
  assert.ok(phaseAt(s, s.start + 1060).inserted < (s.after || '').length);
  for (let i = 1; i < film.shots.length; i++) {
    assert.equal(film.shots[i].start, film.shots[i - 1].end);
  }
});

test('reject missing stages, wrong order, duplicate, missing and unknown paragraph IDs', () => {
  assert.throws(() => buildFilm(original, stages.slice(1)));
  assert.throws(() => buildFilm(original, [stages[1], stages[0], ...stages.slice(2)]));
  for (const paragraphs of [
    [stages[0].paragraphs[0]],
    [stages[0].paragraphs[0], stages[0].paragraphs[0]],
    [{ ...stages[0].paragraphs[0], paragraphId: 'unknown' }, stages[0].paragraphs[1]],
  ]) {
    assert.throws(() => buildFilm(original, [{ ...stages[0], paragraphs }, ...stages.slice(1)]));
  }
});

test('unchanged passages generate no edit events', () => {
  const unchanged = stages.map(s => ({
    ...s,
    paragraphs: original.map(p => ({ paragraphId: p.id, correctedText: p.text, reasons: [] })),
  }));
  const film = buildFilm(original, unchanged);
  assert.equal(film.shots.length, 4);
  assert.deepEqual(film.final, original);
});
