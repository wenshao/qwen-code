set -uo pipefail
RUNNER_UID="$(id -u)"
RUNNER_GID="$(id -g)"
if [ "$RUNNER_UID" != "0" ]; then
  chown -R "$RUNNER_UID:$RUNNER_GID" "$GITHUB_WORKSPACE" 2>/dev/null || sudo -n chown -R "$RUNNER_UID:$RUNNER_GID" "$GITHUB_WORKSPACE" || echo "::warning::could not restore workspace ownership; checkout may fail on leftover root-owned files"
fi
chmod -R u+rwX "$GITHUB_WORKSPACE" 2>/dev/null || sudo -n chmod -R u+rwX "$GITHUB_WORKSPACE" || echo "::warning::could not restore workspace write permissions; checkout may fail on leftover read-only files"
# A leftover workspace owned by a different uid than the step user
# (e.g. a runner-user checkout under root-run steps) makes every git
# call fail with "detected dubious ownership". The pinned
# actions/checkout adds safe.directory only to its own temporary
# global config, so later steps are uncovered; trust the workspace
# here instead. The --get-all guard keeps a persistent runner's
# gitconfig from accumulating a duplicate entry per job.
git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$GITHUB_WORKSPACE" || git config --global --add safe.directory "$GITHUB_WORKSPACE" || echo "::warning::could not mark the workspace as a git safe.directory; git steps may fail on a mismatched-ownership checkout"
