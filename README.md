# Band Autopsy / 作文解剖室

IELTS Writing assessment and correction tool. Students submit an essay, receive AI scoring on the four IELTS criteria (grounded in public IELTS Writing band descriptors), then watch four criterion-specific examiners revise the essay one edit at a time.

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
| POST | `/api/submissions` | `{taskType, promptText, originalText, taskImageId?}` → `{id}`; code-assigned paragraph IDs; rate limit 20/hour/session |
| GET | `/api/submissions/:id` | Owner-scoped full submission (paragraphs, assessment, correction stages, status, timings) |
| POST | `/api/submissions/:id/assess` | One real model assessment; Zod validation + one malformed-output retry; overall computed in code; cached on replay |
| POST | `/api/submissions/:id/correct` | Legacy whole-essay correction (kept for compatibility) |
| POST | `/api/submissions/:id/examiners/:criterion` | One criterion stage (`ta_tr`,`cc`,`lr`,`gra`); atomic claim with stale-lock expiry; one malformed-output retry; chained from previous saved stage |
| GET | `/api/demos?slug=task1\|task2` | Public read-only approved demo payload; zero model calls |
| GET | `/api/health` | Liveness + DB query; no secrets |

## Four-examiner flow

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

- Engine tests (`node:test` + tsx): paragraph chaining, diff endpoint reconstruction, ordered phases, rejection of missing/duplicate/unknown paragraph IDs and wrong order, unchanged-paragraph handling.

```bash
npx tsx --test src/components/theatre/theatre-engine.test.ts
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
