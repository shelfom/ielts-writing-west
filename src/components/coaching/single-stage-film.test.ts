import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStageFilm } from './single-stage-film';
import { phaseAt, type ExaminerStage } from '../theatre/theatre-engine';

const rewritten = [
  { id: 'revision3-p1', text: 'The buses, they is cheap.\nMost worker use it.' },
  { id: 'revision3-p2', text: 'However roads matter, too.' },
];
const stage: ExaminerStage = {
  criterion: 'gra', diagnosisZh: '测试', diagnosisEn: 'Test',
  paragraphs: [
    { paragraphId: 'revision3-p2', correctedText: 'However, roads matter too.', reasons: [] },
    { paragraphId: 'revision3-p1', correctedText: 'The buses are cheap.\nMost workers use them.', reasons: [] },
  ],
};

test('a saved single pass uses student rewrite IDs and reconstructs both exact endpoints', () => {
  const film = buildStageFilm(rewritten, stage);
  assert.deepEqual(film.input, rewritten);
  assert.equal(film.final[0].text, stage.paragraphs[1].correctedText);
  assert.equal(film.final[1].text, stage.paragraphs[0].correctedText);
  assert.equal(film.pieces['original-p1'], undefined);
  for (const paragraph of rewritten) {
    const pieces = film.pieces[paragraph.id];
    assert.equal(pieces.map(p => p.kind === 'same' ? p.text : p.before).join(''), paragraph.text);
    assert.equal(pieces.map(p => p.kind === 'same' ? p.text : p.after).join(''), film.final.find(p => p.id === paragraph.id)!.text);
  }
  // Final text follows saved input paragraph order, regardless of model return order.
  assert.equal(film.final.map(p => p.text).join('\n\n'), 'The buses are cheap.\nMost workers use them.\n\nHowever, roads matter too.');
});

test('insertions, deletions and punctuation remain progressive until their own saved shot', () => {
  const film = buildStageFilm(rewritten, stage);
  const edits = film.shots.filter(s => s.kind === 'edit');
  assert.ok(edits.some(s => !s.before));
  assert.ok(edits.some(s => !s.after));
  for (const shot of edits) {
    assert.equal(phaseAt(shot, shot.start).name, 'highlight');
    assert.equal(phaseAt(shot, shot.start + 700).name, 'strike');
    assert.equal(phaseAt(shot, shot.start + 1060).name, 'insert');
    assert.equal(phaseAt(shot, shot.end - 1).name, 'settle');
  }
  for (let index = 1; index < film.shots.length; index++) assert.equal(film.shots[index].start, film.shots[index - 1].end);
  assert.equal(film.shots[film.shots.length - 1].end, film.duration);
});

test('a gate pass with no needed changes has a valid diagnosis and unchanged saved result', () => {
  const film = buildStageFilm(rewritten, { ...stage, paragraphs: rewritten.map(p => ({ paragraphId: p.id, correctedText: p.text, reasons: [] })) });
  assert.equal(film.shots.length, 1);
  assert.equal(film.shots[0].kind, 'intro');
  assert.ok(film.duration > 0);
  assert.deepEqual(film.final, rewritten);
});

test('reject corrections for unknown, missing or duplicate saved paragraph IDs', () => {
  for (const paragraphs of [
    [stage.paragraphs[0]],
    [stage.paragraphs[0], stage.paragraphs[0]],
    [{ ...stage.paragraphs[0], paragraphId: 'original-p1' }, stage.paragraphs[1]],
  ]) assert.throws(() => buildStageFilm(rewritten, { ...stage, paragraphs }));
  assert.throws(() => buildStageFilm([rewritten[0], rewritten[0]], stage));
  assert.throws(() => buildStageFilm([], { ...stage, paragraphs: [] }));
});
