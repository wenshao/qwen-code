"""Derives the test-side variants of after.test.mjs used by the rig.

gate1     : the second-occurrence gate weakened to the first occurrence
baremsg   : the gate failure message reduced to the pre-round-3 bare sentence
noqq      : `?? []` dropped from the post-timeout skip count (R13 probe)
noqqpred  : `?? []` dropped from the polling predicate
absentlog : the witness test plants NO heartbeat.log (D14-1 shape)
emptylog  : the witness test plants an EMPTY heartbeat.log (D14-1 shape)
Every anchor must match exactly once and the output hash must differ.
"""
import hashlib, sys
src_path, out_dir = sys.argv[1], sys.argv[2]
src = open(src_path).read()

PRED = """        (readLog().match(/gh config mint failed; skipping this tick/g) ?? [])
          .length >= 2,"""
MSG = """      `expected >= 2 'gh config mint failed; skipping this tick' log lines within ${timeoutMs}ms, saw ${skips}; last log line: ${JSON.stringify(lastLine)}`,"""
COUNT = """    const skips = (
      logText.match(/gh config mint failed; skipping this tick/g) ?? []
    ).length;"""
PLANT = """    writeFileSync(
      join(workdir, 'heartbeat.log'),
      '2026-09-02T00:00:00Z heartbeat started: comment 777 interval 1s max_age 20400s\\n' +
        '2026-09-02T00:00:01Z gh config mint failed; skipping this tick\\n',
    );"""

variants = {
  'gate1': (PRED, PRED.replace('.length >= 2', '.length >= 1')),
  'baremsg': (MSG, "      'a failed mint must log a skipped tick',"),
  'noqq': (COUNT, COUNT.replace(' ?? []', '')),
  'noqqpred': (PRED, PRED.replace(' ?? [])', ')')),
  'absentlog': (PLANT, '    // (variant) no heartbeat.log planted'),
  'emptylog': (PLANT, "    writeFileSync(join(workdir, 'heartbeat.log'), '');"),
}
for name, (old, new) in variants.items():
    n = src.count(old)
    if n != 1:
        sys.exit(f'{name}: anchor matched {n} times, expected 1')
    out = src.replace(old, new)
    h0, h1 = hashlib.sha256(src.encode()).hexdigest()[:12], hashlib.sha256(out.encode()).hexdigest()[:12]
    if h0 == h1:
        sys.exit(f'{name}: no-op')
    open(f'{out_dir}/{name}.test.mjs', 'w').write(out)
    print(f'variant={name} sha {h0} -> {h1}')
