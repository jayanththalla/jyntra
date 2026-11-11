// Keyed concurrency limiter: at most `max` tasks per key (provider, host) at once, plus a global cap.
export class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(public max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiters.shift()?.();
    };
  }
}

export class KeyedLimiter {
  private map = new Map<string, Semaphore>();
  constructor(private defaultMax: number, private overrides: Record<string, number> = {}) {}
  private sem(key: string) {
    let s = this.map.get(key);
    if (!s) this.map.set(key, (s = new Semaphore(this.overrides[key] ?? this.defaultMax)));
    return s;
  }
  async run<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    // Acquire in a stable order so two tasks can never deadlock on each other's keys.
    const sorted = [...new Set(keys)].sort();
    const releases: (() => void)[] = [];
    try {
      for (const k of sorted) releases.push(await this.sem(k).acquire());
      return await fn();
    } finally {
      for (const r of releases.reverse()) r();
    }
  }
}
