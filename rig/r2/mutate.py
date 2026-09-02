"""Applies one named mutation to autofix-status-heartbeat.sh, or exits 2.

A mutation that silently fails to apply turns into a fake 'surviving mutant',
so every anchor is asserted unique and the caller re-checks the file hash.
"""
import hashlib
import sys

path, name = sys.argv[1], sys.argv[2]
src = open(path).read()
before = hashlib.sha256(src.encode()).hexdigest()

GUARD = (
    '    if ! gh_config_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/autofix-gh-config.XXXXXX")"; then\n'
    '      echo "$(date -u +%FT%TZ) gh config mint failed; skipping this tick"\n'
    '      continue\n'
    '    fi'
)
SKIP_ECHO = (
    '      echo "$(date -u +%FT%TZ) gh config mint failed; skipping this tick"\n'
    '      continue'
)

if name == 'failopen':
    # Logs the skip, but the tick no longer skips: gh runs with an empty
    # GH_CONFIG_DIR, i.e. against the shared ~/.config/gh, holding the PAT.
    old, new = SKIP_ECHO, SKIP_ECHO.replace('      continue', '      :')
elif name == 'bareassign':
    # The mutant the test's own comment names: a bare assignment that carries
    # on with the empty value — no skip log, no `continue`.
    old = GUARD
    new = ('    gh_config_dir="$(mktemp -d '
           '"${RUNNER_TEMP:-/tmp}/autofix-gh-config.XXXXXX" 2>/dev/null)"')
elif name == 'dieonskip':
    # Pulse death: the skip ends the loop instead of degrading one tick.
    old, new = SKIP_ECHO, SKIP_ECHO.replace('      continue', '      exit 0')
elif name == 'mintok':
    # The mint no longer honours RUNNER_TEMP: it succeeds under /tmp, so the
    # test's planted missing RUNNER_TEMP never produces a skip line and the
    # tick runs gh (the "nothing skipped" gate-timeout shape).
    old = '"${RUNNER_TEMP:-/tmp}/autofix-gh-config.XXXXXX"'
    new = '"/tmp/autofix-gh-config.XXXXXX"'
else:
    sys.exit(f'unknown mutation {name}')

if src.count(old) != 1:
    sys.exit(f'anchor for {name} matched {src.count(old)} times, expected 1')
out = src.replace(old, new)
after = hashlib.sha256(out.encode()).hexdigest()
if after == before:
    sys.exit(f'mutation {name} was a no-op')
open(path, 'w').write(out)
print(f'mutation={name} sha {before[:12]} -> {after[:12]}')
