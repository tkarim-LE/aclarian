// Builds targets.json from FAC pulls saved on disk, for testing the page without Blob.
//   node scripts/build-local.mjs <out.json> <fac-year.json>...
import fs from 'node:fs';
import { merge, buildTargets } from '../lib/fac.js';

const [out, ...inputs] = process.argv.slice(2);
const store = { rows: {}, cursor: null };
for (const f of inputs) merge(store, JSON.parse(fs.readFileSync(f, 'utf8')));
const t = buildTargets(store);
fs.writeFileSync(out, JSON.stringify(t));
console.log(`${t.records.length} records, cursor ${t.cursor}`);
