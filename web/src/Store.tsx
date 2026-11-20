// The app's App Store page: texts, screenshots and icon are prepared here and sent to App Store Connect.
// Submitting for review is its own step with its own button, and a question before it happens.
import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CHOICES,
  EMPTY_CONTACT,
  EMPTY_LISTING,
  STORE_CATEGORIES,
  STORE_LIMITS,
  STORE_SHOT,
  contactComplete,
  listingProblems,
  type ReviewContact,
  type StoreChoices,
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
  const [choices, setChoices] = useState<StoreChoices>(DEFAULT_CHOICES);
  const [contact, setContact] = useState<ReviewContact>(EMPTY_CONTACT);
  /** What the latest suggestion found that would raise the age rating; null before any suggestion. */
  const [ageNotes, setAgeNotes] = useState<string[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'' | 'draft' | 'save' | 'capture' | 'icon' | 'send' | 'submit'>('');
  const [error, setError] = useState('');
  const [iconVersion, setIconVersion] = useState(0);

  useEffect(() => {
    dialog.current?.showModal();
    api
      .store(id)
      .then((s) => {
        setStore(s);
        setForm(s.listing);
        setChoices(s.choices);
        setContact(s.contact);
      })
      .catch((err) => setError(errorText(err)));
  }, [id]);

  // While the page is on its way to Apple, ask how it is going.
  const syncing = store?.sync.status === 'working';
  const submitting = store?.submit.status === 'working';
  useEffect(() => {
    if (!syncing && !submitting) return;
    const timer = setInterval(() => {
      api.store(id).then(setStore).catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [id, syncing, submitting]);

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

  function choose(key: keyof StoreChoices, value: boolean) {
    setChoices((c) => ({ ...c, [key]: value }));
    setDirty(true);
  }

  function changeContact(key: keyof ReviewContact, value: string) {
    setContact((c) => ({ ...c, [key]: value }));
    setDirty(true);
  }

  async function save(): Promise<boolean> {
    const ok = await act('save', () => api.saveListing(id, { listing: form, choices, contact }));
    if (ok) setDirty(false);
    return ok;
  }

  async function draft() {
    const written = form.name || form.subtitle || form.promo || form.description || form.keywords;
    if (written && !window.confirm(t.store.confirmDraft)) return;
    setBusy('draft');
    setError('');
    try {
      const { draft, ageRatingNotes } = await api.draftListing(id);
      setForm((f) => ({ ...f, ...draft }));
      setAgeNotes(ageRatingNotes);
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

  async function submit() {
    if (!window.confirm(t.store.confirmSubmit)) return;
    await act('submit', () => api.submitStore(id));
  }

  const problems = store ? listingProblems(form, store.screenshots.length) : [];
  const sync = store?.sync;
  const check = (key: keyof StoreChoices, label: string, help: string) => (
    <label className="check">
      <input type="checkbox" checked={choices[key]} onChange={(e) => choose(key, e.target.checked)} />
      <span>
        {label}
        <small>{help}</small>
      </span>
    </label>
  );
  const person = (key: keyof ReviewContact, label: string, type: 'text' | 'tel' | 'email', autoComplete: string, help?: string) => (
    <label>
      <span>{label}</span>
      <input type={type} autoComplete={autoComplete} value={contact[key]} onChange={(e) => changeContact(key, e.target.value)} />
      {help && <small>{help}</small>}
    </label>
  );

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
              <h3>{t.store.details}</h3>
              <p>{t.store.detailsHelp}</p>
              <div className="guide-form">
                {check('noMatureContent', t.store.noMature, t.store.noMatureHelp)}
                {ageNotes && ageNotes.length === 0 && <p className="muted fine">{t.store.ageNotesNone}</p>}
                {ageNotes && ageNotes.length > 0 && (
                  <div className="notice">
                    <p>{t.store.ageNotesSome}</p>
                    <ul className="plain-list">
                      {ageNotes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {check('noThirdPartyContent', t.store.noThirdParty, t.store.noThirdPartyHelp)}
                {check('free', t.store.free, t.store.freeHelp)}
                <h4>{t.store.contact}</h4>
                <p className="muted fine">{t.store.contactHelp}</p>
                {person('firstName', t.store.firstName, 'text', 'given-name')}
                {person('lastName', t.store.lastName, 'text', 'family-name')}
                {person('phone', t.store.phone, 'tel', 'tel', t.store.phoneHelp)}
                {person('email', t.store.email, 'email', 'email')}
                {person('holder', t.store.holder, 'text', 'organization', t.store.holderHelp)}
                <button className="btn" disabled={busy !== '' || !dirty} onClick={() => void save()}>
                  {dirty ? t.store.save : t.store.saved}
                </button>
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
              {!contactComplete(contact) && <p className="muted">{t.store.contactMissing}</p>}
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
              <h3>{t.store.review}</h3>
              <p>{t.store.reviewText}</p>
              <a className="link" href={CONNECT_URL} target="_blank" rel="noreferrer">
                {t.store.open}
              </a>
              {!store.canSubmit && store.submit.status !== 'done' && !submitting && (
                <p className="muted">
                  {sync?.status === 'done' && sync.attached === 'attached' ? t.store.reviewNeedsContact : t.store.reviewNeedsSync}
                </p>
              )}
              <button className="btn primary" disabled={busy !== '' || submitting || syncing || dirty || !store.canSubmit} onClick={() => void submit()}>
                {submitting ? `${t.store.submitting}…` : t.store.submit}
              </button>
              {store.submit.status === 'done' && (
                <p className="notice" role="status">
                  {t.store.submitted}
                </p>
              )}
              {store.submit.status === 'failed' && (
                <p className="form-error" role="alert">
                  {t.store.submitError[store.submit.error ?? 'internal']} {store.submit.error === 'rejected' ? store.submit.detail : ''}
                </p>
              )}
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
