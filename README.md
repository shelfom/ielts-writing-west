# 雅思写作西游记 / IELTS Writing West

过四关，让作文脱胎换骨。

IELTS writing practice with four fictional AI coaches: patient Tang Sanzang (Task Achievement/Response), sharp Sun Wukong (Coherence & Cohesion), friendly Zhu Bajie (Lexical Resource), and concise Sha Wujing (Grammatical Range & Accuracy). Students receive original scores, rewrite serious problems themselves, and unlock a small correction only after passing the current examiner's published checks.

## Coaching policy

New submissions use `ta_tr → cc → lr → gra`. Each examiner has three fixed checks in `src/lib/coaching-rubric.ts`. All three must pass; a requested Band 7, 8 or 9 does not move the gate. These are teaching rules informed by the [official descriptors](https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf), not official IELTS cutoffs.

- Failed reviews return reasons, exact source highlights and rewrite tasks. They do not change the essay.
- Students save a revision directly in the editor, then request another review. Original text/scores and revision history remain saved.
- A later student rewrite rechecks earlier gates. If it undoes a previous pass, that examiner reopens; old reviews and correction snapshots stay archived.
- Three unsuccessful reviews at one examiner end the exercise as **practice unfinished**, with the remaining action plan. No automatic pass or hidden bypass.
- A passing review unlocks a correction limited to that criterion. Literal source patches are applied in code and audited for scope before saving. The saved before/after text drives playback.
- Each next examiner requires an explicit advance. After grammar, the student's revised draft stays separate from an AI reference version targeting the selected band. The reference receives an independent estimate; it is never automatically awarded the requested score.

Coaching progress is stored in the existing `submissions.correction.coaching` JSONB document, including immutable reviewed drafts and revision history. This release needs no schema migration or replacement of production rows. Old saved results and public demos retain their original replay format.

## Model / integration configuration

- **Model**: `doubao-seed-2-0-pro-260215` (Doubao Seed 2 Pro, multimodal) via `coze-coding-dev-sdk`
  - Vision OCR, chart-informed assessment, and four examiner stages all call this model
  - `thinking: 'disabled'` and `caching: 'disabled'` on bounded calls
- **Database**: managed PostgreSQL (Supabase), accessed with the service-role key server-side. RLS enabled.
- **Storage**: managed S3-compatible private object storage for uploads; presigned URLs generated server-side
- All credentials are read from environment variables; none are committed to the repository.

Required environment variables (provided by the platform):

- `COZE_SUPABASE_URL`, `COZE_SUPABASE_ANON_KEY`, `COZE_SUPABASE_SERVICE_ROLE_KEY`
- `COZE_BUCKET_ENDPOINT_URL`, `COZE_BUCKET_NAME`
- `DEPLOY_RUN_PORT`
- `COZE_PROJECT_DOMAIN_DEFAULT`

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/uploads` | Multipart upload (`file`, `role=essay\|task`); magic-byte validation, JPG/PNG, max 8MB, max 3 essay pages; returns `{uploadIds}` |
| POST | `/api/extract` | `{uploadIds}` → real vision OCR, `{text}`; preserves errors, never corrects |
| POST | `/api/submissions` | `{taskType, promptText, originalText, taskImageId?, targetBand?}` → `{id}`; target 7/8/9, default 7; code-assigned paragraph IDs; rate limit 20/hour/session |
| GET | `/api/submissions/:id` | Owner-scoped full submission (paragraphs, assessment, correction stages, status, timings) |
| POST | `/api/submissions/:id/assess` | One real model assessment; Zod validation + one malformed-output retry; overall computed in code; cached on replay |
| POST | `/api/submissions/:id/coaching` | `{action,revision,text?}`; actions `review`, `rewrite`, `correct`, `advance`, `finalise`; owner, current revision, phase and gate checked server-side |
| POST | `/api/submissions/:id/correct` | Legacy correction; rejects coaching submissions |
| POST | `/api/submissions/:id/examiners/:criterion` | Legacy sequential stage; rejects coaching submissions |
| GET | `/api/demos?slug=task1\|task2` | Public read-only approved demo payload; zero model calls |
| GET | `/api/health` | Liveness + DB query; no secrets |

## Original scoring and legacy replay

1. Assessment scores the **original essay only**. Four equally weighted integer criterion estimates; overall = average rounded to nearest 0.5 (half-up) in server code. Labelled an estimate, not an official IELTS score.
2. Four stages run in fixed order `ta_tr → cc → lr → gra`. Each stage:
   - takes the previous saved stage's document as input,
   - changes only its own remit and retains the student's position/meaning,
   - returns exactly every code-assigned paragraph ID once,
   - records real bilingual diagnosis, per-reason explanations, `duration_ms`, `provider_model`.
3. `src/components/theatre/theatre-engine.ts` computes `diffWordsWithSpace` between consecutive saved stages (never model offsets). The rendered document changes in phases: highlight → strike → type replacement → commit. The final reconstructed document equals the saved fourth stage.

## Public demos

- `/demo/task1` — Academic Task 1 (bar chart; chart also published at `/demo-chart.png`)
- `/demo/task2` — Task 2 essay
- Both rows were seeded with real assessment + four real model stages via the server-only script (`scripts/seed-demos.ts`); there is no public write path. Replay makes zero model calls and works in a brand-new browser session.

## Local development

```bash
pnpm install
pnpm dev          # development server on ${DEPLOY_RUN_PORT:-5000}
pnpm ts-check     # TypeScript check
pnpm lint         # ESLint
pnpm build        # production build

# Seed/replace demo rows (real model calls; server-only)
npx tsx scripts/seed-demos.ts [task1|task2]
```

## Migrations

Schema is defined in Drizzle (`src/storage/database/shared/schema.ts`) and applied with the platform DB tooling. Tables: `uploads`, `submissions`, `demos`. RLS is enabled on all tables; the service-role client is used only server-side.

## Tests

- Gate tests: evidence matching, numerical thresholds, three-failure cap, cached text, correction scope, ordered transitions and reopening earlier gates.
- Playback tests: original and student-rewritten paragraph IDs, exact endpoint reconstruction, progressive insertions/deletions, zero-edit passes, invalid saved data.

```bash
pnpm exec tsx --test src/lib/coaching-validation.test.ts src/components/coaching/single-stage-film.test.ts src/components/theatre/theatre-engine.test.ts
```

## Recorded processing times (this environment)

- Task 1 demo: assessment ~11s; stages ~13/12/10/10s
- Task 2 demo: assessment ~9s; stages ~31/18/16/28s
- Cached stage replay: sub-second; non-owner requests: 404

## Limitations

- Anonymous cookie ownership only; no login/accounts
- Single model; no provider choice
- Max 1500 words/essay; prompt max 6000 chars; rate limit 20 submissions/hour/session
- No PDF/Word export, no multiple target-language rewrites
- Scores are model estimates, not examiner-certified official IELTS results
- Synchronous stage endpoints; each stage is separately resumable
