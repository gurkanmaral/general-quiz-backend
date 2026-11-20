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
