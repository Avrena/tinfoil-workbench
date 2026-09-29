import { randomUUID } from 'node:crypto';
import { parseCloudKey, threadFromCloud, cloudPatch, newCloudChat, projectFromCloud, CLOUD_FORMAT } from '../dist/core/cloud.js';
import { InputError, LIMITS } from '../dist/core/validation.js';
import { findThread } from '../dist/core/workspace.js';
import { CloudError, cloudKeyId } from './cloud-client.mjs';

const BATCH = 100; // the enclave's limit for one pull
const conflict = error => error instanceof CloudError && (error.status === 409 || error.status === 412);
const decode = item => { try { return JSON.parse(Buffer.from(item.plaintext, 'base64').toString('utf8')); } catch { return null; } };
const plainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const cloudProjectOf = (ws, projectId) => projectId ? ws.projects.find(p => p.id === projectId)?.cloud?.id ?? null : null;
const localProjectOf = (ws, cloudProject) => cloudProject ? ws.projects.find(p => p.cloud?.id === cloudProject)?.id ?? null : null;

/** Two-way sync of Tinfoil cloud chats and projects (docs/CLOUD.md). Listing is cheap: chats are kept as titles until
 * opened. A change made in Workbench is written by pulling the chat, applying the change and pushing it against the
 * version it was pulled at; if the chat changed in the meantime, the cloud version wins in place and Workbench's version
 * is kept as a local copy. Nothing from the chat key or the plaintexts is logged. */
export class CloudSync {
  /** `host` gives the workspace and saves and announces changes; `account` gives the session token and user. */
  constructor({ client, host, account, now = Date.now }) {
    this.client = client; this.host = host; this.account = account; this.now = now;
    this.status = { state: 'off', keyId: null, user: null, lastSyncAt: null, message: null, chats: 0, projects: 0, older: 0 };
    this.flight = null; this.writes = new Map(); this.loading = new Set();
  }
  get ws() { return this.host.workspace(); }
  key() {
    const cfg = this.ws.cloud, parsed = cfg && parseCloudKey(cfg.key);
    if (!parsed) throw new InputError('Add your Tinfoil chat key in Account first.');
    return { b64: Buffer.from(parsed.bytes).toString('base64'), id: cfg.keyId };
  }
  snapshot() {
    const cfg = this.ws?.cloud;
    return { ...this.status, keyId: cfg?.keyId ?? null, user: cfg?.user ?? null, state: cfg ? this.status.state === 'off' ? 'ready' : this.status.state : 'off',
      chats: this.ws?.threads.filter(t => t.cloud).length ?? 0, projects: this.ws?.projects.filter(p => p.cloud).length ?? 0 };
  }
  set(fields) { this.status = { ...this.status, ...fields }; this.host.emit(); }
  /** The signed-in account must be the one the cloud data belongs to. */
  async assertAccount() {
    const cfg = this.ws.cloud; if (!cfg) throw new InputError('Add your Tinfoil chat key in Account first.');
    const { user } = await this.account.sessionToken(false);
    if (user !== cfg.user) throw new InputError('These cloud chats belong to another Tinfoil account. Sign in with that account, or remove the chat key.');
  }
  /** Checks a chat key against the account's current key before keeping it. Nothing is written to the cloud. */
  async connect(input) {
    const parsed = parseCloudKey(input);
    if (!parsed) throw new InputError('That is not a Tinfoil chat key. Paste the key that starts with key_, or open the key file you downloaded from Tinfoil Chat.');
    const keyId = cloudKeyId(parsed.bytes), { user } = await this.account.sessionToken(false);
    this.set({ state: 'checking', message: null });
    try {
      const current = await this.client.keyCurrent();
      if (!current.keyId) throw new InputError('This Tinfoil account has no cloud chat key yet. Set up cloud sync in Tinfoil Chat first.');
      if (current.keyId.toLowerCase() !== keyId) throw new InputError('This is not your account\'s current chat key. Copy the current key from Tinfoil Chat (Settings → Cloud sync).');
    } catch (error) { this.set({ state: 'error', message: error instanceof InputError ? error.message : error.message }); throw error; }
    const ws = this.ws, previous = ws.cloud;
    ws.cloud = { key: parsed.key, keyId, user, writer: previous?.user === user ? previous.writer : `workbench.${randomUUID()}`, clock: previous?.user === user ? previous.clock : 0 };
    await this.host.save(); this.set({ state: 'ready', message: null });
    await this.sync();
  }
  /** Forgets the key and removes cloud chats and projects from this device; they stay in the Tinfoil account. A chat
   * with changes that were not written yet is kept as a local conversation. */
  async disconnect() {
    const ws = this.ws; if (!ws.cloud) return;
    for (const t of ws.threads) if (t.cloud?.dirty) { delete t.cloud; t.title = `${t.title} (not synced)`.slice(0, 120); }
    ws.threads = ws.threads.filter(t => !t.cloud);
    const gone = new Set(ws.projects.filter(p => p.cloud).map(p => p.id));
    for (const t of ws.threads) if (gone.has(t.projectId)) t.projectId = null;
    ws.projects = ws.projects.filter(p => !p.cloud); delete ws.cloud;
    this.host.ensureActive(); await this.host.save();
    this.status = { state: 'off', keyId: null, user: null, lastSyncAt: null, message: null, chats: 0, projects: 0, older: 0 }; this.host.emit();
  }
  /** One sync pass; concurrent callers share it. */
  sync() {
    if (!this.flight) this.flight = this.run().finally(() => { this.flight = null; });
    return this.flight;
  }
  async run() {
    if (!this.ws.cloud) return;
    this.set({ state: 'syncing', message: null });
    try {
      await this.assertAccount();
      const key = this.key(), current = await this.client.keyCurrent();
      if (current.keyId?.toLowerCase() !== this.ws.cloud.keyId) throw new InputError('Your Tinfoil chat key has changed. Add the current key from Tinfoil Chat in Account.');
      await this.syncProjects(key);
      const older = await this.syncChats(key);
      this.host.ensureActive(); await this.host.save();
      this.set({ state: 'ready', lastSyncAt: this.now(), message: null, older });
    } catch (error) {
      this.set({ state: 'error', message: error instanceof InputError || error instanceof CloudError ? error.message : 'Cloud sync failed. Check your connection and try again.' });
      throw error instanceof InputError || error instanceof CloudError ? error : new InputError('Cloud sync failed. Check your connection and try again.');
    }
  }
  /** Every listed row, page by page, up to `max`. Returns the rows and whether more exist. */
  async list(scope, max) {
    const rows = [], deletes = []; let cursor;
    do {
      const page = await this.client.listStatus(scope, { cursor, limit: BATCH, direction: 'desc' });
      rows.push(...page.updates); deletes.push(...page.deletes); cursor = page.next;
    } while (cursor && rows.length < max);
    // A row whose version moves during the walk can be listed twice; keep its newest version.
    const newest = new Map();
    for (const r of rows) if (typeof r?.id === 'string' && typeof r.etag === 'string' && (!newest.has(r.id) || Number(r.etag) > Number(newest.get(r.id).etag))) newest.set(r.id, r);
    return { rows: [...newest.values()].slice(0, max), deletes, more: !!cursor || newest.size > max };
  }
  async pullMany(scope, ids, key) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += BATCH) for (const item of await this.client.pull(scope, ids.slice(i, i + BATCH), key)) if (item?.ok && typeof item.id === 'string') out.set(item.id, item);
    return out;
  }
  async syncProjects(key) {
    const ws = this.ws, now = this.now(), { rows } = await this.list('project', 200);
    const listed = new Map(rows.filter(r => typeof r.id === 'string').map(r => [r.id, r]));
    const changed = [...listed.values()].filter(r => ws.projects.find(p => p.cloud?.id === r.id)?.cloud?.etag !== r.etag).map(r => r.id);
    for (const [id, item] of await this.pullMany('project', changed, key)) {
      const plain = decode(item); if (!plainObject(plain)) continue;
      const existing = ws.projects.find(p => p.cloud?.id === id), project = projectFromCloud(plain, id, String(item.etag ?? listed.get(id).etag), now, existing);
      if (existing) Object.assign(existing, project); else ws.projects.push(project);
    }
    // A cloud project that is no longer listed was deleted in Tinfoil; its conversations stay, outside any project.
    for (const p of ws.projects.filter(p => p.cloud && !listed.has(p.cloud.id))) { for (const t of ws.threads) if (t.projectId === p.id) t.projectId = null; }
    ws.projects = ws.projects.filter(p => !p.cloud || listed.has(p.cloud.id));
    const docs = await this.list('project_document', 1000);
    const byProject = new Map();
    for (const r of docs.rows) { const [projectId, documentId] = String(r.id).split('/'); if (projectId && documentId) (byProject.get(projectId) ?? byProject.set(projectId, []).get(projectId)).push({ ...r, documentId }); }
    for (const project of ws.projects.filter(p => p.cloud)) {
      const rowsFor = byProject.get(project.cloud.id) ?? [];
      const stale = rowsFor.filter(r => project.cloud.documents.find(d => d.id === r.documentId)?.etag !== r.etag).map(r => r.id);
      const pulled = await this.pullMany('project_document', stale, key);
      project.cloud.documents = rowsFor.map(r => {
        const item = pulled.get(r.id), known = project.cloud.documents.find(d => d.id === r.documentId);
        if (!item) return known ?? null;
        const plain = decode(item); if (!plainObject(plain)) return known ?? null;
        return { id: r.documentId, etag: String(item.etag ?? r.etag), name: String(plain.filename ?? 'document').slice(0, 200), type: String(plain.contentType ?? '').slice(0, 100),
          content: typeof plain.content === 'string' ? plain.content.slice(0, 500_000) : '' };
      }).filter(Boolean).slice(0, 100);
    }
  }
  async syncChats(key) {
    const ws = this.ws, now = this.now(), { rows, deletes, more } = await this.list('chat', LIMITS.cloudChats);
    const listed = new Map(rows.filter(r => typeof r.id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(r.id)).map(r => [r.id, r]));
    const local = new Map(ws.threads.filter(t => t.cloud).map(t => [t.cloud.id, t]));
    // A loaded chat read by an older format is read again once, unless it holds changes still to be written.
    const outdated = t => t.cloud.loaded && !t.cloud.dirty && (t.cloud.format ?? 1) < CLOUD_FORMAT;
    const stale = [...listed.values()].filter(r => { const t = local.get(r.id); return t?.cloud.etag !== r.etag || outdated(t); }).map(r => r.id);
    const pulled = await this.pullMany('chat', stale, key);
    for (const [id, item] of pulled) {
      const plain = decode(item); if (!plainObject(plain)) continue;
      const row = listed.get(id), etag = String(item.etag ?? row.etag), project = typeof (item.project_id ?? row.project_id) === 'string' ? item.project_id ?? row.project_id : null;
      const link = { id, etag, project }, projectId = localProjectOf(ws, project), existing = local.get(id);
      if (existing?.cloud.dirty) this.keepCopy(existing);
      const next = this.owned(threadFromCloud(plain, link, projectId, now, existing, existing ? existing.cloud.loaded : false));
      if (existing) Object.assign(existing, next);
      else if (ws.threads.length < LIMITS.threads) ws.threads.push(next);
    }
    // Deleted in Tinfoil: explicit deletions, and, when the listing is complete, chats that are no longer listed.
    const removed = new Set(deletes.map(d => d.id).filter(id => typeof id === 'string'));
    if (!more) for (const id of local.keys()) if (!listed.has(id)) removed.add(id);
    for (const id of removed) { const t = local.get(id); if (!t) continue; if (t.cloud.dirty) this.keepCopy(t, true); else ws.threads = ws.threads.filter(x => x !== t); }
    return more ? 1 : 0;
  }
  /** Cloud chats belong to the Chat account they came from: continuing one with that account needs no approval, while
   * the API key or another account still asks before sending its history (see needsAuthorization in service.mjs). */
  owned(thread) { if (!thread.connectionOwner && this.ws.cloud) thread.connectionOwner = 'chat:' + this.ws.cloud.user; return thread; }
  /** Keeps Workbench's unsynced version of a cloud chat as a local conversation before the cloud version replaces it. */
  keepCopy(thread, detach = false) {
    const ws = this.ws;
    if (detach) { delete thread.cloud; thread.title = `${thread.title} (Workbench copy)`.slice(0, 120); return; }
    if (ws.threads.length >= LIMITS.threads) return;
    const copy = structuredClone(thread); delete copy.cloud;
    copy.id = randomUUID(); copy.title = `${thread.title} (Workbench copy)`.slice(0, 120); copy.pinned = false;
    ws.threads.unshift(copy); this.host.notice?.(`“${thread.title}” changed in Tinfoil Chat while it had changes here. The cloud version replaced it, and your version was kept as “${copy.title}”.`);
  }
  /** Fetches the messages of a listed chat when it is opened. */
  async load(id) {
    const t = findThread(this.ws, id); if (!t.cloud || t.cloud.loaded || this.loading.has(id)) return;
    this.loading.add(id); this.host.emit();
    try {
      await this.assertAccount();
      const [item] = await this.client.pull('chat', [t.cloud.id], this.key()), plain = item?.ok ? decode(item) : null;
      if (!plainObject(plain)) throw new InputError('This chat could not be loaded from Tinfoil cloud. Sync and try again.');
      const current = this.ws.threads.find(x => x.id === id); if (!current?.cloud) return;
      Object.assign(current, threadFromCloud(plain, { id: current.cloud.id, etag: String(item.etag ?? current.cloud.etag), project: current.cloud.project },
        localProjectOf(this.ws, current.cloud.project), this.now(), current, true));
      await this.host.save();
    } finally { this.loading.delete(id); this.host.emit(); }
  }
  /** Marks a cloud chat changed and writes it shortly after; writes to one chat never overlap. */
  changed(id) {
    const t = this.ws.threads.find(x => x.id === id); if (!t?.cloud) return;
    // Saved at once, so a quit before the write finishes still knows the chat has changes to write.
    t.cloud.dirty = true; void this.host.save().catch(() => {});
    const previous = this.writes.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.write(id)).catch(error => { this.set({ message: error.message }); });
    this.writes.set(id, next); void next.finally(() => { if (this.writes.get(id) === next) this.writes.delete(id); });
    return next;
  }
  nextClock(observed) {
    const cfg = this.ws.cloud, v = Math.min(Math.max(cfg.clock, Number.isSafeInteger(observed) ? observed : 0) + 1, Number.MAX_SAFE_INTEGER);
    cfg.clock = v; return { v, w: cfg.writer };
  }
  async write(id) {
    const t = this.ws.threads.find(x => x.id === id); if (!t?.cloud?.dirty || !this.ws.cloud) return;
    await this.assertAccount();
    const key = this.key(), [item] = await this.client.pull('chat', [t.cloud.id], key);
    if (!item?.ok) {
      if (item?.code === 'NOT_FOUND') { this.keepCopy(t, true); await this.host.save(); this.host.emit(); return; }
      throw new InputError('This chat could not be written to Tinfoil cloud. Sync and try again.');
    }
    const plain = decode(item); if (!plainObject(plain)) throw new InputError('This cloud chat could not be read. It was not changed.');
    // A pull can re-seal an old row under the current key: a new version whose previous one is ours is not a change.
    if (String(item.etag) !== t.cloud.etag && String(item.previous_etag ?? '') === t.cloud.etag) t.cloud.etag = String(item.etag);
    if (String(item.etag) !== t.cloud.etag) return this.resolve(t, plain, String(item.etag));
    const clock = this.nextClock(plain.clock), body = cloudPatch(plain, t, { ...clock, version: Number(item.etag) + 1 }, this.now());
    // A move between cloud projects is part of the chat and of the row's metadata.
    const moved = (plain.projectId ?? null) !== t.cloud.project;
    if (moved) body.projectId = t.cloud.project;
    let etag;
    try { etag = await this.client.push('chat', t.cloud.id, key, body, t.cloud.etag, { messageCount: body.messages.length, ...(moved ? { projectId: t.cloud.project } : {}) }); }
    catch (error) { if (!conflict(error)) throw error; const [again] = await this.client.pull('chat', [t.cloud.id], key); const fresh = again?.ok ? decode(again) : null; if (plainObject(fresh)) return this.resolve(t, fresh, String(again.etag)); throw error; }
    const current = this.ws.threads.find(x => x.id === id);
    if (current?.cloud) current.cloud = { ...current.cloud, etag, turns: current.turns.length, dirty: false, syncedAt: this.now() };
    await this.host.save(); this.host.emit();
  }
  /** The chat changed in Tinfoil since Workbench last synced it: keep Workbench's version as a copy and load the cloud one. */
  async resolve(thread, plain, etag) {
    this.keepCopy(thread);
    Object.assign(thread, threadFromCloud(plain, { id: thread.cloud.id, etag, project: thread.cloud.project }, localProjectOf(this.ws, thread.cloud.project), this.now(), thread, true));
    await this.host.save(); this.host.emit();
  }
  /** Moves a cloud chat into a cloud project or out of projects; a local project cannot hold a cloud chat. The caller
   * writes the change with changed(). Returns false for a conversation that is not a cloud chat. */
  move(id, projectId) {
    const t = findThread(this.ws, id); if (!t.cloud) return false;
    const target = projectId ? this.ws.projects.find(p => p.id === projectId) : null;
    if (projectId && !target?.cloud) throw new InputError('A Tinfoil cloud chat can only move to a cloud project, or out of projects.');
    t.projectId = projectId; t.cloud.project = target?.cloud.id ?? null; return true;
  }
  /** Writes a local conversation to Tinfoil cloud as a new chat, in its project's cloud project if it has one. */
  async upload(id) {
    const t = findThread(this.ws, id); if (t.cloud) return;
    if (!t.turns.length) throw new InputError('Send a message in this conversation before moving it to Tinfoil cloud.');
    if (t.projectId && !this.ws.projects.find(p => p.id === t.projectId)?.cloud)
      throw new InputError('This conversation is in a local project. Move it out of the project, or into a cloud project, before moving it to Tinfoil cloud.');
    if (this.ws.threads.filter(x => x.cloud).length >= LIMITS.cloudChats) throw new InputError('Too many cloud chats on this device. Delete some first.');
    await this.assertAccount();
    const key = this.key(), project = cloudProjectOf(this.ws, t.projectId), chatId = await this.client.newChatId(t.createdAt);
    const clock = this.nextClock(0), body = newCloudChat(t, project, { ...clock, version: 1 }, this.now());
    const etag = await this.client.push('chat', chatId, key, body, '0', { messageCount: body.messages.length, projectId: project });
    const current = this.ws.threads.find(x => x.id === id);
    if (current) { current.cloud = { id: chatId, etag, project, turns: current.turns.length, loaded: true, dirty: false, syncedAt: this.now() }; delete current.cloudPending; }
    await this.host.save(); this.host.emit();
  }
  /** Deletes a cloud chat in Tinfoil, then here. */
  async remove(id) {
    const t = findThread(this.ws, id); if (!t.cloud) return;
    await this.assertAccount();
    const key = this.key();
    try { await this.client.remove('chat', t.cloud.id, key, t.cloud.etag); }
    catch (error) {
      if (!conflict(error)) throw error;
      throw new InputError('This chat changed in Tinfoil Chat. Sync, check it and delete it again.');
    }
    this.ws.threads = this.ws.threads.filter(x => x.id !== id); this.host.ensureActive();
    await this.host.save(); this.host.emit();
  }
}
