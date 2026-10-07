#!/bin/bash
# Plants one consumer file, runs the envelope suite, removes the file.
W=/Users/wenshao/git/pr13498-cand
run() { # label path content
  mkdir -p "$(dirname "$W/$2")"; printf '%s\n' "$3" > "$W/$2"
  r=$(cd $W/packages/core && npx vitest run src/managed-runtime/managed-event-envelope.test.ts --coverage.enabled=false 2>&1 | grep -E "Tests ")
  rm -f "$W/$2"
  echo -e "$1\t$2\t$r"
}
IMP="import { parseManagedEventEnvelope } from '@qwen-code/qwen-code-core/managed-runtime/managed-event-envelope.js';\nexport const probe = parseManagedEventEnvelope;"
run "G2 cli/src/serve deep import (.ts)" packages/cli/src/serve/zz-envelope-consumer.ts "$(printf "$IMP")"
run "G5 channels/base/src (.ts)" packages/channels/base/src/zz-envelope-consumer.ts "$(printf "$IMP")"
run "G6 cli/src basename collision" packages/cli/src/serve/managed-event-envelope.ts "$(printf "$IMP")"
run "G7 cli/src .mjs consumer" packages/cli/src/serve/zz-envelope-consumer.mjs "$(printf "$IMP")"
run "G8 cli/src .cts consumer" packages/cli/src/serve/zz-envelope-consumer.cts "$(printf "$IMP")"
