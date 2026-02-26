/**
 * Repair script: drops the corrupt symbols_fts virtual table and recreates it empty.
 * After running this script, run `npm run build-database` to rebuild symbols + FTS.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/xpp-metadata.db';
console.log(`🔧 Repairing FTS index in: ${DB_PATH}`);

const db = new Database(DB_PATH);
try {
  db.pragma('journal_mode = WAL');

  // Drop the corrupt FTS virtual table (cascades to all shadow tables:
  // symbols_fts_data, symbols_fts_idx, symbols_fts_docsize, symbols_fts_config)
  console.log('🗑️  Dropping corrupt symbols_fts virtual table...');
  db.exec('DROP TABLE IF EXISTS symbols_fts;');
  console.log('   ✅ Dropped symbols_fts (+ shadow tables)');

  // Drop FTS triggers that reference the now-dropped table
  console.log('🗑️  Dropping FTS triggers...');
  db.exec('DROP TRIGGER IF EXISTS symbols_ai;');
  db.exec('DROP TRIGGER IF EXISTS symbols_au;');
  db.exec('DROP TRIGGER IF EXISTS symbols_ad;');
  console.log('   ✅ Dropped triggers');

  // Recreate the FTS virtual table (same schema as in symbolIndex.ts)
  console.log('🏗️  Recreating symbols_fts virtual table...');
  db.exec(`
    CREATE VIRTUAL TABLE symbols_fts USING fts5(
      name,
      type,
      parent_name,
      signature,
      description,
      tags,
      source_snippet,
      inline_comments,
      content='symbols',
      content_rowid='id'
    );
  `);
  console.log('   ✅ Recreated symbols_fts (empty)');

  // Populate FTS from existing symbols
  const symbolCount = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get();
  console.log(`\n📊 Populating FTS from ${symbolCount.cnt} existing symbols...`);
  db.exec("INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild');");
  console.log('   ✅ FTS index rebuilt from existing symbols');

  // Run integrity check on the FTS
  console.log('\n🔍 Running integrity_check...');
  const result = db.pragma('integrity_check(1)');
  const isOk = result.length === 1 && result[0].integrity_check === 'ok';
  console.log(`   ${isOk ? '✅ Database integrity OK' : '❌ Issues found: ' + JSON.stringify(result)}`);

  console.log('\n✅ Repair complete! Now run: npm run build-database');
} catch (e) {
  console.error('❌ Repair failed:', e.message);
  process.exit(1);
} finally {
  db.close();
}
