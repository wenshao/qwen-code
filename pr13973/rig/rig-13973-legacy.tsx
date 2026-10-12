// VERIFICATION RIG ONLY (PR #13973): the empty-only provider contract (createSession removed, like
// the W0D fixture) wrapped around the real Java provider, inside the same provider/frame tree that
// ManagedAgentWebShell renders.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/globals.css';
import shellStyles from '../../App.module.css';
import { BrandProvider } from '../../brandContext';
import { createJavaManagedAgentProvider } from '../../components/managed/java-managed-agent-provider';
import { ManagedSessionsPage } from '../../components/managed/ManagedSessionsPage';
import { WebShellCustomizationProvider } from '../../customization';
import { I18nProvider } from '../../i18n';
import { WebShellPortalRootContext } from '../../portalRoot';
import { ThemeProvider, WebShellThemeId } from '../../themeContext';
import { CompactModeContext, TodoContextsProvider } from '../../WebShellContexts';

const query = new URLSearchParams(window.location.search);
const actor = query.get('actor') ?? 'alice';
const tenant = query.get('tenant') ?? 't13973';
const provider = createJavaManagedAgentProvider({
  baseUrl: window.location.origin,
  productScope: JSON.stringify([tenant, actor, 'legacy']),
  getHeaders: () => ({ 'X-Qwen-Tenant-Id': tenant, 'X-Qwen-Actor-Id': actor }),
  enableWorkspaceBinding: true,
});
const legacyProvider = { ...provider, workspaceBinding: { ...provider.workspaceBinding!, createSession: undefined } };
function Legacy() {
  const [sessionId, setSessionId] = useState<string>();
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const emptyMap = useMemo(() => new Map(), []);
  return (
    <ThemeProvider value={WebShellThemeId.Dark}>
      <BrandProvider value={{}}>
        <I18nProvider language="en">
          <WebShellPortalRootContext.Provider value={portalRoot}>
            <WebShellCustomizationProvider value={{}}>
              <TodoContextsProvider timeline={emptyMap} details={emptyMap}>
                <CompactModeContext.Provider value={false}>
                  <div ref={setPortalRoot} className={`${shellStyles.app} ${shellStyles.themeDark} dark`} style={{ height: '100vh' }} data-web-shell-root data-web-shell-shadcn lang="en">
                    <ManagedSessionsPage sessionId={sessionId} onSelectSession={setSessionId} managedAgentProvider={legacyProvider} />
                  </div>
                </CompactModeContext.Provider>
              </TodoContextsProvider>
            </WebShellCustomizationProvider>
          </WebShellPortalRootContext.Provider>
        </I18nProvider>
      </BrandProvider>
    </ThemeProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Legacy />);
