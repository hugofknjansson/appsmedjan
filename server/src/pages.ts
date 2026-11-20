// The public support page and privacy policy of an app, for people who have no website of their own
// to put them on. Plain HTML built here: every word on them comes from the app's owner, and all of
// it is escaped.
import { contactComplete, copyrightLine, listingProblems, type StorePages } from '../../shared/protocol';
import * as db from './db';

const TEXTS = {
  sv: {
    support: 'Support',
    privacy: 'Integritetspolicy',
    supportIntro: 'Har du frågor om appen, eller har något gått fel? Hör av dig, så hjälper vi dig.',
    contact: 'Kontakt',
    responsible: 'Ansvarig för appen',
    updated: 'Senast uppdaterad',
    otherSupport: 'Support',
    otherPrivacy: 'Integritetspolicy',
  },
  en: {
    support: 'Support',
    privacy: 'Privacy Policy',
    supportIntro: 'Do you have questions about the app, or has something gone wrong? Get in touch and we will help you.',
    contact: 'Contact',
    responsible: 'Responsible for the app',
    updated: 'Last updated',
    otherSupport: 'Support',
    otherPrivacy: 'Privacy policy',
  },
} satisfies Record<StorePages['lang'], Record<string, string>>;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Paragraphs are separated by blank lines; a line break inside one is kept. */
function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** The page as HTML, or null when the project's owner has not turned the pages on (or not finished them). */
export function renderPage(project: db.Project, page: 'support' | 'privacy'): string | null {
  const { pages, savedAt } = db.getPages(project.id);
  if (!pages.hosted) return null;
  const listing = db.getListing(project.id);
  // An unfinished page is not shown at all, rather than half of one.
  if (listingProblems(listing, 1, pages).some((p) => p === 'page_email' || p === 'page_policy')) return null;

  const t = TEXTS[pages.lang];
  const appName = listing.name.trim() || project.name;
  const contact = db.getReviewContact(project.userId);
  // "2026 Name" without the year: who stands behind the app, when they have said so.
  const owner = contactComplete(contact) ? copyrightLine(contact, 0).replace(/^0 /, '') : '';
  const email = escapeHtml(pages.supportEmail);
  const title = page === 'support' ? t.support : t.privacy;
  const other =
    page === 'support'
      ? `<a href="privacy">${escapeHtml(t.otherPrivacy)}</a>`
      : `<a href="support">${escapeHtml(t.otherSupport)}</a>`;
  const body =
    page === 'support'
      ? `<p>${escapeHtml(t.supportIntro)}</p>`
      : `${paragraphs(pages.privacyText)}\n<p class="fine">${escapeHtml(t.updated)}: ${new Date(savedAt).toISOString().slice(0, 10)}</p>`;

  return `<!doctype html>
<html lang="${pages.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(appName)}: ${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 17px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 48px 20px 64px; }
  h1 { font-size: 1.7rem; line-height: 1.2; margin: 0 0 4px; }
  h2 { font-size: 1.1rem; margin: 32px 0 8px; }
  .app { margin: 0 0 28px; opacity: 0.7; }
  .fine { font-size: 0.9rem; opacity: 0.7; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid rgb(128 128 128 / 35%); font-size: 0.9rem; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="app">${escapeHtml(appName)}</p>
${body}
<h2>${escapeHtml(t.contact)}</h2>
<p><a href="mailto:${email}">${email}</a></p>
${owner ? `<p class="fine">${escapeHtml(t.responsible)}: ${escapeHtml(owner)}</p>` : ''}
<footer>${other}</footer>
</main>
</body>
</html>
`;
}
