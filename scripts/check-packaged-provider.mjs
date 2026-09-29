import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Release gate, run by the packaged executable itself in Node mode so that modules resolve from app.asar as they do
 * in the app. The SDK loads some of its modules only while it verifies an enclave, which the offline smoke test
 * cannot reach. This verifies the live enclave with a placeholder key and lists its models, then verifies Tinfoil's
 * cloud sync enclave through the packaged cloud client. It sends no prompt and no sync request, is not billed, and
 * uses no account or chat key.
 *
 *   $env:ELECTRON_RUN_AS_NODE = '1'
 *   & 'release\win-unpacked\Tinfoil Workbench.exe' scripts\check-packaged-provider.mjs
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const archive = resolve(process.argv[2] ?? join(root, 'release', 'win-unpacked', 'resources', 'app.asar'));
const fail = message => { console.error(`PACKAGED_PROVIDER_FAILED: ${message}`); process.exit(1); };
if (!process.versions.electron || !process.resourcesPath) fail('run this with the packaged executable and ELECTRON_RUN_AS_NODE=1, not with Node.');
if (!existsSync(archive)) fail(`${archive} does not exist; package the app first.`);
const describe = error => `${error?.code ?? error?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 300)}`;
let client;
try {
  const { createProvider } = await import(pathToFileURL(join(archive, 'desktop', 'provider.mjs')).href);
  client = await createProvider('packaged-check-placeholder-key', randomUUID() + randomUUID());
  await client.ready();
} catch (error) { fail(`verification: ${describe(error)}`); }
const document = await client.getVerificationDocument();
const steps = Object.entries(document.steps ?? {});
if (document.securityVerified !== true || !steps.length || steps.some(([, step]) => step?.status !== 'success'))
  fail(`verification incomplete: ${steps.map(([name, step]) => `${name}=${step?.status}`).join(' ')}`);
let models;
try { models = (await client.models.list()).data ?? []; } catch (error) { fail(`model list: ${describe(error)}`); }
if (!models.length) fail('the verified endpoint listed no models.');
let sync;
try {
  const { syncEnclave } = await import(pathToFileURL(join(archive, 'desktop', 'cloud-client.mjs')).href);
  sync = await syncEnclave(randomUUID() + randomUUID());
  await sync.ready();
} catch (error) { fail(`sync enclave verification: ${describe(error)}`); }
const syncDocument = await sync.getVerificationDocument(), syncSteps = Object.entries(syncDocument.steps ?? {});
if (syncDocument.securityVerified !== true || !syncSteps.length || syncSteps.some(([, step]) => step?.status !== 'success'))
  fail(`sync enclave verification incomplete: ${syncSteps.map(([name, step]) => `${name}=${step?.status}`).join(' ')}`);
console.log(`PACKAGED_PROVIDER_OK: Electron ${process.versions.electron}; enclave verified (${steps.map(([name]) => name).join(', ')}); ${models.length} models listed; sync enclave verified (${syncSteps.map(([name]) => name).join(', ')})`);
