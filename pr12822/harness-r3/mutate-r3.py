#!/usr/bin/env python3
"""Mutation pass over the PR's new managed-agent-server code.

Each mutant is a single literal replacement (asserted to match exactly once),
followed by the module's full `mvn test` (102 tests). The file is restored with
`git checkout HEAD -- <file>` after every run; the worktree is clean at the PR
head beforehand.
"""
import json
import os
import re
import subprocess
import sys
import time

SP = '$SCRATCH'
WT = f'{SP}/wt-pr'
MOD = f'{WT}/packages/sdk-java/managed-agent-server'
SRC = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/'
MVN = ['mvn', '--batch-mode', '--no-transfer-progress', '-s', f'{SP}/m2settings.xml',
       f'-Dmaven.repo.local={SP}/m2repo', '-Dcheckstyle.skip', 'test']
ENV = dict(os.environ, JAVA_HOME=os.path.expanduser('~/Install/jdk21'),
           PATH=os.path.expanduser('~/Install/jdk21/bin') + ':' + os.path.expanduser('~/Install/maven/bin') + ':' + os.environ['PATH'])

MUTANTS = [
    ('M21', 'Leave agent_revision out of the digest (Workspace create)', 'service/ManagedAgentService.java',
     """        if (agentRevision != null) {
            semantic.put("agentRevision", agentRevision);
        }
        semantic.put("title", effectiveTitle);
        semantic.put("input", input);
        semantic.put("workspace", selection == null""", """        semantic.put("title", effectiveTitle);
        semantic.put("input", input);
        semantic.put("workspace", selection == null"""),
    ('M24', 'WebShell bound workspace: contextRevision always 0', 'service/ManagedAgentService.java',
     """                : new WebShellWorkspace(session.workspace().getWorkspaceId(),
                        session.workspace().getCwdRelative(),
                        session.workspace().getContextRevision(),""",
     """                : new WebShellWorkspace(session.workspace().getWorkspaceId(),
                        session.workspace().getCwdRelative(),
                        0L,"""),
    ('M25', 'Public bound workspace: context_revision always 0', 'service/ManagedAgentService.java',
     """                : new PublicWorkspace(session.workspace().getWorkspaceId(),
                        session.workspace().getCwdRelative(),
                        session.workspace().getContextRevision(),""",
     """                : new PublicWorkspace(session.workspace().getWorkspaceId(),
                        session.workspace().getCwdRelative(),
                        0L,"""),
    ('M26', 'Bound workspace state "pending" instead of "ready"', 'service/ManagedAgentService.java',
     'private static final String WORKSPACE_STATE = "ready";', 'private static final String WORKSPACE_STATE = "pending";'),
    ('M27', 'WebShell bound workspace: state null', 'service/ManagedAgentService.java',
     """                        session.workspace().getContextRevision(),
                        WORKSPACE_STATE);
    }

    private static PublicWorkspace""", """                        session.workspace().getContextRevision(),
                        null);
    }

    private static PublicWorkspace"""),
]


def run(mid):
    t0 = time.time()
    p = subprocess.run(MVN, cwd=MOD, env=ENV, capture_output=True, text=True)
    log = f'{SP}/r3/logs/mut-{mid}.log'
    open(log, 'w').write(p.stdout + p.stderr)
    summary = [l for l in p.stdout.splitlines() if re.search(r'Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+$', l)]
    failing = sorted(set(re.findall(r'\[ERROR\]\s+([\w.]+Test\.\w+)', p.stdout)))
    compile_error = 'COMPILATION ERROR' in p.stdout
    return {'rc': p.returncode, 'summary': summary[-1] if summary else None, 'failing': failing[:8],
            'compileError': compile_error, 'secs': round(time.time() - t0)}


def main():
    only = set(sys.argv[1:])
    results = []
    for mid, what, rel, old, new in MUTANTS:
        if only and mid not in only:
            continue
        path = f'{WT}/{SRC}{rel}'
        text = open(path).read()
        n = text.count(old)
        if n != 1:
            print(f'{mid}: anchor matched {n} times, skipped', flush=True)
            results.append({'id': mid, 'what': what, 'error': f'anchor x{n}'})
            continue
        open(path, 'w').write(text.replace(old, new))
        try:
            r = run(mid)
        finally:
            subprocess.run(['git', 'checkout', 'HEAD', '--', f'{SRC}{rel}'], cwd=WT, check=True)
        verdict = 'COMPILE-ERROR' if r['compileError'] else ('killed' if r['rc'] != 0 else 'SURVIVED')
        results.append({'id': mid, 'what': what, 'verdict': verdict, **r})
        print(f"{mid:4} {verdict:13} {what}  [{r['summary']}] {' '.join(r['failing'][:3])}", flush=True)
    clean = subprocess.run(['git', 'status', '--short'], cwd=WT, capture_output=True, text=True).stdout
    print('worktree clean after run:', clean.strip() == '', flush=True)
    json.dump(results, open(f'{SP}/r3/out/mutation-java.json', 'w'), indent=1)


main()
