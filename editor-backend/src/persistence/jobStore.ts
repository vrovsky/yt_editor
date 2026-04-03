import crypto from 'crypto';
import { getDb } from './db';

export type JobType = 'analyze' | 'generate' | 'export';
export type JobStatus = 'queued' | 'running' | 'success' | 'error';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  label: string;
  progress: number;
  error?: string;
  result?: unknown;
  sourceFile?: string;
  style?: string;
  createdAt: number;
  updatedAt: number;
}

interface JobRow {
  id: string;
  type: string;
  status: string;
  label: string;
  progress: number;
  error: string | null;
  result_json: string | null;
  source_file: string | null;
  style: string | null;
  created_at: number;
  updated_at: number;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    status: row.status as JobStatus,
    label: row.label,
    progress: row.progress,
    error: row.error ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    sourceFile: row.source_file ?? undefined,
    style: row.style ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJob(
  type: JobType,
  label: string,
  opts?: { sourceFile?: string; style?: string },
): Job {
  const id = crypto.randomUUID();
  const now = Date.now();
  const db = getDb();

  db.prepare(`
    INSERT INTO jobs (id, type, status, label, progress, source_file, style, created_at, updated_at)
    VALUES (?, ?, 'queued', ?, 0, ?, ?, ?, ?)
  `).run(id, type, label, opts?.sourceFile ?? null, opts?.style ?? null, now, now);

  return {
    id,
    type,
    status: 'queued',
    label,
    progress: 0,
    sourceFile: opts?.sourceFile,
    style: opts?.style,
    createdAt: now,
    updatedAt: now,
  };
}

export function getJob(id: string): Job | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function updateJob(id: string, patch: Partial<Pick<Job, 'status' | 'label' | 'progress' | 'error' | 'result'>>) {
  const db = getDb();
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

const JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function pruneOldJobs() {
  const db = getDb();
  const cutoff = Date.now() - JOB_TTL_MS;
  db.prepare(`
    DELETE FROM jobs
    WHERE (status = 'success' OR status = 'error')
      AND updated_at < ?
  `).run(cutoff);
}
