#!/usr/bin/env python3
"""Generate the fork-probe workflows from the PR's codeql.yml TEXT, so the
report_failure job is byte-for-byte the PR's except two declared substitutions
in its `if:` (repository and trigger), plus probe-only steps clearly marked."""
import os

SRC = '/root/git/qwen-code-pr13270/.github/workflows/codeql.yml'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'repo/.github/workflows')
BRANCH = 'probe/pr13270-codeql'
text = open(SRC).read()

report = text[text.index('  report_failure:\n'):]
verbatim_if = "if: \"${{ always() && github.repository == 'QwenLM/qwen-code' && github.event_name == 'schedule' && needs.codeql.result != 'success' }}\""
assert report.count(verbatim_if) == 1
probe_if = verbatim_if.replace("'QwenLM/qwen-code'", "'wenshao/qwen-code'").replace("== 'schedule'", "== 'push'")

# Probe-only steps, inserted right before the PR's reporter step.
reporter_step = "      - name: 'File or update the CodeQL failure issue'\n"
assert report.count(reporter_step) == 1
probe_steps = """      # --- probe only: record what GitHub handed this job -------------------
      - name: 'PROBE: needs as seen by this job'
        run: |-
          echo 'needs.codeql.result=${{ needs.codeql.result }}'
          echo '${{ toJSON(needs) }}'
      # --- probe only: keep issue WRITES off the fork; reads stay real -------
      - name: 'PROBE: intercept gh issue create/comment'
        run: |-
          real="$(command -v gh)"
          mkdir -p "${RUNNER_TEMP}/ghshim"
          cat > "${RUNNER_TEMP}/ghshim/gh" <<EOF
          #!/usr/bin/env bash
          if [ "\\$1" = issue ] && { [ "\\$2" = create ] || [ "\\$2" = comment ]; }; then
            echo "INTERCEPTED gh \\$*" >> "${RUNNER_TEMP}/intercepted.log"
            prev=''
            for a in "\\$@"; do
              if [ "\\$prev" = --body-file ]; then cp "\\$a" "${RUNNER_TEMP}/intercepted-body.md"; fi
              prev="\\$a"
            done
            exit 0
          fi
          exec "$real" "\\$@"
          EOF
          chmod +x "${RUNNER_TEMP}/ghshim/gh"
          echo "${RUNNER_TEMP}/ghshim" >> "$GITHUB_PATH"
          "$real" --version | head -1
"""
dump_step = """
      - name: 'PROBE: what the reporter tried to write'
        if: '${{ always() }}'
        run: |-
          echo '--- intercepted calls'; cat "${RUNNER_TEMP}/intercepted.log" || true
          echo '--- body'; cat "${RUNNER_TEMP}/intercepted-body.md" || true
          echo '--- jobs as the reporter read them (same call, real gh, real token)'
          gh api "repos/${{ github.repository }}/actions/runs/${{ github.run_id }}/jobs" --jq '.jobs[] | "\\(.name) | \\(.status) | \\(.conclusion)"'
        env:
          GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}'
"""
probe_report = report.replace(verbatim_if, probe_if).replace(reporter_step, probe_steps + reporter_step).rstrip('\n') + '\n' + dump_step

# A second consumer carrying the PR's gate VERBATIM: on a fork push it must skip.
verbatim_job = """
  report_failure_verbatim_gate:
    name: 'PROBE: PR gate verbatim (expect skipped off-schedule/off-upstream)'
    needs: ['codeql']
    """ + verbatim_if + """
    runs-on: 'ubuntu-latest'
    steps:
      - run: 'echo this must not run on a fork push'
"""

def workflow(name_suffix, js_sleep, group):
    head = f"""name: 'CodeQL'

# PROBE for QwenLM/qwen-code#13270 — not a real scan. The `codeql` matrix keeps
# the PR's job name template, fail-fast and per-leg `timeout-minutes` expression;
# the analysis steps are replaced by a sleep that overruns the javascript cap.
on:
  push:
    branches: ['{BRANCH}']

permissions:
  actions: 'read'
  contents: 'read'
  security-events: 'write'

concurrency:
  group: '{group}'
  cancel-in-progress: false

jobs:
  codeql:
    name: 'CodeQL (${{{{ matrix.language }}}})'
    runs-on: 'ubuntu-latest'
    strategy:
      fail-fast: false
      matrix:
        include:
          - language: 'javascript'
            timeout: 1
          - language: 'java'
            timeout: 15
    timeout-minutes: '${{{{ matrix.timeout }}}}'
    steps:
      - name: 'Stand-in for Perform CodeQL Analysis'
        run: |-
          if [ '${{{{ matrix.language }}}}' = 'javascript' ]; then sleep {js_sleep}; fi
          echo 'leg finished'

"""
    return head + probe_report + verbatim_job

os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'probe-codeql-overrun.yml'), 'w').write(workflow('overrun', 150, 'codeql'))
open(os.path.join(OUT, 'probe-codeql-green.yml'), 'w').write(workflow('green', 0, 'codeql-green'))
print('report_failure if (probe):', probe_if)
