export class Lru<K, V> {
  private map = new Map<K, V>();
  private max: number;
  constructor(max: number) {
    this.max = max;
  }
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: K, value: V) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }
  delete(key: K) {
    this.map.delete(key);
  }
}
