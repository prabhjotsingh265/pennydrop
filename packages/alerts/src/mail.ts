/** Where emails go out: Resend in production, Mailpit locally. */
export interface MailSettings {
  from: string;
  mailpitUrl?: string;
  resendKey?: string;
}

export interface Email {
  to: string;
  subject: string;
  text: string;
  /** Sent beside the text, for mail apps that show it. */
  html?: string;
}

export type Mailer = (email: Email) => Promise<void>;

/** "Pennydrop <hello@x>" as a name and an address. */
function parseAddress(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match ? { name: match[1] || undefined, email: match[2]! } : { email: from.trim() };
}

/**
 * Resend in production, Mailpit locally (it catches everything, nothing real
 * is sent), and the console when neither is set up. Both speak plain HTTP, so
 * no mail library is needed.
 */
export function createMailer(mail: MailSettings): Mailer {
  if (mail.resendKey) {
    return async ({ to, subject, text, html }) => {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${mail.resendKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: mail.from, to: [to], subject, text, html }),
      });
      if (!response.ok) throw new Error(`Resend refused the email (${response.status}).`);
    };
  }
  if (mail.mailpitUrl) {
    const from = parseAddress(mail.from);
    return async ({ to, subject, text, html }) => {
      const response = await fetch(`${mail.mailpitUrl}/api/v1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: { Email: from.email, Name: from.name },
          To: [{ Email: to }],
          Subject: subject,
          Text: text,
          HTML: html,
        }),
      });
      if (!response.ok) throw new Error(`Mailpit refused the email (${response.status}).`);
    };
  }
  return async ({ to, subject, text }) => {
    console.log(`Email to ${to}: ${subject}\n${text}`);
  };
}
