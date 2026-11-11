// Small in-process TTL cache. It exists to avoid paying (and rate-limiting) the AI provider twice for the same thing.
// Per server instance and not shared between users: every key starts with the user id.
export class TtlCache<V> {
  private m = new Map<string, { v: V; exp: number }>();
  constructor(private ttlMs: number, private max: number, private now: () => number = Date.now) {}
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp < this.now()) { this.m.delete(k); return undefined; }
    this.m.delete(k); this.m.set(k, e); // refresh recency
    return e.v;
  }
  set(k: string, v: V) {
    this.m.delete(k);
    this.m.set(k, { v, exp: this.now() + this.ttlMs });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
  get size() { return this.m.size; }
}
export const norm = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();
