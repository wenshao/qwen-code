// Old boolean predicate (base dist) vs new classifier (head dist) over a grid.
const R = '/root/verify/pr14858';
const oldM = await import(`${R}/wt-base/packages/core/dist/src/services/loopDetectionService.js`);
const newM = await import(`${R}/wt-head/packages/core/dist/src/services/loopDetectionService.js`);
const caps = [1, 2, 3, 5, 50, 99, 100, 101, 150, 200, 999, 1000, 1001, 5000, Infinity];
let n = 0, mismatch = 0, reasons = {}, badReason = [];
for (const cap of caps)
  for (const explicit of [true, false])
    for (let total = 0; total <= 12000; total += total < 2200 ? 1 : 97)
      for (let rep = 0; rep <= 12; rep++) {
        n++;
        const o = oldM.shouldHaltOnTurnToolCallCap(total, rep, cap, explicit);
        const h = newM.getTurnToolCallCapHalt(total, rep, cap, explicit);
        if (o !== (h !== null)) { mismatch++; if (mismatch < 5) console.log('MISMATCH', { total, rep, cap, explicit, o, h }); }
        if (h) {
          reasons[h.reason] = (reasons[h.reason] || 0) + 1;
          // expected precedence: explicit > backstop > stuck, with the matching limit
          const exp = explicit ? ['explicit_cap', cap] : total > cap * 10 ? ['backstop', cap * 10] : ['stuck_repetition', cap];
          if (h.reason !== exp[0] || h.limit !== exp[1]) badReason.push({ total, rep, cap, explicit, h });
        }
      }
console.log(JSON.stringify({ inputs: n, haltMismatches: mismatch, reasons, reasonOrLimitErrors: badReason.length }));
console.log('GLOBAL_DUPLICATE_THRESHOLD', newM.GLOBAL_DUPLICATE_THRESHOLD, 'DEFAULT_MAX', newM.DEFAULT_MAX_TOOL_CALLS_PER_TURN);
