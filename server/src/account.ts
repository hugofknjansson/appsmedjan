// The account's basics: confirming the email address, choosing a new password from a link in a
// mail, and deleting the account with everything in it.
import { config } from './config';
import * as db from './db';
import { mailEnabled, sendMail } from './mail';
import { isOperator } from './routing';

const VERIFY_MS = 7 * 24 * 3600_000;
const RESET_MS = 3600_000;
/** A new mail of the same kind to the same person is not sent sooner than this after the last one. */
const AGAIN_AFTER_MS = 60_000;

export type Lang = 'sv' | 'en';

const TEXTS = {
  sv: {
    verifySubject: 'Bekräfta din e-post för App Dance',
    verifyBody: (link: string) =>
      `Hej!\n\nTryck på länken för att bekräfta att det här är din e-postadress:\n\n${link}\n\nLänken gäller i sju dagar. Har du inte skapat något konto hos App Dance kan du strunta i det här mejlet.\n`,
    resetSubject: 'Välj ett nytt lösenord för App Dance',
    resetBody: (link: string) =>
      `Hej!\n\nNågon, förhoppningsvis du, bad om ett nytt lösenord till ditt konto hos App Dance. Tryck på länken för att välja ett:\n\n${link}\n\nLänken gäller i en timme och fungerar en gång. Bad du inte om det kan du strunta i det här mejlet; ditt lösenord är detsamma som förut.\n`,
  },
  en: {
    verifySubject: 'Confirm your email for App Dance',
    verifyBody: (link: string) =>
      `Hi!\n\nTap the link to confirm that this is your email address:\n\n${link}\n\nThe link works for seven days. If you have not made an account with App Dance, you can ignore this mail.\n`,
    resetSubject: 'Choose a new password for App Dance',
    resetBody: (link: string) =>
      `Hi!\n\nSomeone, hopefully you, asked for a new password for your App Dance account. Tap the link to choose one:\n\n${link}\n\nThe link works for an hour, and once. If you did not ask for it, you can ignore this mail; your password is the same as before.\n`,
  },
} satisfies Record<Lang, Record<string, unknown>>;

/** Whether the person must confirm their address before building: only where the operator asks for it, and mail can be sent. */
export function needsConfirming(user: db.User): boolean {
  return config.requireVerifiedEmail && mailEnabled() && !isOperator(user.email) && !db.emailVerified(user.id);
}

export type VerifyMailResult = 'sent' | 'already' | 'too_soon' | 'not_sent';

/** Mails the person a link that confirms their address. `base` is the address people reach the service at. */
export async function sendVerification(user: db.User, base: string, lang: Lang): Promise<VerifyMailResult> {
  if (db.emailVerified(user.id)) return 'already';
  const last = db.lastEmailTokenAt(user.id, 'verify');
  if (last !== null && Date.now() - last < AGAIN_AFTER_MS) return 'too_soon';
  const token = db.createEmailToken(user.id, 'verify', VERIFY_MS);
  const t = TEXTS[lang];
  const sent = await sendMail({ to: user.email, subject: t.verifySubject, text: t.verifyBody(`${base}/api/auth/verify/${token}`) });
  return sent ? 'sent' : 'not_sent';
}

/** The link in the confirming mail was opened. The person it was for, or null when the link is not (or no longer) good. */
export function verify(token: string): db.User | null {
  const userId = db.useEmailToken(token, 'verify');
  if (!userId) return null;
  db.setEmailVerified(userId);
  return db.getUser(userId);
}

/**
 * Mails a link for choosing a new password, if there is an account with the address. Says nothing
 * either way to the one who asked, so that nobody can find out which addresses have accounts.
 */
export async function sendReset(email: string, base: string, lang: Lang): Promise<void> {
  const user = db.userByEmail(email);
  if (!user) return;
  const last = db.lastEmailTokenAt(user.id, 'reset');
  if (last !== null && Date.now() - last < AGAIN_AFTER_MS) return;
  const token = db.createEmailToken(user.id, 'reset', RESET_MS);
  const t = TEXTS[lang];
  await sendMail({ to: user.email, subject: t.resetSubject, text: t.resetBody(`${base}/reset/${token}`) });
}

/**
 * Sets the new password from the link in the mail. Everywhere the person was signed in is signed out,
 * and the address counts as confirmed: the mail reached it. Null when the link is not (or no longer) good.
 */
export function resetPassword(token: string, password: string): db.User | null {
  const userId = db.useEmailToken(token, 'reset');
  if (!userId) return null;
  db.setPassword(userId, password);
  db.deleteSessionsOf(userId);
  db.setEmailVerified(userId);
  console.log(`[account] user ${userId} chose a new password`);
  return db.getUser(userId);
}
