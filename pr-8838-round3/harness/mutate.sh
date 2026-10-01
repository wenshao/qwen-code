#!/usr/bin/env bash
# E1 mutant+original test, E2 mutant+fixed test, E3 clean+fixed test, E4 main Session.ts+fixed test
set -u
R=/root/verify/pr8838/r3
D=/root/verify/pr8838/head/packages/cli/src/acp-integration/session
WT=/root/verify/pr8838/head
restore() { cp $R/Session.clean.ts $D/Session.ts; cp $R/Session.test.clean.ts $D/Session.test.ts; }
trap restore EXIT
run() { # name src test
  cp "$2" $D/Session.ts; cp "$3" $D/Session.test.ts
  (cd $WT/packages/cli && timeout 900 npx vitest run src/acp-integration/session/Session.test.ts --coverage.enabled=false --reporter=json --outputFile=$R/mut-$1.json > $R/mut-$1.log 2>&1)
  python3 -c "
import json;d=json.load(open('$R/mut-$1.json'))
f=[a['fullName'] for t in d['testResults'] for a in t['assertionResults'] if a['status']=='failed']
print('$1', 'passed',d['numPassedTests'],'failed',d['numFailedTests']); [print('   FAIL',x[:150]) for x in f]"
}
git -C $WT show origin/main:packages/cli/src/acp-integration/session/Session.ts > $R/Session.main.ts
run E1-mutant-original-test $R/Session.mutant-m1.ts $R/Session.test.clean.ts
run E2-mutant-fixed-test    $R/Session.mutant-m1.ts $R/Session.test.fixed2.ts
run E3-clean-fixed-test     $R/Session.clean.ts     $R/Session.test.fixed2.ts
run E4-main-fixed-test      $R/Session.main.ts      $R/Session.test.fixed2.ts
restore
git -C $WT status --short
