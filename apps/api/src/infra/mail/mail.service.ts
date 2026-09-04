import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { AppConfig } from '../../config/configuration';

export interface MailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/**
 * Outbound email.
 *
 * Three drivers behind one `send()`:
 *
 *   log    — writes the message to the application log. The default, so a
 *            deployment sends nothing until somebody opts in.
 *   brevo  — Brevo's HTTP API. Takes the `xkeysib-…` key from the API Keys page.
 *   smtp   — any SMTP relay, including Brevo's own.
 *
 * `brevo` and `smtp` are separate on purpose rather than one "Brevo" option:
 * Brevo's SMTP relay does NOT accept a v3 API key. It wants the distinct login
 * and SMTP key from the SMTP tab, which is a different credential pair that
 * people routinely confuse. Splitting the drivers means whichever credential you
 * hold, exactly one setting matches it.
 *
 * The HTTP driver is also the better choice on most container hosts, which block
 * outbound 587/465 — an SMTP send there fails by hanging until it times out,
 * which looks like a hung digest job rather than a configuration problem.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private get settings() {
    return this.config.get('mail', { infer: true });
  }

  onModuleInit(): void {
    switch (this.settings.driver) {
      case 'log':
        this.logger.warn('MAIL_DRIVER=log — messages will be written to the log, not sent.');
        return;

      case 'brevo':
        this.logger.log(`Sending mail through the Brevo API as ${this.settings.from}`);
        return;

      case 'smtp':
        this.transporter = nodemailer.createTransport({
          host: this.settings.host,
          port: this.settings.port,
          secure: this.settings.secure,
          ...(this.settings.user
            ? { auth: { user: this.settings.user, pass: this.settings.password } }
            : {}),
        });
        return;
    }
  }

  /**
   * Send a message.
   *
   * Returns a boolean rather than throwing: mail is a side channel, and a digest
   * job must be able to carry on through one bad address rather than aborting the
   * run for everyone else.
   */
  async send(message: MailMessage): Promise<boolean> {
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    const joined = recipients.join(', ');

    if (this.settings.driver === 'log') {
      /**
       * Subject and recipients only — never the body.
       *
       * Invitation and password-reset messages carry a temporary password in
       * plaintext, and this driver is the default. Logging the body would put
       * working credentials into whatever ingests stdout, with that service's
       * retention and its audience rather than this application's. The
       * administrator who triggered the action already gets the password back
       * in the API response, so nothing is lost by withholding it here.
       */
      this.logger.log(`[mail:log] To: ${joined} — ${message.subject} (body withheld)`);
      return true;
    }

    const started = Date.now();
    try {
      this.logger.debug(`Sending "${message.subject}" to ${recipients.length} recipient(s)`);

      if (this.settings.driver === 'brevo') {
        await this.sendViaBrevo(recipients, message);
      } else {
        await this.transporter?.sendMail({
          from: this.settings.from,
          to: joined,
          subject: message.subject,
          html: message.html,
          text: message.text ?? stripHtml(message.html),
        });
      }

      // The success, not only the failure. A digest nobody received is usually
      // reported as "the email never arrived", and this line is what separates
      // "we never sent it" from "we sent it and the relay dropped it".
      this.logger.log({
        message: `Sent "${message.subject}" to ${joined}`,
        driver: this.settings.driver,
        recipients: recipients.length,
        durationMs: Date.now() - started,
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send "${message.subject}" to ${joined}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * POST to Brevo's transactional endpoint.
   *
   * Plain fetch rather than the `@getbrevo/brevo` SDK — this is one POST with
   * three fields, and the SDK pulls in a generated API client an order of
   * magnitude larger than the code it replaces.
   */
  private async sendViaBrevo(recipients: string[], message: MailMessage): Promise<void> {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': this.settings.brevoApiKey ?? '',
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: this.settings.from, name: this.settings.fromName },
        to: recipients.map((email) => ({ email })),
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text ?? stripHtml(message.html),
      }),
    });

    if (!response.ok) {
      // Brevo answers with {code, message}; the body is the only place that
      // distinguishes an unverified sender from a bad key, and both are common
      // enough on first setup that swallowing it would waste an afternoon.
      const body = await response.text();
      throw new Error(`Brevo responded ${response.status}: ${body.slice(0, 300)}`);
    }
  }

  /** Checks the configured transport — surfaced through the health endpoint. */
  async verify(): Promise<boolean> {
    if (this.settings.driver === 'log') return true;

    if (this.settings.driver === 'brevo') {
      // A cheap authenticated GET. It proves the key is accepted without
      // sending anything, which a transactional POST cannot do.
      try {
        const response = await fetch('https://api.brevo.com/v3/account', {
          headers: { 'api-key': this.settings.brevoApiKey ?? '', accept: 'application/json' },
          // Bounded, because this runs behind a health probe. `fetch` has no
          // default timeout, so a Brevo outage that hangs the socket rather than
          // refusing it would hold the probe open until the platform gave up and
          // restarted a container that was working perfectly well.
          signal: AbortSignal.timeout(4_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    }

    if (!this.transporter) return true;
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
