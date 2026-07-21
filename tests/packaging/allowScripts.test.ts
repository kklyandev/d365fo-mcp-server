/**
 * `allowScripts` drift gate.
 *
 * npm 12 blocks package lifecycle scripts (preinstall/install/postinstall)
 * unless the root package.json pre-approves them by exact `name@version`.
 * better-sqlite3 is a native module: with its install script blocked, npm still
 * exits 0 and prints only a warning, the .node binding is never built, and the
 * failure surfaces much later as a runtime error far from the cause.
 *
 * The pins therefore have to track the lockfile. A dependency bump that does
 * not update `allowScripts` in the same commit would silently stop building the
 * binding for every user running the installer — this gate turns that into a
 * failing PR instead.
 *
 * Optional packages are exempt: fsevents is macOS-only and degrades to polling.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

interface LockEntry {
  version?: string;
  hasInstallScript?: boolean;
  optional?: boolean;
}

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  allowScripts?: Record<string, boolean>;
};
const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, LockEntry>;
};

const allowScripts = pkg.allowScripts ?? {};

/** `node_modules/foo` and `node_modules/a/node_modules/b` → `foo` / `b`. */
function packageName(lockPath: string): string {
  return lockPath.split('node_modules/').pop()!;
}

/** Every non-optional locked package whose install would run a script. */
const scriptPackages = Object.entries(lock.packages)
  .filter(([lockPath, entry]) => lockPath !== '' && entry.hasInstallScript && !entry.optional)
  .map(([lockPath, entry]) => ({ id: `${packageName(lockPath)}@${entry.version}`, lockPath }));

describe('allowScripts pins', () => {
  it('covers every non-optional package that runs an install script', () => {
    // Guards the extraction itself: better-sqlite3 always qualifies, so an
    // empty list would mean the lockfile shape changed and this gate went
    // vacuous rather than green.
    expect(scriptPackages.map(p => p.id)).toContain('better-sqlite3@12.11.1');

    const uncovered = scriptPackages.filter(p => allowScripts[p.id] !== true);
    expect(
      uncovered.map(p => p.id),
      '\nInstall scripts blocked under npm 12 — add each to "allowScripts" in package.json:\n' +
        uncovered.map(p => `  "${p.id}": true`).join('\n'),
    ).toEqual([]);
  });

  it('has no stale pin left behind by a dependency bump', () => {
    const locked = new Set(scriptPackages.map(p => p.id));
    const stale = Object.keys(allowScripts).filter(id => !locked.has(id));
    expect(
      stale,
      '\nThese "allowScripts" pins match nothing in package-lock.json — the ' +
        'dependency moved and the approval no longer applies:\n' +
        stale.map(id => `  ${id}`).join('\n'),
    ).toEqual([]);
  });
});
