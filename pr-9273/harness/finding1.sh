#!/usr/bin/env bash
# Finding 1: the png rung writes SVG with a real freeze, because the staged
# output name does not end in .png and freeze picks its format by extension.
set -u
WT=/root/verify/pr9273/head
E=/root/verify/pr9273/e2e
F=/root/verify/pr9273/tools/bin/freeze
D=$E/f1; rm -rf $D; mkdir -p $D
H() { printf '\n\033[1;36m━━ %s\033[0m\n' "$*"; }
C() { printf '\033[2m$ %s\033[0m\n' "$*"; }
restore() { git -C $WT checkout -q -- packages/cli/src/commands/review/capture-tui.ts; (cd $WT && npm run bundle >/dev/null 2>&1); }
trap restore EXIT

H "1. freeze v0.2.2 chooses the output format from the --output extension"
printf 'probe DONE\n' > $D/p.ans
for o in cap.png cap.png.render-1a2b3c cap.png.render-1a2b3c.png; do
  $F --language ansi $D/p.ans --output $D/$o >/dev/null 2>&1
  printf '  --output %-28s → %s\n' "$o" "$(file -b $D/$o | cut -c1-34)"
done

H "2. PR head 5936b9f118: capture-tui stages the render at <out>.png.render-<nonce>"
C "grep -n 'pngStage =' capture-tui.ts"
grep -n 'const pngStage =' $WT/packages/cli/src/commands/review/capture-tui.ts | sed 's/^/  /'
C "PATH=<freeze>:\$PATH qwen review capture-tui --command 'printf \"HELLO DONE\\n\"; sleep 30' --until DONE --cols 40 --rows 6 --out head/cap"
mkdir -p $D/head
PATH=$(dirname $F):$PATH node $WT/dist/cli.js review capture-tui --command 'printf "HELLO DONE\n"; sleep 30' --until DONE --cols 40 --rows 6 --out $D/head/cap 2>/dev/null; echo
printf '  manifest: %s\n' "$(jq -c '{evidence,pngPath}' $D/head/cap.json | sed "s|$D/||g")"
printf '  \033[1;31mfile head/cap.png → %s\033[0m\n' "$(file -b $D/head/cap.png | cut -c1-40)"
printf '  first bytes: %s\n' "$(head -c 38 $D/head/cap.png)"

H "3. The repo's own publish gate (review/lib/assets.ts validateAssetContent) refuses it"
mkdir -p $WT/packages/cli/src/__probe9273__
cat > $WT/packages/cli/src/__probe9273__/sniff.test.ts <<EOF
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { validateAssetContent } from '../commands/review/lib/assets.js';
it('sniff', () => {
  const h = readFileSync('$D/head/cap.png').subarray(0, 16);
  writeFileSync('$D/sniff.out', JSON.stringify(validateAssetContent('cap.png', h)));
});
EOF
(cd $WT/packages/cli && CI=true npx vitest run src/__probe9273__/sniff.test.ts >/dev/null 2>&1)
rm -rf $WT/packages/cli/src/__probe9273__
C "validateAssetContent('cap.png', <first 16 bytes of head/cap.png>)"
printf '  \033[1;31m%s\033[0m\n' "$(cat $D/sniff.out)"

H "4. Positive control: keep .png as the LAST extension of the stage (one line), rebuild"
sed -i 's|const pngStage = `${pngPath}.render-${renderNonce}`;|const pngStage = `${pngPath}.render-${renderNonce}.png`;|' $WT/packages/cli/src/commands/review/capture-tui.ts
git -C $WT diff -U0 | grep '^[-+] ' | sed 's/^/  /'
(cd $WT && npm run bundle >/dev/null 2>&1)
mkdir -p $D/fix
PATH=$(dirname $F):$PATH node $WT/dist/cli.js review capture-tui --command 'printf "HELLO DONE\n"; sleep 30' --until DONE --cols 40 --rows 6 --out $D/fix/cap 2>/dev/null; echo
printf '  \033[1;32mfile fix/cap.png → %s\033[0m\n' "$(file -b $D/fix/cap.png | cut -c1-48)"
restore; trap - EXIT
C "git checkout -- capture-tui.ts && npm run bundle   # back to the PR head"
mkdir -p $D/neg
PATH=$(dirname $F):$PATH node $WT/dist/cli.js review capture-tui --command 'printf "HELLO DONE\n"; sleep 30' --until DONE --cols 40 --rows 6 --out $D/neg/cap >/dev/null 2>&1
printf '  negative control (head again): file neg/cap.png → %s\n' "$(file -b $D/neg/cap.png | cut -c1-30)"
printf '  worktree clean: %s\n' "$([ -z "$(git -C $WT status --porcelain)" ] && echo yes || echo NO)"
