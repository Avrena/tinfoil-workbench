import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) throw new Error('Use Node.js 22.12 or newer.');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// First bootstrap installs reviewed direct pins and writes a genuine transitive lockfile.
// Never fabricate a dependency lockfile in an offline environment.
const args = existsSync(join(root, 'package-lock.json')) ? ['ci'] :
  ['install'];
const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Dependencies installed. Review and commit package.json and package-lock.json before publishing.');
