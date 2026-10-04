import { pgTable, serial, timestamp, varchar, text, jsonb, integer, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const uploads = pgTable(
  "uploads",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    owner_hash: varchar("owner_hash", { length: 64 }).notNull(),
    storage_key: text("storage_key").notNull(),
    original_name: varchar("original_name", { length: 255 }).notNull(),
    mime_type: varchar("mime_type", { length: 50 }).notNull(),
    role: varchar("role", { length: 20 }).notNull(), // 'essay' | 'task'
    size_bytes: integer("size_bytes").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("uploads_owner_hash_idx").on(table.owner_hash),
    index("uploads_created_at_idx").on(table.created_at),
  ]
);

export const submissions = pgTable(
  "submissions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    owner_hash: varchar("owner_hash", { length: 64 }).notNull(),
    task_type: varchar("task_type", { length: 20 }).notNull(), // 'academic1' | 'general1' | 'task2'
    prompt_text: text("prompt_text").notNull(),
    original_text: text("original_text").notNull(),
    task_image_id: varchar("task_image_id", { length: 36 }),
    paragraphs: jsonb("paragraphs"), // [{id, text}]
    assessment: jsonb("assessment"), // {scores: {ta,tr,cc,lr,gra}, overall, diagnosisZh, diagnosisEn}
    correction: jsonb("correction"), // [{paragraphId, correctedText, reasons: [{criterion, quote, explanationZh, explanationEn}]}]
    playback: jsonb("playback"), // {events: [{paragraphId, type, timestamp, data}]}
    stage: varchar("stage", { length: 30 }).notNull().default("created"), // created|extracted|assessed|corrected|error
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending|processing|completed|error
    error_message: text("error_message"),
    provider_model: varchar("provider_model", { length: 100 }),
    assess_duration_ms: integer("assess_duration_ms"),
    correct_duration_ms: integer("correct_duration_ms"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("submissions_owner_hash_idx").on(table.owner_hash),
    index("submissions_stage_idx").on(table.stage),
    index("submissions_created_at_idx").on(table.created_at),
  ]
);
