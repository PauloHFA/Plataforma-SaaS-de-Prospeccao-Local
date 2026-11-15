import dns from 'node:dns/promises';
import nodemailer from 'nodemailer';
import { generateSecureToken } from '@plataforma/shared/crypto';

export interface EmailDnsVerification {
  domain: string;
  spfVerified: boolean;
  dkimVerified: boolean;
  spfRecord: string | null;
  dkimRecord: string | null;
  instructions: {
    spfHost: string;
    spfValue: string;
    dkimHost: string;
    dkimValue: string;
  };
}

export async function verifyEmailSenderDns(
  senderEmail: string,
  dkimSelector = 'plataforma',
): Promise<EmailDnsVerification> {
  const domain = (senderEmail.split('@')[1] || '').toLowerCase().trim();
  const instructions = {
    spfHost: '@',
    spfValue: `v=spf1 include:_spf.${domain || 'plataforma.com.br'} ~all`,
    dkimHost: `${dkimSelector}._domainkey`,
    dkimValue: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...',
  };

  if (!domain || domain.endsWith('.local') || domain.endsWith('.localhost')) {
    return {
      domain,
      spfVerified: false,
      dkimVerified: false,
      spfRecord: null,
      dkimRecord: null,
      instructions,
    };
  }

  let spfRecord: string | null = null;
  let dkimRecord: string | null = null;

  try {
    const txtRecords = await dns.resolveTxt(domain);
    const flattened = txtRecords.map((chunks) => chunks.join(''));
    spfRecord = flattened.find((r) => r.toLowerCase().includes('v=spf1')) ?? null;
  } catch {
    spfRecord = null;
  }

  try {
    const dkimTxt = await dns.resolveTxt(`${dkimSelector}._domainkey.${domain}`);
    const flattened = dkimTxt.map((chunks) => chunks.join(''));
    dkimRecord = flattened.find((r) => r.toLowerCase().includes('v=dkim1')) ?? null;
  } catch {
    dkimRecord = null;
  }

  return {
    domain,
    spfVerified: Boolean(spfRecord),
    dkimVerified: Boolean(dkimRecord),
    spfRecord,
    dkimRecord,
    instructions,
  };
}

export async function sendEmailMessage(params: {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  smtpConfig?: {
    host: string;
    port: number;
    user: string;
    pass: string;
  };
}): Promise<{ externalMessageId: string; provider: 'smtp' | 'sandbox' }> {
  const host = params.smtpConfig?.host || process.env.SMTP_HOST;
  const user = params.smtpConfig?.user || process.env.SMTP_USER;
  const pass = params.smtpConfig?.pass || process.env.SMTP_PASS;

  if (host && user && pass) {
    const transporter = nodemailer.createTransport({
      host,
      port: params.smtpConfig?.port || Number(process.env.SMTP_PORT || 587),
      secure: (params.smtpConfig?.port || Number(process.env.SMTP_PORT || 587)) === 465,
      auth: { user, pass },
    });

    const info = await transporter.sendMail({
      from: params.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html || `<p>${params.text.replace(/\n/g, '<br/>')}</p>`,
    });

    return {
      externalMessageId: info.messageId || `smtp_${generateSecureToken(8)}`,
      provider: 'smtp',
    };
  }

  return {
    externalMessageId: `email_sbx_${generateSecureToken(10)}`,
    provider: 'sandbox',
  };
}
