#!/bin/sh
# Rig fixture: a small, realistic build log on stdout, diagnostics on stderr, exit 1.
echo "> release build (profile=release, target=aarch64-apple-darwin)"
i=1
while [ $i -le 240 ]; do printf '   Compiling module-%03d v0.%d.%d\n' "$i" $((i % 7)) $((i % 13)); i=$((i+1)); done
echo "warning: unused variable: \`retry_budget\` (src/net/pool.rs:88)" >&2
echo "    Linking release/app"
echo "error[E0425]: cannot find value \`rig_link_target\` in this scope (src/main.rs:42)" >&2
echo "error: could not compile \`app\` due to 1 previous error; 1 warning emitted" >&2
echo "   Finished with errors in 4.21s"
exit 1
