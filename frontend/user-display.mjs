// Presentation only: never use an email prefix for authorization or record ownership.
export function sessionDisplayEmail(payload, subject) {
  if (!subject || payload?.sub !== subject || typeof payload.email !== 'string') return '';
  return payload.email.trim();
}

export function userLabel(email, fallback = 'Signed-in user') {
  if (typeof email !== 'string') return fallback;
  const value = email.trim();
  const at = value.indexOf('@');
  return at > 0 && at < value.length - 1 ? value.slice(0, at) : fallback;
}
