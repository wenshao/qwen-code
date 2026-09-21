// Verification-only embedding host (NOT part of the PR): mounts the public
// WebShellWithProviders against a REAL daemon and exposes the public shellRef.
import ReactDOM from 'react-dom/client';
import '../styles/standalone.css';
import type { WebShellApi } from '../index';
const entry = '../index.tsx';
const { WebShellWithProviders } = await import(/* @vite-ignore */ entry);
const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.add(`theme-${theme}`);
document.documentElement.classList.toggle('dark', theme === 'dark');
if (params.get('timeline') === 'true')
  window.localStorage.removeItem('qwen-code-web-shell-chat-width');
else window.localStorage.setItem('qwen-code-web-shell-chat-width', 'wide');
let api: WebShellApi | null = null;
Object.assign(window, {
  hasNavigateToMessage: () =>
    typeof (api as unknown as Record<string, unknown> | null)?.[
      'navigateToMessage'
    ] === 'function',
  navigateReal: (request: unknown, abortAfterMs?: number) => {
    const fn = (api as unknown as Record<string, unknown> | null)?.[
      'navigateToMessage'
    ] as ((r: unknown) => Promise<unknown>) | undefined;
    if (!fn) return Promise.resolve({ status: 'API_MISSING' });
    if (abortAfterMs === undefined) return fn(request);
    const controller = new AbortController();
    if (abortAfterMs <= 0) controller.abort();
    else setTimeout(() => controller.abort(), abortAfterMs);
    return fn({ ...(request as object), signal: controller.signal });
  },
});
const threshold = params.get('threshold');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <WebShellWithProviders
    baseUrl={window.location.origin}
    token={params.get('token') ?? undefined}
    sessionId={params.get('sessionId')!}
    theme={theme}
    language={params.get('language') === 'zh-CN' ? 'zh-CN' : 'en'}
    {...(threshold === null
      ? {}
      : { conversationSearchThreshold: Number(threshold) })}
    shellRef={(value: WebShellApi | null) => {
      api = value;
    }}
  />,
);
