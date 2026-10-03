#!/bin/bash
# Interleaved per-test durations for perf-sensitive suites: base / pr / cand.
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9916edfc-4afb-4950-bb15-6c228bcecde1/scratchpad
FILES="src/managed-runtime/managed-session-authority.hook-scale.test.ts src/config/managed-session-log.test.ts src/managed-runtime/managed-session-record-sink.test.ts"
for rep in 1 2 3; do
  for arm in base pr cand; do
    case $arm in base) W=$SP/wt-base;; pr) W=$SP/wt-pr;; cand) W=$SP/wt-mut;; esac
    J=$SP/mut/perf-$arm-$rep.json
    load=$(sysctl -n vm.loadavg | awk '{print $2}')
    (cd $W/packages/core && npx vitest run $FILES --reporter=json --outputFile=$J --coverage.enabled=false --testTimeout=120000 >/dev/null 2>&1)
    node -e '
      const r=require(process.argv[1]); const [arm,rep,load]=process.argv.slice(2);
      for (const f of r.testResults) for (const a of f.assertionResults)
        if (/without validating the history|consumed once keys|keeps its title|carries branch points/.test(a.title))
          console.log(`PERF\t${arm}\trep${rep}\tload=${load}\t${a.status}\t${Math.round(a.duration)}ms\t${a.title.slice(0,70)}`);
      console.log(`PERFSUM\t${arm}\trep${rep}\ttotal=${r.numTotalTests}\tpassed=${r.numPassedTests}\tfailed=${r.numFailedTests}`);
    ' $J $arm $rep $load
  done
done
