import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'editor.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
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

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(updated_at);
  `);
}

export function closeDb() {
  if (db) {
    db.close();
  }
}
