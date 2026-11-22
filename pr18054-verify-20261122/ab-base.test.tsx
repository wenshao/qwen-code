// @vitest-environment jsdom
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

const { I18nProvider } = await import('../i18n');
const { WebShellSidebar } = await import(
  '../components/sidebar/WebShellSidebar'
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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('overload A/B: base arm', () => {
  it('renders no strip and keeps New session working under an overloaded daemon', async () => {
    // The same fixture the head arm consumes: the daemon reports sustained
    // overload. Base has no consumer for it, so the button stays actionable.
    const loadAdmission = {
      enabled: true,
      overloaded: true,
      reason: 'cpu_load',
      loadRatio: 2.5,
      eventLoopLagP99Ms: 20,
      sampledAtMs: 1000,
    };

    act(() => {
      root.render(
        <I18nProvider language="en">
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
          />
        </I18nProvider>,
      );
    });
    await flushSidebar();

    const element = strip();
    const button = newTaskButton('New session');
    expect(element).toBeNull();
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(false);
    act(() => {
      button!.click();
    });
    await flushSidebar();
    expect(onNewSession).toHaveBeenCalledTimes(1);

    console.log(
      'AB_CELL ' +
        JSON.stringify({
          arm: 'base',
          daemonOverloaded: loadAdmission.overloaded,
          statusPollConsumed: false,
          strip: element ? 1 : 0,
          disabled: button!.disabled ? 1 : 0,
          creates: onNewSession.mock.calls.length,
        }),
    );
  });
});
