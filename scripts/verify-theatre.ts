import { buildFilm } from '../src/components/theatre/theatre-engine';

async function main() {
  for (const slug of ['task1','task2']) {
    const res = await fetch(`http://localhost:5000/api/demos?slug=${slug}`);
    const d = await res.json() as any;
    const film = buildFilm(d.paragraphs, d.correction.stages);
    const lastStage = d.correction.stages[3];
    const finals = film.final.map(p => p.text);
    const saved = d.paragraphs.map((p: any) =>
      lastStage.paragraphs.find((v: any) => v.paragraphId === p.id).correctedText
    );
    const ok = JSON.stringify(finals) === JSON.stringify(saved);
    console.log(slug, 'final==saved4th:', ok, '| shots:', film.shots.length, '| duration s:', Math.round(film.duration/1000));
    if (!ok) process.exit(1);
  }
}
main();
