/* eslint-disable */
/**
 * PR #10383 — real slash-command integration probe.
 *
 * Builds the PR's OpenTuiSlashDispatcher on top of the REAL production
 * command registry (loadInteractiveCommands -> BuiltinCommandLoader et al.)
 * and a real Config / LoadedSettings, wraps it in the PR's
 * OpenTuiSlashGateway, and drives real slash input. Records the dialog
 * request each command produces and checks it against the OpenTUI dialog
 * components this batch actually ships.
 */
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'pr10383-home-'));
mkdirSync(join(HOME, '.qwen'), { recursive: true });
writeFileSync(
  join(HOME, '.qwen', 'settings.json'),
  JSON.stringify({ ui: { theme: 'Default' } }),
);
process.env['QWEN_HOME'] = HOME;

const OUT = process.env['PROBE_OUT'] ?? '/tmp/pr10383-slash';
mkdirSync(OUT, { recursive: true });

const { loadSettings } = await import('../src/config/settings.js');
const { Config } = await import('@qwen-code/qwen-code-core');
const { loadInteractiveCommands } = await import(
  '../src/ui/opentui/slash-dispatch.js'
);
const { OpenTuiSlashDispatcher } = await import(
  '../src/ui/opentui/commands-dispatch.js'
);
const { OpenTuiSlashGateway } = await import(
  '../src/ui/opentui/slash-gateway.js'
);
const { routeDialogToOpenTui } = await import(
  '../src/ui/opentui/commands-registry.js'
);

const WS = mkdtempSync(join(tmpdir(), 'pr10383-ws-'));
const settings = loadSettings(WS);
const config = new Config({
  sessionId: 'pr10383-slash',
  targetDir: WS,
  cwd: WS,
  debugMode: false,
  chatRecording: false,
  model: 'qwen3-coder-plus',
  trustedFolder: true,
} as never);
await config.initialize({ skipMcpDiscovery: true } as never);

const log: string[] = [];
const items: unknown[] = [];
let nextId = 0;
const host = {
  getHistory: () => items,
  addItem: (item: unknown) => {
    items.push(item);
    return nextId++;
  },
  updateItem: () => {},
  clearItems: () => log.push('clearItems'),
  loadHistory: () => log.push('loadHistory'),
  refreshStatic: () => {},
  clearPendingState: () => {},
  cancelBtw: () => {},
  btwItem: null,
  setBtwItem: () => {},
  btwAbortControllerRef: { current: null },
  pendingItem: null,
  setPendingItem: () => {},
  setDebugMessage: () => {},
  toggleVimEnabled: async () => true,
  setMemoryFileCount: () => {},
  reloadCommands: () => {},
  setSessionName: () => {},
  isIdle: () => true,
  extensionsUpdateState: new Map(),
  dispatchExtensionStateUpdate: () => {},
  addConfirmUpdateExtensionRequest: () => {},
  sessionStats: {
    sessionId: 'sess-1',
    sessionStartTime: new Date(),
    metrics: {},
    lastPromptTokenCount: 0,
    promptCount: 0,
  },
  sessionShellAllowlist: new Set<string>(),
  addSessionShellAllowlist: () => {},
  setIsProcessing: () => {},
  presentShellConfirmation: async () => ({ outcome: 'cancel', approvedCommands: [] }),
  presentActionConfirmation: async () => false,
  handleResume: async (id: string) => log.push(`handleResume:${id}`),
  handleBranch: async (n?: string) => log.push(`handleBranch:${n ?? ''}`),
};

const commands = await loadInteractiveCommands(config as never, settings as never);
const dispatcher = new OpenTuiSlashDispatcher(
  host as never,
  { config: config as never, settings: settings as never, logger: null },
  commands as never,
);
const gateway = new OpenTuiSlashGateway();
gateway.attach(dispatcher as never);

const INPUTS = [
  '/help',
  '?',
  '/settings',
  '/auth',
  '/theme',
  '/editor',
  '/mcp',
  '/memory',
  '/model',
  '/model fast',
  '/model vision',
  '/permissions',
  '/approval-mode',
  '/effort',
  '/stats',
  '/diff',
  '/extensions',
  '/hooks',
  '/agents',
  '/skills',
  '/statusline',
  '/rewind',
  '/arena start',
  '/arena status',
  '/arena stop',
  '/arena select',
  '/branch',
  '/resume',
  '/about',
  '/clear',
  '/nope-not-a-command',
  'plain text prompt',
];

interface Row {
  input: string;
  kind: string;
  dialog?: string;
  detail?: string;
}
const rows: Row[] = [];
for (const input of INPUTS) {
  const before = items.length;
  try {
    const settled = await gateway.dispatch(input);
    if (settled.kind === 'rejected') {
      rows.push({ input, kind: 'rejected', detail: settled.reason });
      continue;
    }
    const outcome = settled.outcome;
    if (outcome === false) {
      rows.push({ input, kind: 'not-a-slash-command' });
      continue;
    }
    const o = outcome as { kind: string; request?: { dialog: string; mode?: string } };
    const added = items.slice(before) as Array<{ type?: string; text?: string; content?: unknown }>;
    rows.push({
      input,
      kind: o.kind,
      dialog: o.request
        ? o.request.dialog + (o.request.mode ? `:${o.request.mode}` : '')
        : undefined,
      detail: added
        .map((i) => `${i.type}:${String(i.text ?? i.content ?? '').slice(0, 90)}`)
        .join(' | '),
    });
  } catch (err) {
    rows.push({ input, kind: 'THREW', detail: (err as Error).message });
  }
}

// Which OpenTuiDialogRequest kinds does this batch actually render?
const COMPONENT_FOR: Record<string, string> = {
  help: 'help-overlay.tsx HelpOverlay',
  theme: 'dialogs-theme.tsx OpenTuiThemeDialog (batch 3)',
  editor: 'dialogs-misc.tsx OpenTuiEditorDialog',
  settings: 'dialogs-settings.tsx OpenTuiSettingsDialog',
  statusline: 'dialogs-memory-status.tsx OpenTuiStatusLineDialog',
  memory: 'dialogs-memory-status.tsx OpenTuiMemoryDialog',
  auth: 'dialogs-auth.tsx OpenTuiAuthDialog',
  trust: 'dialogs-misc.tsx OpenTuiTrustDialog',
  permissions: 'dialogs-permissions.tsx OpenTuiPermissionsDialog',
  'approval-mode': 'dialogs-modes.tsx OpenTuiApprovalModeDialog',
  effort: 'dialogs-modes.tsx OpenTuiEffortDialog',
  delete: 'dialogs-misc.tsx OpenTuiDeleteDialog',
  resume: 'dialogs-misc.tsx OpenTuiResumeDialog',
  extensions_manage: 'dialogs-extensions.tsx OpenTuiExtensionsDialog',
  hooks: 'dialogs-misc.tsx OpenTuiHooksDialog',
  mcp: 'dialogs-mcp.tsx OpenTuiMcpDialog',
  rewind: 'session-rewind.tsx OpentuiRewindSelector (via OpenTuiRewindDialog)',
  diff: 'dialogs-misc.tsx OpenTuiDiffDialog',
  stats: 'dialogs-stats-skills.tsx OpenTuiStatsDialog',
  arena: 'dialogs-arena.tsx OpenTuiArenaDialog',
  subagent_create: 'dialogs-misc.tsx OpenTuiSubagentCreateDialog',
  subagent_list: 'dialogs-misc.tsx OpenTuiSubagentListDialog',
  skills_manage: 'dialogs-stats-skills.tsx OpenTuiSkillsDialog',
  model: 'dialogs-model.tsx OpenTuiModelDialog',
};

// Exhaustiveness: route every ink dialog kind through routeDialogToOpenTui.
const INK_DIALOG_KINDS = [
  'help', 'theme', 'editor', 'settings', 'statusline', 'memory', 'model',
  'fast-model', 'voice-model', 'vision-model', 'compaction-model',
  'image-model', 'auth', 'trust', 'permissions', 'approval-mode', 'effort',
  'delete', 'resume', 'branch', 'extensions_manage', 'hooks', 'mcp',
  'rewind', 'diff', 'stats', 'arena_start', 'arena_select', 'arena_stop',
  'arena_status', 'subagent_create', 'subagent_list', 'skills_manage',
];
const routing: Array<{ ink: string; opentui: string; component: string }> = [];
for (const kind of INK_DIALOG_KINDS) {
  try {
    const req = routeDialogToOpenTui({ type: 'dialog', dialog: kind } as never) as {
      dialog: string;
      mode?: string;
    };
    routing.push({
      ink: kind,
      opentui: req.dialog + (req.mode ? `:${req.mode}` : ''),
      component: COMPONENT_FOR[req.dialog] ?? 'NO COMPONENT IN TREE',
    });
  } catch (err) {
    routing.push({
      ink: kind,
      opentui: `THREW: ${(err as Error).message}`,
      component: '-',
    });
  }
}

writeFileSync(
  join(OUT, 'slash-e2e.json'),
  JSON.stringify({ commandCount: commands.length, rows, routing, log }, null, 2),
);
console.log(`commands loaded: ${commands.length}`);
console.log('--- dispatch ---');
for (const r of rows) {
  console.log(
    `${r.input.padEnd(24)} -> ${r.kind}${r.dialog ? ' [' + r.dialog + ']' : ''}${r.detail ? ' (' + r.detail.slice(0, 70) + ')' : ''}`,
  );
}
console.log('--- routing ---');
for (const r of routing) {
  console.log(`${r.ink.padEnd(18)} -> ${r.opentui.padEnd(18)} ${r.component}`);
}
console.log('host log:', JSON.stringify(log));
process.exit(0);
