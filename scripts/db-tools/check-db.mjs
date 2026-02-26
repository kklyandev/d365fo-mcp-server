import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const db = new Database('./data/xpp-metadata.db', { readonly: true });
try {
  console.log('Running integrity_check...');
  const result = db.pragma('integrity_check');
  console.log('Result:', JSON.stringify(result.slice(0, 20)));
  
  // Check FTS tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const ftsTables = tables.filter(t => t.name.includes('fts'));
  console.log('FTS tables:', ftsTables.map(t => t.name));
  
  const symbolCount = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get();
  console.log('Symbol count:', symbolCount.cnt);
} catch(e) {
  console.error('Error:', e.message, e.code);
} finally {
  db.close();
}
