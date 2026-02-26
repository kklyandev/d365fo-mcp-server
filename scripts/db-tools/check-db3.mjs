import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const db = new Database('./data/xpp-metadata.db', { readonly: true });
try {
  // Check if Asl* models are in the DB
  const aslModels = db.prepare("SELECT model, COUNT(*) as cnt FROM symbols WHERE model LIKE 'Asl%' GROUP BY model ORDER BY model").all();
  console.log('Asl* models in DB:');
  if (aslModels.length === 0) {
    console.log('  NONE - Asl* models are MISSING from symbols table!');
  } else {
    aslModels.forEach(m => console.log(`  ${m.model}: ${m.cnt}`));
  }
} catch(e) {
  console.error('Error:', e.message, e.code);
} finally {
  db.close();
}
