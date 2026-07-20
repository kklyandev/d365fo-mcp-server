/**
 * Knowledge-audit CLI (ROADMAP P1).
 *
 *   npm run eval:knowledge-audit            # verify against the committed snapshot (CI, VM-free)
 *   npm run eval:knowledge-audit -- --capture   # re-audit against the real symbol index (VM only)
 *   npm run eval:knowledge-audit -- --json
 *
 * --capture opens data/xpp-metadata.db (override with DB_PATH), resolves every
 * reference, prints the defect list and rewrites eval/knowledge-audit.snapshot.json.
 * The default (verify) mode needs no DB: it recomputes the reference set from
 * KNOWLEDGE_BASE and fails when any reference is missing from the snapshot —
 * so a knowledge edit cannot ship without being re-audited on the VM.
 *
 * Exit code 1 on any defect, so it drops straight into the eval-gate workflow.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { KNOWLEDGE_BASE } from '../../tools/xppKnowledge.js';
import { extractKnowledgeRefs } from './knowledgeRefs.js';
import {
  auditRefs, renderFindings, buildSnapshot, verifyAgainstSnapshot,
  type Allowlist, type AuditSnapshot, type SymbolLookup,
} from './knowledgeAudit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const SNAPSHOT_PATH = path.join(REPO_ROOT, 'eval', 'knowledge-audit.snapshot.json');
const ALLOW_PATH = path.join(REPO_ROOT, 'eval', 'knowledge-audit.allow.json');

/** AOT element types worth resolving a knowledge reference against. */
const ELEMENT_TYPES = [
  'class', 'table', 'enum', 'edt', 'interface', 'form', 'view', 'query', 'map',
  'report', 'macro', 'data-entity', 'service', 'configuration-key',
  'menu-item-display', 'menu-item-action', 'menu-item-output',
];

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/**
 * Loads the whole element-name table into memory once (~135k rows). A
 * per-name `COLLATE NOCASE` query would full-scan the 2 GB index for every
 * lookup (see memory/sqlite-query-antipatterns); one sequential pass over the
 * indexed `type` column is both correct and ~1000x cheaper here.
 */
async function openLookup(): Promise<{ lookup: SymbolLookup; indexedAt: string }> {
  const { default: Database } = await import('better-sqlite3');
  const dbPath = process.env.DB_PATH ?? path.join(REPO_ROOT, 'data', 'xpp-metadata.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`--capture needs the symbol index; not found at ${dbPath} (set DB_PATH).`);
  }
  const db = new Database(dbPath, { readonly: true });

  const byLower = new Map<string, { canonical: string; types: Set<string> }>();
  const placeholders = ELEMENT_TYPES.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT name, type FROM symbols WHERE type IN (${placeholders})`)
    .all(...ELEMENT_TYPES) as Array<{ name: string; type: string }>;
  for (const r of rows) {
    const key = r.name.toLowerCase();
    const hit = byLower.get(key);
    if (hit) hit.types.add(r.type);
    else byLower.set(key, { canonical: r.name, types: new Set([r.type]) });
  }

  // Tier-2 evidence: names that no symbol row owns, but real elements declare
  // as their base/interface. Scanned off the indexed `type` column, never a
  // full table scan.
  const referenced = new Set<string>();
  const baseRows = db
    .prepare(`SELECT extends_class, implements_interfaces FROM symbols WHERE type IN ('class','interface','table','form','view','map','query')`)
    .all() as Array<{ extends_class: string | null; implements_interfaces: string | null }>;
  for (const r of baseRows) {
    if (r.extends_class) referenced.add(r.extends_class.trim().toLowerCase());
    for (const i of (r.implements_interfaces ?? '').split(',')) {
      const t = i.trim().toLowerCase();
      if (t) referenced.add(t);
    }
  }

  const memberStmt = db.prepare(
    `SELECT name FROM symbols WHERE parent_name = ? AND type = 'method'`,
  );
  const memberCache = new Map<string, Set<string>>();

  const lookup: SymbolLookup = {
    resolve(name) {
      const hit = byLower.get(name.toLowerCase());
      return hit ? { canonical: hit.canonical, types: [...hit.types] } : null;
    },
    isReferencedBase(name) {
      return referenced.has(name.toLowerCase());
    },
    hasMember(canonical, member) {
      let set = memberCache.get(canonical);
      if (!set) {
        set = new Set((memberStmt.all(canonical) as Array<{ name: string }>).map(r => r.name.toLowerCase()));
        memberCache.set(canonical, set);
      }
      return set.has(member.toLowerCase());
    },
  };

  const meta = db.prepare(`SELECT value FROM _index_meta WHERE key = 'last_indexed_at'`).get() as
    | { value: string }
    | undefined;
  return { lookup, indexedAt: meta?.value ?? 'unknown' };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const capture = argv.includes('--capture');
  const asJson = argv.includes('--json');
  const refs = extractKnowledgeRefs(KNOWLEDGE_BASE);
  const allow = readJson<Allowlist>(ALLOW_PATH, {});

  if (!capture) {
    const snapshot = readJson<AuditSnapshot | null>(SNAPSHOT_PATH, null);
    if (!snapshot) {
      console.error(`❌ no snapshot at ${SNAPSHOT_PATH}. Run with --capture on the VM first.`);
      return 1;
    }
    const missing = verifyAgainstSnapshot(refs, snapshot);
    if (asJson) {
      console.log(JSON.stringify({ mode: 'verify', checked: refs.length, missing }, null, 2));
    } else {
      console.log(
        `Knowledge audit (verify) — ${refs.length} reference(s) vs snapshot captured ` +
        `${snapshot.capturedAt} against index ${snapshot.indexedAt}.`,
      );
      if (missing.length === 0) {
        console.log('✅ every reference in KNOWLEDGE_BASE is covered by an audited snapshot entry.');
      } else {
        console.log(`❌ ${missing.length} reference(s) not audited — re-run with --capture on the VM:`);
        for (const m of missing) console.log(`   ${m.entryId} · ${m.field} · ${m.kind} · ${m.name}${m.member ? `::${m.member}` : ''}`);
      }
    }
    return missing.length === 0 ? 0 : 1;
  }

  const { lookup, indexedAt } = await openLookup();
  const result = auditRefs(refs, lookup, allow);
  if (asJson) {
    console.log(JSON.stringify({ mode: 'capture', indexedAt, ...result }, null, 2));
  } else {
    console.log(renderFindings(result));
  }
  const snapshot = buildSnapshot(refs, result, indexedAt);
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  if (!asJson) console.log(`\nSnapshot written: ${path.relative(REPO_ROOT, SNAPSHOT_PATH)} (${snapshot.ok.length} clean reference(s)).`);
  return result.findings.length === 0 ? 0 : 1;
}

main().then(
  code => process.exit(code),
  err => {
    console.error(`❌ knowledge audit failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
