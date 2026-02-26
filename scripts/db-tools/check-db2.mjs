import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const db = new Database('./data/xpp-metadata.db', { readonly: false });
try {
  // Find which table is "Tree 6" (rootpage=6)
  const tables = db.prepare("SELECT type, name, rootpage FROM sqlite_master ORDER BY rootpage").all();
  console.log('Tables with rootpage <= 20:');
  tables.filter(t => t.rootpage <= 20).forEach(t => console.log(`  rootpage=${t.rootpage} type=${t.type} name=${t.name}`));
  
  // Check if symbols table is intact  
  const symbolCount = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get();
  console.log('\nSymbol count:', symbolCount.cnt);
  
  // Check model distribution
  const models = db.prepare("SELECT model, COUNT(*) as cnt FROM symbols GROUP BY model ORDER BY cnt DESC LIMIT 10").all();
  console.log('\nTop models:');
  models.forEach(m => console.log(`  ${m.model}: ${m.cnt}`));
  
} catch(e) {
  console.error('Error:', e.message, e.code);
} finally {
  db.close();
}
