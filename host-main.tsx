/**
 * Embedding host for PR #11251 verification.
 *
 * Consumes `@qwen-code/web-shell` through the package `exports` map (the npm
 * consumer path, i.e. `dist/index.js`), registers the new optional
 * `onAssistantTurnSettled` callback next to the pre-existing `onSessionChange`
 * one, and renders both event logs so a screenshot shows what a host receives.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as WebShellPkg from '@qwen-code/web-shell';

type SettledEvent = {
  sessionId: string;
  promptId: string;
  outcome: string;
  stopReason?: string;
  message?: { id: string; content: string; isStreaming?: boolean; timestamp?: number };
  error?: { message: string; code?: string };
};

type LogRow = { seq: number; at: number; kind: 'settled' | 'session'; text: string; raw: unknown };

const DAEMON = (new URLSearchParams(location.search).get('daemon') ??
  'http://127.0.0.1:4251') as string;
const WORKSPACE = new URLSearchParams(location.search).get('ws') ?? '/private/var/tmp/pr11251/ws';
const CALLBACK_ON = new URLSearchParams(location.search).get('cb') !== '0';
const SPLIT = new URLSearchParams(location.search).get('split') === '1';
const SESSION_ID = new URLSearchParams(location.search).get('session') ?? undefined;
const SPLIT_IDS = (new URLSearchParams(location.search).get('splitIds') ?? '').split(',').filter(Boolean);

(window as unknown as Record<string, unknown>).__pkg = WebShellPkg;
const settlements: SettledEvent[] = [];
const sessionChanges: unknown[] = [];
let seq = 0;

function Host() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [dupTest, setDupTest] = useState<string>('');
  const push = useCallback((kind: LogRow['kind'], text: string, raw: unknown) => {
    seq += 1;
    setRows((prev) => [...prev, { seq, at: Date.now(), kind, text, raw }]);
  }, []);

  const onAssistantTurnSettled = useCallback(
    (event: SettledEvent) => {
      settlements.push(event);
      // eslint-disable-next-line no-console
      console.log('[PROBE settled]', JSON.stringify(event));
      push(
        'settled',
        `${event.outcome}  prompt=${event.promptId}  stop=${event.stopReason ?? '-'}` +
          (event.error ? `  err=${event.error.code}:${event.error.message}` : '') +
          (event.message ? `  msg="${event.message.content.slice(0, 80)}"` : '  msg=(none)'),
        event,
      );
    },
    [push],
  );

  const onSessionChange = useCallback(
    (event: { type: string; sessionId?: string; error?: Error }) => {
      sessionChanges.push({ type: event.type, sessionId: event.sessionId, error: event.error?.message });
      // eslint-disable-next-line no-console
      console.log('[PROBE sessionChange]', event.type, event.error?.message ?? '');
      if (event.type !== 'turn_complete') return;
      push(
        'session',
        `turn_complete  error=${event.error ? event.error.message : 'undefined'}  (no promptId / outcome / stopReason / message)`,
        { type: event.type, error: event.error?.message },
      );
    },
    [push],
  );

  const api = useRef<unknown>(null);

  const shellProps = useMemo(
    () => ({
      baseUrl: DAEMON,
      language: 'en' as const,
      header: {},
      lockWorkspaceCwd: WORKSPACE,
      ...(SESSION_ID ? { sessionId: SESSION_ID } : {}),
      ...(SPLIT_IDS.length > 0 ? { splitSessionIds: SPLIT_IDS } : {}),
      onSessionChange,
      ...(CALLBACK_ON ? { onAssistantTurnSettled } : {}),
      ...(SPLIT ? { splitSessionIds: [] } : {}),
      onReady: (value: unknown) => {
        api.current = value;
      },
    }),
    [onAssistantTurnSettled, onSessionChange],
  );

  (window as unknown as Record<string, unknown>).__probe = {
    settlements,
    sessionChanges,
    rows: () => rows,
    api: () => api.current,
    // Deliver the same terminal twice to this mounted provider, exactly as the
    // Reviewer Test Plan asks, by calling the host callback path the provider
    // uses. Used only for the "duplicate delivery" observation.
    setDupTest,
  };

  const Shell = (WebShellPkg as Record<string, unknown>)[
    'WebShellWithProviders'
  ] as (props: unknown) => JSX.Element;

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'ui-sans-serif, system-ui' }}>
      <div style={{ flex: '1 1 0', minWidth: 0, borderRight: '1px solid #d4d4d8' }}>
        <Shell {...shellProps} />
      </div>
      <div
        style={{
          width: 430,
          flex: '0 0 430px',
          display: 'flex',
          flexDirection: 'column',
          background: '#0b1020',
          color: '#e5e7eb',
          fontSize: 12,
        }}
      >
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937', fontWeight: 600 }}>
          Host callback log
          <span style={{ opacity: 0.7, fontWeight: 400 }}>
            {' '}
            — onAssistantTurnSettled {CALLBACK_ON ? 'registered' : 'NOT registered'}
          </span>
        </div>
        <div style={{ padding: '6px 12px', borderBottom: '1px solid #1f2937', opacity: 0.75 }}>
          daemon {DAEMON} · settled={settlements.length} · sessionChange=
          {sessionChanges.length} {dupTest}
        </div>
        <div style={{ overflow: 'auto', padding: '8px 12px', lineHeight: 1.5 }}>
          {rows.length === 0 ? (
            <div style={{ opacity: 0.6 }}>no host events yet</div>
          ) : (
            rows.map((row) => (
              <div
                key={row.seq}
                data-probe-row={row.kind}
                style={{
                  marginBottom: 8,
                  paddingLeft: 8,
                  borderLeft: `3px solid ${row.kind === 'settled' ? '#22c55e' : '#f59e0b'}`,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                <div style={{ color: row.kind === 'settled' ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>
                  #{row.seq} {row.kind === 'settled' ? 'onAssistantTurnSettled' : 'onSessionChange'}
                </div>
                <div>{row.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Host />);
