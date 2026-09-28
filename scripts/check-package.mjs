import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read-only check of a packaged app.asar: every packaged module's dependencies, the optional dependencies that
 * are installed, and its non-optional peer dependencies must resolve inside the archive. electron-builder packs
 * the production dependency tree but not peers that npm installed on its own; the attested SDK's dependencies
 * need such a peer (zod), and without it every connection of the packaged app failed while source runs passed. */
export function inspectPackage(archive, root) {
  const asar = createRequire(join(root, 'package.json'))('@electron/asar');
  const files = new Set(asar.listPackage(archive).map(f => f.split(sep).join('/')));
  const manifest = dir => { try { return JSON.parse(asar.extractFile(archive, (dir ? `${dir.slice(1)}/package.json` : 'package.json').split('/').join(sep)).toString('utf8')); } catch { return null; } };
  const packages = [...files].map(f => f.match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/@][^/]*)\/package\.json$/)?.[1]).filter(Boolean);
  // Node's lookup: the package's own node_modules, then each enclosing node_modules up to the archive root.
  const resolveIn = (from, name) => {
    for (let dir = from; ; dir = dir.slice(0, dir.lastIndexOf('/node_modules/'))) {
      if (files.has(`${dir}/node_modules/${name}/package.json`)) return true;
      if (!dir.includes('/node_modules/')) return false;
    }
  };
  const installed = name => existsSync(join(root, 'node_modules', name, 'package.json'));
  const missing = [];
  const check = (from, owner, pkg) => {
    const peers = pkg.peerDependenciesMeta ?? {};
    const needed = [
      ...Object.keys(pkg.dependencies ?? {}).map(name => [name, 'dependency']),
      ...Object.keys(pkg.optionalDependencies ?? {}).filter(installed).map(name => [name, 'installed optional dependency']),
      ...Object.keys(pkg.peerDependencies ?? {}).filter(name => peers[name]?.optional !== true).map(name => [name, 'peer dependency']),
    ];
    for (const [name, kind] of needed) if (!resolveIn(from, name)) missing.push(`${name} (${kind} of ${owner})`);
  };
  const app = manifest('');
  if (!app) return { ok: false, packages: packages.length, missing: ['package.json of the app'] };
  check('', 'the app', app);
  for (const dir of packages) { const pkg = manifest(dir); if (pkg) check(dir, `${pkg.name}@${pkg.version}`, pkg); }
  return { ok: missing.length === 0, packages: packages.length, missing: [...new Set(missing)].sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const archive = resolve(process.argv[2] ?? join(root, 'release', 'win-unpacked', 'resources', 'app.asar'));
  if (!existsSync(archive)) { console.error(`PACKAGE_CHECK_FAILED: ${archive} does not exist; package the app first.`); process.exit(1); }
  const result = inspectPackage(archive, root);
  if (!result.ok) { console.error(`PACKAGE_CHECK_FAILED: missing from the package:\n  ${result.missing.join('\n  ')}`); process.exit(1); }
  console.log(`PACKAGE_CHECK_OK: ${result.packages} packaged modules; every dependency and required peer resolves in the archive`);
}
