// Email from the service: the links that confirm an address and that choose a new password.
//
// Sent through Resend's API (MAIL_API_KEY, and MAIL_FROM, an address on a domain verified with
// Resend: "App Dance <hej@example.se>"). Without them nothing is sent. On a development machine the
// mail is then written to the log instead, link and all, so that the flows can be tried; in
// production it is not, since the links let whoever holds them into an account.
import { config } from './config';

export function mailEnabled(): boolean {
  return Boolean(config.mailApiKey && config.mailFrom);
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Sends the mail. False when it could not be sent, which is logged without the mail's contents. */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (!mailEnabled()) {
    if (config.production) console.warn('[mail] not sent: MAIL_API_KEY and MAIL_FROM are not set');
    else console.log(`[mail] (not sent, no MAIL_API_KEY) to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.mailApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.mailFrom, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[mail] not sent: the mail service answered ${res.status} ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[mail] not sent: ${(err as Error).message}`);
    return false;
  }
}
