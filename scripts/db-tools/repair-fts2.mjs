/**
 * Repair via writable_schema: surgically removes FTS entries from sqlite_master
 * when DROP TABLE fails due to corruption.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/xpp-metadata.db';
console.log(`🔧 Surgical FTS repair in: ${DB_PATH}`);

const db = new Database(DB_PATH);
try {
  // Enable writable schema - allows direct modification of sqlite_master
  db.pragma('writable_schema = ON');
  
  // List FTS-related entries in sqlite_master
  const ftsEntries = db.prepare(
    "SELECT type, name, tbl_name, rootpage FROM sqlite_master WHERE name LIKE 'symbols_fts%' OR name LIKE 'symbols_a%' ORDER BY name"
  ).all();
  console.log('FTS entries to remove:');
  ftsEntries.forEach(e => console.log(`  ${e.type} "${e.name}" (rootpage=${e.rootpage})`));
  
  if (ftsEntries.length === 0) {
    console.log('  Nothing to remove.');
  } else {
    // Delete all FTS-related entries from sqlite_master
    const deleted = db.prepare(
      "DELETE FROM sqlite_master WHERE name LIKE 'symbols_fts%' OR name IN ('symbols_ai', 'symbols_au', 'symbols_ad')"
    ).run();
    console.log(`\n🗑️  Removed ${deleted.changes} entries from sqlite_master`);
    
    // Increment the schema version to force SQLite to re-read schema
    db.pragma('schema_version = ' + (db.pragma('schema_version', { simple: true }) + 1));
    console.log('   ✅ Schema version bumped');
  }
  
  db.pragma('writable_schema = OFF');
  db.pragma('integrity_check(1)');
  
} catch (e) {
  console.error('❌ Failed:', e.message);
  process.exit(1);
} finally {
  db.close();
}

// Reopen and verify
console.log('\n🔍 Verifying repair...');
const db2 = new Database(DB_PATH);
try {
  const symbolCount = db2.prepare('SELECT COUNT(*) as cnt FROM symbols').get();
  console.log(`   symbols count: ${symbolCount.cnt}`);
  
  const tables = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log(`   tables: ${tables.map(t => t.name).join(', ')}`);
  
  console.log('\n✅ Repair complete! Now run: npm run build-database');
} catch(e) {
  console.error('❌ Verification failed:', e.message);
} finally {
  db2.close();
}
