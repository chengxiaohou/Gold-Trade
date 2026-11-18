/**
 * 步长对齐：调节时只落在整步长值上。
 * 例如当前 4386.03、步长 50：上调一档 → 4400，下调一档 → 4350。
 */
export function snapToStep(current: number, direction: 1 | -1, steps: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(current)) return Math.max(0, current);
  const q = current / step;
  const near = Math.round(q * 1e6) / 1e6;
  const exact = Math.abs(near - Math.round(near)) < 1e-6;
  const from = exact ? Math.round(near) : (direction > 0 ? Math.floor(near) : Math.ceil(near));
  return Math.max(0, (from + direction * steps) * step);
}
