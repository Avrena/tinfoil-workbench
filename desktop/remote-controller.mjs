import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createSSHTransport } from './remote-ssh.mjs';
import { InputError, record } from '../dist/core/validation.js';
import { remoteID, remoteAlias, remoteName, remoteTitle, remoteTitles, remoteDraft, remoteOverview, remoteDetail, emptyRemoteDraft } from '../dist/core/remote.js';

const id = () => randomUUID().replaceAll('-', '');
const draftHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Fixed controller only. No caller-supplied executable, SSH options or remote command. */
export function sshRequest(alias, request, { spawnProcess = spawn, timeout = 120000 } = {}) {
  remoteAlias(alias);
  return new Promise((resolve, reject) => {
    const child = spawnProcess('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2',
      alias, '/usr/local/bin/tinfoil-workbench'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '', size = 0, ended = false;
    const finish = (error, value) => { if (ended) return; ended = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new InputError('The SSH request timed out. Refresh jobs before submitting again; the remote job may still be running.')); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => {
      size += Buffer.byteLength(data);
      if (size > 3 * 1024 * 1024) { child.kill(); finish(new InputError('The remote response exceeded its display limit.')); }
      else output += data;
    });
    child.stderr.on('data', data => { errors = (errors + data).slice(-8000); });
    child.on('error', () => finish(new InputError('OpenSSH could not start. Install the Windows OpenSSH client and configure a key-only host alias.')));
    child.on('close', code => {
      if (ended) return;
      let answer;
      try { answer = JSON.parse(output); } catch {}
      if (answer?.ok === false && typeof answer.error === 'string') {
        const error = new InputError(answer.error.slice(0, 2000)); error.remoteRejected = true; finish(error); return;
      }
      if (code === 0 && answer?.ok === true) { finish(null, answer.result); return; }
      const message = /host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(errors)
        ? 'SSH host verification failed. Verify this host in OpenSSH before connecting.'
        : /permission denied/i.test(errors) ? 'SSH key authentication failed. Check the alias and key in your SSH configuration.'
        : 'The remote host could not be reached or its controller did not respond. Check SSH and the installed remote worker. Jobs may continue on the host.';
      finish(new InputError(message));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

/** Local profiles and drafts have their own OS-encrypted vault. Job output stays on the VPS. */
export class RemoteController {
  constructor({ store, confirm, transport = createSSHTransport(sshRequest), enroll }) {
    Object.assign(this, { store, confirm, transport, enroll });
    this.local = { version: 1, hosts: [], selectedHost: null }; this.busy = false;
    this.views = new Map(); this.submitting = new Set();
  }
  async initialize() {
    const saved = await this.store.read();
    if (!saved) return;
    if (saved.version !== 1 || !Array.isArray(saved.hosts) || saved.hosts.length > 8) throw new InputError('Remote profiles could not be read. The encrypted file has not been overwritten.');
    this.local = { version: 1, hosts: saved.hosts.map(h => ({ id: remoteID(h.id), alias: remoteAlias(h.alias), name: remoteName(h.name), draft: remoteDraft(h.draft), jobTitles:remoteTitles(h.jobTitles), ...(h.pendingJob ? { pendingJob: remoteID(h.pendingJob), ...(/^[a-f0-9]{64}$/.test(h.pendingDraftHash??'') ? {pendingDraftHash:h.pendingDraftHash} : {}) } : {}) })), selectedHost: saved.selectedHost };
    if (!this.local.hosts.some(h => h.id === this.local.selectedHost)) this.local.selectedHost = this.local.hosts[0]?.id ?? null;
  }
  snapshot(extra = {}) { return { local: structuredClone(this.local), ...extra }; }
  save() { return this.store.write(this.local); }
  flush() { return this.store.flush(); }
  async shutdown() { await this.flush(); this.transport.close?.(); }
  host(value) { const host = this.local.hosts.find(h => h.id === remoteID(value)); if (!host) throw new InputError('Choose a configured remote host.'); return host; }
  async overview(host, job) {
    const pendingAtStart = host.pendingJob, mayReconcile = !this.submitting.has(host.id);
    const overview = remoteOverview(await this.transport(host.alias, { op: 'overview', ...(job ? { id: remoteID(job) } : {}) }));
    this.views.set(host.id, overview);
    if (overview?.protocol !== 1 || !Array.isArray(overview.workspaces) || !Array.isArray(overview.jobs)) throw new InputError('Update the remote worker to use the Workbench interface.');
    // A successful overview shares the server lifecycle lock with submission, so
    // an uncertain start has finished processing before absence is established.
    let selectedJob;
    if (pendingAtStart && host.pendingJob === pendingAtStart && mayReconcile && !this.submitting.has(host.id)) {
      if (overview.jobs.some(j => j.id === pendingAtStart)) { selectedJob = pendingAtStart; if (host.pendingDraftHash === draftHash(host.draft)) host.draft.prompt = ''; }
      delete host.pendingJob; delete host.pendingDraftHash; await this.save();
    }
    if (!selectedJob && !job && overview.detail) selectedJob = overview.detail.id;
    return this.snapshot({ overview, ...(overview.detail ? { detail: overview.detail } : {}), ...(selectedJob ? { selectedJob } : {}) });
  }
  async execute(input) {
    const c = record(input);
    if (c.type === 'load') return this.snapshot();
    if (c.type === 'draft.set') {
      // The picker clears inherited reasoning overrides at selection time. Keep
      // this complete, validated snapshot exact: a new choice can be made before
      // its debounced save, and must not be silently reset by the native host.
      const host = this.host(c.host), draft = remoteDraft(c.draft);
      host.draft = draft; await this.save(); return this.snapshot();
    }
    if (c.type === 'host.select') { this.local.selectedHost = this.host(c.host).id; await this.save(); return this.snapshot(); }
    if (c.type === 'refresh') return this.overview(this.host(c.host), c.id);
    if (c.type === 'job.read') return this.snapshot({ detail: remoteDetail(await this.transport(this.host(c.host).alias, { op: 'inspect', id: remoteID(c.id) })) });
    // Stop bypasses an unrelated long archive/create action and its lifecycle lock.
    if (c.type === 'job.stop') return this.snapshot({ detail: remoteDetail(await this.transport(this.host(c.host).alias, { op: 'stop', id: remoteID(c.id) })) });
    if (this.busy) throw new InputError('Finish the pending remote action first.');
    this.busy = true;
    try { return await this.mutate(c); } finally { this.busy = false; }
  }
  async mutate(c) {
    if (c.type === 'job.rename') {
      const host=this.host(c.host), job=remoteID(c.id), title=remoteTitle(c.title), previous=host.jobTitles;
      if(!this.views.get(host.id)?.jobs.some(j=>j.id===job))throw new InputError('Refresh and select an existing job first.');
      const entries=Object.entries(previous??{}).filter(([id])=>id!==job);
      host.jobTitles=Object.fromEntries([...entries.slice(-199),[job,title]]);
      try{await this.save();}catch(error){host.jobTitles=previous;throw error;}
      return this.snapshot();
    }
    if (c.type === 'host.add') {
      if (this.local.hosts.length >= 8) throw new InputError('Eight remote hosts are already configured.');
      const alias = remoteAlias(c.alias), name = remoteName(c.name);
      if (this.local.hosts.some(h => h.alias === alias)) throw new InputError('This SSH alias is already configured.');
      if (!await this.confirm({ title: `Add ${name}?`, message: `Workbench will use the SSH alias ${alias} and its existing host key and login key. Adding a host does not send any task or copy a Chat account.`, text: alias, approve: 'Add remote host' })) return this.snapshot({ cancelled: true });
      const host = { id: id(), alias, name, draft: emptyRemoteDraft() }; this.local.hosts.push(host); this.local.selectedHost = host.id;
      await this.save(); return this.snapshot();
    }
    const host = this.host(c.host);
    if (c.type === 'host.remove') {
      if (!await this.confirm({ title: `Forget ${host.name} on this PC?`, message: 'Removes its local profile and task draft. Remote jobs keep running and remote files and Chat sign-in are kept.', approve: 'Forget host', tone: 'warning' })) return this.snapshot({ cancelled: true });
      this.local.hosts = this.local.hosts.filter(h => h.id !== host.id); if (this.local.selectedHost === host.id) this.local.selectedHost = this.local.hosts[0]?.id ?? null;
      await this.save(); return this.snapshot();
    }
    if (c.type === 'workspace.create') {
      const result = await this.transport(host.alias, { op: 'create', name: remoteName(c.name) });
      host.draft.workspace = remoteID(result.id); await this.save(); return this.overview(host);
    }
    if (c.type === 'enroll') { await this.enroll(host, request => this.transport(host.alias, request)); return this.overview(host); }
    if (c.type === 'disconnect') {
      if (!await this.confirm({ title: `Disconnect remote Chat on ${host.name}?`, message: 'Stop active jobs first. This removes the VPS session copy. End the dedicated session in Tinfoil account settings to revoke it at the provider.', approve: 'Disconnect remote Chat', tone: 'warning' })) return this.snapshot({ cancelled: true });
      await this.transport(host.alias, { op: 'disconnect-chat' }); return this.overview(host);
    }
    if (c.type === 'submit') {
      if (host.pendingJob) throw new InputError('Refresh jobs to check the previous submission before starting another.');
      const draft = remoteDraft(host.draft); remoteID(draft.workspace);
      if (!draft.prompt.trim()) throw new InputError('Enter a task first.');
      const info = remoteOverview(await this.transport(host.alias, {op:'overview'})); this.views.set(host.id, info);
      const name = info.workspaces.find(w => w.id === draft.workspace)?.name ?? draft.workspace;
      const model = draft.model === 'default' ? info.auth.defaultModel : draft.model;
      if (!model) throw new InputError('Choose an exact Chat model or configure the host default.');
      if (!info.features?.jobSettings && (draft.systemPrompt.trim() || draft.temperature !== null || draft.reasoningEffort !== 'default' || draft.thinkingMode !== 'default')) throw new InputError('Update the remote worker before sending system instructions or advanced model settings.');
      if (!await this.confirm({ title: `Start an autonomous job on ${host.name}?`,
        message: `Remote workspace: ${name} (${draft.workspace.slice(0,8)}). Model: ${model}${draft.model==='default'?' (host default)':''}. The agent may change files and run commands with public Internet access inside this workspace, without further prompts. It uses the remote Chat subscription and keeps running after Workbench closes. Limits: ${draft.maxSeconds} seconds, ${draft.maxRounds} rounds, ${draft.maxCalls} tools, ${draft.maxTokens} output tokens per round. Temperature: ${draft.temperature ?? 'provider default'}. Reasoning effort: ${draft.reasoningEffort}. Thinking: ${draft.thinkingMode}. System instructions: ${draft.systemPrompt.trim() ? draft.systemPromptName || 'Custom' : 'None'}.`,
        text: draft.systemPrompt.trim() ? `System instructions (in addition to the workspace guide):\n${draft.systemPrompt}\n\nTask:\n${draft.prompt}` : draft.prompt,
        approve: 'Start remote job', tone: 'warning' })) return this.snapshot({ cancelled: true });
      // Review applies to a captured draft; editing while the window is open cannot alter what is sent.
      const requestId = id(); this.submitting.add(host.id); host.pendingJob = requestId; host.pendingDraftHash = draftHash(draft);
      let result;
      try { await this.save(); result = await this.transport(host.alias, { op: 'submit', ...draft, model, policy: 'workspace-auto', requestId }); }
      catch (error) { if (error.remoteRejected) { delete host.pendingJob; delete host.pendingDraftHash; await this.save(); } throw error; }
      finally { this.submitting.delete(host.id); }
      delete host.pendingJob; delete host.pendingDraftHash;
      if (JSON.stringify(host.draft) === JSON.stringify(draft)) host.draft.prompt = '';
      await this.save(); return this.snapshot({ selectedJob: remoteID(result.id), message: 'Job started on the host. It keeps running after Workbench closes.' });
    }
    const operations = { 'workspace.archive': 'archive', 'workspace.delete': 'delete', 'job.stop': 'stop', 'job.delete': 'delete-job' };
    const op = operations[c.type]; if (!op) throw new InputError('Unknown remote action.');
    const target = remoteID(c.id);
    if (op === 'delete' || op === 'delete-job') {
      const info=this.views.get(host.id),name=op==='delete'?info?.workspaces.find(w=>w.id===target)?.name:info?.jobs.find(j=>j.id===target)?.prompt?.split('\n')[0];
      if (!await this.confirm({ title: op === 'delete' ? 'Delete this remote workspace?' : 'Delete these job records?', message: op === 'delete' ? `Permanently removes this workspace's files from ${host.name}. Archive first if you need them. Active workspaces cannot be deleted. Job records are kept separately.` : `Permanently removes this job's record from ${host.name}. Workspace files are kept.`, text: [name,target].filter(Boolean).join('\n'), approve: op === 'delete' ? 'Delete workspace files' : 'Delete job records', tone: 'danger' })) return this.snapshot({ cancelled: true });
    }
    const result = await this.transport(host.alias, { op, id: target, ...(['delete','delete-job'].includes(op) ? { confirm: target } : {}) });
    if (op === 'delete' && host.draft.workspace === target) { host.draft.workspace = ''; await this.save(); }
    return { ...await this.overview(host), ...(op === 'archive' ? { message: `Archive saved on ${host.name}: ${result.archive}. It has not been downloaded to this PC.` } : {}) };
  }
}
