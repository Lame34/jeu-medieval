/**
 * Min-heap of cell indices keyed by (primary, secondary, index). The full key ordering makes
 * pop order — hence tie-breaking between equal-cost paths — fully deterministic.
 */
export class CellHeap {
  private cells: Int32Array;
  private primary: Float64Array;
  private secondary: Float64Array;
  private count = 0;

  constructor(initialCapacity = 1024) {
    this.cells = new Int32Array(initialCapacity);
    this.primary = new Float64Array(initialCapacity);
    this.secondary = new Float64Array(initialCapacity);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  push(cell: number, primary: number, secondary: number): void {
    if (this.count === this.cells.length) this.grow();
    let i = this.count++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(primary, secondary, cell, parent)) break;
      this.move(parent, i);
      i = parent;
    }
    this.cells[i] = cell;
    this.primary[i] = primary;
    this.secondary[i] = secondary;
  }

  /** Removes and returns the minimum cell, or -1 when empty. */
  pop(): number {
    if (this.count === 0) return -1;
    const top = this.cells[0] as number;
    const last = --this.count;
    if (last > 0) {
      const cell = this.cells[last] as number;
      const p = this.primary[last] as number;
      const s = this.secondary[last] as number;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= last) break;
        const right = left + 1;
        const child = right < last && this.lessAt(right, left) ? right : left;
        if (!this.less(this.primary[child] as number, this.secondary[child] as number, this.cells[child] as number, i, p, s, cell)) break;
        this.move(child, i);
        i = child;
      }
      this.cells[i] = cell;
      this.primary[i] = p;
      this.secondary[i] = s;
    }
    return top;
  }

  /** Primary key of the current minimum (Infinity when empty). */
  peekKey(): number {
    return this.count > 0 ? (this.primary[0] as number) : Number.POSITIVE_INFINITY;
  }

  /** (p, s, cell) < entry at `at` (or explicit other key when provided). */
  private less(p: number, s: number, cell: number, at: number, op?: number, os?: number, ocell?: number): boolean {
    const bp = op ?? (this.primary[at] as number);
    const bs = os ?? (this.secondary[at] as number);
    const bc = ocell ?? (this.cells[at] as number);
    if (p !== bp) return p < bp;
    if (s !== bs) return s < bs;
    return cell < bc;
  }

  private lessAt(a: number, b: number): boolean {
    return this.less(this.primary[a] as number, this.secondary[a] as number, this.cells[a] as number, b);
  }

  private move(from: number, to: number): void {
    this.cells[to] = this.cells[from] as number;
    this.primary[to] = this.primary[from] as number;
    this.secondary[to] = this.secondary[from] as number;
  }

  private grow(): void {
    const capacity = this.cells.length * 2;
    const cells = new Int32Array(capacity);
    const primary = new Float64Array(capacity);
    const secondary = new Float64Array(capacity);
    cells.set(this.cells);
    primary.set(this.primary);
    secondary.set(this.secondary);
    this.cells = cells;
    this.primary = primary;
    this.secondary = secondary;
  }
}
