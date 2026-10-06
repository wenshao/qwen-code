// VERIFICATION RIG ONLY (PR #13163): host page for the real Managed panel; actor/lang/theme/session come from the URL.
import { createRoot } from 'react-dom/client';
import { ManagedAgentWebShell } from '../../ManagedAgentWebShell';

const q = new URLSearchParams(window.location.search);
const actor = q.get('actor') ?? 'alice';
const tenant = q.get('tenant') ?? 't13163';
const lang = (q.get('lang') ?? 'en') as 'en';
const theme = (q.get('theme') ?? 'light') as 'light';
createRoot(document.getElementById('root')!).render(
  <div style={{ height: '100vh' }}>
    <ManagedAgentWebShell
      baseUrl={window.location.origin}
      productScope={`rig-13163:${actor}`}
      getHeaders={() => ({ 'X-Qwen-Tenant-Id': tenant, 'X-Rig-Actor': actor })}
      enableWorkspaceBinding
      language={lang}
      theme={theme}
      sessionId={q.get('session') ?? undefined}
    />
  </div>,
);
