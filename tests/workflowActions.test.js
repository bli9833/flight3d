import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const sha = 'a'.repeat(40);
function check(workflow) {
  const dir = mkdtempSync(join(process.cwd(), '.workflow-fixture-'));
  try {
    writeFileSync(join(dir, 'ci.yml'), workflow);
    return spawnSync(process.execPath, ['scripts/check-workflow-actions.mjs', dir], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const prefix = `jobs:\n  checks:\n    steps:\n      - uses: owner/action@${sha}\n`;
test('accepts pinned actions, local actions, and reusable workflows', () => {
  assert.equal(check(`${prefix}      - uses : './local/action'\n  reuse:\n    uses: owner/repo/.github/workflows/ci.yml@${sha}\n`).status, 0);
});
for (const entry of [
  '- uses : owner/action@main',
  '- "uses": owner/action@main',
  "- 'uses': owner/action@main",
  '- { uses: owner/action@main }',
  '- uses: >-\n          owner/action@main',
  '- uses: null',
  '- uses: ./../outside',
]) {
  test(`rejects unpinned or invalid reference: ${entry}`, () => {
    const result = check(`${prefix}      ${entry}\n`);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /full commit SHA/);
  });
}
test('rejects malformed YAML and workflows with no references', () => {
  assert.equal(check('jobs: [').status, 1);
  assert.equal(check('jobs: {}').status, 1);
});
