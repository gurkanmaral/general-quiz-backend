import type { Logger } from '../../logger';

export type Mail = {
  kind: 'verifyEmail';
  to: string;
  subject: string;
  text: string;
  /** The action link inside the mail (e.g. the email confirmation link). */
  url: string;
};

/** Outgoing email. The production provider is chosen at deploy (spine: Deferred). */
export type Mailer = {
  send(mail: Mail): Promise<void>;
};

export type DevMailer = Mailer & {
  /** The most recent mail, for tests and local debugging. */
  readonly lastMail: Mail | undefined;
  readonly sent: readonly Mail[];
};

/**
 * Development mailer: logs the action link (never the address) and keeps sent mail in memory.
 * Lets a developer confirm an account locally by opening the logged link.
 */
export function createDevMailer(logger?: Logger): DevMailer {
  const sent: Mail[] = [];
  return {
    async send(mail) {
      sent.push(mail);
      if (sent.length > 50) sent.shift();
      logger?.info({ kind: mail.kind, link: mail.url }, 'dev mailer: open this link to continue');
    },
    get lastMail() {
      return sent.at(-1);
    },
    get sent() {
      return sent;
    },
  };
}

export type ResendConfig = {
  apiKey: string;
  /** Sender, e.g. `KNO. <hello@kno.example>`; the domain must be verified at Resend. */
  from: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
};

/** Production mailer: Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export function createResendMailer({ apiKey, from, fetch: doFetch = fetch }: ResendConfig, logger?: Logger): Mailer {
  return {
    async send(mail) {
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // Never log the address or the link; the status and Resend's error name are enough.
        const detail = await res.text().catch(() => '');
        logger?.error({ kind: mail.kind, status: res.status, detail: detail.slice(0, 200) }, 'mail could not be sent');
        throw new Error(`Resend answered ${res.status}`);
      }
    },
  };
}

/** Resend when RESEND_API_KEY is set; otherwise the dev mailer that logs links. */
export function createMailer(env: { RESEND_API_KEY?: string; MAIL_FROM: string }, logger?: Logger): Mailer {
  return env.RESEND_API_KEY ? createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM }, logger) : createDevMailer(logger);
}
