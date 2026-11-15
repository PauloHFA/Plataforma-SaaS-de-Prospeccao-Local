import { parsePhoneNumberFromString } from 'libphonenumber-js';

export type PhoneLineType = 'MOBILE' | 'LANDLINE' | 'UNKNOWN';

export interface NormalizedPhoneResult {
  raw: string;
  e164: string | null;
  nationalFormatted: string;
  type: PhoneLineType;
  isValid: boolean;
  canHaveWhatsApp: boolean;
}

/**
 * RN-03: Normaliza números para o padrão internacional E.164 (+55 + DDD + número)
 * e distingue linhas móveis (aptas a WhatsApp) de linhas fixas.
 */
export function normalizeBrazilianPhone(raw: string): NormalizedPhoneResult {
  const cleaned = raw.trim();
  if (!cleaned) {
    return {
      raw,
      e164: null,
      nationalFormatted: '',
      type: 'UNKNOWN',
      isValid: false,
      canHaveWhatsApp: false,
    };
  }

  const digits = cleaned.replace(/\D/g, '');
  // Handle Brazilian toll-free / 0800 / 0300 / 400x
  if (/^(0800|0300|400\d|300\d)/.test(digits)) {
    return {
      raw,
      e164: null,
      nationalFormatted: cleaned,
      type: 'LANDLINE',
      isValid: true,
      canHaveWhatsApp: false,
    };
  }

  const candidate = cleaned.startsWith('+') ? cleaned : digits.startsWith('55') && digits.length >= 12 ? `+${digits}` : cleaned;
  const parsed = parsePhoneNumberFromString(candidate, 'BR');

  if (!parsed || !parsed.isValid()) {
    return {
      raw,
      e164: null,
      nationalFormatted: cleaned,
      type: 'UNKNOWN',
      isValid: false,
      canHaveWhatsApp: false,
    };
  }

  const e164 = parsed.number;
  const nationalDigits = parsed.nationalNumber.toString();

  let type: PhoneLineType = 'UNKNOWN';
  if (parsed.country === 'BR') {
    if (nationalDigits.length === 11 && nationalDigits[2] === '9') {
      type = 'MOBILE';
    } else if (nationalDigits.length === 10 && /^[2-5]/.test(nationalDigits[2] ?? '')) {
      type = 'LANDLINE';
    } else if (nationalDigits.length === 10 && /^[6-9]/.test(nationalDigits[2] ?? '')) {
      // Legacy 8-digit mobile or special non-geographic
      type = 'MOBILE';
    }
  } else {
    const libType = parsed.getType();
    if (libType === 'MOBILE' || libType === 'FIXED_LINE_OR_MOBILE') type = 'MOBILE';
    else if (libType === 'FIXED_LINE') type = 'LANDLINE';
  }

  return {
    raw,
    e164,
    nationalFormatted: parsed.formatNational(),
    type,
    isValid: true,
    canHaveWhatsApp: type === 'MOBILE',
  };
}
