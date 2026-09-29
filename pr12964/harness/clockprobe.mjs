// Sample wall clock (Date.now) against monotonic time for N seconds; report backward steps of the wall clock.
const secs = Number(process.argv[2] || 60);
const t0m = performance.now(), t0w = Date.now();
let prevW = t0w, back = [], minOff = 0, maxOff = 0;
const end = t0m + secs * 1000;
while (performance.now() < end) {
  const w = Date.now(), m = performance.now();
  const off = (w - t0w) - (m - t0m);
  minOff = Math.min(minOff, off); maxOff = Math.max(maxOff, off);
  if (w < prevW) back.push(prevW - w);
  prevW = w;
  await new Promise(r => setTimeout(r, 5));
}
console.log(JSON.stringify({ secs, backwardSteps: back.length, largestBackMs: back.length ? Math.max(...back) : 0,
  wallMinusMonotonicMs: { min: Math.round(minOff), max: Math.round(maxOff) } }));
