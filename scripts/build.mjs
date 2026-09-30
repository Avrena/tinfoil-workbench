import { mkdir, rm, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
await rm('dist', { recursive: true, force: true });
const local = 'node_modules/typescript/bin/tsc';
const result = existsSync(local)
  ? spawnSync(process.execPath, [local, '-p', 'tsconfig.json'], { stdio: 'inherit' })
  : spawnSync(process.platform === 'win32' ? 'tsc.cmd' : 'tsc', ['-p', 'tsconfig.json'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) { console.error('TypeScript build failed. Install dependencies first.'); process.exit(1); }
await cp('src/vendor', 'dist/vendor', { recursive: true });
await mkdir('dist', { recursive: true });
await copyFile('src/renderer/index.html', 'dist/index.html');
// The approval window's page and styles (desktop/approval-window.mjs); its script is compiled with the rest.
await copyFile('src/renderer/approval.html', 'dist/approval.html');
// Colours are theme tokens; the Workbench dark values come first as the defaults, until the page applies the user's
// theme (src/core/themes.ts), and in the approval window, which gets the theme from the main process.
const { themeTokens, tokenRule, THEME_PRESETS } = await import(new URL('../dist/core/themes.js', import.meta.url).href);
const defaults = tokenRule(':root', themeTokens(THEME_PRESETS[0].dark, 'dark')).replace('{', '{color-scheme:dark;') + '\n';
await writeFile('dist/approval.css', defaults + await readFile('src/renderer/approval.css', 'utf8'));
// Keep a dedicated spacing layer, bundled into the same local stylesheet.
await writeFile('dist/style.css', defaults + (await readFile('src/renderer/style.css', 'utf8')) + '\n' + (await readFile('src/renderer/spacing.css', 'utf8')));
console.log('Built TypeScript core and renderer.');

if (existsSync('node_modules/pdfjs-dist/build/pdf.mjs')) {
  await mkdir('dist/vendor/pdfjs',{recursive:true});
  for (const name of ['pdf.mjs','pdf.worker.mjs']) await copyFile('node_modules/pdfjs-dist/build/'+name,'dist/vendor/pdfjs/'+name);
  await copyFile('node_modules/pdfjs-dist/LICENSE','dist/vendor/pdfjs/LICENSE');
} else { console.warn('PDF.js is not installed. Run npm run bootstrap before using desktop PDF preview.'); }
