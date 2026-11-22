import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT =
  '/root/git/qwen-code-verify/.qwen/worktrees/bright-oak-37f4f0/tmp/pr18054-head';
const PKG = `${ROOT}/packages/web-shell`;
const APP = `${PKG}/client/App.tsx`;
const SIDEBAR = `${PKG}/client/components/sidebar/WebShellSidebar.tsx`;
const HOOK = `${PKG}/client/daemon/workspace/hooks/useDaemonOverloadPause.ts`;
const ERRORS = `${PKG}/client/daemon/session/httpErrors.ts`;

const appArgs = ['client/App.test.tsx', '-t', 'overload pause guards in App'];
const sidebarArgs = [
  'client/components/sidebar/WebShellSidebar.overload-strip.test.tsx',
];
const hookArgs = [
  'client/daemon/workspace/hooks/useDaemonOverloadPause.test.ts',
];
const errorArgs = [
  'client/daemon/session/httpErrors.test.ts',
  'client/daemon/session/actions.test.ts',
  '-t',
  'system overload|load-admission create failure',
];

const mutations = [
  {
    id: 'M1-app-bang-shell-guard',
    file: APP,
    args: appArgs,
    from: `        const needsSession = !connectionRef.current.sessionId;
        if (
          needsSession &&
          overloadPausedRef.current &&
          !managedModeRef.current
        ) {
          pushToast(
            'warning',
            overloadDetailRef.current ?? t('sidebar.overloadPaused'),
          );
          return false;
        }
        let shellPromptPreparationOwner: symbol | undefined;`,
    to: `        const needsSession = !connectionRef.current.sessionId;
        let shellPromptPreparationOwner: symbol | undefined;`,
    expectRed: 'refuses !ls',
  },
  {
    id: 'M2-app-goal-guard',
    file: APP,
    args: appArgs,
    from: `      const needsSession = !connectionRef.current.sessionId;
      if (
        needsSession &&
        overloadPausedRef.current &&
        !managedModeRef.current
      ) {
        pushToast(
          'warning',
          overloadDetailRef.current ?? t('sidebar.overloadPaused'),
        );
        return false;
      }
      goalSessionCreationInFlightRef.current = needsSession;`,
    to: `      const needsSession = !connectionRef.current.sessionId;
      goalSessionCreationInFlightRef.current = needsSession;`,
    expectRed: 'refuses /goal',
  },
  {
    id: 'M3-app-manual-run-false-branch',
    file: APP,
    args: appArgs,
    from: `            if (result === false) {
              if (!admitted) {
                reject(new Error(t('sidebar.overloadPaused')));
              }
              return;
            }`,
    to: `            if (result === false) {
              if (!admitted) {
                reject(new Error('Run was cancelled before it started'));
              }
              return;
            }`,
    expectRed: 'manual run',
  },
  {
    id: 'M12-app-sendPrompt-guard',
    file: APP,
    args: appArgs,
    from: `      if (
        overloadPausedRef.current &&
        !managedModeRef.current &&
        !connectionRef.current.sessionId &&
        !createSessionPromiseRef.current
      ) {
        pushToast(
          'warning',
          overloadDetailRef.current ?? t('sidebar.overloadPaused'),
        );
        return false;
      }
      if (sessionWriteBlockedRef.current) {`,
    to: `      if (sessionWriteBlockedRef.current) {`,
    expectRed: 'manual run',
  },
  {
    id: 'M13-app-ensureSession-guard',
    file: APP,
    args: appArgs,
    from: `      if (currentSessionId) return Promise.resolve(undefined);
      // Chokepoint for !ls / control commands / @-mention runs: refuse the
      // allocation up front while paused instead of paying a doomed create
      // round-trip on a saturated host.
      if (overloadPausedRef.current && !managedModeRef.current) {
        pushToast(
          'warning',
          overloadDetailRef.current ?? t('sidebar.overloadPaused'),
        );
        return Promise.resolve(undefined);
      }
      const pendingManualTitle = pendingManualTitleRef.current;`,
    to: `      if (currentSessionId) return Promise.resolve(undefined);
      const pendingManualTitle = pendingManualTitleRef.current;`,
    expectRed: null,
  },
  {
    id: 'M4-hook-enabled-clause',
    file: HOOK,
    args: hookArgs,
    from: `  const pollOverloaded =
    enabled && error === undefined && loadAdmission?.overloaded === true;`,
    to: `  const pollOverloaded =
    error === undefined && loadAdmission?.overloaded === true;`,
    expectRed: 'enabled flips false',
  },
  {
    id: 'M5-sidebar-standalone-prop',
    file: SIDEBAR,
    args: sidebarArgs,
    from: `                    onNewSession={onNewStandaloneSession}
                    newSessionDisabled={newSessionDisabled}
                    onLoadSession={onLoadStandaloneSession}`,
    to: `                    onNewSession={onNewStandaloneSession}
                    onLoadSession={onLoadStandaloneSession}`,
    expectRed: 'passes newSessionDisabled to StandaloneRecents',
  },
  {
    id: 'M6-sidebar-worktree-menu-spread',
    file: SIDEBAR,
    args: sidebarArgs,
    from: `                                      ...(ws.trusted &&
                                      !ws.ssh &&
                                      !overloadPaused &&
                                      onNewWorktreeSession &&`,
    to: `                                      ...(ws.trusted &&
                                      !ws.ssh &&
                                      onNewWorktreeSession &&`,
    expectRed: 'omits workspace-menu creation actions',
  },
  {
    id: 'M7-sidebar-per-workspace-button-disabled',
    file: SIDEBAR,
    args: sidebarArgs,
    from: `                                            aria-label={t('sidebar.newTask')}
                                            disabled={newSessionDisabled}
                                            onClick={(event) => {`,
    to: `                                            aria-label={t('sidebar.newTask')}
                                            onClick={(event) => {`,
    expectRed: 'Every New-session button',
  },
  {
    id: 'M8-sidebar-git-branch-wanted',
    file: SIDEBAR,
    args: sidebarArgs,
    from: `                              !lockedWorkspaceCwd &&
                              !overloadPaused
                            }`,
    to: `                              !lockedWorkspaceCwd
                            }`,
    expectRed: 'git poll',
  },
  {
    id: 'M9-sidebar-handleNewSession-guard',
    file: SIDEBAR,
    args: sidebarArgs,
    from: `      if (creatingSessionRef.current) return;
      if (overloadPaused) {
        onError(
          new Error(t('sidebar.overloadPaused')),
          t('sidebar.overloadPaused'),
        );
        return;
      }

      creatingSessionRef.current = true;`,
    to: `      if (creatingSessionRef.current) return;

      creatingSessionRef.current = true;`,
    expectRed: 'guards the recents creation callbacks',
  },
  {
    id: 'M10-httpErrors-classifier',
    file: ERRORS,
    args: errorArgs,
    from: `  return [body['code'], data?.['errorKind'], data?.['code']].includes(
    'system_overloaded',
  );`,
    to: `  return false;`,
    expectRed: 'system overload|load-admission',
  },
  {
    id: 'M11-actions-mapping',
    file: `${PKG}/client/daemon/session/actions.ts`,
    args: [
      'client/daemon/session/actions.test.ts',
      '-t',
      'load-admission create failure',
    ],
    from: `            : isSystemOverloadedError(error)
              ? { code: 'system_overloaded' }
              : undefined,`,
    to: `            : false
              ? { code: 'system_overloaded' }
              : undefined,`,
    expectRed: 'load-admission',
  },
  {
    id: 'M14-app-createNewSession-guard',
    file: APP,
    args: appArgs,
    from: `      if (overloadPausedRef.current && !managedModeRef.current) {
        pushToast(
          'warning',
          overloadDetailRef.current ?? t('sidebar.overloadPaused'),
        );
        return false;
      }
      if (
        connectionRef.current.standaloneSession?.creationRecovery &&`,
    to: `      if (
        connectionRef.current.standaloneSession?.creationRecovery &&`,
    expectRed: null,
  },
  {
    id: 'M15-app-refusal-notice-wiring',
    file: APP,
    args: appArgs,
    from: `      if (
        notice.code === 'system_overloaded' &&
        notice.operation === 'create_session'
      ) {
        setOverloadRefusal({
          message: notice.message,
          expiresAt: Date.now() + OVERLOAD_REFUSAL_TTL_MS,
        });
      }
      if (shouldToastNotice(notice)) {`,
    to: `      if (shouldToastNotice(notice)) {`,
    expectRed: null,
  },
];

function sha(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

for (const mutation of mutations) {
  if (
    process.env.ONLY &&
    !process.env.ONLY.split(',').includes(mutation.id)
  ) {
    continue;
  }
  const original = readFileSync(mutation.file, 'utf8');
  const before = sha(original);
  const occurrences = original.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    console.log(
      JSON.stringify({
        id: mutation.id,
        error: `anchor occurrences=${occurrences}`,
      }),
    );
    continue;
  }
  let row;
  try {
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    const run = spawnSync(
      'npx',
      [
        'vitest',
        'run',
        '--config',
        'vitest.config.ts',
        '--reporter=verbose',
        ...mutation.args,
      ],
      {
        cwd: PKG,
        env: {
          ...process.env,
          NODE_OPTIONS: '--no-experimental-webstorage',
          PATH: `${ROOT}/node_modules/.bin:${process.env.PATH}`,
        },
        encoding: 'utf8',
        timeout: 240_000,
      },
    );
    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    const summary =
      [...output.matchAll(/^\s*Tests\s+(.+)$/gm)].at(-1)?.[1] ?? 'no-summary';
    const failed = [...output.matchAll(/^\s*×\s+(.+?)\s+\d+ms$/gm)].map(
      (match) => match[1],
    );
    const executed =
      Number(summary.match(/(\d+) passed/)?.[1] ?? 0) +
      Number(summary.match(/(\d+) failed/)?.[1] ?? 0);
    row = {
      id: mutation.id,
      exit: run.status,
      executed,
      summary,
      failed,
      expectedRed: mutation.expectRed,
      killed: mutation.expectRed
        ? failed.some((name) => name.includes(mutation.expectRed))
        : failed.length > 0,
    };
  } finally {
    writeFileSync(mutation.file, original);
  }
  const after = sha(readFileSync(mutation.file, 'utf8'));
  row.restored = before === after;
  console.log(JSON.stringify(row));
}
