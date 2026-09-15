import { useState } from 'react';
import { api } from './api';
import { PRODUCT_NAME, TAGLINE_PRIMARY } from './brand';
import { useI18n } from './i18n';

/**
 * First-run prompt: where should the application keep its files?
 *
 * Why this is a blocking screen rather than a settings field: the data directory holds the
 * profile database, the downloaded browser kernel, extensions and backups — potentially tens
 * of gigabytes. On an installed build it defaults under the user profile, which is often on a
 * small system drive, and an operator who discovers that after importing a hundred profiles
 * has to relocate everything. Asking once, before anything exists, is the only cheap moment.
 *
 * The choice is recorded through the backend (`POST /api/v1/data/first-run`) rather than in
 * `localStorage`, because `DATA_DIR` is resolved by the backend process at startup — a
 * renderer-side preference would never reach it. The backend also owns the writability check,
 * so an unusable folder is refused while choosing instead of surfacing later as an opaque
 * database error.
 *
 * Applied by restarting: `DATA_DIR` is resolved once at import time, so the new location only
 * takes effect on the next start.
 */

interface Props {
  /** The folder the app will use if the operator accepts the default. */
  defaultDir: string;
  /** Called after the choice is persisted; the caller restarts the app. */
  onDone: (dir: string) => void;
}

export function FirstRunDataDir({ defaultDir, onDone }: Props): React.ReactElement {
  const { t } = useI18n();
  const [chosen, setChosen] = useState<string>(defaultDir);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Ask the backend whether a folder can hold the data, and say so before it is committed.
   * Uses the same code path the final choice runs, so a folder that passes here cannot be
   * rejected later.
   */
  const validate = async (dir: string): Promise<boolean> => {
    setChecking(true);
    setError(null);
    try {
      const res = await api.checkFirstRunData(dir);
      if (res.data?.ok) return true;
      setError(res.data?.error ?? t('That folder cannot be used.'));
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not check that folder.'));
      return false;
    } finally {
      setChecking(false);
    }
  };

  /** Open the OS folder picker through the shell bridge; absent in a plain browser. */
  const browse = async (): Promise<void> => {
    const picked = await window.antidetect?.data?.prepareDir?.();
    if (!picked?.ok || !picked.dir) return;
    setChosen(picked.dir);
    await validate(picked.dir);
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (!(await validate(chosen))) return;
      const res = await api.setFirstRunData(chosen);
      if (res.code !== 0) {
        setError(res.data?.error ?? t('Could not save that folder.'));
        return;
      }
      onDone(res.data?.dir ?? chosen);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save that folder.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: 'var(--space-5)',
        background: 'var(--bg-app)',
        color: 'var(--text)',
      }}
    >
      <div style={{ maxWidth: 560, width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)' }}>
            {t('Where should {product} keep its files?').replace('{product}', PRODUCT_NAME)}
          </h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-md)' }}>
            {t('Profiles, the browser kernel, extensions and backups go here. This can be tens of gigabytes, so pick a drive with room. You can change it later in Settings.')}
          </p>
        </header>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            type="text"
            data-testid="first-run-dir"
            value={chosen}
            spellCheck={false}
            onChange={(e) => setChosen(e.target.value)}
            onBlur={() => void validate(chosen)}
            style={{
              flex: 1,
              minWidth: 0,
              height: 'var(--control-h)',
              padding: '0 var(--space-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
            }}
          />
          <button type="button" className="btn" data-testid="first-run-browse" onClick={() => void browse()} disabled={busy || checking}>
            {t('Browse…')}
          </button>
        </div>

        {checking ? (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{t('Checking…')}</p>
        ) : null}
        {error ? (
          <p style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--text-sm)' }} role="alert" data-testid="first-run-error">
            {error}
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {/*
            Disabled only while saving, never while the background check runs. Clicking the
            button blurs the input, which starts that check — so gating on `checking` disabled
            the button at the moment of the click and the click was swallowed, silently
            requiring a second press. `confirm` re-validates itself, and `busy` covers the
            real double-submit case.
          */}
          <button
            type="button"
            className="btn btn-primary"
            data-testid="first-run-confirm"
            onClick={() => void confirm()}
            disabled={busy || chosen.trim().length === 0}
          >
            {busy ? t('Saving…') : t('Use this folder')}
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{TAGLINE_PRIMARY}</span>
        </div>

        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
          {t('The application restarts once to apply the location.')}
        </p>
      </div>
    </div>
  );
}
