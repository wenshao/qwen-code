set -uo pipefail
# Release jobs do not need cross-job workspace reuse: remove every
# persisted entry, including planted .git config/hooks/attributes,
# before actions/checkout runs with release credentials. The full
# wipe — rather than keeping and scrubbing .git like serve-ab.yml —
# is deliberate: these checkouts run with CI_BOT_PAT and the npm
# OIDC id-token, so no pre-existing repo state may survive into
# them; the accepted cost is re-fetching full history each run.
#
# Guards ported from serve-ab.yml's wipe (#9220, #9265): under a
# mangled env even `/home` or an empty string reached the rm. A
# wipe pointed at the wrong path is far worse than a skipped wipe,
# so canonicalize, strip trailing slashes, denylist the known
# roots, and require the target to sit inside the runner workspace
# before any rm.
#
# Validate the geometry BEFORE touching anything: the chown/chmod
# ladder and the wipe must never follow a runner workspace a previous
# pool job — which may have run contributor code — replaced with a
# symlink, so refuse one outright; and no ownership/permission change
# may run on a path the containment below has not accepted.
RWS="${RUNNER_WORKSPACE:?}"
while [ "${RWS%/}" != "$RWS" ]; do RWS="${RWS%/}"; done
if [ -L "$RWS" ]; then
  echo "::error::refusing to wipe: runner workspace is a symlink: ${RWS}"
  exit 1
fi
# `-L` only sees the LEAF: the kernel resolves intermediate
# components too, so compare the symlink-blind lexical form
# against the full canonicalization — any difference means some
# component was a symlink re-rooting the whole chain below
# (heal, allow-list, wipe) at the link's target.
RWS_LEX="$(realpath -m -s -- "$RWS" 2>/dev/null)" || { echo "::error::refusing to wipe: realpath unavailable, cannot canonicalize ${RUNNER_WORKSPACE}"; exit 1; }
RWS="$(realpath -m -- "$RWS" 2>/dev/null)" || { echo "::error::refusing to wipe: realpath unavailable, cannot canonicalize ${RUNNER_WORKSPACE}"; exit 1; }
if [ "$RWS" != "$RWS_LEX" ]; then
  echo "::error::refusing to wipe: runner workspace resolves through a symlinked component: ${RWS_LEX} resolves to ${RWS}"
  exit 1
fi
while [ "${RWS%/}" != "$RWS" ]; do RWS="${RWS%/}"; done
if [ -z "$RWS" ]; then echo "::error::refusing to wipe: runner workspace resolved to /"; exit 1; fi
case "$RWS" in
  ..|../*|*/..|*/../*) echo "::error::refusing runner workspace path containing '..': ${RWS}"; exit 1 ;;
esac
WS="${GITHUB_WORKSPACE:?}"
while [ "${WS%/}" != "$WS" ]; do WS="${WS%/}"; done
# Heal a workspace a previous job replaced with a symlink (or any
# non-directory) BEFORE canonicalizing it: afterwards the path
# resolves to the link's target, the containment below refuses it,
# and every later job on this runner would die here permanently on
# corruption that is itself inside the runner workspace and safe
# to unlink.
if [ -L "$WS" ] || [ ! -d "$WS" ]; then
  # Judge the PARENT, canonicalized: the kernel resolves
  # intermediate components too, so a raw containment match is not
  # enough. Never resolve $WS itself — that would resolve through
  # the very link being removed.
  HEAL_PARENT="$(realpath -m -- "$(dirname -- "$WS")" 2>/dev/null)" || { echo "::error::refusing to heal: realpath unavailable, cannot canonicalize the parent of ${WS}"; exit 1; }
  case "$HEAL_PARENT" in
    "$RWS"|"$RWS"/*) ;;
    *) echo "::error::refusing to heal workspace outside the runner workspace: ${WS} (parent: ${HEAL_PARENT}, runner workspace: ${RWS})"; exit 1 ;;
  esac
  if [ -L "$WS" ]; then
    # The link target is bytes a PREVIOUS job chose — on this pool
    # that job may have run contributor code — and the runner
    # parses `::` at the start of any stdout line as a workflow
    # command: keep untrusted bytes off the command line itself,
    # strip the line breaks that could start a new one, and cap
    # the length.
    heal_target="$(readlink -- "$WS" 2>/dev/null || printf '%s' '<unreadable>')"
    heal_target="$(printf '%s' "$heal_target" | tr -d '\r\n' | cut -c1-200)"
    echo "::warning::healing workspace ${WS}: it was a symlink"
    printf 'heal: %s pointed at %s\n' "$WS" "$heal_target"
  else
    echo "::warning::healing workspace ${WS}: it was not a directory"
  fi
  # `rm -f` on the RAW path removes the link itself and never
  # follows it. Both legs fail closed: a swallowed failure here
  # would leave the wipe running against a corrupt path.
  rm -f -- "$WS" || { echo "::error::refusing to continue: could not remove ${WS}"; exit 1; }
  mkdir -- "$WS" || { echo "::error::refusing to continue: could not recreate ${WS}"; exit 1; }
fi
# Heal only guarantees the LEAF is real; a symlinked component
# between the runner workspace and the leaf re-roots the
# containment below the same way, so apply the same comparison.
WS_LEX="$(realpath -m -s -- "$WS" 2>/dev/null)" || { echo "::error::refusing to wipe: realpath unavailable, cannot canonicalize ${GITHUB_WORKSPACE}"; exit 1; }
WS="$(realpath -m -- "$WS" 2>/dev/null)" || { echo "::error::refusing to wipe: realpath unavailable, cannot canonicalize ${GITHUB_WORKSPACE}"; exit 1; }
if [ "$WS" != "$WS_LEX" ]; then
  echo "::error::refusing to wipe: workspace resolves through a symlinked component: ${WS_LEX} resolves to ${WS}"
  exit 1
fi
while [ "${WS%/}" != "$WS" ]; do WS="${WS%/}"; done
case "$WS" in
  ..|../*|*/..|*/../*) echo "::error::refusing to wipe path containing '..': ${WS}"; exit 1 ;;
esac
case "$WS" in
  /|/home|/root|/usr*|/etc*|/var|"") echo "::error::refusing to wipe suspicious workspace path: ${WS}"; exit 1 ;;
esac
# A denylist can only enumerate known roots — the allowlist closes
# every other one (/tmp, /opt, ...): only a directory inside the
# runner workspace may be wiped.
case "$WS" in
  "$RWS"/*) ;;
  *) echo "::error::refusing to wipe workspace outside the runner workspace: ${WS} (runner workspace: ${RWS})"; exit 1 ;;
esac
# Geometry validated — only now may ownership/permissions change.
# Shared ECS runners can retain root-owned files from an earlier
# containerized job; restore them so the wipe and checkout succeed.
RUNNER_UID="$(id -u)"
RUNNER_GID="$(id -g)"
if [ "$RUNNER_UID" != "0" ]; then
  chown -R "$RUNNER_UID:$RUNNER_GID" "$GITHUB_WORKSPACE" 2>/dev/null || sudo -n chown -R "$RUNNER_UID:$RUNNER_GID" "$GITHUB_WORKSPACE" || echo "::warning::could not restore workspace ownership; checkout may fail on leftover root-owned files"
fi
# The validation above guarantees $GITHUB_WORKSPACE is a real directory
# inside the runner workspace (a symlinked leaf was healed, a symlinked
# runner workspace refused), so the recursive chmod cannot escape it.
chmod -R u+rwX "$GITHUB_WORKSPACE" 2>/dev/null || sudo -n chmod -R u+rwX "$GITHUB_WORKSPACE" || echo "::warning::could not restore workspace write permissions; checkout may fail on leftover read-only files"
find "$WS" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
# Later steps must not read pool-persistent Git, npm, Docker, or
# gh state. A fresh directory avoids an unbounded scrub denylist
# and stale lock files before checkout runs.
#
# The pool-wide RUNNER_TOOL_CACHE stays untouched ON PURPOSE:
# lanes in three other pool workflows (qwen-autofix.yml's
# issue-autofix/build-cli/review-address, serve-ab.yml's ab,
# repo-hygiene.yml's dedup lane) resolve Node from it through
# un-gated setup-node, while the pool-routed release jobs never
# read the tool cache — their pool path is PATH Node via
# .github/actions/self-hosted-node. Purging `_tool/node` here
# would strip Node out from under the next such job on this
# member, and nodejs.org may be unreachable through the pool's
# egress proxy.
release_state="$(mktemp -d "${RUNNER_TEMP:?}/release-state.XXXXXX")" || exit 1
: > "${release_state}/gitconfig" || exit 1
: > "${release_state}/npmrc" || exit 1
mkdir "${release_state}/docker" || exit 1
# gh reads $HOME/.config/gh across pool jobs: a prior job could
# plant a config.yml with http_unix_socket there and capture the
# token a later `gh` call sends — qwen-autofix.yml isolates
# GH_CONFIG_DIR the same way.
mkdir "${release_state}/gh" || exit 1
{
  echo 'GIT_CONFIG_COUNT=0'
  echo 'GIT_CONFIG_NOSYSTEM=1'
  echo 'GIT_CONFIG_PARAMETERS='
  echo "GIT_CONFIG_GLOBAL=${release_state}/gitconfig"
  echo "NPM_CONFIG_USERCONFIG=${release_state}/npmrc"
  echo "DOCKER_CONFIG=${release_state}/docker"
  echo "GH_CONFIG_DIR=${release_state}/gh"
} >> "${GITHUB_ENV:?}"
