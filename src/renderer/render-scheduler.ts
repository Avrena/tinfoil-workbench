export interface FrameHost {
  now(): number; hidden(): boolean;
  frame(callback: () => void): number; cancelFrame(id: number): void;
  later(callback: () => void, delay: number): number; cancelLater(id: number): void;
}
/** Event-driven, latest-state scheduling; never a permanent animation loop.
 * Urgent terminal/approval/reader actions bypass the streaming throttle. */
export class RenderScheduler {
  private frame: number | null = null;
  private timer: number | null = null;
  private last = -Infinity;
  private dirty = false;
  constructor(private paint: () => void, private host: FrameHost = {
    now: () => performance.now(), hidden: () => document.hidden,
    frame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id),
    later: (callback, delay) => window.setTimeout(callback, delay), cancelLater: id => window.clearTimeout(id),
  }) {}
  request(interval = 32, urgent = false): void {
    this.dirty = true;
    if (this.host.hidden()) { this.cancel(); return; }
    if (urgent && this.timer !== null) { this.host.cancelLater(this.timer); this.timer = null; }
    if (this.frame !== null || this.timer !== null) return;
    const delay = urgent ? 0 : Math.max(0, interval - (this.host.now() - this.last));
    if (delay > 0) this.timer = this.host.later(() => { this.timer = null; this.queueFrame(); }, delay);
    else this.queueFrame();
  }
  private queueFrame(): void {
    if (this.host.hidden()) return;
    this.frame = this.host.frame(() => {
      this.frame = null;
      if (this.host.hidden() || !this.dirty) return;
      this.dirty = false; this.last = this.host.now(); this.paint();
    });
  }
  cancel(): void {
    if (this.frame !== null) this.host.cancelFrame(this.frame);
    if (this.timer !== null) this.host.cancelLater(this.timer);
    this.frame = this.timer = null;
  }
  destroy(): void { this.dirty = false; this.cancel(); }
}
export const streamingInterval = (characters: number): number => characters > 32_000 ? 64 : 32;
