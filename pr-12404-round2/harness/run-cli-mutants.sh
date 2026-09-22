#!/bin/bash
# Session.ts mutants, each in its own hardlinked copy (target file de-linked before editing), run in parallel.
WT=/root/verify/pr12404-r2; M=/root/verify/pr12404-mut; F=packages/cli/src/acp-integration/session/Session.ts
declare -A MUT
MUT[S1]="s/!!item \&\& typeof item === 'object' \&\& !Array.isArray(item),/true,/"
MUT[S2]="s/!!item \&\& typeof item === 'object' \&\& !Array.isArray(item),/!!item \&\& typeof item === 'object',/"
MUT[S3]="515s/value.length > MAX_DAEMON_INPUT_ANNOTATIONS/false/"
MUT[S4]="515s/value.length > MAX_DAEMON_INPUT_ANNOTATIONS/value.length >= MAX_DAEMON_INPUT_ANNOTATIONS/"
MUT[S5]="527s/return annotations.length > 0 ? structuredClone(annotations) : undefined;/return structuredClone(annotations);/"
MUT[S6]="527s/return annotations.length > 0 ? structuredClone(annotations) : undefined;/return annotations.length > 0 ? annotations : undefined;/"
for id in S0 S1 S2 S3 S4 S5 S6; do
  (
    D=$M/$id; rm -rf $D; mkdir -p $D
    cd $WT && find . -mindepth 1 -maxdepth 1 ! -name '.arm-*' -exec cp -al {} $D/ \;
    cp --remove-destination $WT/$F $D/$F
    [ "$id" != S0 ] && sed -i "${MUT[$id]}" $D/$F
    diff <(cat $WT/$F) $D/$F > $M/$id.diff
    cd $D/packages/cli && timeout 1500 npx vitest run src/acp-integration/session/Session.test.ts --coverage.enabled=false > $M/$id.log 2>&1
    echo "EXIT=$?" >> $M/$id.log
  ) &
done
wait
echo ALLDONE > $M/cli-done
