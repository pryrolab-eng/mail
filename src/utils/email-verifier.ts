import dns from 'dns/promises';
import net from 'net';

export type EmailVerificationReason =
  | 'valid'
  | 'no_mx'
  | 'smtp_rejected'
  | 'disposable'
  | 'invalid_format';

export interface EmailVerificationResult {
  email: string;
  valid: boolean;
  reason: EmailVerificationReason;
}

export const DISPOSABLE_DOMAINS = [
  'mailinator.com',
  'tempmail.com',
  'guerrillamail.com',
  'throwaway.email',
  'yopmail.com',
  '10minutemail.com',
  'sharklasers.com',
  'guerrillamailblock.com',
  'grr.la',
  'guerrillamail.info',
  'spam4.me',
  'trashmail.com',
  'maildrop.cc',
  'dispostable.com',
  'mailnull.com',
  'spamgourmet.com',
  'spamgourmet.net',
  'spamgourmet.org',
  'spamhole.com',
  'spamify.com',
  'tempr.email',
  'discard.email',
  'spamthisplease.com',
  'fakeinbox.com',
  'mailscrap.com',
  'getnada.com',
  'mailnesia.com',
  'mintemail.com',
  'mytemp.email',
  'temp-mail.org',
  'emailondeck.com',
  'moakt.com',
  'inboxkitten.com',
  'mailcatch.com',
  'tempail.com',
  'fakemail.net',
  'trashmail.me',
  'mailpoof.com',
  'tempinbox.com',
  'mail.tm',
  'burnermail.io',
  'mailforspam.com',
  'spambox.us',
  'mailzilla.com',
  'jetable.org',
  'maildrop.cf',
  'getairmail.com',
  'mohmal.com',
  'emailfake.com',
  'crazymailing.com',
  'mailtemp.info',
  'dropmail.me',
  'mailinator.net',
  'mailinator.org',
];

const FORMAT_RE =
  /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)+$/;

function checkFormat(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  if (!FORMAT_RE.test(trimmed)) return false;
  const domain = trimmed.split('@')[1];
  if (!domain?.includes('.')) return false;
  const tld = domain.split('.').pop();
  return !!tld && tld.length >= 2;
}

function isDisposable(domain: string): boolean {
  const d = domain.toLowerCase();
  return DISPOSABLE_DOMAINS.some((x) => d === x || d.endsWith(`.${x}`));
}

async function hasMxRecords(domain: string): Promise<boolean> {
  try {
    const mx = await dns.resolveMx(domain);
    return mx.length > 0;
  } catch {
    try {
      const a = await dns.resolve4(domain);
      return a.length > 0;
    } catch {
      return false;
    }
  }
}

function smtpProbe(
  mxHost: string,
  email: string,
  timeoutMs: number
): Promise<'accepted' | 'rejected' | 'unknown'> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: 'accepted' | 'rejected' | 'unknown') => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const socket = net.createConnection(25, mxHost);
    let buffer = '';
    let stage = 0;

    const timer = setTimeout(() => {
      socket.destroy();
      done('unknown');
    }, timeoutMs);

    const send = (cmd: string) => {
      socket.write(`${cmd}\r\n`);
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const code = parseInt(line.slice(0, 3), 10);
        if (Number.isNaN(code)) continue;

        if (stage === 0 && code === 220) {
          send('EHLO pryro-mail.local');
          stage = 1;
        } else if (stage === 1 && (code === 250 || code === 220)) {
          if (line.toUpperCase().includes('EHLO') || code === 250) {
            send('MAIL FROM:<verify@pryro-mail.local>');
            stage = 2;
          }
        } else if (stage === 2 && code === 250) {
          send(`RCPT TO:<${email}>`);
          stage = 3;
        } else if (stage === 3) {
          clearTimeout(timer);
          socket.write('QUIT\r\n');
          socket.end();
          if (code === 250) done('accepted');
          else if (code === 550 || code === 551 || code === 553 || code === 552) {
            done('rejected');
          } else {
            done('unknown');
          }
          return;
        }
      }
    });

    socket.on('error', () => {
      clearTimeout(timer);
      done('unknown');
    });
  });
}

/**
 * Free verification: format, disposable filter, MX lookup, optional SMTP RCPT probe.
 */
export async function verifyEmail(email: string): Promise<EmailVerificationResult> {
  const normalized = email.trim().toLowerCase();

  if (!checkFormat(normalized)) {
    return { email: normalized, valid: false, reason: 'invalid_format' };
  }

  const domain = normalized.split('@')[1];
  if (isDisposable(domain)) {
    return { email: normalized, valid: false, reason: 'disposable' };
  }

  const mxOk = await hasMxRecords(domain);
  if (!mxOk) {
    return { email: normalized, valid: false, reason: 'no_mx' };
  }

  try {
    const mx = await dns.resolveMx(domain);
    const host = mx.sort((a, b) => a.priority - b.priority)[0]?.exchange;
    if (host) {
      const smtp = await smtpProbe(host, normalized, 5_000);
      if (smtp === 'rejected') {
        return { email: normalized, valid: false, reason: 'smtp_rejected' };
      }
    }
  } catch {
    /* SMTP probe is best-effort */
  }

  return { email: normalized, valid: true, reason: 'valid' };
}

export type BatchEmailVerificationResult = {
  email: string;
  isValid: boolean;
  isDeliverable: boolean;
  isCatchAll: boolean;
  isDisposable: boolean;
  score: number;
  reason?: string;
};

function verificationScore(result: EmailVerificationResult): number {
  if (result.valid) return 90;
  if (result.reason === 'smtp_rejected') return 55;
  if (result.reason === 'disposable') return 10;
  if (result.reason === 'no_mx') return 15;
  return 25;
}

/** Verify many addresses sequentially (used by Email Verification UI). */
export async function verifyEmailsBatch(
  emails: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<BatchEmailVerificationResult[]> {
  const out: BatchEmailVerificationResult[] = [];
  const total = emails.length;

  for (let i = 0; i < emails.length; i++) {
    const raw = emails[i]?.trim();
    if (!raw) {
      out.push({
        email: raw ?? '',
        isValid: false,
        isDeliverable: false,
        isCatchAll: false,
        isDisposable: false,
        score: 0,
        reason: 'invalid_format',
      });
      onProgress?.(i + 1, total);
      continue;
    }

    const result = await verifyEmail(raw);
    out.push({
      email: result.email,
      isValid: result.valid,
      isDeliverable: result.valid || result.reason === 'smtp_rejected',
      isCatchAll: result.reason === 'smtp_rejected',
      isDisposable: result.reason === 'disposable',
      score: verificationScore(result),
      reason: result.reason,
    });
    onProgress?.(i + 1, total);
  }

  return out;
}
