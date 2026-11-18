// Fixture for PR #9801 verification — a multi-line construct a review
// finding would anchor as a range, plus a disjoint region for the control.
export function parseRange(input: string): { start: number; end: number } {
  const parts = input.split('-');
  const start = Number(parts[0]);
  const end = Number(parts[1] ?? parts[0]);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end ||
    start < 1
  ) {
    throw new Error(`bad range: ${input}`);
  }
  return { start, end };
}

export function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export function widen(r: { start: number; end: number }, by: number) {
  return { start: r.start - by, end: r.end + by };
}
