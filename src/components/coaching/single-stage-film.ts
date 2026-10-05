import { diffWordsWithSpace } from 'diff';
import type { ExaminerStage, Paragraph, Piece, Shot } from '../theatre/theatre-engine';

/** Every visible character comes from persisted input or persisted output. */
export function buildStageFilm(input: Paragraph[], stage: ExaminerStage) {
  const ids = new Set(input.map(p => p.id));
  if (!input.length || ids.size !== input.length || stage.paragraphs.length !== input.length ||
      new Set(stage.paragraphs.map(p => p.paragraphId)).size !== ids.size || stage.paragraphs.some(p => !ids.has(p.paragraphId))) {
    throw new Error('Saved correction does not match its input paragraphs.');
  }
  const final = input.map(p => ({ id: p.id, text: stage.paragraphs.find(v => v.paragraphId === p.id)!.correctedText }));
  const shots: Shot[] = [{ kind: 'intro', stageIndex: 0, start: 0, end: 2400, reasons: [] }];
  const pieces: Record<string, Piece[]> = {};
  let clock = 2400;
  input.forEach((paragraph, index) => {
    const parts = diffWordsWithSpace(paragraph.text, final[index].text);
    const output: Piece[] = [];
    for (let i = 0; i < parts.length;) {
      if (!parts[i].added && !parts[i].removed) { output.push({ kind: 'same', text: parts[i++].value }); continue; }
      let before = '', after = '';
      while (i < parts.length && (parts[i].added || parts[i].removed)) {
        if (parts[i].removed) before += parts[i].value;
        if (parts[i].added) after += parts[i].value;
        i++;
      }
      const reasons = stage.paragraphs.find(p => p.paragraphId === paragraph.id)!.reasons;
      const needle = before.trim().toLowerCase();
      const matching = reasons.filter(r => needle && (r.quote.toLowerCase().includes(needle) || needle.includes(r.quote.toLowerCase())));
      const insertDuration = Math.max(450, Math.min(1900, after.length * 26));
      output.push({ kind: 'edit', before, after, eventIndex: shots.length });
      shots.push({ kind: 'edit', stageIndex: 0, paragraphId: paragraph.id, before, after, start: clock,
        end: clock + 1400 + insertDuration, insertDuration, reasons: matching.length ? matching : reasons.slice(0, 1) });
      clock += 1400 + insertDuration;
    }
    pieces[paragraph.id] = output;
  });
  return { input, final, pieces, shots, duration: clock };
}
