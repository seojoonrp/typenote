// Least-recently-used map with a cost budget. Pinned keys are never evicted.

export class LruCache<K, V> {
  private map = new Map<K, { value: V; cost: number }>();
  private total = 0;

  constructor(
    private budget: number,
    private onEvict: (key: K, value: V) => void = () => {},
  ) {}

  get size() {
    return this.map.size;
  }

  get cost() {
    return this.total;
  }

  /** Returns the value and marks it most recently used. */
  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  peek(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  keys(): K[] {
    return [...this.map.keys()];
  }

  set(key: K, value: V, cost: number, pinned: (key: K) => boolean = () => false) {
    const old = this.map.get(key);
    if (old) {
      this.map.delete(key);
      this.total -= old.cost;
      if (old.value !== value) this.onEvict(key, old.value);
    }
    this.map.set(key, { value, cost });
    this.total += cost;
    this.trim(pinned);
  }

  delete(key: K) {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    this.total -= e.cost;
    this.onEvict(key, e.value);
  }

  /** Evicts least recently used, unpinned entries until within budget. */
  trim(pinned: (key: K) => boolean = () => false) {
    for (const [key, e] of this.map) {
      if (this.total <= this.budget) break;
      if (pinned(key)) continue;
      this.map.delete(key);
      this.total -= e.cost;
      this.onEvict(key, e.value);
    }
  }

  clear() {
    for (const [key, e] of this.map) this.onEvict(key, e.value);
    this.map.clear();
    this.total = 0;
  }
}
