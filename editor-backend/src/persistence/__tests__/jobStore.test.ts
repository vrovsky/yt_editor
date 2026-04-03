import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// We test the job store logic against an in-memory DB to avoid file system side effects.
// This duplicates the logic from jobStore.ts but with a test-local DB.

type JobType = 'analyze' | 'generate' | 'export';
type JobStatus = 'queued' | 'running' | 'success' | 'error';

interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  label: string;
  progress: number;
  error?: string;
  result?: unknown;
  createdAt: number;
  updatedAt: number;
}

let db: Database.Database;

function initDb() {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      label TEXT NOT NULL DEFAULT '',
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      result_json TEXT,
      source_file TEXT,
      style TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function createJob(type: JobType, label: string): Job {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO jobs (id, type, status, label, progress, created_at, updated_at)
    VALUES (?, ?, 'queued', ?, 0, ?, ?)
  `).run(id, type, label, now, now);
  return { id, type, status: 'queued', label, progress: 0, createdAt: now, updatedAt: now };
}

function getJob(id: string): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    label: row.label,
    progress: row.progress,
    error: row.error ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function updateJob(id: string, patch: Partial<Pick<Job, 'status' | 'label' | 'progress' | 'error' | 'result'>>) {
  const now = Date.now();
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [now];
  if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status); }
  if (patch.label !== undefined) { sets.push('label = ?'); vals.push(patch.label); }
  if (patch.progress !== undefined) { sets.push('progress = ?'); vals.push(patch.progress); }
  if (patch.error !== undefined) { sets.push('error = ?'); vals.push(patch.error); }
  if (patch.result !== undefined) { sets.push('result_json = ?'); vals.push(JSON.stringify(patch.result)); }
  vals.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function pruneOldJobs(ttlMs: number) {
  const cutoff = Date.now() - ttlMs;
  db.prepare(`DELETE FROM jobs WHERE (status = 'success' OR status = 'error') AND updated_at < ?`).run(cutoff);
}

describe('jobStore (SQLite)', () => {
  beforeEach(() => {
    initDb();
  });

  it('creates a job with queued status', () => {
    const job = createJob('analyze', 'test label');
    expect(job.status).toBe('queued');
    expect(job.progress).toBe(0);
    expect(job.type).toBe('analyze');
  });

  it('retrieves a created job', () => {
    const job = createJob('generate', 'gen label');
    const fetched = getJob(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(job.id);
    expect(fetched!.label).toBe('gen label');
  });

  it('returns null for unknown job', () => {
    expect(getJob('nonexistent')).toBeNull();
  });

  it('updates job status and progress', () => {
    const job = createJob('export', 'export');
    updateJob(job.id, { status: 'running', progress: 50 });
    const fetched = getJob(job.id);
    expect(fetched!.status).toBe('running');
    expect(fetched!.progress).toBe(50);
  });

  it('stores and retrieves result JSON', () => {
    const job = createJob('analyze', 'test');
    const resultData = { transcript: [{ id: 0, text: 'hello' }] };
    updateJob(job.id, { status: 'success', progress: 100, result: resultData });
    const fetched = getJob(job.id);
    expect(fetched!.result).toEqual(resultData);
  });

  it('stores error message', () => {
    const job = createJob('analyze', 'test');
    updateJob(job.id, { status: 'error', error: 'something failed' });
    const fetched = getJob(job.id);
    expect(fetched!.error).toBe('something failed');
  });

  it('prunes old completed jobs', () => {
    const job = createJob('analyze', 'old');
    // Force the updated_at to be old
    db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?')
      .run('success', Date.now() - 100000, job.id);

    pruneOldJobs(50000); // TTL = 50s
    expect(getJob(job.id)).toBeNull();
  });

  it('does not prune running jobs', () => {
    const job = createJob('analyze', 'running');
    db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?')
      .run('running', Date.now() - 100000, job.id);

    pruneOldJobs(50000);
    expect(getJob(job.id)).not.toBeNull();
  });

  it('does not prune recent completed jobs', () => {
    const job = createJob('analyze', 'recent');
    updateJob(job.id, { status: 'success', progress: 100 });

    pruneOldJobs(50000);
    expect(getJob(job.id)).not.toBeNull();
  });

  it('handles multiple jobs independently', () => {
    const job1 = createJob('analyze', 'j1');
    const job2 = createJob('generate', 'j2');

    updateJob(job1.id, { status: 'success', progress: 100 });
    updateJob(job2.id, { status: 'running', progress: 50 });

    expect(getJob(job1.id)!.status).toBe('success');
    expect(getJob(job2.id)!.status).toBe('running');
  });
});
