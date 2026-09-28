import { randomUUID } from 'node:crypto';

/** One native close request at a time. Renderer failure never silently discards edits.
 * Injected callbacks make lifecycle tests independent of Electron and Windows. */
export class CloseCoordinator {
  constructor({ notify, close, confirmForce, timeoutMs = 8000 }) {
    this.notify = notify; this.close = close; this.confirmForce = confirmForce;
    this.timeoutMs = timeoutMs; this.pending = null; this.timer = null; this.approved = false;
  }
  request() {
    if (this.approved) return;
    if (this.pending) return;
    const id = randomUUID(); this.pending = id;
    this.timer = setTimeout(() => void this.fallback(id), this.timeoutMs);
    try { this.notify(id); } catch { void this.fallback(id); }
  }
  reply(id, allow) {
    if (typeof allow !== 'boolean' || id !== this.pending || !this.pending) return false;
    clearTimeout(this.timer); this.timer = null; this.pending = null;
    if (allow) { this.approved = true; this.close(); }
    return true;
  }
  // Renderer explicitly acknowledges receipt before it displays a human decision.
  // Once acknowledged, don't start a second native dialog while the user reads.
  acknowledge(id) {
    if (id !== this.pending || !this.pending) return false;
    clearTimeout(this.timer); this.timer = null; return true;
  }
  async fallback(id) {
    if (id !== this.pending) return;
    clearTimeout(this.timer); this.timer = null;
    // Avoid a concurrent timer + synchronous notification-failure prompt.
    if (this.fallingBack === id) return;
    this.fallingBack = id;
    try { this.reply(id, (await this.confirmForce()) === true); }
    catch { this.reply(id, false); }
    finally { if (this.fallingBack === id) this.fallingBack = null; }
  }
  dispose() { clearTimeout(this.timer); this.timer = null; this.pending = null; }
}

/** Normal close is finally gated by a main-process durable write, even when a
 * failure snapshot made the renderer's in-memory draft appear up to date.
 * Explicit force-close through the native fallback is a separate user choice. */
export async function persistCloseDecision(coordinator, id, allow, save) {
  if (!coordinator || typeof allow !== 'boolean' || id !== coordinator.pending || !id) return false;
  if (!allow) return coordinator.reply(id, false);
  try { await save(); }
  catch (error) { coordinator.reply(id, false); throw error; }
  return coordinator.reply(id, true);
}
