/** Paces a streaming answer. Models send text in bursts, a few characters or a few hundred at a time with pauses between,
 * so drawing each burst as it arrives makes the answer jump. A word or two is shown at once, as it arrives; a longer
 * burst is shown in steps over about a third of a second (faster once the reply is complete), each step ending on a
 * word boundary, so the answer flows instead of jumping and never lags far behind. Small arrivals cost no extra
 * renders. A reply seen for the first time is shown whole, so opening a conversation never replays it. */
const DRAIN_MS = 320, DRAIN_DONE_MS = 140, AT_ONCE = 24, MIN_STEP = 8, WORD_REACH = 24;

export class Reveal {
  private state = new Map<string, { shown: number; at: number; idle: boolean }>();
  /** How much of `text` to show now, and whether more is waiting (the caller then asks for another frame). */
  length(id: string, text: string, live: boolean, now: number, instant = false): { length: number; pending: boolean } {
    const s = this.state.get(id);
    if (instant || !s) {
      if (live && !instant) this.state.set(id, { shown: text.length, at: now, idle: true }); else this.state.delete(id);
      return { length: text.length, pending: false };
    }
    if (text.length < s.shown) s.shown = text.length;
    // A burst after a pause starts with one frame's step, not with the time that passed while nothing was waiting.
    const backlog = text.length - s.shown, elapsed = s.idle ? 33 : Math.min(100, Math.max(16, now - s.at));
    s.at = now;
    if (backlog <= AT_ONCE) { s.shown = text.length; s.idle = true; if (!live) this.state.delete(id); return { length: text.length, pending: false }; }
    let next = s.shown + Math.max(MIN_STEP, Math.round(backlog * elapsed / (live ? DRAIN_MS : DRAIN_DONE_MS)));
    // End on a word boundary when one is near, so words appear whole.
    if (next < text.length) {
      const rest = text.slice(next, next + WORD_REACH).search(/\s/);
      if (rest >= 0) next += rest;
    }
    s.shown = Math.min(text.length, next); s.idle = s.shown >= text.length;
    return { length: s.shown, pending: !s.idle };
  }
}
