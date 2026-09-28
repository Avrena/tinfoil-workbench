import { accountFooter, accountOverview } from './account-view.js';
import { activityMarkup, ActivityDetailsRenderer } from './activity-view.js';
import { toolActive } from '../core/activity.js';
import { openModal, topModal } from './modal.js';
import { MessageEditor } from './editor.js';
import { ResponsiveLayout } from './responsive.js';
import type { Attachment, Command, DesktopBridge, GenerationSettings, InstructionPreset, Reply, Snapshot, Thread, Turn, ToolRun, Artifact } from '../core/types.js';
import { ArtifactPanel, type ArtifactEntry } from './artifact-panel.js';
import { updateMarkup } from './dom.js';
import { RichTextRenderer } from './rich-text.js';
import { RenderScheduler, streamingInterval } from './render-scheduler.js';
import { InlineArtifacts } from './inline-artifacts.js';
import { inlineGroups, replyParts } from '../core/reply-layout.js';
import { capabilityFor } from '../core/capabilities.js';
import { viewPreferences, type ViewPreferences } from '../core/preferences.js';
import { renderDataPreview, staticPreview } from './artifacts.js';
import { escapeHtml as e, clearMarkdownCaches, extractCodeBlocks } from '../core/markdown.js';
import { icon, button } from './icons.js';
import { STARTER_INSTRUCTIONS, activeInstructions } from '../core/instructions.js';
import { instructionsListMarkup, instructionsSummary } from './instructions-view.js';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<div class="shell no-inspector" id="shell">
  <header class="titlebar"><div class="title-brand">${icon('logo')}<span>Tinfoil Workbench</span></div><button class="title-search" data-action="palette" aria-label="Open command palette">${icon('search')}<span>Search or command</span><kbd class="shortcut">Ctrl K</kbd></button><div class="title-trailing"><span id="preview-label" class="preview-label hidden">Offline preview</span><div class="window-controls">${button('minimize','Minimize','minus')}${button('maximize','Maximize or restore','square')}${button('close','Close window','close')}</div></div></header>
  <aside class="sidebar" aria-label="Conversations"><div class="sidebar-head"><h2>Workspace</h2>${button('new','New conversation','plus','class="icon-button"')}${button('close-drawers','Close navigation','close','class="icon-button drawer-close"')}</div><div class="sidebar-search">${icon('search')}<input id="search" type="search" placeholder="Search conversations" aria-label="Filter conversations"></div><div class="nav-section-heading"><h2>Projects</h2>${button('project-create','New project','plus','class="icon-button"')}</div><div class="sr-only" id="thread-count"></div><div class="thread-list" id="thread-list"></div><div class="sidebar-bottom"><button class="account-footer" data-action="account" id="account-footer" aria-label="Account & connection"></button><button data-action="settings">${icon('settings')}Settings</button></div></aside>
  <main class="main"><header class="toolbar">${button('sidebar','Toggle conversation sidebar','panel','class="icon-button"')}<div class="thread-heading"><button class="project-breadcrumb" data-action="thread-project" id="project-breadcrumb" title="Move thread to project">Unfiled</button><h1><button class="toolbar-title" data-action="rename-thread" id="thread-title" title="Rename thread"></button></h1><button id="branch-origin" class="branch-origin hidden" data-action="original-thread">Original thread</button></div><span class="spacer"></span>${button('find','Find in conversation','search','class="icon-button"')}${button('view','Reading & visibility','eye','class="icon-button"')}<details class="export-menu"><summary aria-label="Conversation menu" title="Conversation menu">${icon('more')}</summary><div class="export-popover"><button data-action="account">Account & connection</button><button data-action="rename">Rename thread</button><button data-action="move-project">Move to project…</button><button class="mobile-menu-item" data-action="mobile-find">Find in thread</button><button class="mobile-menu-item" data-action="mobile-view">Reading & visibility</button><button data-action="pin">Pin / unpin</button><button data-action="compare" id="compare-toggle" aria-pressed="false">Compare models</button><button data-action="instructions-picker">System instructions…</button><button data-action="export-md">Export Markdown</button><button data-action="export-json">Export JSON</button><button data-action="import">Import conversation</button><button data-action="delete" class="danger">Delete conversation…</button></div></details>${button('artifacts','Artifact workspace','panel','class="icon-button"')}${button('inspector','Advanced conversation settings','settings','class="icon-button"')}</header>
    <div id="find-bar" class="find-bar hidden"><input id="find-input" type="search" placeholder="Find in this conversation" aria-label="Find in this conversation"><span id="find-count"></span>${button('find-prev','Previous match','up','class="icon-button"')}${button('find-next','Next match','down','class="icon-button"')}${button('find-close','Close find','close','class="icon-button"')}</div>
    <div id="notice" class="notice hidden" role="status"></div><div class="transcript" id="transcript" tabindex="0" aria-label="Conversation"><div id="transcript-inner" class="transcript-inner"></div></div><button class="jump hidden" id="jump" data-action="jump">${icon('down')}Latest</button>
    <div class="composer-region"><div class="pending-settings hidden" id="pending-settings" role="status"><span>Unapplied settings</span><button type="button" data-action="apply-pending">Apply</button><button type="button" data-action="discard-pending">Discard</button></div><form id="composer-form" class="composer"><div class="attachments hidden" id="attachments"></div><textarea id="prompt" enterkeyhint="enter" placeholder="Message Tinfoil…" aria-label="Message" rows="1" maxlength="160000"></textarea><div class="composer-tools">${button('attach','Attach text or code files','attach','class="icon-button"')}${button('edit-draft','Expand message editor','expand','class="icon-button"')}<button type="button" data-action="model-picker" class="model-name" id="composer-model">Choose model</button><select id="quick-effort" class="quick-effort hidden" aria-label="Thinking effort"></select><button type="button" data-action="instructions-picker" class="instructions-chip" id="composer-instructions" aria-label="System instructions (optional)">${icon('instructions')}<span id="composer-instructions-name"></span></button><span id="tools-badge" class="tools-badge hidden">Python · ask first</span><span class="spacer"></span><button type="button" data-action="stop" class="stop hidden" id="stop">${icon('stop')}Stop</button><button type="submit" class="send" id="send" title="Send message">${icon('send')}<span class="sr-only">Send</span></button></div></form><div class="composer-meta"><span id="compose-hint">Enter to send · Shift + Enter for a new line</span><span id="context-size"></span></div></div>
  </main>
  <aside class="inspector" id="inspector"><header class="inspector-header"><span>Advanced</span>${button('inspector','Close advanced settings','close','class="icon-button"')}</header><div class="inspector-body"><form id="config-form"><section><div class="eyebrow">Conversation</div><label for="model">Model</label><input id="model" list="models" placeholder="Model ID" autocomplete="off"><datalist id="models"></datalist><div id="compare-field" class="hidden"><label for="compare-model">Compare with</label><input id="compare-model" list="models" placeholder="Second model ID" autocomplete="off"><p>Two independent requests. Select one reply to continue.</p></div><div class="field-heading"><label for="instructions">System instructions <span class="field-optional">Optional</span></label><button type="button" class="field-action" data-action="instructions-picker" aria-label="Choose saved or starter instructions" title="Choose saved or starter instructions">Choose…</button></div><textarea id="instructions" placeholder="Optional — leave blank for provider defaults" maxlength="40000" aria-describedby="system-optional instructions-applied"></textarea><p id="system-optional">Not required. You can chat without setting a custom system prompt.</p><p id="instructions-applied" class="instructions-applied" hidden></p></section><section><div class="eyebrow">Generation</div><div class="two-fields"><div><label for="temperature">Temperature</label><input id="temperature" type="number" min="0" max="2" step="0.1" placeholder="Default"></div><div><label for="max-tokens">Output limit</label><input id="max-tokens" type="number" min="1" max="131072" step="1" value="8192"></div></div><div id="reasoning-controls"><label for="reasoning">Thinking effort</label><select id="reasoning"></select></div><div id="thinking-controls"><label for="thinking-mode">Thinking mode</label><select id="thinking-mode"><option value="default">Provider default</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></div><p id="capability-note"></p><div id="compare-reasoning-controls" class="hidden"><label for="compare-reasoning">Comparison model effort</label><select id="compare-reasoning"></select><div id="compare-thinking-controls"><label for="compare-thinking-mode">Comparison thinking mode</label><select id="compare-thinking-mode"><option value="default">Provider default</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></div><p id="compare-capability-note"></p></div><label class="toggle-row"><span>Charts, documents & visual tools</span><input id="visual-tools" type="checkbox"></label><p>Creates in-app artifacts without running Python. Files are saved only when you choose Save.</p><label for="tools-mode">Model-requested Python</label><select id="tools-mode"><option value="off">Off</option><option value="ask">Ask before every run</option></select><p>Local execution, not a Tinfoil-hosted sandbox. Every run needs approval.</p><div class="eyebrow activity-settings-heading">Provider tools & delegation</div><label class="toggle-row"><span>Tinfoil web search</span><input id="web-search" type="checkbox"></label><p>Uses Tinfoil’s built-in MCP-backed search. Requires provider access; additional tool usage may apply.</p><label for="delegate-mode">Text-only sub-agents</label><select id="delegate-mode"><option value="off">Off</option><option value="ask">Ask before each request</option></select><p>Client-orchestrated, same model, task-only context. Up to two additional requests per send; no child tools or recursion.</p><details class="tool-support"><summary>API support & limits</summary><p>Batch: multiple tool calls in one completion round, executed sequentially here. This is not an offline billing Batch API.</p><p>MCP: displays Tinfoil-managed search and code-execution events. Arbitrary MCP server connections are not configured by this client.</p><p>Native hosted sub-agent events have not been verified. The optional delegate tool makes a separate approved Chat Completions request.</p></details><button class="primary apply" type="submit" id="apply-settings">Apply settings</button></section></form><details class="connection-details"><summary>Connection & verification</summary><div id="connection-card" class="connection-card"></div></details></div></aside>
  <button id="drawer-backdrop" data-action="close-drawers" aria-label="Close drawer" tabindex="-1" hidden></button>
  <footer class="statusbar"><button data-action="verify" id="status-connection"></button><span class="spacer"></span><span id="status-activity" role="status" aria-live="polite">Ready</span><span id="status-storage">Encrypted on this device</span></footer>
</div>
<dialog id="account-dialog" aria-labelledby="account-title"><div class="modal-head"><h2 id="account-title">Account & connection</h2>${button('dismiss','Close account','close','class="icon-button"')} </div><div class="modal-body" id="account-body"></div></dialog>
<dialog id="settings-dialog"><div class="modal-head"><h2>Settings</h2>${button('dismiss','Close settings','close','class="icon-button"')}</div><div class="modal-body"><form id="key-form"><div class="settings-account-link"><div><strong>Tinfoil Chat account</strong><p>Sign in with your subscription, or use a separate API key below.</p></div><button type="button" data-action="account">Account…</button></div><div class="eyebrow">Developer API key</div><p>This key is separate from a Chat subscription. Saving a key does not switch an active Chat account to API billing.</p><div class="key-status" id="key-status"></div><label for="api-key">Tinfoil API key</label><input id="api-key" type="password" placeholder="Paste a new API key" autocomplete="off" spellcheck="false" maxlength="4096"><div class="modal-actions"><button type="button" data-action="docs">API key guide</button><button type="button" data-action="forget-key" class="danger" id="forget-key">Forget key</button><button type="submit" class="primary" id="save-key">Save & verify</button></div><p class="modal-foot" id="key-feedback" role="status"></p></form><details class="execution-settings"><summary>Execution</summary><p>Python runs locally with your account's permissions. It can access files and the network; this is not a sandbox. Only approve code you trust.</p><div id="python-status" class="key-status"></div><button data-action="python-pick">Choose Python interpreter…</button><p>No Python installation is needed for ordinary chat. Running Python requires an installed interpreter; packages are never installed automatically.</p></details></div></dialog>
<dialog id="view-dialog"><div class="modal-head"><h2>Reading & visibility</h2>${button('dismiss','Close reading settings','close','class="icon-button"')}</div><div class="modal-body"><label for="view-reasoning">Model reasoning</label><select id="view-reasoning"><option value="collapsed">Collapsed by default</option><option value="expanded">Expanded</option><option value="hidden">Hidden</option></select><p>Only reasoning actually returned by the provider is shown. Hiding it does not disable model reasoning.</p><label class="toggle-row"><span>Render Markdown</span><input id="view-markdown" type="checkbox"></label><label class="toggle-row"><span>Render LaTeX maths</span><input id="view-math" type="checkbox"></label><label class="toggle-row"><span>Show timing, tokens & context size</span><input id="view-metadata" type="checkbox"></label><label class="toggle-row"><span>Wrap long code lines</span><input id="view-wrapCode" type="checkbox"></label><label class="toggle-row"><span>Also open the workspace automatically</span><input id="view-autoArtifacts" type="checkbox"></label><label for="view-motion">Animations</label><select id="view-motion"><option value="system">Follow Windows motion preference</option><option value="reduced">Reduced motion</option></select><label class="toggle-row"><span>Focus mode <kbd>Ctrl Shift F</kbd></span><input id="view-focus" type="checkbox"></label><p>Tool approvals and errors remain visible in every mode.</p></div></dialog>
<dialog id="model-dialog"><div class="modal-head"><h2>Choose model</h2>${button('dismiss','Close model picker','close','class="icon-button"')}</div><form id="model-form" class="modal-body"><label for="quick-model">Model</label><input id="quick-model" list="models" placeholder="Search or enter a model ID" autocomplete="off"><div id="model-options" class="model-options"></div><div class="modal-actions"><button type="button" data-action="show-inspector">Advanced…</button><button class="primary" type="submit">Use model</button></div></form></dialog>
<dialog id="instructions-dialog" aria-labelledby="instructions-title"><div class="modal-head"><h2 id="instructions-title">System instructions</h2>${button('instructions-close','Close system instructions','close','class="icon-button"')}</div><div class="modal-body">
<p id="instructions-locked" class="instructions-note instructions-locked" role="status" hidden>Stop the active response to change this conversation’s instructions. Saved instructions can still be managed.</p>
<div id="instructions-list-view"><p class="instructions-intro">Optional — not required. The selection is sent as the system message of each new request in this conversation. None keeps provider defaults.</p><div id="instructions-options" class="instruction-options" role="group" aria-label="Instructions for this conversation"></div><div class="modal-actions"><button type="button" data-action="instructions-new">${icon('plus')}New instructions</button></div></div>
<form id="instructions-form" class="instructions-form" hidden><label for="instructions-name">Name <span class="field-optional">Needed to save for reuse</span></label><input id="instructions-name" maxlength="80" autocomplete="off" placeholder="For example, Code reviewer"><label for="instructions-text">Instructions</label><textarea id="instructions-text" maxlength="40000" rows="8" placeholder="How should the model respond in this conversation?" aria-describedby="instructions-count instructions-storage"></textarea><p class="instructions-count" id="instructions-count"></p><p class="instructions-note" id="instructions-storage">Saved instructions stay in this device’s encrypted workspace. A conversation keeps the text it was given, even if the saved copy later changes or is deleted.</p>
<div class="instructions-confirm" id="instructions-discard" role="alert" hidden><span>Discard these changes?</span><div class="instructions-confirm-actions"><button type="button" data-action="instructions-keep">Keep editing</button><button type="button" class="danger" data-action="instructions-discard">Discard</button></div></div>
<div class="instructions-confirm" id="instructions-delete-confirm" role="alert" hidden><span id="instructions-delete-text"></span><div class="instructions-confirm-actions"><button type="button" data-action="instructions-keep-saved">Cancel</button><button type="button" class="danger" data-action="instructions-confirm-delete">Delete</button></div></div>
<div class="modal-actions"><button type="button" id="instructions-delete" data-action="instructions-delete" class="danger" hidden>Delete…</button><span class="spacer"></span><button type="button" data-action="instructions-back">Back</button><button type="button" id="instructions-save" data-action="instructions-save">Save for reuse</button><button type="submit" class="primary" id="instructions-use">Use in this conversation</button></div></form>
</div></dialog>
<dialog id="rename-dialog"><div class="modal-head"><h2>Rename conversation</h2>${button('dismiss','Close rename dialog','close','class="icon-button"')}</div><form id="rename-form" class="modal-body"><label for="rename-input">Conversation name</label><input id="rename-input" maxlength="120" required><div class="modal-actions"><button type="button" data-action="dismiss">Cancel</button><button type="submit" class="primary">Save name</button></div></form></dialog>
<dialog id="palette-dialog"><input class="palette-input" id="palette-search" placeholder="Type a command…" aria-label="Find a command"><div class="palette-items" id="palette-items"></div></dialog>

<dialog id="project-dialog" aria-labelledby="project-dialog-title"><div class="modal-head"><h2 id="project-dialog-title">New project</h2>${button('dismiss','Close project settings','close','class="icon-button"')}</div><form id="project-form" class="modal-body"><label for="project-name">Project name</label><input id="project-name" maxlength="80" required autocomplete="off"><p class="muted small">Projects organize threads locally. They do not add shared instructions or send extra context.</p><div class="modal-actions"><button type="button" id="remove-project" data-action="project-remove" class="danger hidden">Remove project…</button><span class="spacer"></span><button type="button" data-action="dismiss">Cancel</button><button type="submit" class="primary">Save project</button></div><div id="project-delete-confirm" class="hidden"><p>Remove this project? Its threads will move to Unfiled, not be deleted.</p><button type="button" data-action="project-confirm-remove" class="danger">Remove and keep threads</button></div></form></dialog>
<dialog id="move-dialog" aria-labelledby="move-title"><div class="modal-head"><h2 id="move-title">Move thread</h2>${button('dismiss','Close move dialog','close','class="icon-button"')}</div><form id="move-form" class="modal-body"><label for="move-project">Project</label><select id="move-project"></select><div class="modal-actions"><button type="button" data-action="dismiss">Cancel</button><button type="submit" class="primary">Move thread</button></div></form></dialog>
<dialog id="close-dialog" aria-labelledby="close-heading"><div class="modal-head"><h2 id="close-heading">Before you close</h2></div><div class="modal-body"><p id="close-detail"></p><p class="muted small">The composer draft and its attached text files will be saved locally. No message will be sent.</p><div class="modal-actions"><button type="button" data-action="keep-open" autofocus>Keep working</button><button type="button" data-action="confirm-close" class="danger">Close Workbench</button></div></div></dialog>
<div class="toast hidden" id="toast" role="status"></div>
`;
const $ = <T extends HTMLElement = HTMLElement>(id:string):T => document.getElementById(id) as T;
const bridge = window.tinfoil;
const artifactPanel = new ArtifactPanel($('shell'), {
  save:entry=>{if(entry.toolId)void dispatch({type:'artifact.save',id:entry.threadId,toolId:entry.toolId,artifactId:entry.artifact.id});},
  pdf:entry=>{if(entry.toolId)void dispatch({type:'artifact.pdf',id:entry.threadId,toolId:entry.toolId,artifactId:entry.artifact.id});},
  copy:source=>{void dispatch({type:'clipboard',text:source});},
  openLocal:()=>{void (async()=>{try{const result=await bridge!.command({type:'artifact.open',id:current().id});accept(result.snapshot);if(result.artifact)artifactPanel.open({artifact:result.artifact,threadId:current().id,local:true});}catch(error){toast(error instanceof Error?error.message:'Could not open this file.',true);}})();},
});
const inlineArtifacts = new InlineArtifacts(entry=>artifactPanel.open(entry));
const responsive = new ResponsiveLayout($('shell'),()=>{if(state){applyView();updateComposerHint();sizeComposer();}},()=>artifactPanel.close());
const editor = new MessageEditor(()=>transcriptScheduler.cancel(),()=>scheduleTranscript(true));
let projectEditingId:string|null=null;
const collapsedProjects=new Set<string>();
let view = viewPreferences(undefined);
const richText = new RichTextRenderer();
const activityDetails = new ActivityDetailsRenderer(richText);
const transcriptScheduler = new RenderScheduler(()=>{if(state)renderTranscript();});
function scheduleTranscript(urgent = false): void {
  if(document.querySelector('dialog[open]')){transcriptScheduler.cancel();return;}
  const latest = state ? current().turns.at(-1)?.replies ?? [] : [];
  const streaming = latest.some(r=>['streaming','queued','executing'].includes(r.status));
  const characters = latest.reduce((n,r)=>n+r.content.length+r.reasoning.length,0);
  transcriptScheduler.request(streamingInterval(characters), urgent || !streaming);
}
document.addEventListener('visibilitychange',()=>{
  document.documentElement.classList.toggle('app-background',document.hidden);
  scheduleTranscript(true);
});
const rawReplies = new Set<string>(), disclosures = new Map<string,boolean>();
let findIndex = 0;
let state:Snapshot, currentId='', renderId='', configDirty=false, sending=false, connecting=false;
let draftTimer:ReturnType<typeof setTimeout> | undefined, toastTimer:ReturnType<typeof setTimeout> | undefined;
const drafts = new Map<string,string>(), pendingFiles = new Map<string,Attachment[]>();
// Advanced changes are per-thread session drafts; never sent or enabled until Apply.
const configDrafts = new Map<string, Record<string,string|boolean>>();
const configFields=['model','compare-model','instructions','temperature','max-tokens','tools-mode','reasoning','thinking-mode','compare-reasoning','compare-thinking-mode','visual-tools','web-search','delegate-mode'];
function pendingSettings():void { $('pending-settings').classList.toggle('hidden',!configDirty); }
function rememberConfiguration():void {
  configDrafts.set(current().id,Object.fromEntries(configFields.map(id=>{const el=$(id) as HTMLInputElement;return [id,el.type==='checkbox'?el.checked:el.value];})));
  configDirty=true;pendingSettings();$('apply-settings').textContent='Apply changes';
}
function restoreConfiguration():void {
  const draft=configDrafts.get(current().id);if(!draft)return;
  // Restore model-dependent choices before restoring selected effort values.
  for(const id of ['model','compare-model'])$<HTMLInputElement>(id).value=String(draft[id]??'');
  renderReasoningControls();
  for(const [id,value] of Object.entries(draft)){const el=$(id) as HTMLInputElement;if(typeof value==='boolean')el.checked=value;else el.value=value;}
  renderInstructionsApplied();configDirty=true;pendingSettings();$('apply-settings').textContent='Apply changes';
}
const replyCache = new Map<string, (string | number | boolean | null | undefined)[]>();
const chromeTemplates = new WeakMap<HTMLElement,string>();
function setMarkup(element:HTMLElement,html:string):void { if(chromeTemplates.get(element)===html)return; chromeTemplates.set(element,html); updateMarkup(element,html); }
let revision=0;
function toast(message:string, error=false):void {
  if(error){
    const top=[...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
    if(top){let feedback=top.querySelector<HTMLElement>('.dialog-feedback');if(!feedback){feedback=document.createElement('p');feedback.className='dialog-feedback';feedback.setAttribute('role','alert');(top.querySelector('.modal-body,.editor-body')??top).prepend(feedback);}feedback.textContent=message;}
  }
  clearTimeout(toastTimer); $('toast').textContent=message; $('toast').className=`toast${error?' error':''}`; toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),6000); }
function current():Thread { return state.workspace.threads.find(t=>t.id===state.workspace.activeId)!; }
async function dispatch(command:Command):Promise<boolean> {
  if (!bridge) return false;
  try { const response = await bridge.command(command); accept(response.snapshot); return true; }
  catch(error) { toast(error instanceof Error ? error.message : 'The operation failed.',true); return false; }
}
function accept(snapshot:Snapshot):void {
  // Snapshot sequence is optional only for independently supplied development bridges.
  const sequence = (snapshot as Snapshot & { sequence?:number }).sequence ?? ++revision;
  if (sequence < revision) return;
  revision=sequence; state=snapshot;state.workspace.projects??=[];state.workspace.instructionPresets??=[];
  if(state.platform&&document.documentElement.dataset.platform!==state.platform){
    document.documentElement.dataset.platform=state.platform;
    const motion=document.querySelector<HTMLOptionElement>('#view-motion option[value="system"]');
    if(motion)motion.textContent='Follow system motion preference';
  }
  const existingIds=new Set(state.workspace.threads.map(t=>t.id));
  for(const map of [drafts,pendingFiles,configDrafts])for(const id of map.keys())if(!existingIds.has(id))map.delete(id);
  view = viewPreferences(snapshot.workspace.view); applyView();
  const switched=currentId!==state.workspace.activeId;
  if (switched) { currentId=state.workspace.activeId; configDirty=!!configDrafts.get(currentId); }
  renderSidebar();
  const thread=current();
  setMarkup($('thread-title'),e(thread.title));
  const project=state.workspace.projects?.find(p=>p.id===thread.projectId);
  $('project-breadcrumb').textContent=project?.name??'Unfiled';
  const parent=state.workspace.threads.find(t=>t.id===thread.branchOf);
  $('branch-origin').classList.toggle('hidden',!parent);$('branch-origin').title=parent?'Back to '+parent.title:'';
  $('thread-count').textContent=`· ${state.workspace.threads.length}`;
  $('preview-label').classList.toggle('hidden',state.storage!=='preview');
  const compare=$<HTMLButtonElement>('compare-toggle'); compare.classList.toggle('on',thread.settings.compare); compare.setAttribute('aria-pressed',String(thread.settings.compare)); compare.disabled=!!state.busyThreadId;
  $('composer-model').textContent=(thread.settings.model || 'Choose model') + (thread.settings.compare ? ' × 2' : '');
  renderInstructionsChip();renderInstructionsApplied();if($<HTMLDialogElement>('instructions-dialog').open)renderInstructionsLock();
  $('tools-badge').classList.toggle('hidden', thread.settings.toolsMode !== 'ask');
  $('send').querySelector('span')!.textContent=thread.settings.compare?'Send to 2':'Send';
  $<HTMLButtonElement>('send').disabled=!!state.busyThreadId || sending;
  $('stop').classList.toggle('hidden',state.busyThreadId!==thread.id);
  updateComposerHint();
  const size=thread.turns.reduce((n,t)=>n+t.prompt.length+t.replies.filter(r=>r.id===t.selectedReplyId).reduce((s,r)=>s+r.content.length,0)+t.attachments.reduce((s,a)=>s+a.content.length,0),thread.settings.systemPrompt.length);
  $('context-size').textContent=size?`${size.toLocaleString()} context characters`:'No context yet';
  const notice = state.storage === 'preview' ? null : state.notice;
  const unconfigured=state.storage!=='preview'&&!state.hasKey&&state.account?.status!=='signed-in';
  if(notice)setMarkup($('notice'),e(notice));
  else if(unconfigured)setMarkup($('notice'),`${state.platform==='android'&&!state.chatAvailable?'Add a Tinfoil API key to start.':'Connect an account or API key to start.'} <button type="button" data-action="account">Set up connection</button>`);
  else setMarkup($('notice'),'');
  $('notice').classList.toggle('hidden',!notice&&!unconfigured);
  if (switched || document.activeElement!==$('prompt')) {
    const value=drafts.get(thread.id) ?? thread.draft;
    if($<HTMLTextAreaElement>('prompt').value!==value){$<HTMLTextAreaElement>('prompt').value=value;sizeComposer();}
  }
  if(!pendingFiles.has(thread.id))pendingFiles.set(thread.id,structuredClone(thread.draftAttachments??[]));
  renderAttachments(); scheduleTranscript();
  artifactPanel.sync(thread.id,thread.turns.at(-1)?.id??'',thread.turns.flatMap(t=>t.replies.flatMap(r=>(r.tools??[]).flatMap(tool=>tool.artifacts.map(artifact=>({artifact,threadId:thread.id,toolId:tool.id}))))),view.autoArtifacts&&!view.focus);
  renderQuickEffort();
  if (!configDirty || switched) {renderConfiguration();restoreConfiguration();} pendingSettings();
  renderConnection();renderAccount();
  $('status-storage').textContent=state.storage==='preview'?'Preview · memory only':'Encrypted on this device';
  const pending=thread.turns.flatMap(t=>t.replies).flatMap(r=>r.tools??[]).some(t=>t.status==='awaiting_approval');
  $('status-activity').textContent=pending?'Approval needed':state.busyThreadId?'Working…':'Ready';
  $('python-status').textContent=state.pythonConfigured?'A Python interpreter is selected.':'No Python interpreter selected.';
  $('key-status').textContent=state.hasKey?'A key is saved on this device.':'No API key is saved.';
  $('save-key').textContent=state.connectionMode==='chat-account'?'Save key only':'Save & verify';
  $<HTMLButtonElement>('forget-key').disabled=!state.hasKey || !!state.busyThreadId || connecting;
}
function renderAccount():void {
  setMarkup($('account-footer'),accountFooter(state));
  const dialog=$<HTMLDialogElement>('account-dialog');
  if(dialog.open)setMarkup($('account-body'),accountOverview(state));
}
function showAccount():void {dismiss();showDialog('account-dialog');renderAccount();}
let navigationSignature='';
function renderSidebar():void {
  const filter=$<HTMLInputElement>('search').value.toLowerCase();
  const signature=JSON.stringify([filter,state.workspace.activeId,state.busyThreadId,state.workspace.projects,[...collapsedProjects],state.workspace.threads.map(t=>[t.id,t.title,t.projectId,t.pinned,t.updatedAt,t.turns.length,filter?t.turns.map(turn=>[turn.prompt,...turn.replies.map(r=>r.content)]):null])]);
  if(signature===navigationSignature)return;navigationSignature=signature;
  const threads=[...state.workspace.threads].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt-a.updatedAt).filter(t=>t.title.toLowerCase().includes(filter)||state.workspace.projects?.find(p=>p.id===t.projectId)?.name.toLowerCase().includes(filter)||t.turns.some(turn=>turn.prompt.toLowerCase().includes(filter)||turn.replies.some(r=>r.content.toLowerCase().includes(filter))));
  const item=(t:Thread)=>`<button class="thread ${t.id===state.workspace.activeId?'selected':''}" data-thread="${e(t.id)}" aria-current="${t.id===state.workspace.activeId?'page':'false'}" title="${e(t.title)}">${icon(t.pinned?'pin':'chat')}<span class="thread-copy"><strong>${e(t.title)}</strong><small>${t.turns.length} ${t.turns.length===1?'turn':'turns'} · ${t.id===state.busyThreadId?'Generating':new Date(t.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</small></span></button>`;
  const projects=(state.workspace.projects??[]).map(project=>{
    const children=threads.filter(t=>t.projectId===project.id);if(filter&&!children.length&&!project.name.toLowerCase().includes(filter))return '';
    const collapsed=collapsedProjects.has(project.id)&&!filter;
    return `<section class="project-group" aria-label="${e(project.name)}"><div class="project-group-heading"><button class="project-toggle" data-action="project-toggle" data-project="${e(project.id)}" aria-expanded="${!collapsed}" aria-controls="project-${e(project.id)}">${icon('folder')}<span>${e(project.name)}</span><small>${children.length}</small></button>${button('new-project-thread','New thread in '+e(project.name),'plus',`class="icon-button" data-project="${e(project.id)}"`)}${button('project-manage','Manage '+e(project.name),'more',`class="icon-button" data-project="${e(project.id)}"`)}</div><div id="project-${e(project.id)}" ${collapsed?'hidden':''}>${children.map(item).join('')||'<p class="nav-empty">No threads yet</p>'}</div></section>`;
  }).join('');
  const loose=threads.filter(t=>!t.projectId),pinned=loose.filter(t=>t.pinned),recent=loose.filter(t=>!t.pinned);
  const day=new Date();day.setHours(0,0,0,0);const today=recent.filter(t=>t.updatedAt>=+day),earlier=recent.filter(t=>t.updatedAt<+day);
  const group=(name:string,list:Thread[])=>list.length?`<section class="thread-group" aria-label="${name}"><h3>${name}</h3>${list.map(item).join('')}</section>`:'';
  setMarkup($('thread-list'),(projects||'<p class="nav-empty">Keep related threads together.</p>')+`<div class="nav-section-heading"><h2>Threads</h2><span>${loose.length}</span></div>`+group('Pinned',pinned)+group('Today',today)+group('Earlier',earlier)+(!loose.length?'<p class="nav-empty">No unfiled threads</p>':''));
}
function welcome():string {
  return `<div class="empty"><div class="empty-mark">${icon('logo')}</div><h1>What are we working on?</h1><p>A conversation, with room to think.</p><div class="starter-chips"><button data-prompt="Help me refine this draft while preserving my voice:\n\n">Write</button><button data-prompt="Explain this idea with a worked example:\n\n">Explain</button><button data-prompt="Check this calculation and show the maths clearly.">Analyze</button><button data-prompt="Show an inline visualization demo.">Visualize</button><button data-prompt="Show a tool activity demo.">Tool activity</button></div></div>`;
}
function turnMarkup(turn:Turn):string {
  return `<article class="turn" data-key="turn-${e(turn.id)}" data-turn="${e(turn.id)}"><div class="user-row"><div class="message-label"><span class="user-dot">Y</span>You<span class="meta">${new Date(turn.createdAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</span></div><div class="user-prompt">${e(turn.prompt)}</div>${turn.attachments.length?`<div class="attached-summary">${turn.attachments.map(f=>`<span>${e(f.name)}</span>`).join('')}</div>`:''}<div class="turn-actions"><button data-action="edit" data-turn="${e(turn.id)}">${icon('write')}Edit</button></div></div><div class="replies ${turn.replies.length>1?'comparison':''}">${turn.replies.map(r=>`<section class="reply" data-reply-host data-key="${e(r.id)}" id="reply-${e(r.id)}" aria-label="Reply from ${e(r.model)}"></section>`).join('')}</div><div id="hint-${e(turn.id)}" class="compare-hint hidden">Choose an answer to continue, or branch from either reply.</div></article>`;
}
function responseFlow(reply:Reply,raw:boolean):string {
  const host=(rootId:string)=>`<figure class="inline-artifact" data-key="artifact-${e(rootId)}" data-artifact-host="${e(rootId)}"></figure>`;
  if(raw)return '<div class="markdown-segment" data-key="raw" data-rich-host data-rich-key="raw"></div>'+inlineGroups(reply).map(g=>host(g.rootId)).join('');
  return replyParts(reply).map(part=>part.kind==='artifact'?host(part.group.rootId):`<div class="markdown-segment" data-key="${e(part.key)}" data-rich-host data-rich-key="${e(part.key)}"></div>`).join('');
}
function syncRichText(node:HTMLElement,reply:Reply):void {
  activityDetails.sync(node,reply,view);
  const raw=rawReplies.has(reply.id),parts=raw?[]:replyParts(reply);
  for(const host of node.querySelectorAll<HTMLElement>('[data-rich-key]')) {
    if(host.dataset.richKey==='raw'){richText.render(host,reply.content.slice(0,200000),{markdown:false,math:false});continue;}
    const part=parts.find(p=>p.kind==='text'&&p.key===host.dataset.richKey);
    if(part?.kind==='text')richText.render(host,part.text.slice(0,Math.max(0,200000-part.start)),{markdown:view.markdown,math:view.math,prefix:reply.content.slice(0,part.start)});
  }
  const reasoning=node.querySelector<HTMLElement>('.reasoning-content');
  if(reasoning?.closest('details')?.open)richText.render(reasoning,reply.reasoning,{markdown:view.markdown,math:view.math,codeTools:false});
}
function replyMarkup(reply:Reply, turn:Turn):string {
  const streaming=['streaming','queued','awaiting_approval','executing'].includes(reply.status);
  const selected=turn.selectedReplyId===reply.id, raw=rawReplies.has(reply.id);
  const tools=reply.tools??[], active=tools.filter(toolActive), finished=tools.filter(t=>!active.includes(t));
  const thinking=streaming&&(reply.phase==='thinking'||(!reply.phase&&!!reply.reasoning&&!reply.content));
  const writing=streaming&&!thinking&&!active.some(t=>t.provider)&&reply.status==='streaming'&&(reply.phase==='answering'||(!reply.phase&&!!reply.content));
  const status=reply.status==='awaiting_approval'?'Approval needed':active.some(t=>t.name==='delegate_task'&&t.status==='running')?'Sub-agent working':active.some(t=>t.provider&&t.status==='running')?'Using provider tools':reply.status==='executing'?(active.some(t=>t.name==='python')?'Running Python':'Creating visualization'):thinking?'Thinking':writing?'Writing':'Waiting for response';
  const reasonOpen=disclosures.get(`reason-${reply.id}`)??view.reasoning==='expanded';
  const hasArtifact=tools.some(t=>t.artifacts.length);
  // A single answer starts with its content. Side-by-side lanes still name their model up front.
  return `${turn.replies.length>1?`<div class="message-label lane-label" data-key="identity"><span class="assistant-dot">${icon('logo')}</span><span>${e(reply.model)}</span></div>`:''}
    <div class="reply-context ${(!reply.reasoning||view.reasoning==='hidden')&&!tools.length?'hidden':''}" data-key="context">${reply.reasoning&&view.reasoning!=='hidden'?`<details class="reasoning ${thinking?'is-thinking':''}" data-key="reasoning" data-disclosure="reason-${e(reply.id)}" ${reasonOpen?'open':''}><summary><span class="reasoning-label">${thinking?'Thinking':'Reasoning'}</span><span class="thinking-wave" aria-hidden="true"><i></i><i></i><i></i></span><small>${reply.edit?.reasoningEdited?'Manually edited · local only':'Provided by the model'}</small></summary><div class="reasoning-content" data-key="reason-text" data-rich-host></div>${!streaming?`<div class="reasoning-actions"><button data-action="edit-thinking" data-turn="${e(turn.id)}" data-reply="${e(reply.id)}">${icon('write')}Edit thinking text</button></div>`:''}</details>`:''}
    <div class="reply-tool-activity" data-key="tools">${activityMarkup(reply)}</div></div>
    <div class="reply-content response-flow ${writing?'streaming-answer':''}" data-key="answer" aria-busy="${streaming}">${responseFlow(reply,raw)}${!streaming&&!reply.content&&!hasArtifact?'<div class="waiting">No answer text was returned.</div>':''}</div>
    ${streaming?`<div class="response-activity ${reply.status==='awaiting_approval'?'needs-approval':''} ${thinking&&reply.reasoning&&view.reasoning!=='hidden'?'sr-only':''}" data-key="activity" role="status" aria-live="polite"><span class="activity-orbit" aria-hidden="true"></span><span>${status}</span></div>`:''}
    ${reply.error?`<div class="reply-note" data-key="error" role="status">${e(reply.error)}</div>`:''}
    <div class="reply-footer" data-key="footer"><div class="reply-actions" data-key="actions">${reply.status==='complete'?`<button data-action="edit-reply" data-turn="${e(turn.id)}" data-reply="${e(reply.id)}" title="Edit answer or thinking text">${icon('write')}<span>Edit</span></button>`:''}<button data-action="copy-reply" data-reply="${e(reply.id)}" title="Copy answer">${icon('copy')}<span>Copy</span></button><button data-action="source" data-reply="${e(reply.id)}" aria-pressed="${raw}">${icon('code')}<span>${raw?'Rendered':'Source'}</span></button>${reply.status==='complete'?`<button data-action="branch" data-turn="${e(turn.id)}" data-reply="${e(reply.id)}" title="Continue in a new branch">${icon('branch')}<span>Branch</span></button>`:!streaming?`<button data-action="retry" data-turn="${e(turn.id)}">Retry in new branch</button>`:''}${reply.status==='complete'&&turn.replies.length>1?(selected?'<span class="chosen-label">Selected</span>':`<button class="choose-reply" data-action="choose" data-turn="${e(turn.id)}" data-reply="${e(reply.id)}">Use reply</button>`):''}</div>${replySignature(reply)}</div>`;
}
/** Quiet provenance after the answer: model, the instructions it was sent with, edits and opt-in metadata. */
function replySignature(reply:Reply):string {
  const parts=[`<span class="signature-model">${e(reply.model)}</span>`],plain=[reply.model];
  if(reply.systemPromptName!==undefined){const name=reply.systemPromptName||'Custom instructions';plain.push('System instructions: '+name);parts.push(`<span class="signature-instructions">${icon('instructions')}<span class="sr-only">System instructions: </span>${e(name)}</span>`);}
  if(reply.edit){plain.push('Edited; the original text is preserved');parts.push('<span class="edited-label">Edited</span>');}
  if(view.metadata){const timing=`${reply.status} · ${(reply.elapsedMs/1000).toFixed(1)}s`;plain.push(timing);parts.push(`<span class="meta">${e(timing)}</span>`);}
  if(view.metadata&&reply.usage){const usage=`${reply.usage.input.toLocaleString()} in · ${reply.usage.output.toLocaleString()} out`;plain.push(usage+' (main model requests only)');parts.push(`<span class="usage">${usage}</span>`);}
  // Separated by spacing, not glyphs. A wide footer keeps it on one line and truncates it (the title
  // holds everything); a narrow one gives it its own line, where it may wrap.
  return `<p class="reply-signature" data-key="signature" title="${e(plain.join(' · '))}">${parts.join('')}</p>`;
}
function renderTranscript():void {
  const thread=current(), viewport=$('transcript'), container=$('transcript-inner');
  const nearBottom=viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<110;
  const structure=thread.id+':'+thread.turns.map(t=>t.id).join(',');
  const changed=structure!==renderId;
  if(changed) {
    const switched=!renderId.startsWith(thread.id+':');
    if(switched){inlineArtifacts.destroy();replyCache.clear();richText.clear();clearMarkdownCaches();container.replaceChildren();}
    renderId=structure;
    updateMarkup(container,thread.turns.length?thread.turns.map(turnMarkup).join(''):welcome());
  }
  for(const turn of thread.turns) {
    for(const reply of turn.replies) {
      const signature=[reply.content,reply.reasoning,reply.systemPromptName,turn.replies.length,reply.edit?.editedAt,reply.phase,reply.finalContentOffset,reply.status,reply.error,view.metadata?reply.elapsedMs:0,reply.usage?.input,reply.usage?.output,...(reply.tools??[]).flatMap(t=>[t.id,t.contentOffset,t.name,t.status,t.arguments,t.stdout,t.stderr,t.exitCode,t.truncated,t.origin,t.batchId,t.batchIndex,t.batchSize,t.provider?.family,t.provider?.sources.map(s=>s.url+'|'+s.title).join('\n'),t.delegate?.model,t.delegate?.task,t.delegate?.content,t.delegate?.reasoning,t.delegate?.phase,t.delegate?.usage?.input,t.delegate?.usage?.output,view.metadata?t.elapsedMs:0,...t.artifacts.flatMap(a=>[a.id,a.version])]),!!state.busyThreadId,turn.selectedReplyId,...Object.values(view),rawReplies.has(reply.id)];
      const previous=replyCache.get(reply.id),node=$(`reply-${reply.id}`);
      if(previous?.length===signature.length&&previous.every((value,i)=>value===signature[i])) {syncRichText(node,reply);continue;}
      const selection=window.getSelection();
      if (selection&&!selection.isCollapsed&&selection.anchorNode&&node.contains(selection.anchorNode)) continue;
      node.querySelectorAll<HTMLDetailsElement>('details[data-disclosure]').forEach(d=>disclosures.set(d.dataset.disclosure!,d.open));
      updateMarkup(node,replyMarkup(reply,turn)); inlineArtifacts.sync(node,inlineGroups(reply),thread.id); node.classList.toggle('chosen',turn.selectedReplyId===reply.id);
      node.querySelectorAll<HTMLDetailsElement>('details[data-disclosure]').forEach(d=>{const value=disclosures.get(d.dataset.disclosure!);if(value!==undefined)d.open=value;});
      syncRichText(node,reply);
      node.querySelectorAll<HTMLButtonElement>('.run-code').forEach(b=>b.disabled=reply.status!=='complete'||!!state.busyThreadId);
      replyCache.set(reply.id,signature);
    }
    $(`hint-${turn.id}`).classList.toggle('hidden',turn.replies.length<2||!!turn.selectedReplyId);
  }
  inlineArtifacts.prune();
  const reading=!!document.activeElement?.closest('.inline-artifact')||!window.getSelection()?.isCollapsed;
  if(changed||(nearBottom&&!reading)) viewport.scrollTop=viewport.scrollHeight;
  $('jump').classList.toggle('hidden',viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<150);
}
let configurationSignature='';
function renderConfiguration(force = false):void {
  const s=current().settings;
  const signature=JSON.stringify([current().id,s,state.models,state.capabilities,state.busyThreadId]);
  if(!force&&configurationSignature===signature)return;configurationSignature=signature;
  $<HTMLSelectElement>('tools-mode').value=s.toolsMode ?? 'off';
  $<HTMLInputElement>('model').value=s.model; $<HTMLInputElement>('compare-model').value=s.compareModel;
  $('compare-field').classList.toggle('hidden',!s.compare);
  $<HTMLTextAreaElement>('instructions').value=s.systemPrompt;renderInstructionsApplied();
  $<HTMLInputElement>('temperature').value=s.temperature===null?'':String(s.temperature);
  $<HTMLInputElement>('max-tokens').value=String(s.maxTokens);
  $<HTMLInputElement>('visual-tools').checked=s.visualTools;
  $<HTMLInputElement>('web-search').checked=s.webSearch;
  $<HTMLSelectElement>('delegate-mode').value=s.delegateMode??'off';
  renderReasoningControls();
  $('models').innerHTML=state.models.map(m=>`<option value="${e(m)}"></option>`).join('');
  $<HTMLButtonElement>('apply-settings').disabled=state.busyThreadId===current().id;
}
function effortOptions(select:HTMLSelectElement,model:string,value:string):void {
  const cap=capabilityFor(model,state.capabilities);select.replaceChildren();
  for(const effort of ['default',...cap.effort]){const option=document.createElement('option');option.value=effort;option.textContent=effort==='default'?'Provider default':effort[0]!.toUpperCase()+effort.slice(1);select.append(option);}
  select.value=cap.effort.includes(value)?value:'default';
}
function renderQuickEffort():void {
  const s=current().settings,cap=capabilityFor(s.model,state.capabilities),select=$<HTMLSelectElement>('quick-effort');
  const signature=JSON.stringify([s.model,s.reasoningEffort,cap.effort]);
  if(select.dataset.signature!==signature){
    effortOptions(select,s.model,s.reasoningEffort);
    // The compact picker uses a short label; the full provider wording remains
    // in Advanced and the accessible description. Wire values are unchanged.
    const fallback=select.querySelector<HTMLOptionElement>('option[value="default"]');
    if(fallback)fallback.textContent='Default';
    select.title='Thinking effort — Default uses the provider setting';
    select.dataset.signature=signature;
  }
  select.classList.toggle('hidden',!cap.effort.length);select.disabled=!!state.busyThreadId;
}
function renderReasoningControls():void {
  const s=current().settings,model=$<HTMLInputElement>('model').value,compare=$<HTMLInputElement>('compare-model').value;
  for(const [id,m,value,mode] of [['reasoning',model,s.reasoningEffort,s.thinkingMode],['compare-reasoning',compare,s.compareReasoningEffort,s.compareThinkingMode]] as const){
    const cap=capabilityFor(m,state.capabilities),secondary=id==='compare-reasoning';effortOptions($<HTMLSelectElement>(id),m,value);
    if(!secondary)$('reasoning-controls').classList.toggle('hidden',!cap.effort.length);
    else{$<HTMLSelectElement>(id).classList.toggle('hidden',!cap.effort.length);document.querySelector('label[for="compare-reasoning"]')!.classList.toggle('hidden',!cap.effort.length);}
    $(secondary?'compare-thinking-controls':'thinking-controls').classList.toggle('hidden',!cap.toggle);
    $<HTMLSelectElement>(secondary?'compare-thinking-mode':'thinking-mode').value=cap.toggle?mode:'default';
    $(secondary?'compare-capability-note':'capability-note').textContent=cap.effort.length?`Supported effort: ${cap.effort.join(', ')}. ${cap.source==='catalog'?'Provider metadata.':'Bundled Tinfoil profile; refreshed metadata takes precedence.'}`:cap.toggle?'This model offers on/off thinking, not adjustable effort.':cap.known?'No adjustable thinking control is exposed for this model.':'Capabilities unknown: provider-default reasoning is used.';
  }
  $('compare-reasoning-controls').classList.toggle('hidden',!s.compare);
}
$('quick-effort').addEventListener('change',()=>{if(configDirty){toast('Apply pending Advanced changes first.',true);delete $<HTMLSelectElement>('quick-effort').dataset.signature;renderQuickEffort();return;}void dispatch({type:'thread.settings',id:current().id,settings:{...current().settings,reasoningEffort:$<HTMLSelectElement>('quick-effort').value}});});
for(const id of ['model','compare-model'])$(id).addEventListener('input',renderReasoningControls);
let connectionSignature='';
function renderConnection():void {
  const signature=JSON.stringify([state.verification,state.storage,state.hasKey,state.busyThreadId,connecting,state.connectionMode,state.account?.status,state.account?.entitlement]);
  if(signature===connectionSignature)return;connectionSignature=signature;
  const v=state.verification, preview=state.storage==='preview';
  const chat=state.connectionMode==='chat-account',ready=chat?state.account?.status==='signed-in'&&state.account.entitlement==='active':state.hasKey;
  const label=preview?'Offline preview':v.state==='verified'?'Enclave verified':v.state==='checking'?'Verifying enclave…':v.state==='failed'?'Verification failed':'Not connected';
  $('connection-card').classList.toggle('verified',v.state==='verified'&&!preview);
  $('connection-card').innerHTML=`<strong>${icon('shield')}${label}</strong><p>${preview?'Sample conversations only. No API requests or attestation are performed.':v.state==='verified'?`SDK verification completed ${new Date(v.checkedAt!).toLocaleTimeString()}. Requests use encrypted EHBP transport.`:'The official SDK checks attestation before an inference request is sent.'}</p><button type="button" data-action="${ready?'connect':'account'}" ${connecting||state.busyThreadId?'disabled':''}>${ready?'Verify & refresh models':chat?'Sign in to Tinfoil Chat':'Set up connection'}</button>${v.steps.length?`<div class="verification-steps">${v.steps.map(s=>`<div><span>${e(s.name)}</span><span>${e(s.status)}</span></div>`).join('')}</div>`:''}`;
  $('status-connection').innerHTML=`<i class="status-indicator ${v.state==='verified'&&!preview?'verified':''}"></i>${label}`;
}
let instructionsEdit:{mode:'new'|'saved'|'current';id?:string;name:string;text:string;origin:string}|null=null,instructionsLeave:'back'|'close'='back',instructionsPending=false;
/** One picker request at a time: a repeated click must not save, apply or delete twice. */
async function instructionsRequest(run:()=>Promise<void>):Promise<void> {
  if(instructionsPending)return;instructionsPending=true;
  try{await run();}finally{instructionsPending=false;}
}
const presets=():InstructionPreset[]=>state.workspace.instructionPresets??[];
function findPreset(key:string):InstructionPreset|undefined {
  const split=key.indexOf(':'),kind=key.slice(0,split),id=key.slice(split+1);
  return kind==='saved'?presets().find(p=>p.id===id):kind==='starter'?STARTER_INSTRUCTIONS.find(p=>p.id===id):undefined;
}
// Both summaries run on every snapshot, including streamed ones; write the DOM only on change.
function renderInstructionsChip():void {
  const summary=instructionsSummary(current().settings,presets()),chip=$<HTMLButtonElement>('composer-instructions');
  if(chip.dataset.summary===summary.label)return;chip.dataset.summary=summary.label;
  $('composer-instructions-name').textContent=summary.name;
  chip.classList.toggle('is-set',summary.set);chip.title=summary.label;chip.setAttribute('aria-label',summary.label);
}
function renderInstructionsApplied():void {
  if(!state)return;
  const s=current().settings,a=activeInstructions(s,presets()),value=$<HTMLTextAreaElement>('instructions').value,line=$('instructions-applied');
  const text=value!==s.systemPrompt?(value.trim()?'Edited text applies as unnamed custom instructions.':'Clearing the text turns custom instructions off.')
    :a.kind==='saved'?`Using saved instructions “${a.preset.name}”.`:a.kind==='starter'?`Using the “${a.preset.name}” starter.`:a.kind==='custom'&&a.name?`Using “${a.name}”.`:'';
  if(line.textContent!==text){line.textContent=text;line.hidden=!text;}
}
function renderInstructionsLock():void {
  const locked=state.busyThreadId===current().id;
  $('instructions-locked').hidden=!locked;$<HTMLButtonElement>('instructions-use').disabled=locked;
  $('instructions-use').title=locked?'Stop the active response to change this conversation’s instructions.':'';
  if(!instructionsEdit)setMarkup($('instructions-options'),instructionsListMarkup(current().settings,presets(),locked));
}
/** Returns to the list. Focus goes back to the control that opened the editor, the entry
 * just saved, or the current choice, so keyboard and screen-reader users keep their place. */
function showInstructionsList(focus?:string):void {
  instructionsEdit=null;$('instructions-dialog').querySelector('.dialog-feedback')?.remove();
  $('instructions-form').hidden=true;$('instructions-list-view').hidden=false;$('instructions-title').textContent='System instructions';
  renderInstructionsLock();
  ((focus?$('instructions-dialog').querySelector<HTMLElement>(focus):null)??$('instructions-options').querySelector<HTMLElement>('[aria-current=true]'))?.focus();
}
function showInstructionsForm(mode:'new'|'saved'|'current',name:string,text:string,origin:string,id?:string):void {
  instructionsEdit={mode,id,name,text,origin};$('instructions-dialog').querySelector('.dialog-feedback')?.remove();
  $('instructions-list-view').hidden=true;$('instructions-form').hidden=false;
  $('instructions-title').textContent=mode==='saved'?'Edit saved instructions':mode==='current'?'This conversation’s instructions':'New instructions';
  $<HTMLInputElement>('instructions-name').value=name;$<HTMLTextAreaElement>('instructions-text').value=text;
  $('instructions-delete').hidden=mode!=='saved';$('instructions-save').textContent=mode==='saved'?'Save changes':'Save for reuse';
  $('instructions-discard').hidden=true;$('instructions-delete-confirm').hidden=true;
  refreshInstructionsForm();renderInstructionsLock();$('instructions-text').focus();
}
function refreshInstructionsForm():void {
  const name=$<HTMLInputElement>('instructions-name').value.trim(),text=$<HTMLTextAreaElement>('instructions-text').value;
  $('instructions-count').textContent=`${text.length.toLocaleString()} / 40,000 characters${text.trim()?'':' · leave empty to turn custom instructions off'}`;
  $<HTMLButtonElement>('instructions-save').disabled=!name||!text.trim();
}
function instructionsDirty():boolean {
  const edit=instructionsEdit;
  return !!edit&&$<HTMLDialogElement>('instructions-dialog').open&&($<HTMLInputElement>('instructions-name').value!==edit.name||$<HTMLTextAreaElement>('instructions-text').value!==edit.text);
}
function leaveInstructions(target:'back'|'close'):void {
  if(instructionsDirty()){instructionsLeave=target;$('instructions-discard').hidden=false;document.querySelector<HTMLButtonElement>('[data-action=instructions-keep]')!.focus();return;}
  if(target==='close'||!instructionsEdit)$<HTMLDialogElement>('instructions-dialog').close();else showInstructionsList(instructionsEdit.origin);
}
/** Copies text and name into this conversation's settings. It affects only later requests. */
async function applyInstructions(text:string,name:string):Promise<boolean> {
  if(configDirty){toast('Apply or discard pending Advanced changes first.',true);return false;}
  if(state.busyThreadId===current().id){toast('Stop the active response to change this conversation’s instructions.',true);return false;}
  const thread=current(),named=text.trim()?name.trim():'';
  const ok=await dispatch({type:'thread.settings',id:thread.id,settings:{...thread.settings,systemPrompt:text,systemPromptName:named}});
  if(ok)toast(text.trim()?`From your next message this conversation uses ${named?`“${named}”`:'custom instructions'}.`:'From your next message this conversation uses no custom instructions.');
  return ok;
}
function chooseInstructions(target:HTMLElement):Promise<void> {
  return instructionsRequest(async()=>{
    const key=target.dataset.instructions!;
    if(target.getAttribute('aria-current')==='true'){$<HTMLDialogElement>('instructions-dialog').close();return;}
    const preset=key==='none'?{text:'',name:''}:findPreset(key);
    if(!preset){toast('These instructions are no longer available.',true);renderInstructionsLock();return;}
    if(await applyInstructions(preset.text,preset.name))$<HTMLDialogElement>('instructions-dialog').close();
  });
}
/** Saving only changes the library; a conversation changes only when an entry is chosen. */
function saveInstructionsForm():Promise<void> {
  return instructionsRequest(async()=>{
    const edit=instructionsEdit;if(!edit)return;
    const name=$<HTMLInputElement>('instructions-name').value.trim(),text=$<HTMLTextAreaElement>('instructions-text').value;
    if(!await dispatch({type:'instructions.save',...(edit.mode==='saved'&&edit.id?{id:edit.id}:{}),name,text}))return;
    const saved=presets().find(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase());
    toast(`Saved “${name}”.`);showInstructionsList(saved?`[data-instructions="saved:${CSS.escape(saved.id)}"]`:undefined);
  });
}
function renderAttachments():void {
  const files=pendingFiles.get(current().id)??[];
  setMarkup($('attachments'),files.map((f,i)=>`<button type="button" class="attachment-chip" data-remove-file="${i}" title="Remove ${e(f.name)}">${icon('attach')}${e(f.name)}${icon('close')}</button>`).join(''));
  $('attachments').classList.toggle('hidden',!files.length);
}
function updateComposerHint():void {if(state)$('compose-hint').textContent=current().settings.compare?'Two separate model requests.':responsive.touch?'Enter for a new line · tap ↑ to send':'Enter to send · Shift + Enter for a new line';}
function sizeComposer():void {
  const input=$<HTMLTextAreaElement>('prompt');
  input.style.height='auto';
  const minimum=parseFloat(getComputedStyle(input).minHeight)||48;
  const viewport=window.visualViewport?.height??innerHeight;
  const maximum=responsive.compact?Math.max(minimum,Math.min(170,viewport*.27)):210;
  // scrollHeight excludes borders; the composer textarea has none. An empty
  // single line remains compact and pasted multiline drafts still grow.
  input.style.height=`${Math.min(maximum,Math.max(minimum,input.scrollHeight))}px`;
}
function saveDraft():void {
  clearTimeout(draftTimer);
  const id=current().id, value=$<HTMLTextAreaElement>('prompt').value;
  drafts.set(id,value);
  const files=structuredClone(pendingFiles.get(id)??[]);
  draftTimer=setTimeout(()=>{ void dispatch({type:'thread.draft',id,text:value,attachments:files}); },550);
}
async function flushDraft():Promise<boolean> {
  clearTimeout(draftTimer);
  if(!state) return false;
  const id=current().id, value=$<HTMLTextAreaElement>('prompt').value; drafts.set(id,value);
  const files=pendingFiles.get(id)??current().draftAttachments??[];
  if(value!==current().draft || JSON.stringify(files)!==JSON.stringify(current().draftAttachments??[]))return dispatch({type:'thread.draft',id,text:value,attachments:files});
  return true;
}
async function submit():Promise<void> {
  if(sending||state.busyThreadId) return;
  if(configDirty) { toast('Apply your configuration changes before sending.',true); return; }
  const id=current().id, value=$<HTMLTextAreaElement>('prompt').value;
  if(!value.trim()) return;
  clearTimeout(draftTimer); sending=true;
  const files=pendingFiles.get(id)??[];
  drafts.set(id,''); $<HTMLTextAreaElement>('prompt').value=''; sizeComposer();
  const t=current(),mode=state.connectionMode??'api-key',owner=mode==='chat-account'&&state.account?.profile?'chat:'+state.account.profile.id:'api-key';
  if(state.storage!=='preview'&&t.turns.length>0&&t.connectionOwner!==owner&&(owner!=='api-key'||!!t.connectionOwner)){
    await dispatch({type:'thread.authorize-account',id});drafts.set(id,value);$<HTMLTextAreaElement>('prompt').value=value;sending=false;accept(state);sizeComposer();toast('Review the connection, then press Send when ready.');return;
  }
  const success=await dispatch({type:'send',id,text:value,attachments:files});
  sending=false;
  if(success) pendingFiles.delete(id);
  else if(!drafts.get(id)) { drafts.set(id,value); if(current().id===id) $<HTMLTextAreaElement>('prompt').value=value; }
  accept(state); sizeComposer();
}
let closeRequest:string|null=null, closingWindow=false;
async function answerClose(allow:boolean):Promise<void> {
  if(!closeRequest||closingWindow)return;
  const id=closeRequest;
  if(allow){
    closingWindow=true;app.inert=true;
    const saved=await flushDraft();
    app.inert=false;closingWindow=false;
    if(!saved){await dispatch({type:'window.close-response',requestId:id,allow:false});closeRequest=null;$<HTMLDialogElement>('close-dialog').close();toast('The draft could not be saved. The window remains open.',true);return;}
  }
  closeRequest=null;
  // Close the dialog first; focus returns to the prior editor when keeping open.
  $<HTMLDialogElement>('close-dialog').close();
  await dispatch({type:'window.close-response',requestId:id,allow});
}
bridge?.onCloseRequested?.(id=>{void(async()=>{
  closeRequest=id;
  await dispatch({type:'window.close-ack',requestId:id});
  if(sending||editor.isSaving){await answerClose(false);toast('Finish the pending save or send before closing.',true);return;}
  const reasons:string[]=[];
  if(editor.hasUnsavedChanges)reasons.push('The open editor has unsaved changes.');
  if(instructionsDirty())reasons.push('The instructions editor has unsaved changes.');
  if(configDrafts.size)reasons.push('Unapplied Advanced settings will be discarded.');
  if(state.busyThreadId)reasons.push('The active response and tool work will be stopped; received text is retained.');
  if(reasons.length){$('close-detail').textContent=reasons.join(' ');showDialog('close-dialog');}
  else await answerClose(true);
})();});
$<HTMLDialogElement>('close-dialog').addEventListener('cancel',event=>{event.preventDefault();void answerClose(false);});
/** Escape and Android Back: the dialog on top gets a cancelable cancel event and closes only
 * if no handler keeps it open (the editors ask before discarding unsaved text). */
function cancelTopDialog():boolean {
  const top=topModal();if(!top)return false;
  if(top.dispatchEvent(new Event('cancel',{cancelable:true})))top.close();
  return true;
}
// Chromium stops making a dialog's own cancel event cancelable when Escape is pressed again with
// no other input in between, so a second Escape closed an editor and dropped its unsaved text
// without asking. Handle Escape here instead; an IME keeps Escape while it is composing.
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return;
  if(cancelTopDialog())event.preventDefault();
});
// Android: backgrounding persists the draft (the process may later be stopped without a close
// request); Back closes the topmost layer and reports whether anything was open.
bridge?.onAppEvent?.(async event=>{
  if(event==='pause')return flushDraft();
  if(cancelTopDialog())return true;
  const menu=document.querySelector<HTMLDetailsElement>('details.export-menu[open]');
  if(menu){menu.open=false;return true;}
  if(!$('find-bar').classList.contains('hidden')){void action('find-close');return true;}
  if(responsive.compact&&(responsive.navigation||responsive.advanced||artifactPanel.isOpen())){responsive.close();return true;}
  if(artifactPanel.isOpen()){artifactPanel.close();return true;}
  return false;
});
function showDialog(id:string):void { $(id).querySelector('.dialog-feedback')?.remove();transcriptScheduler.cancel();openModal($<HTMLDialogElement>(id)); }
// Pickers close on the first click of a double-click. Drop the second click only when the first
// was inside an open dialog and this one, at the same point, lands outside every dialog; that is
// decided from the DOM at click time, before the asynchronous close event. Separate quick taps
// elsewhere, such as a drawer's own close button, still work.
let lastClick:{t:number;x:number;y:number;inDialog:boolean}|null=null;
window.addEventListener('click',event=>{
  const inDialog=event.target instanceof Element&&!!event.target.closest('dialog[open]'),prev=lastClick;
  lastClick={t:event.timeStamp,x:event.clientX,y:event.clientY,inDialog};
  if(prev?.inDialog&&!inDialog&&event.detail>1&&event.timeStamp-prev.t<600&&Math.abs(event.clientX-prev.x)<=16&&Math.abs(event.clientY-prev.y)<=16){event.stopImmediatePropagation();event.preventDefault();}
},true);
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',()=>{
  if(dialog.id==='settings-dialog')$<HTMLInputElement>('api-key').value='';
  dialog.querySelector('.dialog-feedback')?.remove();scheduleTranscript(true);
}));
function dismiss():void { document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d=>{if(d===editor.dialog)editor.requestClose();else if(d.id==='instructions-dialog'&&instructionsDirty())leaveInstructions('close');else d.close();}); }
const commands=[['account','Account & connection','lock',''],['artifacts','Toggle artifact workspace','panel','Ctrl Shift A'],['focus','Toggle focus mode','eye','Ctrl Shift F'],['view','Reading & visibility','eye',''],['find','Find in conversation','search','Ctrl F'],['new','New conversation','plus','Ctrl N'],['settings','Settings & connection','settings','Ctrl ,'],['show-inspector','Model configuration','panel',''],['instructions-picker','System instructions','instructions',''],['connect','Verify enclave & refresh models','shield',''],['import','Import conversation','upload',''],['export-md','Export conversation as Markdown','download','']];
function palette():void { $<HTMLInputElement>('palette-search').value=''; renderPalette(); showDialog('palette-dialog'); $('palette-search').focus(); }
function renderPalette():void {
  const filter=$<HTMLInputElement>('palette-search').value.toLowerCase();
  $('palette-items').innerHTML=commands.filter(c=>c[1]!.toLowerCase().includes(filter)).map(([action,label,glyph,key])=>`<button data-action="${action}">${icon(glyph!)}${label}${key?`<kbd class="shortcut">${key}</kbd>`:''}</button>`).join('');
}
async function connect():Promise<void> {
  if(connecting) return; connecting=true; renderConnection();
  await dispatch({type:'connect'}); connecting=false; renderConnection();
}
async function action(name:string, target?:HTMLElement):Promise<void> {
  if(!state) return;
  const thread=current();
  if(name!=='dismiss'&&$<HTMLDialogElement>('palette-dialog').open) $<HTMLDialogElement>('palette-dialog').close();
  switch(name) {
    case 'keep-open':await answerClose(false);break;
    case 'confirm-close':await answerClose(true);break;
    case 'apply-pending':if(!$<HTMLFormElement>('config-form').checkValidity()){await action('show-inspector');}$<HTMLFormElement>('config-form').requestSubmit();break;
    case 'discard-pending':configDrafts.delete(thread.id);configDirty=false;renderConfiguration(true);pendingSettings();break;
    case 'new': if(!await flushDraft())break; await dispatch({type:'thread.new'}); if(responsive.compact)responsive.close();$('prompt').focus();break;
    case 'close-drawers':responsive.close();break;
    case 'new-project-thread':if(!await flushDraft())break;await dispatch({type:'thread.new',projectId:target?.dataset.project??null});if(responsive.compact)responsive.close();break;
    case 'project-toggle':if(target?.dataset.project){const id=target.dataset.project;collapsedProjects.has(id)?collapsedProjects.delete(id):collapsedProjects.add(id);renderSidebar();}break;
    case 'project-create':case 'project-manage':projectEditingId=name==='project-manage'?target?.dataset.project??null:null;$('project-dialog-title').textContent=projectEditingId?'Project settings':'New project';$<HTMLInputElement>('project-name').value=state.workspace.projects.find(p=>p.id===projectEditingId)?.name??'';$('remove-project').classList.toggle('hidden',!projectEditingId);$('project-delete-confirm').classList.add('hidden');showDialog('project-dialog');$('project-name').focus();break;
    case 'project-remove':$('project-delete-confirm').classList.remove('hidden');break;
    case 'project-confirm-remove':if(projectEditingId&&await dispatch({type:'project.delete',id:projectEditingId}))dismiss();break;
    case 'thread-project':case 'move-project':setMarkup($('move-project'),'<option value="">Unfiled</option>'+state.workspace.projects.map(p=>`<option value="${e(p.id)}">${e(p.name)}</option>`).join(''));$<HTMLSelectElement>('move-project').value=thread.projectId??'';showDialog('move-dialog');break;
    case 'original-thread':if(thread.branchOf){if(!await flushDraft())break;await dispatch({type:'thread.select',id:thread.branchOf});}break;
    case 'edit-draft':if(!await flushDraft())break;editor.open({kind:'draft',title:'Edit message',content:$<HTMLTextAreaElement>('prompt').value,attachmentNames:(pendingFiles.get(thread.id)??[]).map(a=>a.name),save:async content=>{drafts.set(thread.id,content);const ok=await dispatch({type:'thread.draft',id:thread.id,text:content});if(ok&&current().id===thread.id){$<HTMLTextAreaElement>('prompt').value=content;sizeComposer();}return ok;}});break;
    case 'edit-reply':case 'edit-thinking':{const turn=thread.turns.find(t=>t.id===target?.dataset.turn),reply=turn?.replies.find(r=>r.id===target?.dataset.reply);if(!turn||!reply)break;if(state.busyThreadId===thread.id){toast('Stop the active response before editing.',true);break;}if(!await flushDraft())break;editor.open({kind:'reply',title:'Edit response',field:name==='edit-thinking'?'reasoning':'content',content:reply.content,reasoning:reply.reasoning,originalContent:reply.edit?.originalContent,originalReasoning:reply.edit?.originalReasoning,save:async(content,reasoning)=>dispatch({type:'reply.edit',id:thread.id,turnId:turn.id,replyId:reply.id,content,reasoning,expectedContent:reply.content,expectedReasoning:reply.reasoning})});break;}
    case 'palette': palette(); break;
    case 'conversations':if(responsive.compact){if(!responsive.navigation)responsive.showNavigation();}else await setView({sidebar:true,focus:false});$('search').focus();break;
    case 'artifacts': artifactPanel.toggle(); break;
    case 'account':showAccount();break;
    case 'account-sample':if(state.storage==='preview')window.dispatchEvent(new CustomEvent('workbench-preview-account'));break;
    case 'account-login':await dispatch({type:'account.login'});break;
    case 'account-cancel':await dispatch({type:'account.cancel'});break;
    case 'account-refresh':await dispatch({type:'account.refresh'});break;
    case 'account-manage':await dispatch({type:'account.manage'});break;
    case 'account-signout':await dispatch({type:'account.signout'});break;
    case 'account-mode-chat':await dispatch({type:'connection.mode',mode:'chat-account'});break;
    case 'account-mode-api':await dispatch({type:'connection.mode',mode:'api-key'});break;
    case 'account-api':dismiss();$('key-feedback').textContent='';showDialog('settings-dialog');break;
    case 'account-connect':await connect();break;
    case 'settings': $('key-feedback').textContent=''; showDialog('settings-dialog'); break;
    case 'dismiss': dismiss(); break;
    case 'inspector':if(responsive.compact)responsive.showAdvanced();else{artifactPanel.close();await setView({inspector:!view.inspector,focus:false});}break;
    case 'sidebar':if(responsive.compact)responsive.showNavigation();else await setView({sidebar:!view.sidebar,focus:false});break;
    case 'focus': await setView({focus:!view.focus}); break;
    case 'mobile-view':case 'view': renderViewControls(); showDialog('view-dialog'); break;
    case 'mobile-find':case 'find': $('find-bar').classList.remove('hidden');$('find-input').focus();break;
    case 'find-close': $('find-bar').classList.add('hidden');clearFind();break;
    case 'find-next': moveFind(1);break;
    case 'find-prev': moveFind(-1);break;
    case 'model-picker': $<HTMLInputElement>('quick-model').value=thread.settings.model; renderModels();showDialog('model-dialog');$('quick-model').focus();break;
    case 'instructions-picker':showInstructionsList();showDialog('instructions-dialog');$('instructions-options').querySelector<HTMLButtonElement>('[aria-current=true]')?.focus();break;
    case 'instructions-new':showInstructionsForm('new','','','[data-action=instructions-new]');break;
    case 'instructions-edit':{
      const key=target?.dataset.edit??'',preset=findPreset(key),origin=`.instruction-edit[data-edit="${CSS.escape(key)}"]`;
      if(key==='current')showInstructionsForm('current',thread.settings.systemPromptName,thread.settings.systemPrompt,origin);
      else if(preset&&key.startsWith('saved:'))showInstructionsForm('saved',preset.name,preset.text,origin,preset.id);
      else if(preset)showInstructionsForm('new','',preset.text,origin); // Starters are read-only; edit a copy.
      break;
    }
    case 'instructions-back':leaveInstructions('back');break;
    case 'instructions-close':leaveInstructions('close');break;
    case 'instructions-keep':$('instructions-discard').hidden=true;$('instructions-text').focus();break;
    case 'instructions-discard':{const origin=instructionsEdit?.origin;instructionsEdit=null;$('instructions-discard').hidden=true;if(instructionsLeave==='close')$<HTMLDialogElement>('instructions-dialog').close();else showInstructionsList(origin);break;}
    case 'instructions-save':await saveInstructionsForm();break;
    case 'instructions-delete':{const preset=presets().find(p=>p.id===instructionsEdit?.id);if(!preset)break;$('instructions-delete-text').textContent=`Delete “${preset.name}” from saved instructions? Conversations that already use it keep their copy.`;$('instructions-delete-confirm').hidden=false;document.querySelector<HTMLButtonElement>('[data-action=instructions-keep-saved]')!.focus();break;}
    case 'instructions-keep-saved':$('instructions-delete-confirm').hidden=true;$('instructions-delete').focus();break;
    case 'instructions-confirm-delete':await instructionsRequest(async()=>{if(instructionsEdit?.id&&await dispatch({type:'instructions.delete',id:instructionsEdit.id})){toast('Saved instructions deleted. Conversations that used them are unchanged.');showInstructionsList();}});break;
    case 'python-pick': await dispatch({type:'python.pick'});break;
    case 'source': if(target?.dataset.reply){rawReplies.has(target.dataset.reply)?rawReplies.delete(target.dataset.reply):rawReplies.add(target.dataset.reply);renderTranscript();}break;
    case 'cancel-delegate': if(target?.dataset.tool)await dispatch({type:'tool.cancel',id:thread.id,toolId:target.dataset.tool});break;
    case 'approve-tool': case 'deny-tool': if(target?.dataset.tool)await dispatch({type:'tool.approve',id:thread.id,toolId:target.dataset.tool,approve:name==='approve-tool'});break;
    case 'artifact-view': case 'artifact-save': {
      const tool=thread.turns.flatMap(t=>t.replies).flatMap(r=>r.tools??[]).find(t=>t.id===target?.dataset.tool);
      const artifact=tool?.artifacts.find(a=>a.id===target?.dataset.artifact);
      if(!tool||!artifact)break;
      if(name==='artifact-save')await dispatch({type:'artifact.save',id:thread.id,toolId:tool.id,artifactId:artifact.id});
      else artifactPanel.open({artifact,toolId:tool.id,threadId:thread.id});
      break;
    }
    case 'verify': case 'show-inspector': dismiss(); if(responsive.compact){if(!responsive.advanced)responsive.showAdvanced();}else await setView({inspector:true,focus:false}); if(name==='verify')document.querySelector<HTMLDetailsElement>('.connection-details')!.open=true; break;
    case 'compare':
      if(configDirty) { toast('Apply your configuration changes first.',true); break; }
      await dispatch({type:'thread.settings',id:thread.id,settings:{...thread.settings,compare:!thread.settings.compare}});
      if(current().settings.compare){if(responsive.compact){if(!responsive.advanced)responsive.showAdvanced();}else await setView({inspector:true,focus:false});} break;
    case 'pin': await dispatch({type:'thread.pin',id:thread.id}); break;
    case 'rename-thread':case 'rename': $<HTMLInputElement>('rename-input').value=thread.title; showDialog('rename-dialog'); break;
    case 'delete': await dispatch({type:'thread.delete',id:thread.id}); break;
    case 'connect': await connect(); break;
    case 'forget-key': await dispatch({type:'credentials.clear'}); $<HTMLInputElement>('api-key').value=''; break;
    case 'docs': await dispatch({type:'open.docs'}); break;
    case 'stop': await dispatch({type:'stop',id:thread.id}); break;
    case 'jump': $('transcript').scrollTop=$('transcript').scrollHeight; break;
    case 'export-md': case 'export-json': await flushDraft(); await dispatch({type:'export',id:thread.id,format:name==='export-md'?'markdown':'json'}); break;
    case 'import': if(!await flushDraft())break; await dispatch({type:'import'}); break;
    case 'attach': {
      try {
        const result=await bridge!.command({type:'attachments.pick'});
        accept(result.snapshot);
        const added=result.attachments??[], existing=pendingFiles.get(thread.id)??[];
        if(existing.length+added.length>8||[...existing,...added].reduce((n,a)=>n+a.content.length,0)>200000) { toast('Attachment limit exceeded: eight files and 200,000 combined characters.',true); break; }
        pendingFiles.set(thread.id,[...existing,...added]); renderAttachments();
        await dispatch({type:'thread.draft',id:thread.id,text:drafts.get(thread.id)??thread.draft,attachments:pendingFiles.get(thread.id)??[]});
      } catch(error) { toast(error instanceof Error?error.message:'Could not attach file.',true); }
      break;
    }
    case 'edit':{if(!await flushDraft())break;const turn=thread.turns.find(t=>t.id===target?.dataset.turn);if(!turn)break;if(state.busyThreadId===thread.id){toast('Stop the active response before editing.',true);break;}editor.open({kind:'prompt',title:'Edit prompt',content:turn.prompt,attachmentNames:turn.attachments.map(a=>a.name),save:async content=>{const ok=await dispatch({type:'prompt.edit',id:thread.id,turnId:turn.id,content,expectedContent:turn.prompt});if(!ok)return false;const id=current().id;drafts.set(id,content);pendingFiles.set(id,structuredClone(turn.attachments));renderAttachments();return true;}});break;}
    case 'retry': case 'branch': {
      if(!await flushDraft())break; const turn=thread.turns.find(t=>t.id===target?.dataset.turn);
      if(!turn) break;
      const before=name!=='branch';
      const ok=await dispatch({type:'thread.fork',id:thread.id,turnId:turn.id,before,replyId:target?.dataset.reply});
      if(ok&&before) { pendingFiles.set(current().id,structuredClone(turn.attachments)); renderAttachments(); $('prompt').focus(); if(name==='retry') await submit(); }
      break;
    }
    case 'choose':
      if(target?.dataset.turn&&target.dataset.reply) await dispatch({type:'reply.select',id:thread.id,turnId:target.dataset.turn,replyId:target.dataset.reply}); break;
    case 'copy-reply': {
      const reply=thread.turns.flatMap(t=>t.replies).find(r=>r.id===target?.dataset.reply);
      if(reply&&await dispatch({type:'clipboard',text:reply.content})) toast('Reply copied.'); break;
    }
    case 'minimize': case 'maximize': case 'close': await dispatch({type:'window',action:name}); break;
  }
  document.querySelectorAll<HTMLDetailsElement>('.export-menu[open]').forEach(d=>d.open=false);
}
document.addEventListener('click',event=>{
  const target=(event.target as Element).closest<HTMLElement>('button');
  if(!target||!state) return;
  if(target.dataset.url){void dispatch({type:'open.url',url:target.dataset.url});return;}
  if(target.classList.contains('wrap-code')){target.closest('.code-block')?.classList.toggle('wrap');return;}
  if(target.classList.contains('run-code')||target.classList.contains('preview-code')){void codeAction(target);return;}
  // The picker swaps views and closes on single clicks, so a second click of a double-click
  // would act on whatever replaced the pressed button. No control there uses double-clicks.
  if(event.detail>1&&target.closest('#instructions-dialog')){event.preventDefault();return;}
  if(target.dataset.instructions){void chooseInstructions(target);return;}
  if(target.dataset.quickModel){$<HTMLInputElement>('quick-model').value=target.dataset.quickModel; $<HTMLFormElement>('model-form').requestSubmit();return;}
  if(target.dataset.action) { void action(target.dataset.action,target); return; }
  if(target.dataset.thread) { void (async()=>{if(!await flushDraft())return; await dispatch({type:'thread.select',id:target.dataset.thread!});if(responsive.compact)responsive.close();})(); return; }
  if(target.dataset.prompt!==undefined) { $<HTMLTextAreaElement>('prompt').value=target.dataset.prompt.replace(/\\n/g,'\n'); sizeComposer(); saveDraft(); $('prompt').focus(); return; }
  if(target.dataset.removeFile!==undefined) { const files=pendingFiles.get(current().id)??[]; files.splice(Number(target.dataset.removeFile),1); renderAttachments(); saveDraft(); return; }
  if(target.classList.contains('copy-code')) { const content=target.closest('.code-block')?.querySelector('pre code')?.textContent; if(content) void dispatch({type:'clipboard',text:content}).then(ok=>{if(ok)toast('Code copied.');}); }
});
function applyView():void {
  if(view.focus)artifactPanel.close(false);
  responsive.apply(view.sidebar,view.inspector,view.focus);
  document.documentElement.classList.toggle('reduce-motion',view.motion==='reduced');
  $('shell').classList.toggle('focus-mode',view.focus);
  $('shell').classList.toggle('show-metadata',view.metadata);
  $('shell').classList.toggle('wrap-all-code',view.wrapCode);
}
async function setView(partial:Partial<ViewPreferences>):Promise<void> {
  const updated={...view,...partial};
  if(partial.reasoning!==undefined){disclosures.clear();document.querySelectorAll<HTMLDetailsElement>('.reasoning').forEach(d=>d.open=partial.reasoning==='expanded');}
  await dispatch({type:'view.set',view:updated});
}
function renderViewControls():void {
  $<HTMLSelectElement>('view-reasoning').value=view.reasoning;
  $<HTMLSelectElement>('view-motion').value=view.motion;
  for(const key of ['markdown','math','metadata','wrapCode','focus','autoArtifacts'] as const)$<HTMLInputElement>(`view-${key}`).checked=view[key];
}
for(const key of ['markdown','math','metadata','wrapCode','focus','autoArtifacts'] as const)$(`view-${key}`).addEventListener('change',()=>{void setView({[key]:$<HTMLInputElement>(`view-${key}`).checked});});
$('view-motion').addEventListener('change',()=>{void setView({motion:$<HTMLSelectElement>('view-motion').value as ViewPreferences['motion']});});
document.addEventListener('selectionchange',()=>{if(state&&window.getSelection()?.isCollapsed)scheduleTranscript();});
$('view-reasoning').addEventListener('change',()=>{void setView({reasoning:$<HTMLSelectElement>('view-reasoning').value as ViewPreferences['reasoning']});});
function renderModels():void {
  const filter=$<HTMLInputElement>('quick-model').value.toLowerCase();
  $('model-options').innerHTML=state.models.filter(m=>m.toLowerCase().includes(filter)).slice(0,30).map(m=>`<button type="button" data-quick-model="${e(m)}">${e(m)}</button>`).join('');
}
$('quick-model').addEventListener('input',renderModels);
$('model-form').addEventListener('submit',event=>{event.preventDefault();if(configDirty){toast('Apply pending Advanced changes first.',true);return;}void dispatch({type:'thread.settings',id:current().id,settings:{...current().settings,model:$<HTMLInputElement>('quick-model').value.trim()}}).then(ok=>{if(ok)dismiss();});});
function clearFind():void {
  document.querySelectorAll('mark.search-match').forEach(m=>m.replaceWith(document.createTextNode(m.textContent??'')));
  $('transcript-inner').normalize();$('find-count').textContent='';
}
function findText():void {
  clearFind();findIndex=0;
  const query=$<HTMLInputElement>('find-input').value.toLowerCase();if(!query)return;
  const walker=document.createTreeWalker($('transcript-inner'),NodeFilter.SHOW_TEXT);
  const nodes:Text[]=[];let node:Node|null;
  while((node=walker.nextNode())){const parent=node.parentElement;if(parent?.closest('.user-prompt,.reply-content')&&!parent.closest('math,annotation,button,svg'))nodes.push(node as Text);}
  let count=0;
  for(const n of nodes){const value=n.data,lower=value.toLowerCase();let from=0,index=lower.indexOf(query);if(index<0)continue;const fragment=document.createDocumentFragment();while(index>=0&&count<200){fragment.append(value.slice(from,index));const mark=document.createElement('mark');mark.className='search-match';mark.textContent=value.slice(index,index+query.length);fragment.append(mark);from=index+query.length;index=lower.indexOf(query,from);count++;}fragment.append(value.slice(from));n.replaceWith(fragment);}
  moveFind(0);
}
function moveFind(offset:number):void {
  const hits=[...document.querySelectorAll<HTMLElement>('mark.search-match')];
  if(!hits.length){$('find-count').textContent='No matches';return;}
  findIndex=(findIndex+offset+hits.length)%hits.length;hits.forEach((h,i)=>h.classList.toggle('current-match',i===findIndex));
  hits[findIndex]!.scrollIntoView({block:'center'});$('find-count').textContent=`${findIndex+1} / ${hits.length}${hits.length>=200?'+':''}`;
}
$('find-input').addEventListener('input',findText);
$('find-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();moveFind(event.shiftKey?-1:1);}if(event.key==='Escape')void action('find-close');});
function previewContent(language:string,source:string,title:string):void {
  artifactPanel.openSource(language,source,title,current().id);
}
async function codeAction(target:HTMLElement):Promise<void>{
  const replyElement=target.closest<HTMLElement>('.reply');if(!replyElement)return;
  const replyId=replyElement.id.slice('reply-'.length),reply=current().turns.flatMap(t=>t.replies).find(r=>r.id===replyId);
  const index=Number(target.closest<HTMLElement>('.code-block')?.dataset.codeIndex),block=reply&&extractCodeBlocks(reply.content)[index];if(!block)return;
  if(target.classList.contains('run-code'))await dispatch({type:'code.run',id:current().id,replyId,index});
  else previewContent(block.language,block.code,block.language.toUpperCase()+' preview');
}
document.addEventListener('dblclick',event=>{const formula=(event.target as Element).closest<HTMLElement>('[data-tex]');if(formula?.dataset.tex)void dispatch({type:'clipboard',text:formula.dataset.tex}).then(ok=>{if(ok)toast('LaTeX copied.');});});
$('search').addEventListener('input',()=>{if(state)renderSidebar();});
$('palette-search').addEventListener('input',renderPalette);
$('palette-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();$('palette-items').querySelector<HTMLButtonElement>('button')?.click();}});
// One observer for the composer, never one observer per streamed paragraph.
// It keeps Latest above attachments/wrapped controls and reflows drafts after
// a drawer or orientation change without resetting selection or scroll state.
let composerWidth=-1, composerHeight=-1;
const composerObserver=new ResizeObserver(entries=>{
  const box=entries[0]?.borderBoxSize[0];
  if(!box)return;
  if(Math.abs(box.blockSize-composerHeight)>.5){
    composerHeight=box.blockSize;
    $('shell').style.setProperty('--composer-region-height',`${composerHeight}px`);
  }
  if(Math.abs(box.inlineSize-composerWidth)>.5){
    composerWidth=box.inlineSize;
    sizeComposer();
  }
});
composerObserver.observe(document.querySelector<HTMLElement>('.composer-region')!);
window.visualViewport?.addEventListener('resize',()=>sizeComposer());
$('prompt').addEventListener('input',()=>{sizeComposer(); if(state)saveDraft();});
$('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229&&(!responsive.touch||event.ctrlKey||event.metaKey)){event.preventDefault(); void submit();}});
$('composer-form').addEventListener('submit',event=>{event.preventDefault(); void submit();});
$('transcript').addEventListener('scroll',()=>{$('jump').classList.toggle('hidden',$('transcript').scrollHeight-$('transcript').scrollTop-$('transcript').clientHeight<150);});
$('config-form').addEventListener('input',rememberConfiguration);
$('config-form').addEventListener('submit',event=>{
  event.preventDefault();
  const applied=current().settings,systemPrompt=$<HTMLTextAreaElement>('instructions').value;
  // Editing the text in Advanced makes it unnamed custom instructions; unchanged text keeps its name.
  const values:GenerationSettings={...applied,model:$<HTMLInputElement>('model').value.trim(),compareModel:$<HTMLInputElement>('compare-model').value.trim(),systemPrompt,systemPromptName:systemPrompt===applied.systemPrompt?applied.systemPromptName:'',
    temperature:$<HTMLInputElement>('temperature').value===''?null:Number($<HTMLInputElement>('temperature').value),maxTokens:Number($<HTMLInputElement>('max-tokens').value),toolsMode:$<HTMLSelectElement>('tools-mode').value as GenerationSettings['toolsMode'],reasoningEffort:$<HTMLSelectElement>('reasoning').value,thinkingMode:$<HTMLSelectElement>('thinking-mode').value as GenerationSettings['thinkingMode'],compareReasoningEffort:$<HTMLSelectElement>('compare-reasoning').value,compareThinkingMode:$<HTMLSelectElement>('compare-thinking-mode').value as GenerationSettings['thinkingMode'],visualTools:$<HTMLInputElement>('visual-tools').checked,webSearch:$<HTMLInputElement>('web-search').checked,delegateMode:$<HTMLSelectElement>('delegate-mode').value as GenerationSettings['delegateMode']};
  const id=current().id,originalDraft=configDrafts.get(id);
  void dispatch({type:'thread.settings',id,settings:values}).then(ok=>{if(ok){if(configDrafts.get(id)===originalDraft)configDrafts.delete(id);configDirty=configDrafts.has(current().id);if(current().id===id&&!configDirty){$('apply-settings').textContent='Apply settings';renderConfiguration(true);}pendingSettings();toast('Conversation settings saved.');}});
});
$('instructions-form').addEventListener('submit',event=>{event.preventDefault();void instructionsRequest(async()=>{if(await applyInstructions($<HTMLTextAreaElement>('instructions-text').value,$<HTMLInputElement>('instructions-name').value)){instructionsEdit=null;$<HTMLDialogElement>('instructions-dialog').close();}});});
$('instructions-form').addEventListener('input',refreshInstructionsForm);
// Enter in the name field must not apply instructions; Ctrl+Enter applies from anywhere in the form.
$('instructions-name').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();$('instructions-text').focus();}});
$('instructions-form').addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!event.isComposing){event.preventDefault();$<HTMLFormElement>('instructions-form').requestSubmit();}});
$<HTMLDialogElement>('instructions-dialog').addEventListener('cancel',event=>{if(instructionsEdit){event.preventDefault();leaveInstructions('back');}});
$<HTMLDialogElement>('instructions-dialog').addEventListener('close',()=>{instructionsEdit=null;});
$('instructions').addEventListener('input',renderInstructionsApplied);
$('key-form').addEventListener('submit',event=>{
  event.preventDefault(); if(connecting)return;
  void (async()=>{
    const input=$<HTMLInputElement>('api-key'), value=input.value.trim(); input.value='';
    $<HTMLButtonElement>('save-key').disabled=true; $('key-feedback').textContent=state.connectionMode==='chat-account'?'Saving key…':'Saving and verifying…';
    if(value&&!(await dispatch({type:'credentials.set',key:value}))) { $('key-feedback').textContent='The key could not be saved.'; $<HTMLButtonElement>('save-key').disabled=false; return; }
    if(state.connectionMode==='chat-account'){
      $('key-feedback').textContent=value?'Key saved. Chat account mode remains selected; choose API key in Account to verify and use it.':'No new API key entered. Chat account mode remains selected.';
      $<HTMLButtonElement>('save-key').disabled=false;return;
    }
    await connect();
    $('key-feedback').textContent=state.verification.state==='verified'?'Enclave verified. Choose a chat model in Configuration.':'Not connected. Check the error message and retry.';
    $<HTMLButtonElement>('save-key').disabled=false;
  })();
});
$('project-form').addEventListener('submit',event=>{event.preventDefault();const name=$<HTMLInputElement>('project-name').value;void dispatch(projectEditingId?{type:'project.rename',id:projectEditingId,name}:{type:'project.create',name}).then(ok=>{if(ok)dismiss();});});
$('move-form').addEventListener('submit',event=>{event.preventDefault();void dispatch({type:'thread.move',id:current().id,projectId:$<HTMLSelectElement>('move-project').value||null}).then(ok=>{if(ok)dismiss();});});
$('rename-form').addEventListener('submit',event=>{event.preventDefault();void dispatch({type:'thread.rename',id:current().id,title:$<HTMLInputElement>('rename-input').value}).then(ok=>{if(ok)dismiss();});});
document.addEventListener('keydown',event=>{
  if(event.isComposing||document.querySelector('dialog[open]'))return;
  if(event.ctrlKey||event.metaKey){if(event.shiftKey&&event.key.toLowerCase()==='a'){event.preventDefault();void action('artifacts');return;}if(event.key.toLowerCase()==='f'){event.preventDefault();void action(event.shiftKey?'focus':'find');return;}if(event.key.toLowerCase()==='b'){event.preventDefault();void action('sidebar');return;}if(event.key.toLowerCase()==='n'){event.preventDefault();void action('new');}else if(event.key.toLowerCase()==='k'){event.preventDefault();palette();}else if(event.key===','){event.preventDefault();void action('settings');}}
});
document.addEventListener('selectionchange',()=>{if(state&&window.getSelection()?.isCollapsed)scheduleTranscript(true);});
$('transcript').addEventListener('toggle',event=>{const d=event.target;if(d instanceof HTMLDetailsElement&&d.dataset.disclosure){disclosures.set(d.dataset.disclosure,d.open);scheduleTranscript(true);}},true);
window.addEventListener('error',()=>toast('The interface encountered an error. Restart before sending another request.',true));
window.addEventListener('unhandledrejection',()=>toast('An operation failed. Your existing conversations were not intentionally reset.',true));
if(!bridge) { $('notice').textContent='Desktop bridge unavailable. Launch with npm start, or use npm run preview for an explicitly offline demonstration.'; $('notice').classList.remove('hidden'); $<HTMLButtonElement>('send').disabled=true; }
else { bridge.subscribe(accept); bridge.snapshot().then(accept).catch(error=>toast(error instanceof Error?error.message:'Unable to open workspace.',true)); }
