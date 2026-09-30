import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read-only preflight. Never installs packages, starts Python, reads credentials,
 * or treats source-only validation as a native desktop pass. */
export function inspect(root, { sourceOnly = false, nodeVersion = process.versions.node, platform = process.platform } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, status: ok ? 'pass' : 'fail', detail });
  const json = path => { try { return JSON.parse(readFileSync(join(root,path),'utf8')); } catch { return null; } };
  const pkg = json('package.json');
  const [major, minor] = nodeVersion.split('.').map(Number);
  add('Node.js', major > 22 || major === 22 && minor >= 12, `${nodeVersion}; requires 22.12 or newer`);
  add('Package metadata', !!pkg && pkg.private === true && pkg.main === 'desktop/main.mjs', 'Private source package with a fixed desktop entry point');
  const pins = { ...pkg?.dependencies, ...pkg?.devDependencies };
  add('Direct dependency pins', Object.keys(pins).length >= 5 && Object.values(pins).every(v => /^\d+\.\d+\.\d+$/.test(v)), 'Exact versions required; latest/ranges are not accepted for this handoff');
  for (const path of ['desktop/main.mjs','desktop/preload.cjs','desktop/approval-preload.cjs','desktop/approval-window.mjs','desktop/python-find.mjs','src/renderer/approval.html','desktop/close-coordinator.mjs','src/renderer/app.ts','src/renderer/index.html','assets/icon.ico','tsconfig.json']) {
    add(path, existsSync(join(root,path)), 'Required source/build input');
  }
  if (!sourceOnly) {
    const lock = json('package-lock.json');
    add('Dependency lockfile', !!lock && lock.lockfileVersion >= 3, 'Run npm run bootstrap; review and commit the generated package-lock.json');
    if (lock) {
      const rootLock=lock.packages?.[''];
      const rootPins={...rootLock?.dependencies,...rootLock?.devDependencies};
      add('Lockfile matches direct pins',Object.entries(pins).every(([name,version])=>rootPins[name]===version && lock.packages?.['node_modules/'+name]?.version===version),'Stale lockfiles must be deliberately regenerated and reviewed; they are not replaced by doctor');
    }
    for (const [name, version] of Object.entries(pins)) {
      const installed=json('node_modules/'+name+'/package.json');
      add(name, installed?.version===version, `Expected ${version}; ${installed?.version ? 'installed '+installed.version : 'not installed'}`);
    }
    for (const path of ['node_modules/typescript/bin/tsc','node_modules/pdfjs-dist/build/pdf.mjs','node_modules/pdfjs-dist/build/pdf.worker.mjs','node_modules/pdfjs-dist/LICENSE']) {
      add(path,existsSync(join(root,path)),'Required local tool or bundled PDF resource');
    }
    const executable = platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
    const binary=join(root,'node_modules/electron/dist',executable);
    add('Electron binary',existsSync(binary) && statSync(binary).isFile(),'The install lifecycle must download Electron; --ignore-scripts alone does not produce a runnable app');
  }
  return { version: pkg?.version??'unknown', mode: sourceOnly?'source-only':'local-dependencies', platform, checks, ok:checks.every(c=>c.status==='pass'),
    notChecked:['Windows DPAPI','native window lifecycle','live sign-in and inference','installer/signature','physical mobile devices','transitive dependency security audit'],
    notes:['Custom system prompt: optional and not required.','Python is optional for chat and visualization; no interpreter is started by doctor.','Native and live checks must still run even when all entries pass.'] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const result=inspect(root,{sourceOnly:process.argv.includes('--source')});
  if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));
  else {
    console.log(`Tinfoil Workbench ${result.version} — ${result.mode}`);
    for(const c of result.checks)console.log(`${c.status==='pass'?'PASS':'FAIL'}  ${c.name}: ${c.detail}`);
    console.log('\n'+result.notes.join('\n'));
    console.log('Not checked: '+result.notChecked.join(', ')+'.');
  }
  process.exitCode=result.ok?0:1;
}
