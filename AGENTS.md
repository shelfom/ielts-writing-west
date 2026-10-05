# AGENTS.md - 雅思写作西游记 / Writing Journey

## Current coaching flow (2026-10-05)

New submissions use persisted `correction.coaching` state and POST `/api/submissions/:id/coaching` actions (`review`, `rewrite`, `correct`, `advance`, `finalise`). Preserve original text and five scores. Each criterion has three published readiness checks; failed reviews change no text. After three distinct failed reviews, practice pauses without auto-passing. Later student rewrites recheck earlier gates to prevent stale passes. Real model corrections use exact anchored patches and a separate scope audit. Target-band models are separate from student drafts and independently estimated. Legacy saved theatre and demo routes remain compatible; legacy mutation routes reject coaching rows.

`src/lib/coaching-types.ts`, `coaching-rubric.ts`, `coaching-validation.ts`, and `coaching-prompts.ts` define the shared contract. UI lives in `src/components/coaching`. All progress/history uses existing JSONB, with no schema migration. Never replace production tables to deploy this change.

## Project Overview
IELTS Writing assessment and correction tool. Users submit essays, receive AI-powered scoring (4 IELTS criteria), and see sentence-by-sentence corrections with animated playback.

## Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19, TypeScript 5
- **UI**: Tailwind CSS 4, shadcn/ui components
- **Database**: PostgreSQL (Supabase)
- **Storage**: S3-compatible object storage (Coze managed)
- **AI**: doubao-seed-2.0-pro (via coze-coding-dev-sdk)

## Directory Structure
```
src/
├── app/
│   ├── api/
│   │   ├── health/route.ts          # GET /api/health
│   │   ├── uploads/route.ts         # POST /api/uploads (multipart)
│   │   ├── extract/route.ts         # POST /api/extract (OCR)
│   │   └── submissions/
│   │       ├── route.ts             # POST /api/submissions
│   │       └── [id]/
│   │           ├── route.ts         # GET /api/submissions/:id
│   │           ├── assess/route.ts  # POST /api/submissions/:id/assess
│   │           └── correct/route.ts # POST /api/submissions/:id/correct
│   ├── result/[id]/page.tsx         # Result page with scores & playback
│   ├── page.tsx                     # Main input page
│   ├── layout.tsx                   # Root layout
│   └── globals.css                  # Global styles + theme
├── components/
│   ├── LanguageContext.tsx           # EN/中文 toggle context
│   └── LangToggle.tsx               # Language toggle button
├── lib/
│   ├── session.ts                   # Anonymous owner session (cookie)
│   ├── storage.ts                   # S3 storage wrapper
│   ├── llm.ts                       # LLM client wrapper
│   ├── types.ts                     # TypeScript types
│   ├── prompts.ts                   # AI prompts (assessment/correction)
│   └── scoring.ts                   # Score calculation utilities
└── storage/database/
    ├── supabase-client.ts           # Supabase client (service_role_key)
    └── shared/schema.ts             # Drizzle schema
```

## API Contracts

### POST /api/uploads
- **Input**: multipart/form-data with `file` (File) and `role` ('essay'|'task')
- **Output**: `{ uploadIds: string[] }`
- **Validation**: JPG/PNG only, max 8MB per image, max 3 essay pages

### POST /api/extract
- **Input**: `{ uploadIds: string[] }`
- **Output**: `{ text: string }`
- **Note**: Uses vision model for OCR

### POST /api/submissions
- **Input**: `{ taskType: 'academic1'|'general1'|'task2', promptText: string, originalText: string, taskImageId?: string }`
- **Output**: `{ id: string }`
- **Validation**: promptText max 6000 chars, essay max 1500 words, rate limit 20/hour

### GET /api/submissions/:id
- **Output**: Full submission data with paragraphs, assessment, correction, playback events
- **Auth**: Owner-scoped via cookie

### POST /api/submissions/:id/assess
- **Output**: `{ scores: {ta_tr, cc, lr, gra}, overall, diagnosisZh, diagnosisEn, ... }`
- **Note**: Computes overall score server-side (not LLM)

### POST /api/submissions/:id/correct
- **Requires**: Assessment must exist first
- **Output**: `{ paragraphs: [{paragraphId, correctedText, reasons}], ... }`
- **Note**: Computes diff playback events server-side using diffWordsWithSpace

### GET /api/health
- **Output**: `{ status: 'ok', db: true }`

## Database Schema
- **uploads**: id, owner_hash, storage_key, original_name, mime_type, role, size_bytes, created_at
- **submissions**: id, owner_hash, task_type, prompt_text, original_text, task_image_id, paragraphs (JSONB), assessment (JSONB), correction (JSONB), playback (JSONB), stage, status, error_message, provider_model, assess_duration_ms, correct_duration_ms, created_at, updated_at

## Key Features
- **Anonymous ownership**: HttpOnly SameSite cookie, SHA-256 hashed
- **Bilingual UI**: EN/中文 toggle affects all UI text, scoring rationales, diagnosis
- **Correction playback**: Animated diff with strikethrough + fade-in replacements
- **Score computation**: Server-side rounding to nearest 0.5 (half-up)
- **Caching**: Existing assessments/corrections reused on retry
- **Concurrency guard**: Prevents duplicate processing requests

## Development Commands
```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm start        # Start production server
pnpm ts-check     # TypeScript type check
pnpm lint         # ESLint check
```

## Environment Variables
- `COZE_SUPABASE_URL`, `COZE_SUPABASE_ANON_KEY`, `COZE_SUPABASE_SERVICE_ROLE_KEY` - Database
- `COZE_BUCKET_ENDPOINT_URL`, `COZE_BUCKET_NAME` - Object storage
- `COZE_PROJECT_DOMAIN_DEFAULT` - Public domain
- `DEPLOY_RUN_PORT` - Server port (default 5000)

## Limitations
- No user authentication (anonymous session only)
- No PDF/Word export
- No multiple target language rewrites
- Single model (doubao-seed-2.0-pro) for all AI tasks
- Max 1500 words per essay
- Rate limit: 20 submissions/hour/session
