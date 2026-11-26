// Prints the `insert into document_types` statement generated from docs/route-list.csv.
// Usage: node scripts/gen-document-types-seed.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const csvPath = fileURLToPath(new URL('../docs/route-list.csv', import.meta.url));
const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
const header = lines.shift();
if (header !== 'document_type,office,requires_leave_dates') {
  throw new Error(`Unexpected header: ${header}`);
}

const q = (s) => `'${s.replaceAll("'", "''")}'`;
const rows = lines.map((line, i) => {
  const cols = line.split(',');
  if (cols.length !== 3) throw new Error(`Line ${i + 2}: expected 3 columns, got ${cols.length}`);
  const [name, office, flag] = cols;
  if (flag !== 'true' && flag !== 'false') throw new Error(`Line ${i + 2}: bad flag ${flag}`);
  return `  (${q(name)}, ${q(office)}, ${flag})`;
});

console.log(`insert into document_types (name, office, requires_leave_dates) values\n${rows.join(',\n')};`);
