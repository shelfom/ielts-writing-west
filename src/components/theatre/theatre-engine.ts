import { diffWordsWithSpace } from 'diff';

export type Criterion = 'ta_tr' | 'cc' | 'lr' | 'gra';
export type Paragraph = { id: string; text: string };
export type Reason = { criterion: string; quote: string; explanationZh: string; explanationEn: string };
export type ExaminerStage = {
  criterion: Criterion;
  diagnosisZh: string;
  diagnosisEn: string;
  paragraphs: { paragraphId: string; correctedText: string; reasons: Reason[] }[];
};
export type Piece = { kind: 'same'; text: string } | { kind: 'edit'; before: string; after: string; eventIndex: number };
export type Shot = {
  kind: 'intro' | 'edit';
  stageIndex: number;
  paragraphId?: string;
  before?: string;
  after?: string;
  start: number;
  end: number;
  insertDuration?: number;
  reasons: Reason[];
};
export type Scene = { stage: ExaminerStage; before: Paragraph[]; after: Paragraph[]; pieces: Record<string, Piece[]>; introIndex: number };
export const ORDER: Criterion[] = ['ta_tr', 'cc', 'lr', 'gra'];

export function buildFilm(original: Paragraph[], stages: ExaminerStage[]) {
  if (stages.length !== 4) throw Error('All four examiner stages are required');
  if (!original.length || new Set(original.map(p => p.id)).size !== original.length) throw Error('Original paragraph IDs must be unique');
  let current = original.map(p => ({ ...p }));
  const shots: Shot[] = [], scenes: Scene[] = [];
  let clock = 0;
  for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
    const stage = stages[stageIndex];
    if (stage.criterion !== ORDER[stageIndex]) throw Error('Examiner order is invalid');
    if (stage.paragraphs.length !== original.length || new Set(stage.paragraphs.map(p => p.paragraphId)).size !== original.length)
      throw Error('Every examiner must return each paragraph exactly once');
    const before = current.map(p => ({ ...p }));
    const after = before.map(p => {
      const revised = stage.paragraphs.find(v => v.paragraphId === p.id);
      if (!revised) throw Error('Unknown or missing paragraph');
      return { id: p.id, text: revised.correctedText };
    });
    const introIndex = shots.length;
    shots.push({ kind: 'intro', stageIndex, start: clock, end: clock + 2600, reasons: [] });
    clock += 2600;
    const pieces: Record<string, Piece[]> = {};
    before.forEach((p, idx) => {
      const parts = diffWordsWithSpace(p.text, after[idx].text);
      const out: Piece[] = [];
      for (let i = 0; i < parts.length;) {
        const part = parts[i];
        if (!part.added && !part.removed) { out.push({ kind: 'same', text: part.value }); i++; continue; }
        let oldText = '', newText = '';
        while (i < parts.length && (parts[i].added || parts[i].removed)) {
          if (parts[i].removed) oldText += parts[i].value;
          if (parts[i].added) newText += parts[i].value;
          i++;
        }
        const eventIndex = shots.length;
        const allReasons = stage.paragraphs.find(v => v.paragraphId === p.id)!.reasons;
        const needle = oldText.trim().toLowerCase();
        const matches = allReasons.filter(r => needle.length > 1 && (r.quote.toLowerCase().includes(needle) || needle.includes(r.quote.toLowerCase())));
        const reasons = matches.length ? matches : allReasons.slice(0, 1);
        const insertDuration = Math.max(450, Math.min(1900, newText.length * 26));
        const duration = 650 + 400 + insertDuration + 350;
        shots.push({ kind: 'edit', stageIndex, paragraphId: p.id, before: oldText, after: newText, start: clock, end: clock + duration, insertDuration, reasons });
        clock += duration;
        out.push({ kind: 'edit', before: oldText, after: newText, eventIndex });
      }
      pieces[p.id] = out;
    });
    scenes.push({ stage, before, after, pieces, introIndex });
    current = after;
  }
  return { shots, scenes, final: current, duration: clock };
}

export function phaseAt(shot: Shot, position: number) {
  const elapsed = position - shot.start;
  if (shot.kind === 'intro') return { name: 'diagnosis', inserted: 0 };
  if (elapsed < 650) return { name: 'highlight', inserted: 0 };
  if (elapsed < 1050) return { name: 'strike', inserted: 0 };
  const fraction = Math.min(1, (elapsed - 1050) / (shot.insertDuration || 450));
  if (fraction < 1) return { name: 'insert', inserted: Math.ceil((shot.after?.length || 0) * fraction) };
  return { name: 'settle', inserted: shot.after?.length || 0 };
}
