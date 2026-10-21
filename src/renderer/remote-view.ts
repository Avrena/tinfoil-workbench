import { heading, conversationMenu, readingButtons, pendingSettings, effortMarkup } from './conversation-ui.js';
import { EffortControl } from './effort-control.js';
import { viewPreferences, type ViewPreferences } from '../core/preferences.js';
import type { EditorSession } from './editor.js';
import type { DesktopBridge, InstructionPreset } from '../core/types.js';
import type { RemoteCommand, RemoteLocal, RemoteOverview, RemoteDetail, RemoteDraft, RemoteResponse, RemoteJob, RemoteWorkspace } from '../core/remote.js';
import { emptyRemoteDraft, remoteActive } from '../core/remote.js';
import { capabilityFor, type ModelCapability } from '../core/capabilities.js';
import { escapeHtml as e } from '../core/markdown.js';
import { icon } from './icons.js';
import { updateMarkup } from './dom.js';
import { openModal } from './modal.js';
import { RichTextRenderer } from './rich-text.js';
import { RemoteModelPicker, type ModelSource } from './remote-model-picker.js';
import { transcriptView, type RichSources } from './remote-transcript.js';
import { RemoteAdvanced, customGeneration, effortName, thinkingName, limitsSummary } from './remote-settings.js';
import { RemoteInstructions } from './remote-instructions.js';

const label = (value: string): string => ({ starting:'Starting', authenticating:'Checking Chat access', running:'Running', complete:'Completed', error:'Failed', stopped:'Stopped', interrupted:'Interrupted', limited:'Limit reached', stopping:'Stopping' }[value] ?? value);
const date = (value?: number | string): string => value ? new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString() : '';
/** Today's jobs show the time; older ones the day. Full dates stay in Job details. */
const when = (value?: number | string): string => {
  if (!value) return '';
  const at = new Date(typeof value === 'number' ? value * 1000 : value), today = new Date();
  return at.toDateString() === today.toDateString() ? at.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : at.toLocaleDateString(undefined, { month:'short', day:'numeric' });
};
const LIMIT_REASONS = ['rounds','calls','context','output','time'];
const outcome=(job:{status:string;reason?:string}):string=>LIMIT_REASONS.includes(job.reason??'')?'Limit reached':job.reason==='auth'?'Chat sign-in required':job.reason==='quota'?'Chat usage limit':job.reason==='subscription'?'Chat subscription required':label(job.status);
const failed=(job:{status:string;reason?:string}):boolean=>job.status==='error'&&!LIMIT_REASONS.includes(job.reason??'');
const firstLine=(text:string|undefined,fallback:string):string=>text?.trim().split('\n')[0]?.trim()||fallback;
const workspaceName=(w:RemoteWorkspace):string=>w.name||'Workspace '+w.id.slice(0,8);
const SAFETY='The agent runs commands and changes files in this workspace without asking, with public Internet access.';

/** Where the composer's message goes: this conversation (Local) or a task on an SSH host (Remote). The same tab sits on
 * the top edge of both composers, in the same place; the page (app.ts) handles the choice, so the draft being left is
 * saved first and a failed save keeps the person where they are. */
export function executionToggle(id: string, mode: 'local' | 'remote'): string {
  const option = (value: 'local' | 'remote', glyph: string, text: string, title: string) => `<button type="button" role="radio" data-execution="${value}" aria-checked="${mode === value}" tabindex="${mode === value ? 0 : -1}" title="${title}">${icon(glyph)}<span>${text}</span></button>`;
  return `<div class="execution-tab" id="${id}" role="radiogroup" aria-label="Run on" hidden>${option('local', 'monitor', 'Local', 'Local: this conversation, with Chat’s model, tools and instructions')}${option('remote', 'terminal', 'Remote', 'Remote: a task in a workspace on your SSH host, with its own model and instructions')}</div>`;
}

export type RemoteSources = ModelSource & { capabilities?: () => ModelCapability[]; instructionPresets?: () => readonly InstructionPreset[]; reading:()=>ViewPreferences; showAdvanced:()=>void; edit:(session:EditorSession)=>void; copy:(text:string)=>Promise<void>; rendered:()=>void; configurationChanged:()=>void; navigationChanged:()=>void };

/** Remote tasks in the main view: the job as a conversation where the chat transcript is, and a task composer where the
 * chat composer is. Its drafts, model, settings and output are its own and never part of a chat; the controller keeps
 * them per host. Job history and host administration open from the toolbar. */
export class RemoteAgents {
  visible = false; busy = false; private stopping = false;
  private local: RemoteLocal = { version:1, hosts:[], selectedHost:null };
  private configurationLoad?: Promise<void>; private configurationKnown = false;
  private overview?: RemoteOverview; private detail?: RemoteDetail;
  /** The job shown, or '' for a new task. Only the person, a start, or reconciling an unconfirmed start changes it. */
  private job = '';
  private epoch = 0; private refreshing = false; private refreshAgain = false; private timer?: ReturnType<typeof setTimeout>;
  private draftTimer?: ReturnType<typeof setTimeout>; private revision = 0; private saved = 0;
  private saving: Promise<boolean> = Promise.resolve(true); private lastDetail = ''; private offline = false; private modelKey = '';
  private picker: RemoteModelPicker; private advanced: RemoteAdvanced; private instructions: RemoteInstructions;
  private richText = new RichTextRenderer(); private reasoningSources: RichSources = new Map();
  /** Where each view was scrolled (by job, '' for a new task) this session; a job seen first opens at its end, as a chat does. */
  private scrolls = new Map<string, { top: number; bottom: boolean }>(); private shown: string | null = null;
  private reading = viewPreferences(undefined); private opened = new Map<string,boolean>(); private raw = new Set<string>(); private answers: RichSources = new Map(); private effort: EffortControl;
  private toolbar: HTMLElement; private scroll: HTMLElement; private composer: HTMLElement; private dialogs: HTMLElement;
  constructor(private shell: HTMLElement, private bridge: DesktopBridge | undefined, private callbacks: RemoteSources) {
    const main = shell.querySelector<HTMLElement>('#main')!;
    this.toolbar = document.createElement('header'); this.toolbar.id = 'remote-toolbar'; this.toolbar.className = 'toolbar remote-toolbar'; this.toolbar.hidden = true;
    this.toolbar.innerHTML = `<button type="button" class="icon-button" data-action="sidebar" title="Toggle conversation sidebar" aria-label="Toggle conversation sidebar">${icon('panel')}</button>`
      + heading(`<button type="button" class="project-breadcrumb" id="remote-crumb" data-remote="manage" aria-haspopup="dialog" title="Manage remote host and workspace">Remote</button>`,'remote-heading','New task','Rename task')
      + '<span class="spacer"></span>' + readingButtons()
      // Chat's toolbar layout: Find, View, the menu, a panel (Jobs where Chat has Artifacts) and Advanced. New task is also
      // Ctrl+N, Manage is also the crumb, and the view refreshes itself every 15 s, so those three live in the menu.
      + conversationMenu(`<button class="mobile-menu-item" data-action="mobile-find">Find in task</button><button class="mobile-menu-item" data-action="mobile-view">Reading & visibility</button><button type="button" data-remote="new" id="remote-new">New task</button><button type="button" data-action="rename-thread">Rename task</button><button type="button" data-remote="refresh" id="remote-refresh">Refresh</button><button type="button" data-remote="manage" id="remote-manage-button">Manage hosts and workspaces</button>`)
      + `<button type="button" class="icon-button" data-remote="jobs" id="remote-jobs-button" aria-haspopup="dialog" aria-label="Jobs" title="Jobs">${icon('history')}<span class="sr-only" id="remote-jobs-count"></span><span class="remote-dot" id="remote-jobs-dot" aria-hidden="true" hidden></span></button>`
      + `<button type="button" class="icon-button" data-action="inspector" id="remote-advanced-button" title="Advanced settings" aria-label="Advanced settings">${icon('settings')}</button>`;
    main.querySelector('.toolbar')!.after(this.toolbar);
    this.scroll = document.createElement('div'); this.scroll.id = 'remote-scroll'; this.scroll.className = 'transcript remote-transcript'; this.scroll.tabIndex = 0; this.scroll.hidden = true;
    this.scroll.setAttribute('aria-label', 'Remote task');
    this.scroll.innerHTML = `<div class="transcript-inner remote-inner" id="remote-inner">
      <p id="remote-unavailable" class="notice" hidden>Remote tasks need the Windows app and an SSH-configured host.</p>
      <p id="remote-connection" class="remote-feedback danger" role="status" hidden></p>
      <p id="remote-feedback" class="remote-feedback" role="status" hidden></p>
      <div id="remote-welcome" class="remote-welcome">
        <div class="remote-welcome-head"><div class="empty-mark">${icon('terminal')}</div><h2 id="remote-welcome-title">Run tasks on your own host</h2><p id="remote-welcome-text"></p></div>
        <div id="remote-setup" class="remote-setup" hidden><h3 id="remote-setup-title">Before the first task</h3><div id="remote-setup-slots" class="remote-setup-slots"></div></div>
        <section id="remote-recent" class="remote-recent" aria-labelledby="remote-recent-heading" hidden><div class="remote-recent-head"><h3 id="remote-recent-heading">Recent jobs</h3><button type="button" class="remote-link" data-remote="jobs">All jobs</button></div><div id="remote-recent-list" class="remote-job-list"></div></section>
      </div>
      <section id="remote-job-detail" class="remote-job-detail" hidden aria-labelledby="remote-job-title">
        <h2 id="remote-job-title" class="remote-job-title" tabindex="-1"><span id="remote-job-state" class="remote-job-state"></span><span id="remote-job-task" class="remote-job-task"></span></h2>
        <div id="remote-job-output" class="remote-job-output" tabindex="0" aria-label="Job transcript"></div>
        <p id="remote-job-error" class="remote-feedback" hidden></p>
        <details id="remote-job-more" class="remote-job-more"><summary>Job details</summary><div id="remote-job-meta" class="remote-meta"></div>
          <details id="remote-job-system" class="remote-job-system" hidden><summary>Exact system instructions</summary><pre id="remote-job-system-text"></pre></details>
          <button type="button" id="remote-delete-job" data-remote="delete-job" class="danger">${icon('trash')}<span>Delete job records…</span></button></details>
      </section></div>`;
    main.querySelector('#transcript')!.after(this.scroll);
    this.composer = document.createElement('div'); this.composer.id = 'remote-composer'; this.composer.className = 'remote-composer-wrap'; this.composer.hidden = true;
    this.composer.innerHTML = pendingSettings('remote-pending-settings') + `<div id="remote-running" class="remote-running" hidden><span class="remote-running-dot" aria-hidden="true"></span><span id="remote-running-text"></span><button type="button" data-remote="view-active" id="remote-view-active">View job</button></div>`
      + `<div class="role-tab-row remote-edge" id="remote-edge">${executionToggle('remote-execution', 'remote')}<button type="button" class="remote-link" id="remote-back-chat" data-execution="local">Back to Chat</button><span class="spacer"></span><span id="remote-draft-state" class="remote-draft-state" role="status"></span></div>`
      + `<form id="remote-task-form" class="composer remote-composer" novalidate><div class="remote-context" id="remote-context">`
      + `<label class="remote-context-field" title="Host">${icon('terminal')}<span class="sr-only">Host</span><select id="remote-host"></select></label>`
      + `<label class="remote-context-field" title="Workspace">${icon('folder')}<span class="sr-only">Workspace</span><select id="remote-workspace"></select></label></div>`
      + `<textarea id="remote-prompt" rows="1" maxlength="160000" aria-label="Task for the remote agent" aria-describedby="remote-start-note"></textarea>`
      + `<div class="composer-tools"><button type="button" class="icon-button" data-action="edit-draft" title="Expand message editor" aria-label="Expand message editor">${icon('expand')}</button><button type="button" id="remote-model-button" class="model-name remote-model-button" aria-haspopup="dialog"></button><input id="remote-model" type="hidden" value="default">` + effortMarkup('remote-')
      + `<button type="button" id="remote-instructions" class="instructions-chip" aria-haspopup="dialog">${icon('instructions')}<span id="remote-instructions-name"></span></button>`
      + `<span class="spacer"></span><button type="button" id="remote-stop" class="send stop remote-stop" data-remote="stop" hidden>${icon('stop')}<span class="remote-stop-label">Stop job</span></button>`
      + `<button type="submit" id="remote-start" class="send remote-start">${icon('send')}<span class="remote-start-label">Review & start</span></button></div></form>`
      + `<div class="composer-meta remote-composer-meta"><span id="remote-start-note"></span></div>`;
    main.querySelector('.composer-region')!.append(this.composer);
    this.dialogs = document.createElement('div'); this.dialogs.id = 'remote-dialogs';
    this.dialogs.innerHTML = `<dialog id="remote-jobs-dialog" class="remote-dialog remote-jobs-dialog" aria-labelledby="remote-jobs-title"><div class="modal-head"><h2 id="remote-jobs-title">Jobs</h2><button type="button" class="icon-button" data-remote-close aria-label="Close jobs">${icon('close')}</button></div>`
      + `<div class="modal-body"><div id="remote-job-list" class="remote-job-list" aria-label="Remote jobs"></div><p id="remote-jobs-note" class="small muted"></p><div class="modal-actions"><button type="button" data-remote="new">${icon('plus')}<span>New task</span></button></div></div></dialog>`
      + `<dialog id="remote-manage-dialog" class="remote-dialog remote-manage-dialog" aria-labelledby="remote-manage-title"><div class="modal-head"><h2 id="remote-manage-title">Manage remote agents</h2><button type="button" class="icon-button" data-remote-close aria-label="Close manage">${icon('close')}</button></div><div class="modal-body">
        <div id="remote-connected" hidden>
          <section class="remote-section" aria-labelledby="remote-workspace-heading"><h3 id="remote-workspace-heading">Workspace</h3><p id="remote-workspace-note" class="remote-note"></p>
            <div id="remote-create-home"><details id="remote-create" class="remote-create"><summary>Create a workspace</summary><form id="remote-create-form"><label>Name<input id="remote-workspace-name" maxlength="80" required placeholder="Experiment"></label><button type="submit">${icon('plus')}Create workspace</button></form><p class="small muted">Reserves 2 GiB on the host. Up to four workspaces.</p></details></div>
            <details id="remote-workspace-actions"><summary>Archive or delete this workspace</summary><div class="remote-actions"><button type="button" data-remote="archive">${icon('download')}Archive on host</button><button type="button" data-remote="delete-workspace" class="danger">${icon('trash')}Delete workspace…</button></div><p class="small muted">An archive stays on the host and is not downloaded to this PC. Deleting removes the workspace files permanently; job records are kept.</p></details>
          </section>
          <section class="remote-section" aria-labelledby="remote-chat-heading"><h3 id="remote-chat-heading">Tinfoil Chat on this host</h3>
            <div id="remote-auth-home"><div id="remote-auth" class="remote-auth"><p id="remote-auth-state"></p><div class="remote-actions"><button type="button" data-remote="enroll" id="remote-enroll">Connect remote Chat…</button><button type="button" data-remote="disconnect" id="remote-disconnect" hidden>Disconnect…</button></div></div></div>
          </section>
        </div>
        <section class="remote-section" aria-labelledby="remote-hosts-heading"><h3 id="remote-hosts-heading">Hosts</h3><p id="remote-updated" class="small muted"></p>
          <div id="remote-host-home"><details id="remote-host-settings"><summary>Add a host</summary><form id="remote-host-form"><label>Display name<input id="remote-host-name" maxlength="80" required placeholder="My sandbox"></label><label>SSH alias<input id="remote-host-alias" maxlength="101" required placeholder="my-sandbox" autocapitalize="off" spellcheck="false"></label><button type="submit">${icon('plus')}Add host</button></form><p class="small muted">Uses your existing OpenSSH configuration, verified host key and login key. Workbench never asks for passwords or keys. Install the remote worker on the host first.</p></details></div>
          <button type="button" data-remote="forget" id="remote-forget">Forget this host on this PC…</button>
        </section></div></dialog>`;
    shell.after(this.dialogs);
    this.picker = new RemoteModelPicker(this.dialogs, this.$<HTMLButtonElement>('model-button'), this.$<HTMLInputElement>('model'), callbacks, () => { this.syncModel(true); this.changed(); });
    this.advanced = new RemoteAdvanced(document.getElementById('inspector')!, this.$<HTMLButtonElement>('advanced-button'), {...callbacks,pending:()=>this.renderControls()}, () => this.changed());
    this.instructions = new RemoteInstructions(this.dialogs, this.$<HTMLButtonElement>('instructions'), callbacks, () => this.changed());
    this.effort = new EffortControl('remote-',()=>({levels:capabilityFor(this.effectiveModel(),callbacks.capabilities?.()??[]).effort,value:this.advanced.values.reasoningEffort,disabled:this.busy||!this.host()||this.advanced.dirty}),level=>this.advanced.setEffort(level));
    // Reasoning is drawn only once its disclosure is opened, as in Chat.
    this.$('job-output').addEventListener('toggle', event => { const d = event.target; if (d instanceof HTMLDetailsElement && d.dataset.disclosure) { this.opened.set(d.dataset.disclosure,d.open);if(d.open)this.drawRich(d); } }, true);
    const click = (event: MouseEvent) => {
      const target = event.target as Element, close = target.closest('[data-remote-close]');
      if (close) { close.closest('dialog')?.close(); return; }
      // The jobs list is a picker and closes on a click outside it; Manage holds typed input and keeps Esc and its buttons.
      const jobs = this.$<HTMLDialogElement>('jobs-dialog');
      if (target === jobs) { const r = jobs.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) jobs.close(); return; }
      const button = target.closest<HTMLButtonElement>('[data-remote],[data-remote-job]');
      if (!button || button.disabled) return;
      // A command chosen in the menu closes it and leaves focus on the menu's button, unless the command moves focus.
      const menu = button.closest<HTMLDetailsElement>('.export-menu');
      if (menu) { menu.removeAttribute('open'); menu.querySelector<HTMLElement>('summary')?.focus(); }
      if (button.dataset.remoteJob) { this.showJob(button.dataset.remoteJob); return; }
      void this.action(button.dataset.remote!);
    };
    for (const part of [this.toolbar, this.scroll, this.composer, this.dialogs]) part.addEventListener('click', click);
    for (const id of ['jobs-dialog', 'manage-dialog']) this.$(id).addEventListener('close', () => this.returnFocus());
    this.$<HTMLFormElement>('host-form').addEventListener('submit', event => { event.preventDefault(); void this.perform({ type:'host.add', name:this.value('host-name'), alias:this.value('host-alias') }, true); });
    this.$<HTMLFormElement>('create-form').addEventListener('submit', event => { event.preventDefault(); void this.perform({ type:'workspace.create', host:this.hostID(), name:this.value('workspace-name') }); });
    this.$<HTMLFormElement>('task-form').addEventListener('submit', event => { event.preventDefault(); void this.start(); });
    this.$('prompt').addEventListener('input', () => { this.size(); this.changed(); });
    this.$('prompt').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (!this.$<HTMLButtonElement>('start').disabled) this.$<HTMLFormElement>('task-form').requestSubmit(); } });
    this.$('workspace').addEventListener('change', () => { this.changed(); this.render(); });
    this.$('host').addEventListener('change', () => { void this.switchHost(this.value('host')); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.visible) this.schedule(); else clearTimeout(this.timer); });
    addEventListener('resize', () => { if (this.visible) this.size(); });
  }
  private $<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById('remote-' + id) as T; }
  private value(id: string): string { return this.$<HTMLInputElement>(id).value; }
  private hostID(): string { return this.local.selectedHost ?? ''; }
  private host() { return this.local.hosts.find(h => h.id === this.hostID()); }
  private activeJob(): RemoteJob | undefined { return this.overview?.jobs.find(j => remoteActive(j.status)); }
  private feedback(message: string, error = false): void { const node = this.$('feedback'); node.hidden = !message; node.classList.toggle('danger', error); const text = document.createElement('span'); text.textContent = message; const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Dismiss'; dismiss.addEventListener('click', () => { node.hidden = true; }); node.replaceChildren(text, dismiss); }
  private opener: HTMLElement | null = null;
  private openDialog(id: string): void { this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null; openModal(this.$<HTMLDialogElement>(id)); }
  private returnFocus(): void { const target = this.opener; this.opener = null; if (target?.isConnected && target.getClientRects().length) target.focus(); else if (this.visible) this.focusComposer(); }
  /** The message box grows with the task, as Chat's does, up to a limit. */
  private size(): void {
    const input = this.$<HTMLTextAreaElement>('prompt');
    input.style.height = 'auto';
    const minimum = parseFloat(getComputedStyle(input).minHeight) || 48, viewport = window.visualViewport?.height ?? innerHeight;
    input.style.height = `${Math.min(innerWidth <= 1000 ? Math.max(minimum, Math.min(170, viewport * .27)) : 240, Math.max(minimum, input.scrollHeight))}px`;
  }
  focusComposer(): void {
    const prompt = this.$<HTMLTextAreaElement>('prompt');
    if (this.host() && !prompt.readOnly) prompt.focus({ preventScroll: true });
    else (this.$('setup-slots').querySelector<HTMLElement>('input,button,summary') ?? this.$('heading')).focus({ preventScroll: true });
  }
  /** Remembers where the shown view is scrolled before another is shown. */
  private keepScroll(): void {
    if (this.shown === null || this.scroll.hidden) return;
    const s = this.scroll; this.scrolls.set(this.shown, { top: s.scrollTop, bottom: s.scrollHeight - s.scrollTop - s.clientHeight < 80 });
  }
  /** Shows a job. From the jobs list, focus then goes to the job's heading rather than back to the list's opener. */
  private showJob(id: string): void {
    if (this.job !== id) { this.keepScroll(); this.job = id; this.lastDetail = ''; }
    this.render();
    const dialog = this.$<HTMLDialogElement>('jobs-dialog');
    if (dialog.open) { this.opener = this.$('job-title'); dialog.close(); } else this.$('job-title').focus({ preventScroll: true });
    void this.refresh();
  }
  newTask(): void {
    if (this.job) { this.keepScroll(); this.job = ''; this.lastDetail = ''; }
    this.render();
    const dialog = this.$<HTMLDialogElement>('jobs-dialog');
    if (dialog.open) { this.opener = null; dialog.close(); } else this.focusComposer();
  }
  /** Moves a block between its home and the setup callout, only when it is elsewhere, keeping focus inside it. */
  private place(node: HTMLElement, parent: HTMLElement, first = false): void {
    if (node.parentElement === parent) return;
    const focused = node.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    if (first) parent.prepend(node); else parent.append(node);
    focused?.focus({ preventScroll: true });
  }
  /** The model the host will use: the draft's, or the host's own default. */
  private effectiveModel(): string { const model = this.value('model').trim() || 'default'; return model === 'default' ? this.overview?.auth.defaultModel ?? '' : model; }
  /** Effort and thinking follow the model's capability. A choice in the picker resets them; the list loading or the host
   * reporting its default only redraws them. */
  private syncModel(reset = false): void {
    const id = this.effectiveModel(), key = `${id}|${this.callbacks.capabilities?.().length ?? 0}`;
    if (!reset && key === this.modelKey) return;
    this.modelKey = key; this.advanced.setModel(id, reset);
  }
  private readDraft(): RemoteDraft {
    const prior = { ...emptyRemoteDraft(), ...this.host()?.draft }, instructions = this.instructions.current;
    const result: RemoteDraft = { ...prior, ...this.advanced.values, prompt: this.value('prompt'), workspace: this.overview ? this.value('workspace') : prior.workspace,
      systemPrompt: instructions.text, systemPromptName: instructions.text.trim() ? instructions.name : '' };
    const model = this.value('model').trim(); if (model && !/[\x00-\x1f\x7f]/.test(model)) result.model = model;
    return result;
  }
  private hydrate(): void {
    const draft = { ...emptyRemoteDraft(), ...this.host()?.draft };
    this.$<HTMLTextAreaElement>('prompt').value = draft.prompt; this.$<HTMLInputElement>('model').value = draft.model;
    this.advanced.hydrate(draft,this.hostID()); this.instructions.hydrate(draft.systemPrompt, draft.systemPromptName);
    // Saving is quiet once it works; only a save in progress or a failed one is shown.
    this.revision = this.saved = 0; this.$('draft-state').textContent = '';
    this.picker.render(this.overview?.auth.defaultModel ?? null); this.modelKey = ''; this.syncModel();
    if (this.visible) this.size();
  }
  private changed(): void { this.revision++; this.$('draft-state').textContent = 'Saving draft…'; clearTimeout(this.draftTimer); this.draftTimer = setTimeout(() => { void this.flush(); }, 450); this.renderControls(); }
  async flush(): Promise<boolean> {
    clearTimeout(this.draftTimer); await this.saving;
    if (!this.bridge?.remote || !this.host() || this.saved === this.revision) return true;
    const host = this.hostID(), draft = this.readDraft(), revision = this.revision;
    this.saving = (async () => {
      try { await this.bridge!.remote!({ type:'draft.set', host, draft }); if (this.hostID() === host) { this.host()!.draft = draft; this.saved = revision; this.$('draft-state').textContent = this.saved === this.revision ? '' : 'Saving draft…'; } return true; }
      catch (error) { this.feedback(error instanceof Error ? error.message : 'Draft could not be saved.', true); this.$('draft-state').textContent = 'Draft not saved'; return false; }
    })();
    return this.saving;
  }
  get configured(): boolean { return this.local.hosts.length > 0; }
  /** The selected host's cached jobs, using the same rows as the conversation sidebar. Reading this never opens SSH. */
  sidebar(filter: string): { html:string; count:number; refreshing:boolean; disabled:boolean } {
    const host=this.host(), overview=this.overview, names=new Map(overview?.workspaces.map(w=>[w.id,workspaceName(w)])??[]);
    const jobs=(overview?.jobs??[]).filter(j=>[this.jobTitle(j),j.prompt??'',names.get(j.workspace)??''].some(text=>text.toLowerCase().includes(filter)));
    const groups=new Map<string,RemoteJob[]>();
    for(const job of jobs){const group=groups.get(job.workspace)??[];group.push(job);groups.set(job.workspace,group);}
    const rows=[...groups].map(([workspace,list])=>`<section class="thread-group" data-key="remote-${workspace}" aria-label="${e(names.get(workspace)??'Workspace '+workspace.slice(0,8))}"><h3>${e(names.get(workspace)??'Workspace '+workspace.slice(0,8))}</h3>${list.map(j=>{
      const selected=this.visible&&this.job===j.id,title=this.jobTitle(j);
      return `<div class="thread-row" data-key="${j.id}"><button type="button" class="thread${selected?' selected':''}" data-action="remote-job" data-job-id="${j.id}" aria-current="${selected?'page':'false'}" title="${e(title)}">${icon(remoteActive(j.status)?'terminal':'chat')}<span class="thread-copy"><strong>${e(title)}</strong><small>${e(outcome(j))}${when(j.createdAt)?` · ${e(when(j.createdAt))}`:''}</small></span></button></div>`;
    }).join('')}</section>`).join('');
    const empty=!overview?(this.offline?'Connect to the host to load its tasks.':'Loading remote tasks…'):filter?'No matching remote tasks.':'No remote tasks yet.';
    return {count:jobs.length,refreshing:this.refreshing,disabled:this.busy||this.refreshing||!host,
      html:`<p class="nav-empty remote-thread-host">${e(host?.name??'Remote')}${this.offline?' · Last known':''}</p>`+(rows||`<p class="nav-empty">${empty}</p>`)+(overview?.jobsTruncated?'<p class="nav-empty">Newest 200 tasks. Older records remain on the host.</p>':'')};
  }
  selectJob(id:string):void { if(this.visible&&this.overview?.jobs.some(j=>j.id===id))this.showJob(id); }
  refreshJobs():Promise<void> { return this.refresh(); }
  private renderAvailability(): void {
    this.$('execution').hidden = !this.configured;
    this.$('back-chat').hidden = this.configured;
    this.callbacks.configurationChanged();
  }
  /** Read the saved host list without opening Remote or contacting a host. Opening during startup shares this read. */
  loadConfiguration(): Promise<void> {
    if (!this.bridge?.remote) return Promise.resolve();
    if (this.configurationLoad) return this.configurationLoad;
    const previous = this.local;
    return this.configurationLoad = this.bridge.remote({ type:'load' }).then(result => {
      // A host added or forgotten while the read was pending takes precedence over its older snapshot.
      if (this.local === previous) { this.local = result.local; this.renderAvailability(); }
      this.configurationKnown = true;
    }).finally(() => { this.configurationLoad = undefined; });
  }
  async open(): Promise<void> {
    this.visible = true; this.toolbar.hidden = this.scroll.hidden = this.composer.hidden = false;
    this.advanced.panel.hidden=false;this.reading={...this.callbacks.reading()};
    this.shell.classList.add('remote-mode'); document.getElementById('remote-nav')?.setAttribute('aria-current', 'page');
    // A configuration already known to be empty keeps the task box hidden while it is read again.
    const supported = !!this.bridge?.remote, unconfigured = this.configurationKnown && !this.local.hosts.length;
    this.$('unavailable').hidden = supported; this.$('welcome').hidden = !supported; this.$('task-form').hidden = !supported || unconfigured;
    this.composer.querySelector<HTMLElement>('.remote-composer-meta')!.hidden = unconfigured;
    if (!supported) { this.$('heading').focus(); return; }
    try { await this.loadConfiguration(); this.hydrate(); this.render(); this.focusComposer(); await this.refresh(); }
    catch (error) { this.feedback(String((error as Error).message), true); this.render(); }
    // Names and logos come from Tinfoil's public list; Chat may not have loaded it yet.
    if (this.callbacks.loadModels && this.callbacks.modelCatalogState?.() === 'idle')
      void this.callbacks.loadModels().catch(() => {}).finally(() => { if (this.visible) { this.picker.render(this.overview?.auth.defaultModel ?? null); this.syncModel(); } });
  }
  async hide(): Promise<boolean> {
    if (!await this.flush()) return false;
    for (const dialog of this.dialogs.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
    // Hidden, the view loses its scroll offset; it is put back from what is kept here when shown again.
    this.effort.close();this.advanced.panel.hidden=true;
    this.keepScroll(); this.shown = null; this.visible = false; this.epoch++; clearTimeout(this.timer);
    this.toolbar.hidden = this.scroll.hidden = this.composer.hidden = true;
    this.shell.classList.remove('remote-mode'); document.getElementById('remote-nav')?.removeAttribute('aria-current');
    return true;
  }
  private schedule(): void { clearTimeout(this.timer); if (this.visible && !document.hidden) this.timer = setTimeout(() => { void this.refresh(); }, 15000); }
  private async switchHost(id: string): Promise<void> {
    if(this.advanced.dirty){this.$<HTMLSelectElement>('host').value=this.hostID();this.feedback('Apply or discard pending Advanced changes before changing hosts.',true);this.advanced.open();return;}
    if (this.busy || !await this.flush()) { this.$<HTMLSelectElement>('host').value = this.hostID(); return; }
    try {
      const result = await this.bridge!.remote!({ type:'host.select', host:id });
      this.epoch++; clearTimeout(this.timer); this.overview = undefined; this.detail = undefined; this.keepScroll(); this.job = ''; this.lastDetail = ''; this.feedback(''); this.$('connection').hidden = true;
      this.local = result.local; this.hydrate(); this.render(); await this.refresh();
    } catch (error) { this.$<HTMLSelectElement>('host').value = this.hostID(); this.feedback((error as Error).message, true); }
  }
  /** Takes a controller response. The shown job follows its selection only after a start (`adopt`) or when it settles an
   * unconfirmed start; a refresh never moves the person off a new task. */
  private accept(result: RemoteResponse, adopt = false): void {
    const pending = this.host()?.pendingJob, reconciled = !!pending && result.selectedJob === pending && this.saved === this.revision;
    this.local = result.local; if (result.overview) { this.overview = result.overview; this.offline = false; }
    if (reconciled && this.host()?.draft.prompt === '') { this.$<HTMLTextAreaElement>('prompt').value = ''; this.size(); }
    if (result.selectedJob && (adopt || result.selectedJob === pending) && result.selectedJob !== this.job) { this.keepScroll(); this.job = result.selectedJob; this.lastDetail = ''; }
    // Any job's detail updates its row (Stop from New task returns the stopped job); only the shown job keeps the detail.
    if (result.detail) {
      const d = result.detail, summary = this.overview?.jobs.find(j => j.id === d.id);
      if (summary) Object.assign(summary, { status:d.status, error:d.error, reason:d.reason, rounds:d.rounds, calls:d.calls, verified:d.verified });
      if (!remoteActive(d.status)) for (const w of this.overview?.workspaces ?? []) w.activeJobs = w.activeJobs.filter(id => id !== d.id);
      if (d.id === this.job) this.detail = d;
    }
    if (result.message) this.feedback(result.message);
  }
  private async refresh(): Promise<void> {
    if (this.refreshing) { this.refreshAgain = true; return; }
    if (!this.host() || !this.visible || this.busy) { this.schedule(); return; }
    const host = this.hostID(), epoch = this.epoch; this.refreshing = true; this.renderControls();
    try {
      const result = await this.bridge!.remote!({ type:'refresh', host, ...(this.job ? { id:this.job } : {}) });
      if (host !== this.hostID() || epoch !== this.epoch) return;
      this.accept(result); this.$('connection').hidden = true;
      if (this.job && !this.overview?.jobs.some(j => j.id === this.job)) { this.job = ''; this.detail = undefined; }
      this.render();
    } catch (error) { if (host === this.hostID() && epoch === this.epoch) { this.offline = true; this.$('connection').hidden = false; this.$('connection').textContent = `Connection unavailable. Showing the last known state; jobs may still be running. ${(error as Error).message}`; this.render(); } }
    finally { this.refreshing = false; this.renderControls(); if (this.refreshAgain && this.visible && !this.busy) { this.refreshAgain = false; void this.refresh(); } else this.schedule(); }
  }
  private async perform(command: RemoteCommand, reload = false): Promise<void> {
    if (this.busy || !await this.flush()) return;
    this.busy = true; this.epoch++; clearTimeout(this.timer); this.renderControls(); this.feedback('Working…');
    try {
      const result = await this.bridge!.remote!(command), started = command.type === 'submit' && !result.cancelled;
      this.accept(result, started);
      if (!result.message) this.feedback(result.cancelled ? 'Action cancelled.' : '');
      if (!result.cancelled && (reload || command.type === 'host.remove')) { this.overview = undefined; this.detail = undefined; this.job = ''; this.hydrate(); }
      if (command.type === 'host.add' && !result.cancelled) { this.$<HTMLDetailsElement>('host-settings').open = false; this.$<HTMLInputElement>('host-name').value = ''; this.$<HTMLInputElement>('host-alias').value = ''; }
      if (command.type === 'workspace.create' && !result.cancelled) { this.$<HTMLInputElement>('workspace-name').value = ''; this.$<HTMLSelectElement>('workspace').value = ''; this.$<HTMLDetailsElement>('create').open = false; }
      // A started job is what the person follows next: it takes the transcript, and the composer is ready for another.
      if (started) { this.hydrate(); this.detail = undefined; }
      if (command.type === 'job.delete' && !result.cancelled) { this.job = ''; this.detail = undefined; }
      this.render();
      if (started) this.$('job-title').focus({ preventScroll: true });
    } catch (error) { this.feedback((error as Error).message, true); try { this.local = (await this.bridge!.remote!({ type:'load' })).local; } catch { /* The last known state stays. */ } this.render(); }
    finally { this.busy = false; this.renderControls(); this.schedule(); }
    if (reload || command.type === 'submit') await this.refresh();
  }
  /** Checks what the host cannot check before the review opens: values being typed in Advanced, and settings an older
   * worker would refuse. The draft and its text stay as they are. */
  private async start(): Promise<void> {
    if(this.advanced.dirty){this.feedback('Apply or discard pending Advanced changes before starting.',true);this.advanced.open();return;}
    const problem = this.advanced.invalid();
    if (problem) { this.feedback(`${problem.message} Your task text remains saved.`, true); this.advanced.open(problem.field); return; }
    if (!this.value('model').trim() || /[\x00-\x1f\x7f]/.test(this.value('model'))) { this.$('model-button').focus(); this.feedback('Choose a model, or the host default. Your task text remains saved.', true); return; }
    if (this.overview && this.overview.features?.jobSettings !== true && customGeneration(this.readDraft())) { this.feedback('This host’s worker doesn’t accept system instructions or generation settings yet. Set them back to None and the defaults, or update the worker. Your task text remains saved.', true); return; }
    if (!await this.flush()) return;
    await this.perform({ type:'submit', host:this.hostID() });
  }
  private stopLabel(text: string): void { this.$('stop').querySelector('span')!.textContent = text; }
  private async action(name: string): Promise<void> {
    if (name === 'refresh') { await this.refresh(); return; }
    if (name === 'new') { this.newTask(); return; }
    if (name === 'jobs') { this.render(); this.openDialog('jobs-dialog'); (this.$('job-list').querySelector<HTMLElement>('[aria-pressed=true]') ?? this.$('job-list').querySelector<HTMLElement>('button'))?.focus(); return; }
    if (name === 'manage') { this.render(); this.openDialog('manage-dialog'); return; }
    if (name === 'view-active') { const active = this.activeJob(); if (active) this.showJob(active.id); return; }
    const host = this.hostID(), workspace = this.value('workspace');
    if (name === 'forget') await this.perform({ type:'host.remove', host });
    if (name === 'enroll' || name === 'disconnect') await this.perform({ type:name, host });
    if (name === 'archive' || name === 'delete-workspace') await this.perform({ type:name === 'archive' ? 'workspace.archive' : 'workspace.delete', host, id:workspace });
    // One job runs at a time on a host, so Stop is for that job, wherever the person is.
    if (name === 'stop' && !this.stopping) {
      const active = this.activeJob(); if (!active) return;
      this.stopping = true; this.stopLabel('Stopping…'); this.renderControls();
      try { this.accept(await this.bridge!.remote!({ type:'job.stop', host, id:active.id })); this.render(); }
      catch (error) { this.feedback(`Stop is not confirmed. ${(error as Error).message}`, true); }
      finally { this.stopping = false; this.stopLabel('Stop job'); this.renderControls(); }
      // The host's own view of the stop (its workspace and job lists) follows at once, not at the next poll.
      await this.refresh();
    }
    if (name === 'delete-job') await this.perform({ type:'job.delete', host, id:this.job });
  }
  private jobRow(j: RemoteJob, named: Map<string, string>): string {
    const chosen = this.job === j.id, elsewhere = j.workspace !== this.value('workspace') && named.has(j.workspace) ? ` · ${e(named.get(j.workspace)!)}` : '';
    return `<button type="button" data-key="${j.id}" data-remote-job="${j.id}" aria-pressed="${chosen}" class="remote-job-row${chosen ? ' selected' : ''}"><span class="remote-job-copy"><strong>${e(this.jobTitle(j))}</strong><small><span class="remote-status${remoteActive(j.status) ? ' active' : ''}${failed(j) ? ' failed' : ''}">${e(outcome(j))}</span> · ${e(when(j.createdAt))}${elsewhere}</small></span></button>`;
  }
  private render(): void {
    this.renderAvailability();
    const host = this.host(), overview = this.overview, workspaces = overview?.workspaces ?? [];
    const shared = (name: string) => this.local.hosts.filter(h => h.name === name).length > 1;
    updateMarkup(this.$('host'), this.local.hosts.map(h => `<option value="${h.id}" title="SSH alias ${e(h.alias)}">${e(h.name)}${shared(h.name) ? ` · ${e(h.alias)}` : ''}</option>`).join('') || '<option value="">No hosts added</option>'); this.$<HTMLSelectElement>('host').value = this.hostID();
    this.$('host').title = host ? `${host.name} · SSH alias ${host.alias}` : 'Host';
    // With no saved host the task box has nothing to do; setup takes the room, and Back to Chat stays on the edge.
    const unconfigured = this.configurationKnown && !this.local.hosts.length;
    this.$('task-form').hidden = unconfigured || !this.bridge?.remote; this.composer.querySelector<HTMLElement>('.remote-composer-meta')!.hidden = unconfigured;
    this.$<HTMLDetailsElement>('host-settings').open = !host || this.$<HTMLDetailsElement>('host-settings').open;
    this.$('connected').hidden = !host; this.$('forget').hidden = !host;
    const selected = this.value('workspace') || host?.draft.workspace || '';
    const placeholder = !host ? 'No workspace' : !overview ? (this.offline ? 'Unavailable while disconnected' : 'Loading workspaces…') : workspaces.length ? 'Choose a workspace' : 'No workspace yet';
    updateMarkup(this.$('workspace'), `<option value="">${placeholder}</option>` + workspaces.map(w => `<option value="${w.id}">${e(workspaceName(w))}${w.activeJobs.length ? ' · running' : ''}</option>`).join(''));
    this.$<HTMLSelectElement>('workspace').value = workspaces.some(w => w.id === selected) ? selected : workspaces.some(w => w.id === host?.draft.workspace) ? host!.draft.workspace : '';
    const workspace = workspaces.find(w => w.id === this.value('workspace'));
    this.$('workspace-note').textContent = workspace ? `${workspaceName(workspace)} · ID ${workspace.id} · 2 GiB · ${workspace.activeJobs.length ? 'Job running' : workspace.provisioningFailed ? 'Setup failed' : 'Ready'}` : overview ? (workspaces.length ? 'Choose a workspace above the task box.' : 'This host has no workspace yet.') : 'Workspaces appear once the host responds.';
    this.$('auth-state').textContent = overview ? (overview.auth.enrolled ? 'Connected. Subscription access is checked when each job starts.' : 'Connect a dedicated Tinfoil Chat session on this host to run jobs. You sign in again in a fresh window; your Workbench sign-in is not copied.') : this.offline ? 'Remote Chat status unknown while disconnected.' : 'Checking remote Chat connection…';
    this.$('enroll').textContent = overview?.auth.enrolled ? 'Reconnect remote Chat…' : 'Connect remote Chat…'; this.$('disconnect').hidden = !overview?.auth.enrolled;
    // Only what blocks a first job reaches the page; the rest stays in Manage.
    const needsAuth = !!host && !!overview && !overview.auth.enrolled, needsWorkspace = !!host && !!overview && !workspaces.length;
    this.place(this.$('host-settings'), !host ? this.$('setup-slots') : this.$('host-home'));
    this.place(this.$('auth'), needsAuth ? this.$('setup-slots') : this.$('auth-home'), true);
    this.place(this.$('create'), needsWorkspace ? this.$('setup-slots') : this.$('create-home'));
    this.$('enroll').classList.toggle('primary', needsAuth);
    this.$('setup').hidden = !!host && !needsAuth && !needsWorkspace;
    this.$('setup-title').textContent = host ? `Before the first task on ${host.name}` : 'Add a host';
    this.$('welcome-title').textContent = host ? 'What should the agent do?' : 'Run tasks on your own host';
    this.$('welcome-text').textContent = !host ? 'Remote tasks run over SSH in a workspace on a Linux host you control, and keep running after Workbench closes.'
      : workspace ? `Each task is a new job in ${workspaceName(workspace)} on ${host.name}; files stay between jobs. ${SAFETY}` : `Tasks run in a workspace on ${host.name} and keep running after Workbench closes.`;
    this.picker.render(overview?.auth.defaultModel ?? null); this.syncModel();
    this.advanced.setSupported(overview ? overview.features?.jobSettings === true : undefined); this.advanced.renderTrigger();
    this.$('updated').textContent = overview ? `${this.offline ? 'Last known' : 'Updated'} ${date(overview.checkedAt)} · refreshes every 15 s while visible` : '';
    this.$('refresh').textContent = overview ? `Refresh · ${this.offline ? 'last known' : 'updated'} ${when(overview.checkedAt)}` : 'Refresh';
    this.$('crumb').textContent = host ? `Remote · ${host.name}` : 'Remote';
    this.$('crumb').title = host ? `Remote · ${host.name}. Manage host and workspace` : 'Manage remote hosts and workspaces';
    const jobs = overview?.jobs ?? [], named = new Map(workspaces.map(w => [w.id, workspaceName(w)]));
    updateMarkup(this.$('job-list'), jobs.map(j => this.jobRow(j, named)).join('') || '<p class="remote-empty" data-key="empty">No jobs on this host yet.</p>');
    this.$('jobs-title').textContent = host ? `Jobs on ${host.name}` : 'Jobs';
    this.$('jobs-note').textContent = overview?.jobsTruncated ? 'Showing the newest 200 jobs. Older records remain on the host.' : '';
    updateMarkup(this.$('recent-list'), jobs.slice(0, 5).map(j => this.jobRow(j, named)).join(''));
    this.$('recent').hidden = !jobs.length || !host;
    this.$('jobs-count').textContent = jobs.length ? String(jobs.length) : '';
    const jobsLabel = `Jobs${jobs.length ? `, ${jobs.length}` : ''}${this.activeJob() ? ', one running' : ''}`;
    this.$('jobs-button').setAttribute('aria-label', jobsLabel); this.$('jobs-button').title = jobsLabel;
    this.renderDetail(); this.renderControls();
  }
  private renderControls(): void {
    const host = this.host(), overview = this.overview, connected = !!overview && !this.offline, active = this.activeJob(), selected = overview?.workspaces.find(w => w.id === this.value('workspace'));
    this.$<HTMLSelectElement>('host').disabled = this.busy || !this.local.hosts.length; this.$<HTMLButtonElement>('refresh').disabled = this.busy || this.refreshing || !host;
    const prompt = this.$<HTMLTextAreaElement>('prompt'); prompt.readOnly = this.busy || !host;
    prompt.placeholder = !host ? 'Add a host to write a task' : selected ? `New task for ${workspaceName(selected)}…` : 'Describe the task and how to check the result…';
    this.$<HTMLSelectElement>('workspace').disabled = this.busy || !overview;
    this.$<HTMLButtonElement>('model-button').disabled=this.busy||!host||this.advanced.dirty;this.$<HTMLButtonElement>('advanced-button').disabled=this.busy||!host;
    this.$('pending-settings').classList.toggle('hidden',!this.advanced.dirty);this.effort?.render();
    this.instructions.setLocked(this.busy || !host);
    this.$<HTMLButtonElement>('forget').disabled = this.busy || !host;
    for (const el of this.dialogs.querySelectorAll<HTMLButtonElement>('#remote-manage-dialog form button, [data-remote="enroll"], [data-remote="disconnect"], [data-remote="archive"], [data-remote="delete-workspace"]')) el.disabled = this.busy;
    for (const el of this.scroll.querySelectorAll<HTMLButtonElement>('form button, [data-remote="enroll"], [data-remote="delete-job"]')) el.disabled = this.busy;
    for (const el of document.querySelectorAll<HTMLButtonElement>('[data-remote="archive"], [data-remote="delete-workspace"]')) el.disabled = this.busy || !connected || !selected || !!selected.activeJobs.length;
    for (const el of document.querySelectorAll<HTMLButtonElement>('[data-remote="enroll"], [data-remote="disconnect"]')) { el.disabled = this.busy || !!active; el.title = active ? 'Stop the running job before changing remote Chat.' : ''; }
    // Stop belongs to the composer, as in Chat. The strip offers the running job when another view is shown.
    this.$('running').hidden = !active || this.job === active.id;
    if (active) this.$('running-text').textContent = `${this.offline ? 'Last known: ' : ''}${outcome(active)} · ${firstLine(active.prompt, 'Job ' + active.id.slice(0, 8)).slice(0, 80)}`;
    this.$('jobs-dot').hidden = !active;
    // While the host's job runs, Stop takes Start's place, as in Chat, and focus in that place moves with it.
    const stop = this.$<HTMLButtonElement>('stop'), startButton = this.$<HTMLButtonElement>('start'), slot = document.activeElement === stop || document.activeElement === startButton;
    stop.hidden = !active; stop.disabled = this.stopping; startButton.hidden = !!active;
    stop.title = active ? `Stop the running job: ${firstLine(active.prompt, 'Job ' + active.id.slice(0, 8)).slice(0, 80)}` : '';
    const blocked = this.busy || !connected || !overview?.auth.enrolled || !selected || !!selected.provisioningFailed || !!active || !!host?.pendingJob || !prompt.value.trim();
    startButton.disabled = blocked;
    const shown = active ? stop : startButton; if (slot && document.activeElement !== shown) (shown.disabled ? this.$('prompt') : shown).focus();
    const problem = this.advanced.invalid(), unsupported = !!overview && overview.features?.jobSettings !== true && customGeneration({ ...this.advanced.values, systemPrompt: this.instructions.current.text, systemPromptName: '' });
    const note = !host ? 'Add a host to start.' : host.pendingJob ? 'The last start is unconfirmed. Refresh before trying again.' : active ? 'One job at a time on this host. Wait for it to finish, or stop it.' : this.offline ? 'Reconnect before starting a new job.'
      : !overview ? 'Connecting to the host…' : !overview.auth.enrolled ? 'Connect Tinfoil Chat on this host first.' : !overview.workspaces.length ? 'Create a workspace first.' : !selected ? 'Choose a workspace above the task box.'
      : selected.provisioningFailed ? 'This workspace failed to set up. Choose another, or delete it in Manage.' : problem ? `Fix a value in Advanced: ${problem.message}`
      : unsupported ? 'This host’s worker doesn’t accept system instructions or generation settings yet.' : 'Ctrl+Enter to review and start · Enter for a new line';
    this.$('start-note').textContent = note; this.$('start-note').classList.toggle('danger', !!problem || unsupported);
    startButton.title = blocked && prompt.value.trim() ? note : 'Review and start (Ctrl+Enter)';
    for (const el of document.querySelectorAll<HTMLButtonElement>('[data-remote="delete-job"]')) { const job = overview?.jobs.find(j => j.id === this.job); el.disabled = this.busy || !connected || !job || remoteActive(job.status); }
    this.callbacks.navigationChanged();
  }
  /** Draws an open reasoning disclosure's text. */
  private drawRich(details: HTMLDetailsElement): void {
    const host = details.querySelector<HTMLElement>('[data-rich-id]'); if (!host) return;
    const source = this.reasoningSources.get(host.dataset.richId!);
    if (source !== undefined) this.richText.render(host, source, { markdown:this.reading.markdown, math:this.reading.math, codeTools:false });
  }
  private renderMeta(job: RemoteJob, detail?: RemoteDetail): void {
    const source = detail ?? job, workspace = this.overview?.workspaces.find(w => w.id === job.workspace), usage = source.usage, settings = detail?.settings;
    const model = source.model ? this.picker.model(source.model) : null;
    const rows: [string, string][] = [['Job ID', job.id], ['Workspace', workspace ? `${workspaceName(workspace)} (${job.workspace.slice(0, 8)})` : `${job.workspace.slice(0, 8)} (deleted or unavailable)`], ['Model', source.model ? (model!.name !== source.model ? `${model!.name} (${source.model})` : source.model) : ''],
      ...(settings ? [['System instructions', settings.systemPrompt.trim() ? settings.systemPromptName || 'Custom instructions' : 'None'], ['Temperature', settings.temperature === null ? 'Provider default' : String(settings.temperature)],
        ['Thinking effort', effortName(settings.reasoningEffort)], ['Thinking', thinkingName(settings.thinkingMode)], ['Output limit', `${settings.maxTokens.toLocaleString()} tokens per round`], ['Limits', limitsSummary(settings)]] as [string, string][] : []),
      ['Created', date(job.createdAt)], ['Started', date(source.startedAt)], ['Finished', date(source.finishedAt)], ['Rounds', String(source.rounds ?? 0)], ['Tool calls', String(source.calls ?? 0)],
      ['Tokens', usage ? `${usage.input.toLocaleString()} in · ${usage.output.toLocaleString()} out` : ''], ['Attestation', source.verified ? 'Verified' : 'Not reported'], ['Outcome code', source.reason ?? '']];
    updateMarkup(this.$('job-meta'), `<dl>${rows.filter(([, value]) => value).map(([name, value]) => `<div data-key="meta-${e(name)}"><dt>${e(name)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`);
    // The exact text the job started with, read only. Written only when it changes, so a selection inside it survives.
    const system = settings?.systemPrompt ?? '', text = this.$('job-system-text');
    this.$('job-system').hidden = !system.trim();
    if (text.textContent !== system) text.textContent = system;
  }
  private renderDetail(): void {
    const job = this.overview?.jobs.find(j => j.id === this.job);
    this.$('job-detail').hidden = !job; this.$('welcome').hidden = !!job || !this.bridge?.remote;
    const title = job ? this.jobTitle(job) : 'New task';
    this.$('heading').textContent = title; this.$('heading').title = job ? `${title}. Rename task (saved on this PC)` : title;this.$<HTMLButtonElement>('heading').disabled=!job;
    const key = job ? job.id : '';
    if (!job) { this.restoreView(key); return; }
    const detail = this.detail?.id === job.id ? this.detail : undefined, active = remoteActive(job.status), stamp = when(detail?.finishedAt ?? detail?.startedAt ?? job.createdAt);
    const state = this.$('job-state'); state.textContent = `${this.offline ? 'Last known: ' : ''}${outcome(job)}${stamp ? ' · ' + stamp : ''}`; state.classList.toggle('active', active); state.classList.toggle('failed', failed(job));
    this.$('job-task').textContent = firstLine(job.prompt, 'Job ' + job.id.slice(0, 8));
    this.$('job-error').hidden = !job.error; this.$('job-error').textContent = job.error ?? ''; this.$('job-error').classList.toggle('danger', failed(job));
    this.renderMeta(job, detail);
    const model = job.model ? this.picker.model(job.model) : null, serialized = JSON.stringify([detail ?? job, model?.name, this.offline,this.reading.markdown,this.reading.math,this.reading.reasoning,[...this.raw]]);
    if (this.lastDetail === serialized) { this.restoreView(key); return; }
    const selection = window.getSelection(); if (selection && !selection.isCollapsed && this.$('job-output').contains(selection.anchorNode)) return;
    const s = this.scroll, stick = this.shown === key && s.scrollHeight - s.scrollTop - s.clientHeight < 110;
    this.lastDetail = serialized;
    const output = this.$('job-output');
    if (!detail) updateMarkup(output, '<p class="muted" data-key="loading">Loading this job’s transcript…</p>');
    else {
      const view = transcriptView(job, detail, model, active,this.reading,this.opened,this.raw);
      updateMarkup(output, view.html); this.reasoningSources = view.reasoning; this.answers = view.rich;
      // Islands keep their DOM between polls; the renderer parses only text that changed.
      for (const host of output.querySelectorAll<HTMLElement>('[data-rich-id]')) {
        const source = view.rich.get(host.dataset.richId!);
        if (source !== undefined) this.richText.render(host, source, { markdown:!this.raw.has(host.dataset.richId!)&&this.reading.markdown, math:!this.raw.has(host.dataset.richId!)&&this.reading.math, codeTools:false });
        else { const d = host.closest('details'); if (d?.open) this.drawRich(d); }
      }
    }
    this.callbacks.rendered();
    // A running job that is followed at its end stays at its end, as a streaming chat does.
    if (stick) s.scrollTop = s.scrollHeight; else this.restoreView(key);
  }
  updateReading(reading:ViewPreferences):void {
    if(this.reading.reasoning!==reading.reasoning){this.opened.clear();for(const d of this.$('job-output').querySelectorAll<HTMLDetailsElement>('.reasoning'))d.open=reading.reasoning==='expanded';}
    const changed=this.reading.markdown!==reading.markdown||this.reading.math!==reading.math||this.reading.reasoning!==reading.reasoning;
    this.reading={...reading};if(changed&&this.visible){this.lastDetail='';this.renderDetail();}
  }
  get hasPendingSettings():boolean {return this.advanced.dirty;}
  // The pending bar hides once it has acted; focus pressed there returns to the task box.
  async applySettings():Promise<void> {const bar=this.barFocused();if(this.advanced.apply()){await this.flush();if(bar)this.focusComposer();}}
  discardSettings():void {const bar=this.barFocused();this.advanced.discard();if(bar)this.focusComposer();}
  private barFocused():boolean {return this.$('pending-settings').contains(document.activeElement);}
  async editDraft():Promise<void> {
    if(this.busy||!this.host()||!await this.flush())return;
    const host=this.hostID();this.callbacks.edit({title:'Edit task',content:this.value('prompt'),note:'Saved to this host’s task draft. Nothing is sent to the agent.',save:async content=>{
      if(this.hostID()!==host||this.busy)return false;this.$<HTMLTextAreaElement>('prompt').value=content;this.size();this.changed();return this.flush();
    }});
  }
  async answerAction(action:string,id:string):Promise<void> {
    const content=this.answers.get(id);if(content===undefined)return;
    if(action==='copy-reply'){await this.callbacks.copy(content);return;}
    if(this.raw.has(id))this.raw.delete(id);else this.raw.add(id);this.lastDetail='';this.renderDetail();
  }
  private jobTitle(job:RemoteJob):string {return this.host()?.jobTitles?.[job.id]??firstLine(job.prompt,'Job '+job.id.slice(0,8));}
  get title():string {const job=this.overview?.jobs.find(j=>j.id===this.job);return job?this.jobTitle(job):'New task';}
  get canRename():boolean {return !!this.job;}
  async rename(title:string):Promise<boolean> {
    const host=this.hostID(),job=this.job;if(!host||!job||!await this.flush())return false;
    try{const response=await this.bridge!.remote!({type:'job.rename',host,id:job,title});if(this.hostID()===host){this.local=response.local;this.render();}return true;}
    catch(error){this.feedback((error as Error).message,true);return false;}
  }
  /** Shows a view where it was left; a job seen for the first time opens at its latest output. */
  private restoreView(key: string): void {
    if (this.shown === key || this.scroll.hidden) return;
    this.shown = key; const s = this.scroll, saved = this.scrolls.get(key);
    s.scrollTop = saved ? (saved.bottom ? s.scrollHeight : saved.top) : key ? s.scrollHeight : 0;
  }
}
