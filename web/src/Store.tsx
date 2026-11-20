// The app's App Store page: texts, screenshots and icon are prepared here and sent to App Store Connect.
// Submitting for review stays with the person, in App Store Connect.
import { useEffect, useRef, useState } from 'react';
import {
  EMPTY_LISTING,
  STORE_CATEGORIES,
  STORE_LIMITS,
  STORE_SHOT,
  listingProblems,
  type StoreListing,
  type StoreState,
} from '../../shared/protocol';
import { ApiError, api } from './api';
import { apiErrorText, t } from './i18n';

const CONNECT_URL = 'https://appstoreconnect.apple.com/apps';

const errorText = (err: unknown) => apiErrorText(err instanceof ApiError ? err.code : 'internal');

/** Apple counts characters the way people do, not UTF-16 units. */
const count = (s: string) => [...s].length;

export function StoreDialog({ id, onClose, onConnect }: { id: string; onClose: () => void; onConnect: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [store, setStore] = useState<StoreState | null>(null);
  const [form, setForm] = useState<StoreListing>(EMPTY_LISTING);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'' | 'draft' | 'save' | 'capture' | 'icon' | 'send'>('');
  const [error, setError] = useState('');
  const [iconVersion, setIconVersion] = useState(0);

  useEffect(() => {
    dialog.current?.showModal();
    api
      .store(id)
      .then((s) => {
        setStore(s);
        setForm(s.listing);
      })
      .catch((err) => setError(errorText(err)));
  }, [id]);

  // While the page is on its way to Apple, ask how it is going.
  const syncing = store?.sync.status === 'working';
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => {
      api.store(id).then(setStore).catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [id, syncing]);

  function change<K extends keyof StoreListing>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  /** Runs one action against the server; its answer is the page's new state. */
  async function act(kind: typeof busy, action: () => Promise<StoreState>): Promise<boolean> {
    setBusy(kind);
    setError('');
    try {
      setStore(await action());
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy('');
    }
  }

  async function save(): Promise<boolean> {
    const ok = await act('save', () => api.saveListing(id, form));
    if (ok) setDirty(false);
    return ok;
  }

  async function draft() {
    const written = form.name || form.subtitle || form.promo || form.description || form.keywords;
    if (written && !window.confirm(t.store.confirmDraft)) return;
    setBusy('draft');
    setError('');
    try {
      const { draft } = await api.draftListing(id);
      setForm((f) => ({ ...f, ...draft }));
      setDirty(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  }

  async function pickIcon(file: File | undefined) {
    if (!file) return;
    if (await act('icon', () => api.uploadIcon(id, file))) setIconVersion((v) => v + 1);
  }

  async function send() {
    if (dirty && !(await save())) return;
    await act('send', () => api.syncStore(id));
  }

  const problems = store ? listingProblems(form, store.screenshots.length) : [];
  const sync = store?.sync;

  const field = (key: 'name' | 'subtitle' | 'promo' | 'keywords', label: string, help?: string) => (
    <label>
      <span>
        {label} <Counter value={form[key]} max={STORE_LIMITS[key]} />
      </span>
      <input type="text" value={form[key]} spellCheck onChange={(e) => change(key, e.target.value)} />
      {help && <small>{help}</small>}
    </label>
  );
  const link = (key: 'supportUrl' | 'privacyUrl' | 'marketingUrl', label: string, help?: string) => (
    <label>
      <span>{label}</span>
      <input
        type="url"
        inputMode="url"
        placeholder="https://"
        spellCheck={false}
        autoComplete="off"
        value={form[key]}
        onChange={(e) => change(key, e.target.value)}
      />
      {help && <small>{help}</small>}
    </label>
  );

  return (
    <dialog ref={dialog} className="sheet wide" aria-labelledby="store-title" onClose={onClose}>
      <header className="sheet-head">
        <h2 id="store-title">{t.store.title}</h2>
        <button className="btn ghost" onClick={() => dialog.current?.close()}>
          {t.dismiss}
        </button>
      </header>

      <div className="sheet-body">
        <p className="muted">{t.store.intro}</p>
        {!store && !error && <span className="spinner" />}

        {store && (
          <ol className="guide">
            <li>
              <h3>{t.store.texts}</h3>
              <div className="guide-form">
                <div>
                  <button className="btn" disabled={busy !== ''} onClick={() => void draft()}>
                    {busy === 'draft' ? `${t.store.drafting}…` : t.store.draft}
                  </button>
                  <p className="muted fine">{t.store.draftHelp}</p>
                </div>
                {field('name', t.store.name)}
                {field('subtitle', t.store.subtitle)}
                {field('promo', t.store.promo, t.store.promoHelp)}
                <label>
                  <span>
                    {t.store.description} <Counter value={form.description} max={STORE_LIMITS.description} />
                  </span>
                  <textarea rows={9} value={form.description} onChange={(e) => change('description', e.target.value)} />
                </label>
                {field('keywords', t.store.keywords, t.store.keywordsHelp)}
                <label>
                  <span>{t.store.category}</span>
                  <select value={form.category} onChange={(e) => change('category', e.target.value)}>
                    <option value="">{t.store.chooseCategory}</option>
                    {STORE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t.store.categories[c]}
                      </option>
                    ))}
                  </select>
                </label>
                {link('supportUrl', t.store.supportUrl, t.store.supportUrlHelp)}
                {link('privacyUrl', t.store.privacyUrl, t.store.privacyUrlHelp)}
                {link('marketingUrl', t.store.marketingUrl)}
                <button className="btn" disabled={busy !== '' || !dirty} onClick={() => void save()}>
                  {dirty ? t.store.save : t.store.saved}
                </button>
              </div>
            </li>

            <li>
              <h3>{t.store.screenshots}</h3>
              <p>{t.store.screenshotsHelp.replace('{max}', String(STORE_SHOT.max))}</p>
              {store.screenshots.length === 0 ? (
                <p className="muted">{t.store.noShots}</p>
              ) : (
                <ul className="shots">
                  {store.screenshots.map((shot, i) => (
                    <li key={shot}>
                      <img src={`/api/projects/${id}/store/screenshots/${shot}`} alt="" loading="lazy" />
                      <button
                        className="btn ghost"
                        disabled={busy !== ''}
                        aria-label={t.store.removeShot.replace('{n}', String(i + 1))}
                        onClick={() => void act('capture', () => api.deleteScreenshot(id, shot))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button className="btn" disabled={busy !== '' || !store.canCapture} onClick={() => void act('capture', () => api.captureScreenshot(id))}>
                {t.store.capture}
              </button>
            </li>

            <li>
              <h3>{t.store.icon}</h3>
              <p>{t.store.iconHelp}</p>
              <div className="icon-row">
                {store.hasIcon ? (
                  <img className="icon-preview" src={`/api/projects/${id}/store/icon?v=${iconVersion}`} alt="" />
                ) : (
                  <span className="icon-preview empty">{t.store.iconNone}</span>
                )}
                <label className="btn">
                  {t.store.iconChoose}
                  <input type="file" accept="image/png" hidden disabled={busy !== ''} onChange={(e) => void pickIcon(e.target.files?.[0])} />
                </label>
                {store.hasIcon && (
                  <button className="btn ghost" disabled={busy !== ''} onClick={() => void act('icon', () => api.deleteIcon(id))}>
                    {t.store.iconRemove}
                  </button>
                )}
              </div>
            </li>

            <li>
              <h3>{t.store.sendTitle}</h3>
              {store.account === 'none' ? (
                <p>
                  {t.store.accountNone}{' '}
                  <button className="link" onClick={onConnect}>
                    {t.apple.title}
                  </button>
                </p>
              ) : (
                <p>{store.account === 'own' ? t.store.accountOwn : t.store.accountOperator}</p>
              )}
              {store.account !== 'none' && !store.available && <p className="muted">{t.store.notAvailable}</p>}
              {store.account !== 'none' && !store.build && <p className="muted">{t.store.noBuild}</p>}
              {problems.length > 0 && (
                <div>
                  <p>{t.store.missing}</p>
                  <ul className="plain-list">
                    {problems.map((p) => (
                      <li key={p}>{t.store.problem[p]}</li>
                    ))}
                  </ul>
                </div>
              )}
              {dirty && problems.length === 0 && <p className="muted">{t.store.unsaved}</p>}
              <button
                className="btn primary"
                disabled={busy !== '' || syncing || problems.length > 0 || !store.available || store.account === 'none'}
                onClick={() => void send()}
              >
                {syncing ? `${t.store.stage[sync?.stage ?? 'queued']}…` : t.store.send}
              </button>

              {sync?.status === 'done' && (
                <div className="notice" role="status">
                  <p>{t.store.done}</p>
                  <p>{t.store.attached[sync.attached ?? 'none'].replace('{build}', store.build ?? '')}</p>
                </div>
              )}
              {sync?.status === 'failed' && (
                <p className="form-error" role="alert">
                  {t.store.error[sync.error ?? 'internal']} {sync.error === 'rejected' ? sync.detail : ''}
                </p>
              )}
            </li>

            <li>
              <h3>{t.store.left}</h3>
              <p>{t.store.leftText}</p>
              <ul className="plain-list">
                {t.store.leftItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <a className="link" href={CONNECT_URL} target="_blank" rel="noreferrer">
                {t.store.open}
              </a>
            </li>
          </ol>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const n = count(value);
  return (
    <span className="counter" data-over={n > max}>
      {n}/{max}
    </span>
  );
}
