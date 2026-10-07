#!/bin/bash
# Plants one consumer (new file, or a line appended to an existing file), runs the
# envelope suite, then restores. Prints the gate test's verdict.
W=/Users/wenshao/git/pr13498-cand
DEEP="@qwen-code/qwen-code-core/managed-runtime/managed-event-envelope.js"
run() { # label path content [append]
  local p="$W/$2"; local existed=0
  if [ -f "$p" ]; then existed=1; cp "$p" "$p.gatebak"; fi
  mkdir -p "$(dirname "$p")"
  if [ "${4:-}" = append ]; then printf '\n%s\n' "$3" >> "$p"; else printf '%s\n' "$3" > "$p"; fi
  r=$(cd $W/packages/core && npx vitest run src/managed-runtime/managed-event-envelope.test.ts --coverage.enabled=false -t "declares the contract without enabling" 2>&1 | grep -E "Tests ")
  if [ $existed = 1 ]; then mv "$p.gatebak" "$p"; else rm -f "$p"; fi
  case "$r" in *failed*) v=caught;; *passed*) v=MISSED;; *) v="?? $r";; esac
  echo -e "$1\t$2\t$v"
}
run "G2 cli/src deep import .ts" packages/cli/src/serve/zz-consumer.ts "import { parseManagedEventEnvelope } from '$DEEP'; void parseManagedEventEnvelope;"
run "G5 channels/base/src .ts" packages/channels/base/src/zz-consumer.ts "import { parseManagedEventEnvelope } from '$DEEP'; void parseManagedEventEnvelope;"
run "G6 basename collision" packages/cli/src/serve/managed-event-envelope.ts "import { parseManagedEventEnvelope } from '$DEEP'; void parseManagedEventEnvelope;"
run "G7 .mjs in cli/src" packages/cli/src/serve/zz-consumer.mjs "import { parseManagedEventEnvelope } from '$DEEP'; void parseManagedEventEnvelope;"
run "G8 .cts in cli/src" packages/cli/src/serve/zz-consumer.cts "import env = require('$DEEP'); void env;"
run "G9 web-shell/client .tsx" packages/web-shell/client/zz-consumer.tsx "import { parseManagedEventEnvelope } from '$DEEP'; void parseManagedEventEnvelope;"
run "G10 root scripts/ .mjs" scripts/zz-consumer.mjs "import { parseManagedEventEnvelope } from '$DEEP'; void parseManagedEventEnvelope;"
run "G15 core/src/index.ts barrel (control)" packages/core/src/index.ts "export * from './managed-runtime/managed-event-envelope.js';" append
run "G11 core package entry index.ts re-export" packages/core/index.ts "export * from './src/managed-runtime/managed-event-envelope.js';" append
run "G12 cli package entry index.ts import" packages/cli/index.ts "import { parseManagedEventEnvelope } from '$DEEP'; void parseManagedEventEnvelope;" append
run "G13 dist/src deep path in cli/src" packages/cli/src/serve/zz-consumer.ts "import { parseManagedEventEnvelope } from '@qwen-code/qwen-code-core/dist/src/managed-runtime/managed-event-envelope.js'; void parseManagedEventEnvelope;"
