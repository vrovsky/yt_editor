import * as fs from 'fs';
import * as path from 'path';

/**
 * Time-based retention for user media (uploads + exports). Files in `dir`
 * older than `maxAgeMs` (by mtime) are deleted. Returns the count removed.
 *
 * This complements pruneOldJobs() in jobStore, which only removes DB rows —
 * without this, uploaded videos would persist on disk indefinitely (a privacy
 * and disk-exhaustion issue). See legal/PRIVACY_POLICY.md §4 (Retention).
 */
export function pruneOldMedia(dir: string, maxAgeMs: number): number {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }

  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  for (const name of entries) {
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed += 1;
      }
    } catch {
      // Ignore files that vanish or can't be stat'd between readdir and unlink.
    }
  }

  return removed;
}
