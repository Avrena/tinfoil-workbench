import type { AccountSnapshot, ConnectionMode } from './account.js';
import type { ModelCapability, ThinkingMode } from './capabilities.js';
import type { ViewPreferences } from './preferences.js';
import type { CloudChatLink, CloudProjectLink } from './cloud.js';
import type { AgentApproval, AgentShell } from './agent.js';
export type ReplyStatus = 'queued' | 'streaming' | 'complete' | 'stopped' | 'error' | 'interrupted' | 'awaiting_approval' | 'executing';
export interface GenerationSettings {
  toolsMode: 'off' | 'ask';
  visualTools: boolean;
  webSearch: boolean;
  delegateMode: 'off' | 'ask';
  /** The workspace agent (docs/WORKSPACE-AGENT.md), Windows only; it also needs the conversation's agentFolder. */
  agentMode: 'off' | 'ask';
  agentShell: AgentShell;
  /** Which of the agent's calls run without asking: none, file changes in the folder, or commands too (except those
   * `commandRisk` or `outsidePaths` flag). Raised only by the host after its own confirmation; a new conversation asks. */
  agentApproval?: AgentApproval;
  thinkingMode: ThinkingMode;
  compareReasoningEffort: string;
  compareThinkingMode: ThinkingMode;
  model: string;
  compareModel: string;
  compare: boolean;
  systemPrompt: string;
  /** Display name of systemPrompt (a saved or starter entry, or one typed by the user).
   * '' when unnamed or blank. Local presentation only; never sent to a model. */
  systemPromptName: string;
  temperature: number | null;
  maxTokens: number;
  reasoningEffort: string;
}
/** A text file travels as its text. A picture keeps only a reference to the stored image (Workspace `images`) and a
 * small thumbnail for the page; a folder only its path, which the workspace agent may read (core/attachments.ts). */
export interface Attachment { name: string; content: string; kind?: 'image' | 'folder'; image?: ImageAttachment; path?: string }
export interface ImageAttachment { id: string; mime: string; width: number; height: number; thumb: string }
/** A picture attached to a message or draft, base64 without its data: prefix. Never in snapshots. */
export interface StoredImage { mime: string; data: string; added: number }
/** Where a picture of a Tinfoil cloud chat is kept in Tinfoil's attachment storage; `key` is base64 (32 bytes). */
export interface CloudPicture { chat: string; id: string; key: string }
export interface Usage { input: number; output: number }
export interface Artifact { id: string; name: string; mime: string; data: string; kind?: 'html' | 'svg' | 'markdown' | 'text' | 'json' | 'pdf' | 'chart' | 'table' | 'diagram' | 'timeline' | 'stats'; title?: string; source?: string; description?: string; version?: number; parentId?: string; rootId?: string }
export interface DelegateRun {
  model: string; task: string; content: string; reasoning: string;
  phase: 'waiting' | 'thinking' | 'answering'; usage: Usage | null;
}
export interface ProviderActivity {
  itemId: string; round: number; family: 'web_search' | 'code_execution';
  sources: { url: string; title: string }[];
}
export interface ToolRun {
  batchId?: string;
  batchIndex?: number;
  batchSize?: number;
  delegate?: DelegateRun;
  provider?: ProviderActivity;
  contentOffset?: number;
  /** A workspace agent call: the folder and shell it ran in, and for a change the diff shown for approval. */
  /** `auto`: approved by the conversation's approval level, not by the person; `asked`: why a command asked anyway. */
  agent?: { folder: string; shell?: AgentShell; diff?: string; auto?: true; asked?: string };
  id: string; callId: string; name: string; arguments: string;
  /** 'text': a drawing call the model wrote into its answer as text, which Workbench drew (see recoverTextCalls). */
  /** Model-requested Python run by the conversation's workspace agent level ("auto"), not approved by the person. */
  autoApproved?: true;
  origin: 'model' | 'manual' | 'provider' | 'text'; status: 'queued' | 'awaiting_approval' | 'running' | 'complete' | 'error' | 'denied' | 'cancelled';
  stdout: string; stderr: string; exitCode: number | null; elapsedMs: number;
  artifacts: Artifact[]; truncated: boolean;
}
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ReplyEdit { originalContent: string; originalReasoning: string; contentEdited: boolean; reasoningEdited: boolean; historyRewritten?: boolean; editedAt: number }
export interface Project { id: string; name: string; createdAt: number; /** Set for a Tinfoil cloud project. */ cloud?: CloudProjectLink }
/** Reusable system instructions. Selecting one copies its text into a thread's settings,
 * so later edits or deletion never change an existing conversation. */
export interface InstructionPreset { id: string; name: string; text: string; createdAt: number; updatedAt: number }
export interface Reply {
  edit?: ReplyEdit;
  /** UTF-16 offset of the final round; tool history already stores prior rounds. */
  finalContentOffset?: number;
  phase?: 'waiting' | 'thinking' | 'answering';
  /** Name of the custom system instructions sent with this request ('' when unnamed), for display
   * only. Absent when none were sent, and on replies recorded before the field existed. */
  systemPromptName?: string;
  id: string; model: string; content: string; reasoning: string;
  tools?: ToolRun[]; toolMessages?: ApiMessage[];
  status: ReplyStatus; finishReason: string | null;
  error: string | null; usage: Usage | null; elapsedMs: number;
  /** Time spent thinking, in ms, over the finished stretches of the reply's rounds; and while a stretch runs, when it
   * began (the host's clock; validation drops it when a workspace is opened again). */
  thinkingMs?: number; thinkingSince?: number;
}
export interface Turn {
  id: string; prompt: string; attachments: Attachment[]; createdAt: number;
  replies: Reply[]; selectedReplyId: string | null;
  /** A message added in another role (the transcript editor): `prompt` is sent as that role, and there is no reply. */
  role?: 'assistant' | 'system';
  /** This turn's number among the versions of its point in the conversation, in the order they were made; absent is 1. */
  version?: number;
  /** The other versions of this point, each with the turns that followed it (core/versions.ts). Only a turn on the
   * conversation's path holds them; a turn set aside with a version never does, though the turns after it keep theirs. */
  versions?: TurnVersion[];
}
/** A version set aside: the turn at its point first, then the turns that followed it. */
export interface TurnVersion { turns: Turn[] }
export interface Thread {
  /** Local authorization binding, not model context or a cloud-sync identifier. */
  connectionOwner?: string;
  projectId?: string | null;
  branchOf?: string;
  /** Set for a Tinfoil cloud chat (docs/CLOUD.md). */
  cloud?: CloudChatLink;
  /** Started from the Cloud list: becomes a cloud chat after its first reply, like a conversation in a cloud project. */
  cloudPending?: true;
  /** The workspace agent's folder: an absolute path, set only through the native folder picker. */
  agentFolder?: string;
  id: string; title: string; pinned: boolean; createdAt: number; updatedAt: number;
  settings: GenerationSettings; turns: Turn[]; draft: string;
  /** Unsent reference files, encrypted with the draft and never sent until Send. */
  draftAttachments?: Attachment[];
}
export interface Workspace {
  version: 1; activeId: string; threads: Thread[]; projects: Project[]; instructionPresets: InstructionPreset[];
  connectionMode?: ConnectionMode; /** false turns staying signed in off; absent means on. */ rememberAccount?: false;
  /** Tinfoil cloud sync: the chat key (`key_…`), its key ID and the Tinfoil user it belongs to. Never in snapshots. */
  cloud?: CloudConfig; apiKey: string; cacheSecret: string; view: ViewPreferences; pythonPath: string;
  /** Where the workspace agent makes a new folder for a conversation that has none (Windows; set by the host's picker). */
  agentRoot?: string;
  /** Pictures attached to messages and drafts, by ImageAttachment id. Never in snapshots. */
  images?: Record<string, StoredImage>;
  /** Pictures of Tinfoil cloud chats, by ImageAttachment id: the cloud chat, the sync enclave's ID for the picture and
   * the picture's own key, which the chat's messages also hold (docs/CLOUD.md). Never in snapshots. */
  cloudImages?: Record<string, CloudPicture>;
  /** The picture behind the conversation (Settings → Chat background), base64. Never in snapshots: they carry its id. */
  backgroundPicture?: { id: string; mime: string; data: string };
}
/** `writer` and `clock` are this installation's edit clock for Tinfoil's conflict order (docs/CLOUD.md). */
export interface CloudConfig { key: string; keyId: string; user: string; writer: string; clock: number }
/** Cloud sync as the renderer sees it; the key itself is never included. */
export interface CloudStatus {
  state: 'off' | 'checking' | 'ready' | 'syncing' | 'error'; keyId: string | null; user: string | null;
  lastSyncAt: number | null; message: string | null; chats: number; projects: number; older: number;
}
export interface Verification {
  state: 'idle' | 'checking' | 'verified' | 'failed';
  checkedAt: number | null; steps: { name: string; status: string }[];
}
export interface PythonInterpreter { path: string; version: string | null; onPath?: true; missing?: true }
export interface Snapshot {
  sequence: number;
  workspace: Omit<Workspace, 'apiKey' | 'cacheSecret' | 'pythonPath'>;
  account?: AccountSnapshot; connectionMode?: ConnectionMode; rememberAccount?: boolean; cloud?: CloudStatus;
  /** Cloud chats whose messages are being fetched. */
  cloudLoading?: string[];
  hasKey: boolean; models: string[]; capabilities?: ModelCapability[]; verification: Verification;
  /** Tinfoil's public model catalog, loaded without credentials when the model picker needs it. */
  modelCatalog?: 'idle' | 'loading' | 'ready' | 'failed';
  busyThreadId: string | null; storage: 'os-encrypted' | 'preview';
  /** The id of the stored background picture, for the page to fetch it once (`background.get`), or null. */
  background?: string | null;
  notice: string | null; pythonConfigured?: boolean;
  /** Python in the Windows app: the interpreter runs use (`missing` when its file is gone) and, once searched, the
   * installed ones Workbench found. The page may pick one of those; any other path comes from the native picker. */
  python?: { current: PythonInterpreter | null; found: PythonInterpreter[] | null; searching: boolean };
  /** The workspace agent: available in the Windows app, and whether Git Bash was found there. */
  agent?: { available: boolean; gitBash: boolean; root: string | null };
  /** Set only by the Android host; absent on the Windows desktop. */
  platform?: 'android';
  /** Android only: whether this WebView can host Tinfoil's sign-in page (docs/ANDROID-ACCOUNT.md). */
  chatAvailable?: boolean;
}
/** `images`: the stored pictures (Workspace `images`) that follow a user message's text; the service adds them to the request. */
export interface ApiMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: ToolCall[]; reasoning_content?: string; images?: string[] }
export interface GenerationJob {
  threadId: string; turnId: string; replyId: string;
  lane: 'primary' | 'comparison'; model: string; settings: GenerationSettings; messages: ApiMessage[];
}
export type Command =
  | { type: 'account.login' | 'account.cancel' | 'account.refresh' | 'account.manage' | 'account.signout' }
  | { type: 'account.remember'; enabled: boolean }
  | { type: 'cloud.connect'; key: string } | { type: 'cloud.key.file' | 'cloud.sync' | 'cloud.disconnect' } | { type: 'thread.cloud.upload'; id: string }
  | { type: 'connection.mode'; mode: ConnectionMode }
  | { type: 'thread.authorize-account'; id: string }
  | { type: 'thread.new'; projectId?: string | null; cloud?: boolean }
  | { type: 'project.create'; name: string }
  | { type: 'project.rename'; id: string; name: string }
  | { type: 'project.delete'; id: string }
  | { type: 'thread.move'; id: string; projectId: string | null }
  | { type: 'instructions.save'; id?: string; name: string; text: string }
  | { type: 'instructions.delete'; id: string }
  | { type: 'reply.edit'; id: string; turnId: string; replyId: string; content: string; reasoning: string; expectedContent: string; expectedReasoning: string }
  | { type: 'view.set'; view: ViewPreferences }
  | { type: 'python.pick' }
  /** Looks for installed Python; `python.use` picks one of the interpreters found (by its path). */
  | { type: 'python.find' }
  | { type: 'python.use'; path: string }
  /** The workspace agent's folder: chosen in the host's native picker, or cleared. The page never names a path. */
  | { type: 'agent.folder'; id: string }
  | { type: 'agent.folder.clear'; id: string }
  /** Where new folders for the workspace agent are made: chosen in the host's native picker. */
  | { type: 'agent.root' }
  /** How many of the agent's calls run without asking; the host confirms a higher level. */
  | { type: 'agent.approval'; id: string; level: AgentApproval }
  | { type: 'tool.cancel'; id: string; toolId: string }
  | { type: 'tool.approve'; id: string; toolId: string; approve: boolean }
  | { type: 'code.run'; id: string; replyId: string; index: number }
  | { type: 'artifact.pdf'; id: string; toolId: string; artifactId: string }
  | { type: 'artifact.open'; id: string }
  | { type: 'artifact.save'; id: string; toolId: string; artifactId: string }
  | { type: 'open.url'; url: string }
  | { type: 'thread.select'; id: string }
  | { type: 'thread.rename'; id: string; title: string }
  | { type: 'thread.pin'; id: string }
  | { type: 'thread.delete'; id: string }
  | { type: 'thread.draft'; id: string; text: string; attachments?: Attachment[] }
  | { type: 'thread.settings'; id: string; settings: GenerationSettings }
  | { type: 'thread.fork'; id: string; turnId: string; replyId?: string; before: boolean }
  | { type: 'reply.select'; id: string; turnId: string; replyId: string }
  | { type: 'credentials.set'; key: string }
  | { type: 'credentials.clear' }
  | { type: 'connect' }
  | { type: 'models.catalog' }
  /** `replace`: the turn this message replaces with a new version (an edited message). */
  | { type: 'send'; id: string; text: string; attachments: Attachment[]; replace?: string }
  | { type: 'turn.retry'; id: string; turnId: string }
  | { type: 'turn.version'; id: string; turnId: string; version: number }
  | { type: 'turn.add'; id: string; role: 'assistant' | 'system'; text: string; replace?: string }
  | { type: 'stop'; id: string }
  | { type: 'attachments.pick' }
  /** Stores a picture the page prepared (renderer/attach.ts) under the id it chose, for a draft or message to use. */
  | { type: 'image.add'; id: string; mime: string; data: string }
  /** The chat background picture: pick one with the host's picker (answers with `files`), store the page's prepared
   * copy, remove it, or fetch it (answers with `picture`). */
  | { type: 'background.pick' } | { type: 'background.set'; mime: string; data: string } | { type: 'background.clear' } | { type: 'background.get' }
  | { type: 'export'; id: string; format: 'markdown' | 'json' }
  | { type: 'import' }
  | { type: 'clipboard'; text: string }
  | { type: 'open.docs'; topic?: 'python' }
  | { type: 'window'; action: 'minimize' | 'maximize' | 'close' }
  | { type: 'window.close-response'; requestId: string; allow: boolean }
  | { type: 'window.close-ack'; requestId: string };
export interface DesktopBridge {
  snapshot(): Promise<Snapshot>;
  onCloseRequested?(callback: (requestId: string) => void): () => void;
  command(command: Command): Promise<{ snapshot: Snapshot; attachments?: Attachment[]; files?: PickedFile[]; artifact?: Artifact; picture?: string | null }>;
  /** Windows only: the folder a dropped or pasted file object is, registered with the main process so a message may
   * attach it; null for a file. Only a real dropped or pasted file has a path. */
  folderFor?(file: File): Promise<{ path: string; name: string } | null>;
  subscribe(callback: (snapshot: Snapshot) => void): () => void;
  /** Android only: 'pause' when the app is backgrounded, 'back' for the system Back action.
   * Resolve true when the renderer handled Back itself. */
  onAppEvent?(callback: (event: 'pause' | 'back') => Promise<boolean>): () => void;
}
/** A picture or PDF from the Attach picker, base64, for the page to prepare like a dropped file (renderer/attach.ts). */
export interface PickedFile { name: string; mime: string; data: string }
declare global { interface Window { tinfoil?: DesktopBridge } }
