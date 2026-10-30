import { randomUUID } from 'crypto';
import { mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

// SQLite stand-in for the subset of the supabase-js query builder the API
// routes use (from/select/insert/upsert/update/eq/in/gte/limit/single/maybeSingle),
// so the routes keep their original code. The file lives in DATA_DIR, which
// must be a persistent volume in production.

type Row = Record<string, any>;
type Result = { data: any; error: { message: string } | null; count?: number | null };

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');

const TABLES: Record<string, { columns: string[]; json: string[]; defaults: () => Row }> = {
  uploads: {
    columns: ['id', 'owner_hash', 'storage_key', 'original_name', 'mime_type', 'role', 'size_bytes', 'created_at'],
    json: [],
    defaults: () => ({ id: randomUUID(), created_at: new Date().toISOString() }),
  },
  submissions: {
    columns: ['id', 'owner_hash', 'task_type', 'prompt_text', 'original_text', 'task_image_id', 'paragraphs', 'assessment',
      'correction', 'playback', 'stage', 'status', 'error_message', 'provider_model', 'assess_duration_ms',
      'correct_duration_ms', 'created_at', 'updated_at'],
    json: ['paragraphs', 'assessment', 'correction', 'playback'],
    defaults: () => {
      const now = new Date().toISOString();
      return { id: randomUUID(), stage: 'created', status: 'pending', created_at: now, updated_at: now };
    },
  },
  demos: {
    columns: ['slug', 'task_type', 'prompt_text', 'original_text', 'task_image_url', 'paragraphs', 'assessment', 'correction',
      'created_at', 'updated_at'],
    json: ['paragraphs', 'assessment', 'correction'],
    defaults: () => {
      const now = new Date().toISOString();
      return { created_at: now, updated_at: now };
    },
  },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, storage_key TEXT NOT NULL, original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL, role TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS uploads_owner_hash_idx ON uploads(owner_hash);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, task_type TEXT NOT NULL, prompt_text TEXT NOT NULL,
  original_text TEXT NOT NULL, task_image_id TEXT, paragraphs TEXT, assessment TEXT, correction TEXT, playback TEXT,
  stage TEXT NOT NULL DEFAULT 'created', status TEXT NOT NULL DEFAULT 'pending', error_message TEXT,
  provider_model TEXT, assess_duration_ms INTEGER, correct_duration_ms INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS submissions_owner_hash_idx ON submissions(owner_hash);
CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON submissions(created_at);
CREATE TABLE IF NOT EXISTS demos (
  slug TEXT PRIMARY KEY, task_type TEXT NOT NULL, prompt_text TEXT NOT NULL, original_text TEXT NOT NULL,
  task_image_url TEXT, paragraphs TEXT NOT NULL, assessment TEXT NOT NULL, correction TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, 'writing-west.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  seedDemos(db);
  return db;
}

// Demo essays ship with the code (data/demos.json) and are re-applied on boot.
function seedDemos(conn: DatabaseSync) {
  let demos: Row[] = [];
  try {
    demos = JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'demos.json'), 'utf8'));
  } catch { return; }
  const now = new Date().toISOString();
  const stmt = conn.prepare(`INSERT OR REPLACE INTO demos (slug, task_type, prompt_text, original_text, task_image_url,
    paragraphs, assessment, correction, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const d of demos) {
    const original = d.original_text ?? (d.paragraphs || []).map((p: Row) => p.text).join('\n\n');
    stmt.run(d.slug, d.task_type, d.prompt_text, original, d.task_image_url ?? null,
      JSON.stringify(d.paragraphs), JSON.stringify(d.assessment), JSON.stringify(d.correction), now, now);
  }
}

function encode(table: string, row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (!TABLES[table].columns.includes(k)) throw new Error(`Unknown column ${table}.${k}`);
    out[k] = TABLES[table].json.includes(k) && v !== null && v !== undefined ? JSON.stringify(v) : v ?? null;
  }
  return out;
}

function decode(table: string, row: Row): Row {
  const out: Row = { ...row };
  for (const k of TABLES[table].json) {
    if (typeof out[k] === 'string') out[k] = JSON.parse(out[k]);
  }
  return out;
}

class QueryBuilder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' = 'select';
  private replace = false;
  private cols = '*';
  private returning = false;
  private countOnly = false;
  private values: Row = {};
  private where: string[] = [];
  private params: any[] = [];
  private max?: number;
  private mode: 'many' | 'single' | 'maybe' = 'many';

  constructor(private table: string) {
    if (!TABLES[table]) throw new Error(`Unknown table ${table}`);
  }

  select(cols = '*', opts?: { count?: 'exact'; head?: boolean }) {
    this.cols = cols;
    if (this.op !== 'select') this.returning = true;
    if (opts?.head) this.countOnly = true;
    return this;
  }

  insert(values: Row) {
    this.op = 'insert';
    this.values = values;
    return this;
  }

  upsert(values: Row) {
    this.op = 'insert';
    this.replace = true;
    this.values = values;
    return this;
  }

  update(values: Row) {
    this.op = 'update';
    this.values = values;
    return this;
  }

  private column(name: string) {
    if (!TABLES[this.table].columns.includes(name)) throw new Error(`Unknown column ${this.table}.${name}`);
    return name;
  }

  eq(col: string, value: any) {
    if (value === null) this.where.push(`${this.column(col)} IS NULL`);
    else { this.where.push(`${this.column(col)} = ?`); this.params.push(value); }
    return this;
  }

  gte(col: string, value: any) {
    this.where.push(`${this.column(col)} >= ?`);
    this.params.push(value);
    return this;
  }

  in(col: string, values: any[]) {
    if (!values.length) this.where.push('0');
    else { this.where.push(`${this.column(col)} IN (${values.map(() => '?').join(', ')})`); this.params.push(...values); }
    return this;
  }

  limit(n: number) {
    this.max = n;
    return this;
  }

  single() {
    this.mode = 'single';
    return this;
  }

  maybeSingle() {
    this.mode = 'maybe';
    return this;
  }

  private selectList() {
    if (this.cols.trim() === '*') return '*';
    return this.cols.split(',').map(c => this.column(c.trim())).join(', ');
  }

  private whereSql() {
    return this.where.length ? ` WHERE ${this.where.join(' AND ')}` : '';
  }

  private run(): Result {
    const conn = getDb();
    let rows: Row[] = [];
    if (this.op === 'select') {
      if (this.countOnly) {
        const row = conn.prepare(`SELECT COUNT(*) AS n FROM ${this.table}${this.whereSql()}`).get(...this.params) as Row;
        return { data: null, error: null, count: Number(row.n) };
      }
      const limit = this.max !== undefined ? ` LIMIT ${Math.floor(this.max)}` : '';
      rows = conn.prepare(`SELECT ${this.selectList()} FROM ${this.table}${this.whereSql()}${limit}`).all(...this.params) as Row[];
    } else if (this.op === 'insert') {
      const row = encode(this.table, { ...TABLES[this.table].defaults(), ...this.values });
      const keys = Object.keys(row);
      const sql = `INSERT${this.replace ? ' OR REPLACE' : ''} INTO ${this.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
        + (this.returning ? ` RETURNING ${this.selectList()}` : '');
      rows = this.returning ? conn.prepare(sql).all(...Object.values(row)) as Row[] : (conn.prepare(sql).run(...Object.values(row)), []);
    } else {
      const row = encode(this.table, this.values);
      const keys = Object.keys(row);
      const sql = `UPDATE ${this.table} SET ${keys.map(k => `${k} = ?`).join(', ')}${this.whereSql()}`
        + (this.returning ? ` RETURNING ${this.selectList()}` : '');
      const args = [...Object.values(row), ...this.params];
      rows = this.returning ? conn.prepare(sql).all(...args) as Row[] : (conn.prepare(sql).run(...args), []);
    }
    const data = rows.map(r => decode(this.table, r));
    if (this.mode === 'many') return { data: this.op === 'select' || this.returning ? data : null, error: null };
    if (data.length > 1) return { data: null, error: { message: 'Multiple rows returned' } };
    if (this.mode === 'single' && data.length === 0) return { data: null, error: { message: 'No rows returned' } };
    return { data: data[0] ?? null, error: null };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    let result: Result;
    try {
      result = this.run();
    } catch (err) {
      result = { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function getSupabaseClient(_token?: string) {
  return { from: (table: string) => new QueryBuilder(table) };
}

export { getSupabaseClient };
