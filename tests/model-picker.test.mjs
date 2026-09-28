import test from 'node:test';
import assert from 'node:assert/strict';
import { APIConnectionError, APIConnectionTimeoutError } from 'tinfoil';
import { normalizeCapability, capabilityFor } from '../dist/core/capabilities.js';
import { pickerModels, pickerModel, makerOf, modelMatches, contextLabel } from '../dist/core/model-list.js';
import { publicError, networkFailure, moduleFailure } from '../dist/core/security.js';
import { makerMark, modelRow, customModelRow } from '../dist/renderer/model-view.js';
import { WorkbenchService } from '../desktop/service.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
// Shapes follow Tinfoil's public catalog (api/config/models) and the enclave's /v1/models list.
const catalogEntry = { modelName: 'deepseek-v4-1-flash', name: 'DeepSeek V4.1 Flash', nameShort: 'V4.1 Flash', image: 'deepseek.png', type: 'chat',
  contextWindowTokens: 1048576, multimodal: true, toolCalling: true, experimental: true, description: 'DeepSeek\u0000 efficient   MoE model',
  chatConfig: { reasoningConfig: { supportsEffort: true, effortMap: { high: 'high', max: 'max' } } } };
const listedEntry = { id: 'kimi-k3', name: 'Kimi K3', type: 'chat', context_window: 262144, multimodal: true, reasoning: true, tool_calling: true };

test('catalog and /v1/models entries become bounded display metadata', () => {
  assert.deepEqual(normalizeCapability(catalogEntry).display, { name: 'DeepSeek V4.1 Flash', short: 'V4.1 Flash', maker: 'deepseek', type: 'chat',
    contextWindow: 1048576, multimodal: true, reasoning: true, tools: true, experimental: true, description: 'DeepSeek efficient MoE model' });
  assert.deepEqual(normalizeCapability(listedEntry).display, { name: 'Kimi K3', short: '', maker: '', type: 'chat', contextWindow: 262144,
    multimodal: true, reasoning: true, tools: true, experimental: false, description: '' });
});
test('display metadata rejects unsafe or implausible values', () => {
  const d = normalizeCapability({ id: 'x', name: `A\nB${'c'.repeat(400)}`, image: 'https://example.invalid/a.png"><script>', type: 'Chat!', context_window: 1e12, description: 7 }).display;
  assert.deepEqual([d.maker, d.type, d.contextWindow, d.description, d.name.length, /[\n\r]/.test(d.name)], ['', '', null, '', 120, false]);
  assert.equal(normalizeCapability({ id: 'y', image: 'static/models/zai.png' }).display.maker, 'zai');
  assert.equal(normalizeCapability({ id: 'z', contextWindowTokens: -5 }).display.contextWindow, null);
});
test('display metadata never becomes reasoning parameters', () => {
  // /v1/models may say "reasoning": true; only Tinfoil's reasoning configuration can add request parameters.
  const listed = normalizeCapability({ id: 'mystery-model', reasoning: true });
  assert.equal(listed.display.reasoning, true); assert.equal(listed.known, false); assert.deepEqual(listed.effort, []);
  assert.deepEqual(capabilityFor('mystery-model', [listed]).enable, {});
});
test('the picker lists chat models in catalog order, then endpoint IDs without metadata', () => {
  const caps = [normalizeCapability(catalogEntry), normalizeCapability({ modelName: 'whisper-large-v3-turbo', name: 'Whisper', type: 'audio', image: 'openai.png' }), normalizeCapability(listedEntry)];
  assert.deepEqual(pickerModels(['a-local-model', 'whisper-large-v3-turbo', 'kimi-k3', 'deepseek-v4-1-flash'], caps).map(m => m.id), ['deepseek-v4-1-flash', 'kimi-k3', 'a-local-model']);
  assert.deepEqual(pickerModel('unlisted/id', caps), { id: 'unlisted/id', name: 'unlisted/id', short: '', maker: '', type: '', contextWindow: null,
    multimodal: false, reasoning: false, tools: false, experimental: false, description: '' });
});
test('makers come from the catalog, then the ID, then the initials of the name', () => {
  assert.deepEqual(makerOf({ id: 'glm-5-3', name: 'GLM-5.3', maker: 'zai' }), { key: 'zai', name: 'Z.ai', mark: 'GLM' });
  assert.equal(makerOf({ id: 'deepseek-ai/DeepSeek-R2', name: 'x', maker: '' }).key, 'deepseek');
  assert.equal(makerOf({ id: 'meta-llama/llama-4-scout', name: 'x', maker: '' }).key, 'llama');
  assert.equal(makerOf({ id: 'gpt-oss-20b', name: 'x', maker: 'not-a-known-maker' }).key, 'openai');
  assert.deepEqual(makerOf({ id: 'demo/writer', name: 'Demo Writer', maker: '' }), { key: '', name: '', mark: 'DW' });
  assert.equal(makerOf({ id: 'demo/analyst', name: 'demo/analyst', maker: '' }).mark, 'A');
});
test('search matches names, IDs and makers, and every word must match', () => {
  const gemma = pickerModel('gemma4-31b', [normalizeCapability({ modelName: 'gemma4-31b', name: 'Gemma 4 31B', image: 'gemma.png', type: 'chat' })]);
  for (const query of ['', 'gemma', '31b', 'GOOGLE', 'google 31']) assert.equal(modelMatches(gemma, query), true, query);
  assert.equal(modelMatches(gemma, 'google 70b'), false);
});
test('context sizes use the catalog binary units', () => {
  assert.deepEqual([1048576, 262144, 131072, 32768, 8192, 1500000, 500].map(contextLabel), ['1M', '256K', '128K', '32K', '8K', '1.5M', '500']);
});
test('picker rows escape provider text and name their marks for screen readers', () => {
  const model = { ...pickerModel('evil"id'), name: '<img src=x onerror=alert(1)>', description: '"><b>', reasoning: true, multimodal: true, contextWindow: 131072 };
  const row = modelRow(model, 'evil"id');
  assert.ok(!row.includes('<img') && !row.includes('<b>')); assert.match(row, /data-quick-model="evil&quot;id"/); assert.match(row, /aria-current="true"/);
  assert.match(row, /aria-label="&lt;img src=x onerror=alert\(1\)&gt;, reasoning, image input, 128K context, current model"/);
  assert.ok(!customModelRow('a<b').includes('a<b'));
  assert.match(makerMark(pickerModel('deepseek-v4-1-flash')), /class="maker-mark maker-deepseek"/);
  assert.match(makerMark(null, 'maker-badge'), /class="maker-badge maker-none"/);
});
test('connection failures without an HTTP status say what failed', () => {
  assert.match(publicError(new APIConnectionError({ cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) })), /^Tinfoil could not be reached \(ECONNRESET\)\./);
  assert.match(publicError(new APIConnectionTimeoutError()), /timed out before a response arrived/);
  assert.match(publicError(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })), /\(ENOTFOUND\)/);
  assert.match(publicError(new TypeError('Failed to fetch')), /^Tinfoil could not be reached\. /);
  assert.match(publicError(Object.assign(new Error('Not found'), { status: 404, code: 'model_not_found' })), /model, context size/);
  assert.match(publicError(new Error('boom')), /^The secure request failed\. /);
  assert.equal(networkFailure({ code: 'lowercase_code' }), null);
  // Codes that are not about the network are never reported as one.
  const missing = Object.assign(new Error("Cannot find package 'zod' imported from sdk"), { code: 'ERR_MODULE_NOT_FOUND' });
  assert.equal(networkFailure(missing), null);
  assert.equal(publicError(missing), 'Workbench could not load part of its secure connection code (ERR_MODULE_NOT_FOUND). Reinstall or update Workbench. Nothing was sent.');
  assert.equal(moduleFailure(missing), publicError(missing)); assert.equal(moduleFailure(new APIConnectionError({ cause: { code: 'ECONNRESET' } })), null);
  assert.equal(networkFailure(Object.assign(new Error('denied'), { code: 'EACCES' })), null);
  assert.match(publicError(Object.assign(new Error('denied'), { code: 'EACCES' })), /^The secure request failed \(EACCES\)\. /);
  assert.match(publicError(new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })), /could not be reached \(UND_ERR_CONNECT_TIMEOUT\)/);
  assert.match(publicError(new TypeError('fetch failed', { cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } })), /could not be reached \(ERR_TLS_CERT_ALTNAME_INVALID\)/);
});

function vault() { let value = null; return { read: async () => value, write: async v => { value = structuredClone(v); }, flush: async () => {} }; }
const client = (extra = {}) => ({ ready: async () => {}, getVerificationDocument: async () => ({ securityVerified: true, steps: { verifyCode: { status: 'success' } } }),
  models: { list: async () => ({ data: [{ id: 'b' }, { id: 'a' }] }) }, ...extra });
async function service(t, sdk, options = {}) {
  const s = new WorkbenchService(vault(), async () => sdk, () => {}, null, options); await s.initialize();
  await s.execute({ type: 'credentials.set', key: 'test-only-not-real' }); t.after(() => s.shutdown()); return s;
}

test('the public catalog loads once without credentials and outlives connection changes', async t => {
  let loads = 0; const catalog = [normalizeCapability(catalogEntry)];
  const s = await service(t, client(), { capabilityLoader: async (...args) => { loads++; assert.equal(args.length, 0); return catalog; } });
  assert.equal(s.snapshot().modelCatalog, 'idle');
  const [, second] = await Promise.all([s.execute({ type: 'models.catalog' }), s.execute({ type: 'models.catalog' })]);
  assert.equal(loads, 1); assert.equal(second.modelCatalog, 'ready'); assert.deepEqual(second.capabilities.map(c => c.id), ['deepseek-v4-1-flash']);
  await s.execute({ type: 'models.catalog' }); assert.equal(loads, 1);
  await s.execute({ type: 'credentials.set', key: 'another-test-only-key' });
  assert.deepEqual(s.snapshot().capabilities.map(c => c.id), ['deepseek-v4-1-flash']);
});
test('a failed catalog is fetched again after a minute, not on every picker opening', async t => {
  let loads = 0; const s = await service(t, client(), { capabilityLoader: async () => { loads++; throw new Error('offline'); } });
  assert.equal((await s.execute({ type: 'models.catalog' })).modelCatalog, 'failed');
  await s.execute({ type: 'models.catalog' }); assert.equal(loads, 1);
  s.catalogFailedAt -= 61_000; await s.execute({ type: 'models.catalog' }); assert.equal(loads, 2);
});
test('a successful verification fills an empty model list without verifying again', async t => {
  let lists = 0, readies = 0;
  const s = await service(t, client({ ready: async () => { readies++; }, models: { list: async () => { lists++; return { data: [{ id: 'b' }, { id: 'a' }] }; } } }));
  await s.connect(); await settle();
  assert.deepEqual(s.models, ['a', 'b']); assert.equal(lists, 1); assert.equal(readies, 1);
  await s.connect(); await settle(); assert.equal(lists, 1);
});
test('a verification that never finishes times out with its own message', async t => {
  const s = await service(t, client({ ready: () => new Promise(() => {}) }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = s.connect(); await settle();
  t.mock.timers.tick(45_000);
  await assert.rejects(pending, { name: 'InputError', message: 'Enclave verification timed out after 45 seconds. Check your connection and try again. Nothing was sent.' });
  t.mock.timers.reset();
  assert.equal(s.verification.state, 'failed'); assert.match(s.notice, /timed out after 45 seconds/);
});
test('a failed verification step is named and kept in the verification record', async t => {
  const steps = { fetchDigest: { status: 'success' }, verifyEnclave: { status: 'failed', error: 'quote rejected' }, compareMeasurements: { status: 'pending' } };
  const s = await service(t, client({ ready: async () => { throw new Error('attestation rejected'); }, secureClient: { getVerificationDocument: () => ({ steps }) } }));
  await assert.rejects(s.connect(), { name: 'InputError', message: 'The enclave could not be verified: the enclave attestation check failed. Nothing was sent.' });
  assert.deepEqual(s.verification.steps, [{ name: 'fetchDigest', status: 'success' }, { name: 'verifyEnclave', status: 'failed' }, { name: 'compareMeasurements', status: 'pending' }]);
  assert.equal(s.notice, 'The enclave could not be verified: the enclave attestation check failed. Nothing was sent.');
});
test('an unreachable attestation service is reported as a network failure', async t => {
  const s = await service(t, client({ ready: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); },
    secureClient: { getVerificationDocument: () => ({ steps: { fetchDigest: { status: 'pending' } } }) } }));
  await assert.rejects(s.connect(), /Tinfoil could not be reached \(ECONNREFUSED\)/);
  assert.equal(s.verification.state, 'failed'); assert.match(s.notice, /could not be reached \(ECONNREFUSED\)/);
});
test('a Chat session that ends during verification reports the session, not a connectivity failure', async t => {
  let release, status = 'signed-in';
  const account = { snapshot: () => ({ status, message: status === 'signed-in' ? null : 'Your Tinfoil session expired. Sign in again.' }),
    getCredential: async () => ({ key: 'chat-test-only-token', owner: 'user_test' }) };
  const s = new WorkbenchService(vault(), async () => client({ ready: () => new Promise(resolve => { release = resolve; }) }), () => {}, null, { account });
  await s.initialize(); t.after(() => s.shutdown());
  await s.execute({ type: 'connection.mode', mode: 'chat-account' });
  const pending = s.connect(); await settle();
  status = 'expired'; s.accountChanged(); release();
  await assert.rejects(pending, { name: 'InputError', message: 'Your Tinfoil session expired. Sign in again.' });
});
test('an SDK module that the installed app cannot load is named, not reported as a network failure', async t => {
  const missing = Object.assign(new Error("Cannot find package 'zod' imported from sdk"), { code: 'ERR_MODULE_NOT_FOUND' });
  const s = new WorkbenchService(vault(), async () => { throw missing; }, () => {}, null, {}); await s.initialize(); t.after(() => s.shutdown());
  await s.execute({ type: 'credentials.set', key: 'test-only-not-real' });
  await assert.rejects(s.execute({ type: 'connect' }), { name: 'InputError', message: /could not load part of its secure connection code \(ERR_MODULE_NOT_FOUND\)/ });
  assert.equal(s.verification.state, 'failed'); assert.doesNotMatch(s.notice, /could not be reached/);
});
test('Verify & refresh names a network failure while listing models', async t => {
  const s = await service(t, client({ models: { list: async () => { throw new APIConnectionError({ cause: { code: 'ECONNRESET' } }); } } }));
  await assert.rejects(s.execute({ type: 'connect' }));
  assert.match(s.notice, /^Tinfoil could not be reached \(ECONNRESET\)\./);
});
