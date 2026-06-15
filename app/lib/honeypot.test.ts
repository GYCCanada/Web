import { describe, expect, it } from 'bun:test';

import { HONEYPOT_FIELD, isHoneypotTriggered } from './honeypot';

describe('isHoneypotTriggered', () => {
  it('returns false when the honeypot field is absent', () => {
    const formData = new FormData();
    formData.set('email', 'ada@example.com');

    expect(isHoneypotTriggered(formData)).toBe(false);
  });

  it('returns false when the honeypot field is empty or whitespace', () => {
    const empty = new FormData();
    empty.set(HONEYPOT_FIELD, '');

    const whitespace = new FormData();
    whitespace.set(HONEYPOT_FIELD, '   ');

    expect(isHoneypotTriggered(empty)).toBe(false);
    expect(isHoneypotTriggered(whitespace)).toBe(false);
  });

  it('returns true when the honeypot field has a value', () => {
    const formData = new FormData();
    formData.set(HONEYPOT_FIELD, 'https://spam.example');

    expect(isHoneypotTriggered(formData)).toBe(true);
  });

  it('returns true when the honeypot field is not a string', () => {
    const formData = new FormData();
    formData.append(HONEYPOT_FIELD, 'first');
    formData.append(HONEYPOT_FIELD, 'second');

    expect(isHoneypotTriggered(formData)).toBe(true);
  });
});
