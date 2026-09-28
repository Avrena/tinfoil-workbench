import { build } from 'esbuild';
import { cp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

/** Produces mobile-dist/, the Capacitor web directory for the Android app: the compiled renderer
 * from dist/ plus the Android bridge and host-worker bundles. Run `npm run build` first. */
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const out = 'mobile-dist';
if (!existsSync('dist/renderer/app.js')) { console.error('dist/ is missing. Run npm run build first.'); process.exit(1); }
if (!existsSync('dist/vendor/pdfjs/pdf.mjs')) { console.error('PDF.js is missing from dist/. Run npm run bootstrap, then npm run build.'); process.exit(1); }

await rm(out, { recursive: true, force: true });
await cp('dist', out, { recursive: true });

// Module scripts run in document order, so the bridge defines window.tinfoil before the renderer starts.
const marker = '<script type="module" src="/renderer/app.js"></script>';
const html = await readFile('src/renderer/index.html', 'utf8');
if (!html.includes(marker)) throw new Error('src/renderer/index.html no longer loads /renderer/app.js as expected.');
await writeFile(join(out, 'index.html'), html.replace(marker, '<script type="module" src="/mobile/bridge.js"></script>' + marker));

// The worker bundle includes the shared desktop service. Node built-ins are mapped to the small
// shims in mobile/shims; any other Node-only import is a build error rather than a runtime surprise.
const shims = { crypto: 'mobile/shims/node-crypto.mjs', zlib: 'mobile/shims/zlib.mjs' };
const nodeShims = {
  name: 'node-shims',
  setup(b) {
    b.onResolve({ filter: /^(node:)?(crypto|zlib)$/ }, args => ({ path: resolve(root, shims[args.path.replace(/^node:/, '')]) }));
  },
};
// Vendored Prism assigns module.exports only behind `typeof module !== 'undefined'`, which is
// false in the worker, so esbuild's CommonJS-in-ESM warning for it is expected.
const common = { bundle: true, platform: 'browser', target: 'es2022', legalComments: 'none', metafile: true, logLevel: 'warning', minify: true,
  logOverride: { 'commonjs-variable-in-esm': 'silent' } };
const bridge = await build({ ...common, entryPoints: ['mobile/bridge.mjs'], outfile: join(out, 'mobile/bridge.js'), format: 'esm' });
const host = await build({ ...common, entryPoints: ['mobile/host-worker.mjs'], outfile: join(out, 'mobile/host-worker.js'), format: 'iife',
  inject: ['mobile/shims/buffer.mjs'], plugins: [nodeShims] });

// Third-party notices for every npm package compiled into the two bundles.
const packages = new Map();
for (const result of [bridge, host]) for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.replaceAll('\\', '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//g);
  if (!match) continue;
  const path = match.join('').replace(/\/$/, '');
  if (!packages.has(path)) packages.set(path, match.at(-1).replace(/^node_modules\/|\/$/g, ''));
}
const notices = ['Third-party software compiled into the Tinfoil Workbench Android host bundles.',
  'Renderer components (KaTeX, Marked, Prism, PDF.js) keep their licenses under vendor/.', ''];
const listed = new Set();
for (const [path, name] of [...packages].sort((a, b) => a[1].localeCompare(b[1]))) {
  const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  if (listed.has(`${name}@${pkg.version}`)) continue; // nested copies of the same release
  listed.add(`${name}@${pkg.version}`);
  const licenseFile = (await readdir(path)).find(f => /^(licen[sc]e|copying)(\.|$)/i.test(f));
  notices.push('='.repeat(72), `${name} ${pkg.version} — ${typeof pkg.license === 'string' ? pkg.license : 'see license text'}`, '='.repeat(72));
  notices.push(licenseFile ? (await readFile(join(path, licenseFile), 'utf8')).trim() : 'No license file is included in the published package; see its package.json.', '');
}
await writeFile(join(out, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'));
const size = file => Math.round(statSync(file).size / 1024);
console.log(`Built ${out}/ for Android: bridge ${size(join(out, 'mobile/bridge.js'))} KiB, host worker ${size(join(out, 'mobile/host-worker.js'))} KiB, ${listed.size} bundled packages with notices.`);
