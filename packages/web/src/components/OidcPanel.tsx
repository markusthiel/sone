/**
 * SONE web — configuring the identity provider.
 *
 * Everything except the secret, which comes from the environment and is never
 * sent in either direction (ADR-0024). The form reports whether one is present,
 * because that is what an administrator needs to understand why single sign-on
 * is off — not the credential itself.
 */

import { useT } from '../i18n/useT.tsx';
import { Fragment, useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { ApiError, api } from '../api/client.ts';
import { messageFor } from './Auth.tsx';

/**
 * A translated sentence with one word of it set in code (ADR-0148).
 *
 * The three sentences here name an environment variable and a path, and both
 * were written as three JSX children — text, `<code>`, text — which is a
 * sentence assembled from pieces and cannot be translated: word order differs
 * by language and a translator cannot move a `<code>` element (ADR-0011).
 *
 * So the sentence is one message, the identifier appears inside it, and this
 * finds it again to set it apart. A translator may put it anywhere in the
 * sentence; if a translation drops it, the sentence is simply shown as it was
 * written rather than losing a word.
 */
function withCode(sentence: string, word: string): ReactNode {
  const parts = sentence.split(word);
  if (parts.length === 1) return sentence;
  return parts.map((part, at) => (
    <Fragment key={at}>
      {at > 0 && <code>{word}</code>}
      {part}
    </Fragment>
  ));
}

interface Settings {
  issuer: string;
  clientId: string;
  buttonLabel: string;
  allowSignup: boolean;
  enabled: boolean;
}

const EMPTY: Settings = {
  issuer: '',
  clientId: '',
  buttonLabel: 'Single sign-on',
  allowSignup: false,
  enabled: false,
};

export function OidcPanel(): ReactElement {
  const { t } = useT();
  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [hasSecret, setHasSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .adminOidc()
      .then((result) => {
        if (cancelled) return;
        setSettings(result.settings ?? EMPTY);
        setHasSecret(result.hasClientSecret);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = (): void => {
    setBusy(true);
    setError(null);
    void api
      .setAdminOidc(settings)
      .then(() => setSaved(true))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'))
      .finally(() => setBusy(false));
  };

  const change = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    setSaved(false);
    setSettings((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="settings-section">
      <p className="muted">
        {t('oidc.note')}
      </p>

      {/* The secret's absence is the first thing to say.
        *
        * Everything below can be filled in correctly and still not work without
        * it, and somebody who does not know that will reasonably conclude the
        * form is broken. */}
      {!hasSecret && (
        <p className="warning">
          {withCode(t('oidc.noSecret'), 'SONE_OIDC_CLIENT_SECRET')}
        </p>
      )}

      {error && <p className="error">{messageFor(error)}</p>}

      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('oidc.issuer')}</b>
            <span>{t('oidc.issuer.hint')}</span>
          </span>
          <input
            id="oidc-issuer"
            aria-label={t('oidc.issuer')}
            value={settings.issuer}
            placeholder={t('oidc.issuerPlaceholder')}
            onChange={(event) => change('issuer', event.target.value)}
          />
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('oidc.clientId')}</b>
            <span>{t('oidc.asRegistered')}</span>
          </span>
          <input
            id="oidc-client"
            aria-label={t('oidc.clientId')}
            value={settings.clientId}
            onChange={(event) => change('clientId', event.target.value)}
          />
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('oidc.buttonLabel')}</b>
            <span>
              {t('oidc.buttonLabel.hint')}
            </span>
          </span>
          <input
            id="oidc-label"
            aria-label={t('oidc.buttonLabel')}
            value={settings.buttonLabel}
            onChange={(event) => change('buttonLabel', event.target.value)}
          />
        </div>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.allowSignup}
          onChange={(event) => change('allowSignup', event.target.checked)}
        />
        {t('oidc.allowSignup')}
      </label>
      <p className="muted">
        {t('oidc.allowSignup.hint')}
      </p>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={!hasSecret}
          onChange={(event) => change('enabled', event.target.checked)}
        />
        {t('oidc.showButton')}
      </label>

      <p className="muted">{withCode(t('oidc.callback'), '/api/auth/oidc/callback')}</p>

      <div className="settings-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={save}>
          {busy ? t('action.saving') : t('action.save')}
        </button>
        {saved && <span className="muted">{t('action.saved')}</span>}
      </div>
    </section>
  );
}
