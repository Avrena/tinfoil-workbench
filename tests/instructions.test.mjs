import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_INSTRUCTIONS, activeInstructions, saveInstructionPreset, deleteInstructionPreset, instructionExcerpt } from '../dist/core/instructions.js';
import { newWorkspace, beginTurn, buildHistory, exportThread, exportMarkdown, importThread, defaults } from '../dist/core/workspace.js';
import { settings, validateWorkspace, instructionPreset, LIMITS } from '../dist/core/validation.js';
import { WorkbenchService } from '../desktop/service.mjs';
import { createCommandHandler } from '../mobile/commands.mjs';
import { toolGuide } from '../dist/core/prompt.js';

function thread(extra = {}) {
  const w = newWorkspace(), t = w.threads[0];
  Object.assign(t.settings, { model: 'a', ...extra });
  return { w, t };
}

test('starter instructions are valid, distinct and never selected by default', () => {
  assert.equal(new Set(STARTER_INSTRUCTIONS.map(p => p.id)).size, STARTER_INSTRUCTIONS.length);
  assert.equal(new Set(STARTER_INSTRUCTIONS.map(p => p.name.toLowerCase())).size, STARTER_INSTRUCTIONS.length);
  for (const p of STARTER_INSTRUCTIONS) { assert.deepEqual(instructionPreset(p), p); assert.ok(Object.isFrozen(p)); }
  assert.equal(defaults.systemPrompt, ''); assert.equal(defaults.systemPromptName, '');
  assert.deepEqual(activeInstructions(newWorkspace().threads[0].settings, []), { kind: 'none' });
});

test('the Visual explainer starter names only the real visual tools and holds back when they are off', async () => {
  const { VISUAL_TOOLS } = await import('../dist/core/visual-tools.js');
  const visual = STARTER_INSTRUCTIONS.find(p => p.id === 'starter-visual'), offered = new Set(VISUAL_TOOLS.map(t => t.function.name));
  const named = new Set([...visual.text.matchAll(/\b(render_[a-z_]+|create_artifact|update_artifact|read_artifact)\b/g)].map(m => m[1]));
  for (const name of named) assert.ok(offered.has(name), `${name} is not a visual tool`);
  for (const name of ['render_chart', 'render_stat_cards', 'render_timeline', 'render_table', 'render_diagram', 'create_artifact', 'update_artifact']) assert.ok(named.has(name), name);
  assert.match(visual.text, /^Show, don't just tell\. When visual tools are available,/);
  assert.match(visual.text, /A visual appears where you call its tool/);
  assert.match(visual.text, /never mention a visual you have not created/);
  assert.equal(STARTER_INSTRUCTIONS[0].id, 'starter-concise', 'the first starter stays Concise');
  // It follows the fixed tool guide in the system message, which keeps its prefix-cacheable position.
  assert.ok(visual.text.length < 1600, `${visual.text.length} characters`);
});

test('settings migrate without a name and never keep a name for blank instructions', () => {
  const { systemPromptName, ...old } = defaults;
  assert.equal(settings(old).systemPromptName, '');
  assert.equal(settings({ ...defaults, systemPrompt: '   ', systemPromptName: 'Concise' }).systemPromptName, '');
  assert.equal(settings({ ...defaults, systemPrompt: 'Be brief.', systemPromptName: '  Concise ' }).systemPromptName, 'Concise');
  assert.equal(settings({ ...defaults, systemPrompt: 'Be brief.', systemPromptName: null }).systemPromptName, '');
  for (const name of ['Line\nbreak', 'x'.repeat(81), 3, {}])
    assert.throws(() => settings({ ...defaults, systemPrompt: 'Be brief.', systemPromptName: name }));
});

test('a sent turn records the instruction name only when custom instructions were sent', () => {
  const blank = thread();
  const [plain] = beginTurn(blank.t, 'Hi', []);
  assert.equal('systemPromptName' in blank.t.turns[0].replies[0], false);
  assert.equal(plain.messages.some(m => m.role === 'system'), false);

  const named = thread({ systemPrompt: 'Answer in French.', systemPromptName: 'Translator', compare: true, compareModel: 'b' });
  const jobs = beginTurn(named.t, 'Hi', []);
  assert.deepEqual(named.t.turns[0].replies.map(r => r.systemPromptName), ['Translator', 'Translator']);
  for (const job of jobs) {
    assert.deepEqual(job.messages[0], { role: 'system', content: 'Answer in French.' });
    assert.ok(!JSON.stringify(job.messages).includes('Translator'), 'names are display-only');
  }

  const unnamed = thread({ systemPrompt: 'Answer in French.' });
  beginTurn(unnamed.t, 'Hi', []);
  assert.equal(unnamed.t.turns[0].replies[0].systemPromptName, '');
});

test('changing instructions later does not relabel earlier replies', () => {
  const { t } = thread({ systemPrompt: 'Answer in French.', systemPromptName: 'Translator' });
  beginTurn(t, 'First', []);
  Object.assign(t.turns[0].replies[0], { status: 'complete', content: 'Bonjour' });
  Object.assign(t.settings, { systemPrompt: '', systemPromptName: '' });
  const [job] = beginTurn(t, 'Second', []);
  assert.equal(t.turns[0].replies[0].systemPromptName, 'Translator');
  assert.equal('systemPromptName' in t.turns[1].replies[0], false);
  assert.equal(job.messages.some(m => m.role === 'system'), false);
  assert.equal(buildHistory(t, 1).some(m => m.role === 'system'), false);
});

test('reply instruction names survive export and import, and old replies stay unlabelled', () => {
  const { w, t } = thread({ systemPrompt: 'Answer in French.', systemPromptName: 'Translator' });
  beginTurn(t, 'Hi', []);
  Object.assign(t.turns[0].replies[0], { status: 'complete', content: 'Bonjour' });
  const imported = importThread(w, JSON.parse(exportThread(t)));
  assert.equal(imported.turns[0].replies[0].systemPromptName, 'Translator');
  assert.equal(imported.settings.systemPromptName, 'Translator');
  const legacy = JSON.parse(exportThread(t));
  delete legacy.conversation.turns[0].replies[0].systemPromptName;
  delete legacy.conversation.settings.systemPromptName;
  const restored = importThread(w, legacy);
  assert.equal('systemPromptName' in restored.turns[0].replies[0], false);
  assert.equal(restored.settings.systemPromptName, '');
  const bad = JSON.parse(exportThread(t));
  bad.conversation.turns[0].replies[0].systemPromptName = 'Two\nlines';
  assert.throws(() => importThread(w, bad), /single line/);
});

test('Markdown export names the instructions each reply used', () => {
  const { t } = thread({ systemPrompt: 'Answer in French.', systemPromptName: 'Translator' });
  beginTurn(t, 'Hi', []);
  Object.assign(t.turns[0].replies[0], { status: 'complete', content: 'Bonjour' });
  t.settings.systemPromptName = '';
  beginTurn(t, 'Again', []);
  const output = exportMarkdown(t);
  assert.match(output, /Status: complete · Instructions: Translator/);
  assert.match(output, /Status: queued · Instructions: Custom instructions/);
  assert.match(output, /## Custom system instructions \(optional; not required\)\n\nAnswer in French\./);
  t.settings.systemPromptName = 'Translator';
  assert.match(exportMarkdown(t), /optional; not required\)\n\nName: Translator\n\nAnswer in French\./);
});

test('saved instructions have unique names, bounded size and explicit updates', () => {
  const w = newWorkspace();
  const first = saveInstructionPreset(w, undefined, ' Translator ', 'Answer in French.');
  assert.equal(first.name, 'Translator'); assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.throws(() => saveInstructionPreset(w, undefined, 'translator', 'Other'), /already exist/);
  for (const [name, body] of [['', 'x'], ['Empty', '   '], ['Long', 'x'.repeat(LIMITS.instructions + 1)], ['Two\nlines', 'x']])
    assert.throws(() => saveInstructionPreset(w, undefined, name, body));
  const second = saveInstructionPreset(w, undefined, 'Reviewer', 'Review carefully.');
  assert.throws(() => saveInstructionPreset(w, second.id, 'TRANSLATOR', 'x'), /already exist/);
  const updated = saveInstructionPreset(w, first.id, 'Translator', 'Answer in German.');
  assert.equal(updated, w.instructionPresets[0]); assert.equal(updated.text, 'Answer in German.');
  assert.throws(() => saveInstructionPreset(w, 'missing', 'Other', 'x'), /no longer exist/);
  while (w.instructionPresets.length < LIMITS.instructionPresets) saveInstructionPreset(w, undefined, 'Entry ' + w.instructionPresets.length, 'x');
  assert.throws(() => saveInstructionPreset(w, undefined, 'One too many', 'x'), /limit/);
});

test('editing or deleting a saved entry leaves conversations that use it unchanged', () => {
  const { w, t } = thread();
  const preset = saveInstructionPreset(w, undefined, 'Translator', 'Answer in French.');
  Object.assign(t.settings, { systemPrompt: preset.text, systemPromptName: preset.name });
  assert.equal(activeInstructions(t.settings, w.instructionPresets).kind, 'saved');
  saveInstructionPreset(w, preset.id, 'Translator', 'Answer in German.');
  assert.equal(t.settings.systemPrompt, 'Answer in French.');
  assert.deepEqual(activeInstructions(t.settings, w.instructionPresets), { kind: 'custom', name: 'Translator', text: 'Answer in French.' });
  deleteInstructionPreset(w, preset.id);
  assert.equal(w.instructionPresets.length, 0); assert.equal(t.settings.systemPrompt, 'Answer in French.');
  assert.throws(() => deleteInstructionPreset(w, preset.id), /no longer exist/);
});

test('active instructions match by exact name and text, preferring saved entries', () => {
  const starter = STARTER_INSTRUCTIONS[0];
  const pick = (systemPrompt, systemPromptName, saved = []) => activeInstructions({ systemPrompt, systemPromptName }, saved);
  assert.deepEqual(pick(starter.text, starter.name), { kind: 'starter', preset: starter });
  assert.equal(pick(starter.text, '').kind, 'custom');
  assert.equal(pick(starter.text + ' ', starter.name).kind, 'custom');
  const copy = { ...starter, id: 'own-copy' };
  assert.deepEqual(pick(starter.text, starter.name, [copy]), { kind: 'saved', preset: copy });
  assert.deepEqual(pick(' \n', 'Ignored'), { kind: 'none' });
});

test('workspaces migrate to an empty library and reject malformed entries', () => {
  const w = newWorkspace();
  delete w.instructionPresets;
  assert.deepEqual(validateWorkspace(w).instructionPresets, []);
  const entry = { id: 'saved-1', name: 'Reviewer', text: 'Review carefully.', createdAt: 1 };
  assert.deepEqual(validateWorkspace({ ...w, instructionPresets: [entry] }).instructionPresets, [{ ...entry, updatedAt: 1 }]);
  for (const bad of [[entry, entry], [{ ...entry, text: '' }], [{ ...entry, name: 'a\u0000b' }], [{ ...entry, id: '../x' }], 'not a list'])
    assert.throws(() => validateWorkspace({ ...w, instructionPresets: bad }));
  assert.throws(() => validateWorkspace({ ...w, instructionPresets: Array.from({ length: 51 }, (_, i) => ({ ...entry, id: 'id' + i, name: 'n' + i })) }));
});

test('list excerpts are single-line and bounded without splitting characters', () => {
  assert.equal(instructionExcerpt('  Line one.\n\n  Line two. '), 'Line one. Line two.');
  const long = instructionExcerpt('😀'.repeat(200), 10);
  assert.equal([...long].length, 10); assert.ok(long.endsWith('…')); assert.ok(!long.includes('�'));
  assert.equal(instructionExcerpt('a' + ' '.repeat(1000) + 'b', 20), 'a…');
});

async function service(t) {
  let stored = null; const calls = [];
  const vault = { read: async () => structuredClone(stored), write: async v => { stored = structuredClone(v); }, flush: async () => {} };
  const client = { ready: async () => {}, getVerificationDocument: async () => ({ securityVerified: true, steps: {} }), models: { list: async () => ({ data: [] }) },
    chat: { completions: { create: async body => { calls.push(structuredClone(body)); return (async function* () { yield { choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] }; })(); } } } };
  const s = new WorkbenchService(vault, async () => client);
  await s.initialize(); await s.execute({ type: 'credentials.set', key: 'test-only-not-real' });
  s.workspace.threads[0].settings.model = 'a';
  t.after(() => s.shutdown());
  return { s, calls, get stored() { return stored; } };
}
const finished = async s => { while (s.tasks.size) await Promise.all([...s.tasks]); };

test('service stores the library, applies names through settings and never sends them', async t => {
  const f = await service(t), { s, calls } = f, id = s.workspace.activeId;
  let snap = await s.execute({ type: 'instructions.save', name: 'Translator', text: 'Answer in French.' });
  const [preset] = snap.workspace.instructionPresets;
  assert.equal(preset.name, 'Translator'); assert.ok(!('apiKey' in snap.workspace));
  assert.equal(f.stored.instructionPresets[0].text, 'Answer in French.');
  await s.execute({ type: 'thread.settings', id, settings: { ...s.workspace.threads[0].settings, systemPrompt: preset.text, systemPromptName: preset.name } });
  await s.execute({ type: 'instructions.save', id: preset.id, name: 'Translator', text: 'Answer in German.' });
  assert.equal(s.workspace.threads[0].settings.systemPrompt, 'Answer in French.');
  await s.execute({ type: 'send', id, text: 'Hello', attachments: [] }); await finished(s);
  // The instructions follow the guide to the offered tools, unchanged (core/prompt.ts).
  assert.deepEqual(calls[0].messages[0], { role: 'system', content: `${toolGuide({ visual: true, python: false })}\n\nAnswer in French.` });
  assert.ok(!JSON.stringify(calls[0]).includes('Translator'));
  assert.equal(s.workspace.threads[0].turns[0].replies[0].systemPromptName, 'Translator');
  snap = await s.execute({ type: 'instructions.delete', id: preset.id });
  assert.deepEqual(snap.workspace.instructionPresets, []);
  assert.equal(s.workspace.threads[0].settings.systemPromptName, 'Translator');
  await assert.rejects(s.execute({ type: 'instructions.delete', id: preset.id }), /no longer exist/);
  await assert.rejects(s.execute({ type: 'instructions.save', id: '../bad', name: 'x', text: 'y' }), /Invalid identifier/);
  await s.execute({ type: 'thread.settings', id, settings: { ...s.workspace.threads[0].settings, systemPrompt: '', systemPromptName: 'Translator' } });
  assert.equal(s.workspace.threads[0].settings.systemPromptName, '');
  assert.doesNotThrow(() => validateWorkspace(f.stored));
});

test('the Android host passes library commands to the shared service', async t => {
  const { s } = await service(t);
  const native = { confirm: async () => { throw new Error('no confirmation expected'); } };
  const command = createCommandHandler({ service: s, native });
  const { snapshot } = await command({ type: 'instructions.save', name: 'Reviewer', text: 'Review carefully.' });
  assert.equal(snapshot.platform, 'android');
  assert.deepEqual(snapshot.workspace.instructionPresets.map(p => p.name), ['Reviewer']);
  const after = await command({ type: 'instructions.delete', id: snapshot.workspace.instructionPresets[0].id });
  assert.deepEqual(after.snapshot.workspace.instructionPresets, []);
});
