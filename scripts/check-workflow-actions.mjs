// Parse workflow structure so YAML key formatting cannot bypass action pins.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const directory = process.argv[2] ?? '.github/workflows';
const failures = [];
let references = 0;
function inspect(value, location) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const path = `${location}.${key}`;
    if (key === 'uses') {
      references++;
      const local = typeof child === 'string' && /^\.\/[\w./-]+$/.test(child)
        && !child.split('/').includes('..');
      const pinned = typeof child === 'string' && /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/.test(child);
      if (!local && !pinned) failures.push(`${path}: action must use a full commit SHA`);
    } else {
      inspect(child, path);
    }
  }
}
for (const name of readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
  try {
    inspect(parse(readFileSync(join(directory, name), 'utf8')), name);
  } catch (error) {
    failures.push(`${name}: invalid workflow YAML: ${error.message}`);
  }
}
if (!references) failures.push('No workflow action references found; check the workflow directory.');
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Workflow action references pinned: ${references}`);
