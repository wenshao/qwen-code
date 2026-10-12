#!/bin/bash
# Round 6: PR head 296b1be5 (contains main e17ad4caef). java jar then node dist.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad; R=$S/rig; W=${W:-$HOME/git/qwen-code-pr13654-merge}; TAG=${TAG:-r6head}
cd $W || exit 1; echo "worktree $W at $(git rev-parse --short HEAD) tree $(git rev-parse --short HEAD^{tree})"
case ${1:-all} in java|all)
  $R/build-java-merge.sh $W > $S/r6/logs/build-java-$TAG.log 2>&1 && cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $R/jars/$TAG-server.jar && echo "$TAG jar ok" || echo "$TAG jar FAILED";;
esac
case ${1:-all} in node|all)
  export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$(dirname $(which pnpm)):$PATH
  (pnpm install --frozen-lockfile > $S/r6/logs/build-node-$TAG.log 2>&1 && npm run build >> $S/r6/logs/build-node-$TAG.log 2>&1 && npm run bundle >> $S/r6/logs/build-node-$TAG.log 2>&1 && echo "dist ok $(ls -la dist/cli.js | awk '{print $5}')") || echo "dist FAILED";;
esac
echo "build-merge done $(date +%T)"
