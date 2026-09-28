/** Small, weighted LRU. Costs are caller-supplied UTF-16 character estimates,
 * not a promise about engine heap bytes. Never retains an oversized entry. */
export class RenderCache<V> {
  private entries = new Map<string, { value: V; cost: number }>();
  private total = 0;
  constructor(readonly maxEntries = 128, readonly maxCost = 512_000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(maxCost) || maxCost < 1) throw new RangeError('Invalid render cache limits.');
  }
  get size(): number { return this.entries.size; }
  get cost(): number { return this.total; }
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: V, cost: number): void {
    const previous = this.entries.get(key);
    if (previous) { this.total -= previous.cost; this.entries.delete(key); }
    if (!Number.isFinite(cost) || cost < 0 || cost > this.maxCost) return;
    this.entries.set(key, { value, cost }); this.total += cost;
    while (this.entries.size > this.maxEntries || this.total > this.maxCost) {
      const oldest = this.entries.keys().next().value!;
      this.total -= this.entries.get(oldest)!.cost; this.entries.delete(oldest);
    }
  }
  clear(): void { this.entries.clear(); this.total = 0; }
}
