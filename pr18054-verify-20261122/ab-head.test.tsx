// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createSidebarMocks,
  DAEMON_APPROVAL_MODES,
  flushSidebar,
  installSidebarDomShims,
  sidebarSessionPage,
  useResolvedWebShellSessions,
  useSidebarSessionCatalogQuery,
} from '../test/sidebarHarness';

const fakeActions = vi.hoisted(() => ({
  loadDaemonStatus: undefined as
    | ((detail?: string) => Promise<unknown>)
    | undefined,
  workspace: {
    actions: {
      loadDaemonStatus: (detail?: string) =>
        fakeActions.loadDaemonStatus!(detail),
    },
  },
}));

vi.mock('../daemon/workspace/DaemonWorkspaceProvider.js', () => ({
  useOptionalDaemonWorkspace: () => fakeActions.workspace,
}));

const mocks = createSidebarMocks({
  connection: { capabilities: undefined },
});
const {
  connection,
  workspace,
  workspaceActions,
  active,
  pinned,
  archived,
  refreshSessionCatalogQueries,
  useSessionCatalogQueries,
  loadSession,
} = mocks;
const sessionCatalogController = {
  refreshQueries: refreshSessionCatalogQueries,
  invalidateWorkspace: vi.fn(),
  refreshWorkspace: vi.fn(),
  renamed: vi.fn(),
  toggleSessionPinned: vi.fn(),
};

vi.mock('@qwen-code/web-shell/daemon-react-sdk', () => ({
  DAEMON_APPROVAL_MODES,
  useConnection: () => mocks.connection,
  useActions: () => mocks.actions,
  useWorkspace: () => mocks.workspace,
  useWorkspaceActions: () => mocks.workspaceActions,
  useChannels: () => mocks.channels,
  useSessions: (options?: { archiveState?: string; group?: string }) =>
    sidebarSessionPage(mocks, options),
  useStreamingState: () => 'idle',
}));

vi.mock('../session-catalog/session-catalog-hooks', () => ({
  useWebShellSessions: (options?: {
    enabled?: boolean;
    archiveState?: string;
    group?: string;
  }) => useResolvedWebShellSessions(mocks, options),
  useSessionCatalogController: () => sessionCatalogController,
  useSessionCatalogPolling: () => undefined,
  useSessionCatalogQuery: (
    client: typeof mocks.workspace.client,
    query: { workspaceCwd: string; options?: Record<string, unknown> },
    options: { autoLoad?: boolean; enabled?: boolean },
  ) => useSidebarSessionCatalogQuery(client, query, options),
  useSessionCatalogQueries,
}));

vi.mock('../components/sidebar/RecentSessions', () => ({
  RecentSessions: () => null,
}));
vi.mock('../components/sidebar/StandaloneRecents', () => ({
  StandaloneRecents: () => null,
}));
vi.mock('../components/sidebar/WorkspaceMenu', () => ({
  WorkspaceMenu: () => null,
}));
vi.mock('../components/sidebar/WorkspaceSection', async () => {
  const React = await import('react');
  return {
    WorkspaceSection: (props: {
      headerActions?: (
        visible: boolean,
        extras: Record<string, unknown>,
      ) => unknown;
    }) =>
      React.createElement(
        React.Fragment,
        null,
        props.headerActions?.(true, {
          overview: undefined,
          gitBranch: 'main',
        }) as never,
      ),
    isAbsolutePath: (value: string) => value.startsWith('/'),
  };
});

const { I18nProvider, useI18n } = await import('../i18n');
const { WebShellSidebar } = await import(
  '../components/sidebar/WebShellSidebar'
);
const { useDaemonOverloadPause } = await import(
  '../daemon/workspace/hooks/useDaemonOverloadPause'
);

installSidebarDomShims();

let root: Root;
let container: HTMLDivElement;
const onNewSession = vi.fn(() => false);
const onError = vi.fn();

const strip = () =>
  container.querySelector<HTMLElement>('[data-web-shell-overload-strip]');
const newTaskButton = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const report = (overloaded: boolean) => ({
  runtime: {
    loadAdmission: {
      enabled: true,
      overloaded,
      reason: overloaded ? 'cpu_load' : null,
      loadRatio: overloaded ? 2.5 : 0.3,
      eventLoopLagP99Ms: 20,
      sampledAtMs: 1000,
    },
  },
});

function Harness({
  initialRefusal = null,
}: {
  initialRefusal?: { message: string; expiresAt: number } | null;
}) {
  const [refusal, setRefusal] = useState(initialRefusal);
  const { paused, pollOverloaded, loadAdmission, refusalMessage } =
    useDaemonOverloadPause({
      enabled: true,
      refusal,
      onRefusalExpired: () => setRefusal(null),
    });
  const { t } = useI18n();
  const detail =
    pollOverloaded && loadAdmission
      ? t('sidebar.overloadDetail', {
          ratio: loadAdmission.loadRatio.toFixed(2),
          lag: Math.round(loadAdmission.eventLoopLagP99Ms),
          reason: loadAdmission.reason ?? 'unknown',
        })
      : refusalMessage;
  return (
    <WebShellSidebar
      collapsed={false}
      onCollapsedChange={() => {}}
      onOpenSettings={() => {}}
      onOpenDaemonStatus={() => {}}
      onOpenScheduledTasks={() => {}}
      onOpenWorkflows={() => {}}
      onOpenGoals={() => {}}
      onOpenSessions={() => {}}
      onOpenSplitView={() => {}}
      onNewSession={onNewSession}
      onLoadSession={loadSession}
      onError={onError}
      overloadPaused={paused}
      overloadDetail={detail}
    />
  );
}

const renderHarness = (initialRefusal = null) => {
  act(() => {
    root.render(
      <I18nProvider language="en">
        <Harness initialRefusal={initialRefusal} />
      </I18nProvider>,
    );
  });
};

const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container.appendChild(document.createElement('div')));
  connection.status = 'connected';
  connection.loadingTranscript = false;
  connection.error = undefined;
  connection.sessionId = null;
  connection.sessionContext = undefined;
  connection.workspaceCwd = '/tmp/project';
  connection.capabilities = undefined;
  workspace.capabilities = undefined;
  workspace.client.listWorkspaceSessionsPage
    .mockReset()
    .mockResolvedValue({ sessions: [] });
  workspace.client.listStandaloneSessionsPage
    .mockReset()
    .mockResolvedValue({ sessions: [] });
  workspaceActions.listSessionGroups.mockReset();
  workspaceActions.listSessionGroups.mockResolvedValue({
    groups: [],
    colorOptions: [],
  });
  active.sessions = [];
  active.data = active.sessions;
  pinned.sessions = [];
  pinned.data = pinned.sessions;
  archived.sessions = [];
  archived.data = archived.sessions;
  refreshSessionCatalogQueries.mockReset();
  useSessionCatalogQueries.mockReset();
  useSessionCatalogQueries.mockReturnValue([]);
  loadSession.mockReset();
  onNewSession.mockClear();
  onError.mockClear();
  fakeActions.loadDaemonStatus = vi.fn(async () => report(false));
  Object.defineProperty(document, 'hidden', {
    value: false,
    configurable: true,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('overload A/B: head arm', () => {
  it(
    'turns the strip and disabled button on and off with the same status fixture',
    async () => {
      let overloaded = false;
      fakeActions.loadDaemonStatus = vi.fn(async () => report(overloaded));
      renderHarness();
      await flushSidebar();
      await wait(200);

      let element = strip();
      let button = newTaskButton('New session');
      expect(element).toBeNull();
      expect(button!.disabled).toBe(false);

      overloaded = true;
      await wait(5_600);
      await flushSidebar();
      element = strip();
      button = newTaskButton('New session');
      expect(element).not.toBeNull();
      expect(element!.textContent).toBe('System overloaded — new tasks paused');
      expect(element!.getAttribute('title')).toContain('Host load ratio 2.50');
      expect(button!.disabled).toBe(true);
      act(() => {
        button!.click();
      });
      await flushSidebar();
      expect(onNewSession).not.toHaveBeenCalled();

      overloaded = false;
      await wait(5_600);
      await flushSidebar();
      expect(strip()).toBeNull();
      expect(newTaskButton('New session')!.disabled).toBe(false);

      console.log(
        'AB_CELL ' +
          JSON.stringify({
            arm: 'head',
            strippedWhenOverloaded: 1,
            disabledWhenOverloaded: 1,
            createsWhenOverloaded: onNewSession.mock.calls.length,
            strippedAfterRecovery: strip() ? 1 : 0,
          }),
      );
    },
    30_000,
  );

  it(
    'pauses on an unexpired refusal hint and clears it at expiry',
    async () => {
      renderHarness({
        message: 'System overloaded (cpu_load) — refused by daemon',
        expiresAt: Date.now() + 2_000,
      });
      await flushSidebar();
      await wait(100);
      const element = strip();
      expect(element).not.toBeNull();
      expect(element!.getAttribute('title')).toBe(
        'System overloaded (cpu_load) — refused by daemon',
      );
      expect(newTaskButton('New session')!.disabled).toBe(true);

      await wait(2_300);
      await flushSidebar();
      expect(strip()).toBeNull();
      expect(newTaskButton('New session')!.disabled).toBe(false);
    },
    20_000,
  );
});
