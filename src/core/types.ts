import type { AccountSnapshot, ConnectionMode } from './account.js';
import type { ModelCapability, ThinkingMode } from './capabilities.js';
import type { ViewPreferences } from './preferences.js';
import type { CloudChatLink, CloudProjectLink } from './cloud.js';
export type ReplyStatus = 'queued' | 'streaming' | 'complete' | 'stopped' | 'error' | 'interrupted' | 'awaiting_approval' | 'executing';
export interface GenerationSettings {
  toolsMode: 'off' | 'ask';
  visualTools: boolean;
  webSearch: boolean;
  delegateMode: 'off' | 'ask';
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
export interface Attachment { name: string; content: string }
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
  id: string; callId: string; name: string; arguments: string;
  origin: 'model' | 'manual' | 'provider'; status: 'queued' | 'awaiting_approval' | 'running' | 'complete' | 'error' | 'denied' | 'cancelled';
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
}
export interface Turn {
  id: string; prompt: string; attachments: Attachment[]; createdAt: number;
  replies: Reply[]; selectedReplyId: string | null;
}
export interface Thread {
  /** Local authorization binding, not model context or a cloud-sync identifier. */
  connectionOwner?: string;
  projectId?: string | null;
  branchOf?: string;
  /** Set for a Tinfoil cloud chat (docs/CLOUD.md). */
  cloud?: CloudChatLink;
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
  notice: string | null; pythonConfigured?: boolean;
  /** Set only by the Android host; absent on the Windows desktop. */
  platform?: 'android';
  /** Android only: whether this WebView can host Tinfoil's sign-in page (docs/ANDROID-ACCOUNT.md). */
  chatAvailable?: boolean;
}
export interface ApiMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: ToolCall[]; reasoning_content?: string }
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
  | { type: 'thread.new'; projectId?: string | null }
  | { type: 'project.create'; name: string }
  | { type: 'project.rename'; id: string; name: string }
  | { type: 'project.delete'; id: string }
  | { type: 'thread.move'; id: string; projectId: string | null }
  | { type: 'instructions.save'; id?: string; name: string; text: string }
  | { type: 'instructions.delete'; id: string }
  | { type: 'prompt.edit'; id: string; turnId: string; content: string; expectedContent: string }
  | { type: 'reply.edit'; id: string; turnId: string; replyId: string; content: string; reasoning: string; expectedContent: string; expectedReasoning: string }
  | { type: 'view.set'; view: ViewPreferences }
  | { type: 'python.pick' }
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
  | { type: 'send'; id: string; text: string; attachments: Attachment[] }
  | { type: 'stop'; id: string }
  | { type: 'attachments.pick' }
  | { type: 'export'; id: string; format: 'markdown' | 'json' }
  | { type: 'import' }
  | { type: 'clipboard'; text: string }
  | { type: 'open.docs' }
  | { type: 'window'; action: 'minimize' | 'maximize' | 'close' }
  | { type: 'window.close-response'; requestId: string; allow: boolean }
  | { type: 'window.close-ack'; requestId: string };
export interface DesktopBridge {
  snapshot(): Promise<Snapshot>;
  onCloseRequested?(callback: (requestId: string) => void): () => void;
  command(command: Command): Promise<{ snapshot: Snapshot; attachments?: Attachment[]; artifact?: Artifact }>;
  subscribe(callback: (snapshot: Snapshot) => void): () => void;
  /** Android only: 'pause' when the app is backgrounded, 'back' for the system Back action.
   * Resolve true when the renderer handled Back itself. */
  onAppEvent?(callback: (event: 'pause' | 'back') => Promise<boolean>): () => void;
}
declare global { interface Window { tinfoil?: DesktopBridge } }
