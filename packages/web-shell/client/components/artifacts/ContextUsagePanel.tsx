import { useEffect, useRef, useState } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import type {
  DaemonSessionActions,
  DaemonSessionContextUsageStatus,
} from '@qwen-code/web-shell/daemon-react-sdk';
import { useI18n } from '../../i18n';
import { isSessionDisconnectedError } from '../../utils/sessionErrors';
import { ContextUsageMessage } from '../messages/ContextUsageMessage';
import { Button } from '../ui/button';
import styles from './ContextUsagePanel.module.css';

export function ContextUsagePanel({
  sessionActions,
  sessionId,
}: {
  sessionActions?: DaemonSessionActions;
  sessionId: string;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<DaemonSessionContextUsageStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let pending = false;
    setStatus(null);
    setError(false);
    setLoading(Boolean(sessionActions));

    const refresh = async () => {
      if (!active || pending || !sessionActions) return;
      pending = true;
      setLoading(true);
      setError(false);
      try {
        const snapshot = await sessionActions.getContextUsage({ detail: true });
        if (!active) return;
        setStatus(
          snapshot.sessionId === sessionId &&
            snapshot.usage.contextWindowSize > 0
            ? snapshot
            : null,
        );
      } catch (err) {
        if (!active) return;
        setStatus(null);
        // Mirror TokenUsagePanel: a disconnected session is transient and its
        // error already surfaces through the action's notice channel.
        setError(!isSessionDisconnectedError(err));
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    refreshRef.current = () => void refresh();
    void refresh();
    return () => {
      active = false;
    };
  }, [sessionActions, sessionId]);

  return (
    <div className={styles.panel} aria-busy={loading}>
      <div className={styles.toolbar}>
        <span>{t('contextUsage.title')}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('contextUsage.refresh')}
          title={t('contextUsage.refresh')}
          disabled={!sessionActions || loading}
          onClick={() => refreshRef.current()}
        >
          <RefreshCwIcon aria-hidden="true" />
        </Button>
      </div>
      {error ? (
        <div className={styles.state} role="alert">
          <span>{t('contextUsage.loadError')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refreshRef.current()}
          >
            {t('contextUsage.retry')}
          </Button>
        </div>
      ) : !sessionActions ? (
        <div className={styles.state}>{t('contextUsage.unavailable')}</div>
      ) : loading ? (
        <div className={styles.state} role="status">
          {t('common.loading')}
        </div>
      ) : status ? (
        <ContextUsageMessage status={status} compact />
      ) : (
        <div className={styles.state}>{t('contextUsage.unavailable')}</div>
      )}
    </div>
  );
}
