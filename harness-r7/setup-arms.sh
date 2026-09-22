#!/bin/bash
# Single-variable A/B. The fix commit 54c6407 differs from parent 0b4349 ONLY in bwrap-relay.ts
# (git diff --stat: only the relay + its test). cli.js loads dist/sandboxBwrapRelay.js as a runtime
# sibling asset, so one full dist + a relay swap = a faithful single-variable A/B.
# NOTE: use real copies (cp -a), never hardlinks (cp -al) + cp -f, or a write-through corrupts $R/dist.
set -e
R=/root/git/pr12267-r7
V=/root/verify/r7
SB=$R/packages/core/src/sandbox
rm -rf $V/dist-A $V/dist-B $V/relayA2 $V/relayB

cat > $R/_ab-bundle.mjs <<'JS'
import esbuild from 'esbuild';
import path from 'node:path';
const jsToTs = { name:'js-to-ts', setup(b){ b.onResolve({filter:/^\.\.?\//},(a)=>{
  if (a.importer.endsWith('.ts') && a.path.endsWith('.js'))
    return { path: path.resolve(a.resolveDir, a.path.replace(/\.js$/,'.ts')) };
  return null; }); } };
const build=(entry,out)=>esbuild.build({entryPoints:{sandboxBwrapRelay:entry},bundle:true,outdir:out,platform:'node',format:'esm',target:'node22',plugins:[jsToTs]});
const sb=process.argv[2];
await build(path.join(sb,'bwrap-relay.ts'), process.argv[3]); // rebuild the REAL relay -> restore $R/dist
await build(path.join(sb,'_ab_parent.ts'), '/root/verify/r7/relayB');
await build(path.join(sb,'_ab_fix.ts'),    '/root/verify/r7/relayA2');
console.log('bundled');
JS
cp $V/relay-parent.ts $SB/_ab_parent.ts
cp $V/relay-fix.ts    $SB/_ab_fix.ts
cd $R
node $R/_ab-bundle.mjs $SB /root/verify/r7/relayReal
rm -f $SB/_ab_parent.ts $SB/_ab_fix.ts $R/_ab-bundle.mjs
# restore the real fixed relay into $R/dist (undo any earlier write-through)
cp -f $V/relayReal/sandboxBwrapRelay.js $R/dist/sandboxBwrapRelay.js

# Real copies (no hardlinks)
cp -a $R/dist $V/dist-A
cp -a $R/dist $V/dist-B
cp --remove-destination $V/relayB/sandboxBwrapRelay.js $V/dist-B/sandboxBwrapRelay.js

echo "=== $R/dist relay identity (should be FIX: shareInput present) ==="
grep -c shareInput $R/dist/sandboxBwrapRelay.js $V/dist-A/sandboxBwrapRelay.js $V/dist-B/sandboxBwrapRelay.js
echo "=== arm A (fix) vs arm B (parent) relay ==="
cmp $V/dist-A/sandboxBwrapRelay.js $V/dist-B/sandboxBwrapRelay.js && echo "SAME (BAD)" || echo "DIFFER (expected: A=fix B=parent)"
echo "=== cli.js identical across arms (single variable) ==="
cmp $V/dist-A/cli.js $V/dist-B/cli.js && echo "cli.js SAME across arms" || echo "cli.js DIFFER (BAD)"
echo "=== faithfulness: relayReal (rebuilt from real bwrap-relay.ts) vs relayA2 (from relay-fix.ts copy) ==="
cmp <(tail -n +2 $V/relayReal/sandboxBwrapRelay.js) <(tail -n +2 $V/relayA2/sandboxBwrapRelay.js) && echo "identical modulo header comment: faithful" || echo "differ beyond header (inspect)"
