export const HONEYPOT_FIELD = 'website';

export function isHoneypotTriggered(formData: FormData): boolean {
  const value = formData.get(HONEYPOT_FIELD);
  if (typeof value !== 'string') return value !== null;
  return value.trim().length > 0;
}
