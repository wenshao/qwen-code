// VERIFICATION RIG ONLY (PR #13760): a minimal host page for ManagedAgentWebShell.
// The host authenticates as ?actor= in ?tenant= through the rig's X-Rig-Actor adapter.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ManagedAgentWebShell } from '../../ManagedAgentWebShell';

const query = new URLSearchParams(window.location.search);
const actor = query.get('actor') ?? 'alice';
const tenant = query.get('tenant') ?? 't-ui';
const getHeaders = () => ({
  'X-Qwen-Tenant-Id': tenant,
  'X-Rig-Actor': actor,
});

function Host() {
  const [sessionId, setSessionId] = useState<string | undefined>(
    query.get('session') ?? undefined,
  );
  (window as unknown as { __rig: unknown }).__rig = { select: setSessionId };
  return (
    <div style={{ height: '100vh', padding: 16, boxSizing: 'border-box' }}>
      <ManagedAgentWebShell
        baseUrl={window.location.origin}
        productScope={`${tenant}:${actor}`}
        getHeaders={getHeaders}
        enableWorkspaceBinding
        language={query.get('lang') === 'zh' ? 'zh-CN' : 'en'}
        theme={query.get('theme') === 'dark' ? 'dark' : 'light'}
        sessionId={sessionId}
        onSessionChange={setSessionId}
        style={{ height: '100%' }}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Host />);
