#!/bin/bash
cd /Users/wenshao/pr12865-rig
ln -sfn src-r4 src
./r3-chain.sh r4
echo "== mutant MC1 $(date +%T)"
MID=$(cat machine-id.txt)
docker run --rm --init -e TESTS=ManagedContextRecoveryTest -e MUTANTS=/rig/mut/mutants-r4.tsv -e OUTFILE=/rig/out/r4-mut.tsv -v /Users/wenshao/pr12865-rig:/rig -v /Users/wenshao/pr12865-rig/m2:/root/.m2/repository pr12865-linux /rig/mut/run-mut2.sh $MID 2>&1 | cut -f1-3,5
echo "== all done $(date +%T)"
