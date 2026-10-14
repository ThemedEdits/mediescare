'use client';

import { useState } from 'react';
import { CLEAR_DATABASE_PHRASE } from '@mediescare/core/permissions';
import { api, Button, ErrorText, inputClass, Modal, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import { PasswordInput } from '@/components/password-input';

/**
 * Super Admin "Clear database". Asks twice: a warning to acknowledge, then the typed phrase and the
 * Super Admin's password (both re-checked by the server). A backup is taken first; setup opens after.
 */
export function ClearDatabase() {
  const t = useT();
  const errorText = useErrorText();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setStep(0);
    setPhrase('');
    setPassword('');
    setError(null);
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/settings/clear-database', { body: { phrase, password } });
      window.location.assign('/setup');
    } catch (e) {
      setError(errorText(e, 'settings.clearDb.failed'));
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-[10px] border border-danger p-4">
      <div>
        <h2 className="text-lg font-semibold text-danger">{t('settings.clearDb.title')}</h2>
        <p className="text-sm text-muted">{t('settings.clearDb.hint')}</p>
      </div>
      <Button variant="danger" onClick={() => setStep(1)}>
        {t('settings.clearDb.button')}
      </Button>

      {step === 1 ? (
        <Modal title={t('settings.clearDb.confirm1Title')} onClose={close}>
          <div className="space-y-3 text-sm">
            <p>{t('settings.clearDb.confirm1Body')}</p>
            <ul className="list-disc space-y-1 ps-5">
              <li>{t('settings.clearDb.point1')}</li>
              <li>{t('settings.clearDb.point2')}</li>
              <li>{t('settings.clearDb.point3')}</li>
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={() => setStep(2)}>
                {t('settings.clearDb.continue')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {step === 2 ? (
        <Modal title={t('settings.clearDb.confirm2Title')} onClose={close}>
          <form
            className="space-y-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void clear();
            }}
          >
            <label className="block">
              {t('settings.clearDb.typePhrase', { phrase: CLEAR_DATABASE_PHRASE })}
              <input
                className={inputClass}
                value={phrase}
                autoComplete="off"
                onChange={(e) => setPhrase(e.target.value)}
              />
            </label>
            <label className="block">
              {t('settings.clearDb.password')}
              <PasswordInput
                className={inputClass}
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <ErrorText message={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={busy || phrase.trim() !== CLEAR_DATABASE_PHRASE || password.length === 0}
              >
                {busy ? t('settings.clearDb.clearing') : t('settings.clearDb.confirm')}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
