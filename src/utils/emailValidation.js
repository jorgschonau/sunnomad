export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// iOS Hide My Email / Keychain autofill labels (localized UI strings, not real addresses).
const AUTOFILL_PLACEHOLDER_EMAILS = new Set([
  'hide my email',
  '隐藏邮件地址',
  '隐藏电子邮件地址',
  '隱藏電子郵件地址',
  'e-mail-adresse verbergen',
  'masquer l’adresse e-mail',
  "masquer l'adresse e-mail",
  'ocultar mi correo',
  'nascondi la mia email',
  'ocultar o meu email',
]);

export function sanitizeEmailInput(value) {
  return (value ?? '').replace(/\u200B/g, '').trim();
}

export function normalizeEmail(value) {
  const sanitized = sanitizeEmailInput(value);
  return sanitized ? sanitized.toLowerCase() : '';
}

export function isAutofillEmailPlaceholder(value) {
  const sanitized = sanitizeEmailInput(value);
  if (!sanitized) return false;

  const lowered = sanitized.toLowerCase();
  if (AUTOFILL_PLACEHOLDER_EMAILS.has(lowered)) return true;

  if (!sanitized.includes('@')) {
    const hidePattern = /hide|verbergen|masquer|ocultar|nascondi|隐藏|隱藏/i;
    const mailPattern = /email|mail|e-mail|邮件|郵件|correo/i;
    if (hidePattern.test(sanitized) && mailPattern.test(sanitized)) return true;
  }

  return false;
}

export function validateEmailInput(value) {
  const sanitized = sanitizeEmailInput(value);
  if (!sanitized) {
    return { valid: false, reason: 'empty_email', email: null };
  }
  if (isAutofillEmailPlaceholder(sanitized)) {
    return { valid: false, reason: 'autofill_placeholder', email: sanitized };
  }
  if (!EMAIL_REGEX.test(sanitized)) {
    return { valid: false, reason: 'invalid_email', email: sanitized };
  }
  return { valid: true, reason: null, email: sanitized.toLowerCase() };
}

export function emailErrorKey(reason) {
  if (reason === 'autofill_placeholder') return 'auth.autofillEmailPlaceholder';
  if (reason === 'empty_email') return 'auth.enterEmail';
  return 'auth.invalidEmail';
}
