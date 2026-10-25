import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let revision = 'unknown';
try { revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* Source archive. */ }
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: { __BUILD_INFO__: JSON.stringify({ version, revision, builtAt: new Date().toISOString() }) },
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: [
        '**/*.png',
        '**/*.jpg',
        '**/*.jpeg',
        '**/.chrome-profile/**',
        '**/.worktrees/**',
        '**/scripts/**'
      ]
    }
  }
});
