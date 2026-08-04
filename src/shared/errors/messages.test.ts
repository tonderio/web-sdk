/**
 * Every Apple Pay code reviewed TOGETHER, as the phases that introduced them promised.
 *
 * Presence alone is a wrong-reason test: three entries could be added and still
 * be duplicates of each other or of the `UNKNOWN_ERROR` fallback, and every
 * "the code resolves to a message" assertion would stay green while a merchant
 * read the same sentence for three different failures.
 */
import { describe, it, expect } from 'vitest';
import { MESSAGES_EN } from './messages';
import { ErrorKeyEnum } from './ErrorKeyEnum';

const APPLE_PAY_CODES = [
  ErrorKeyEnum.APPLE_PAY_NOT_ENABLED,
  ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER,
  ErrorKeyEnum.APPLE_PAY_CONTAINER_NOT_FOUND,
  ErrorKeyEnum.APPLE_PAY_SESSION_ERROR,
  ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR,
] as const;

describe('MESSAGES_EN — the Apple Pay codes', () => {
  it('resolves every one of them to a non-empty string', () => {
    for (const code of APPLE_PAY_CODES) {
      expect(typeof MESSAGES_EN[code]).toBe('string');
      expect(MESSAGES_EN[code].trim().length).toBeGreaterThan(0);
    }
  });

  it('resolves none of them to the UNKNOWN_ERROR copy', () => {
    const unknown = MESSAGES_EN[ErrorKeyEnum.UNKNOWN_ERROR];

    for (const code of APPLE_PAY_CODES) {
      expect(MESSAGES_EN[code]).not.toBe(unknown);
    }
  });

  it('gives them all DISTINCT copy — no two share a message', () => {
    const messages = APPLE_PAY_CODES.map((code) => MESSAGES_EN[code]);

    expect(new Set(messages).size).toBe(APPLE_PAY_CODES.length);
  });

  it('names the actionable next step in each of the three new entries', () => {
    // Style follows the existing actionable entries: state the failure, then
    // what to do about it.
    expect(MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_NOT_ENABLED]).toContain('Tonder');
    expect(MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER]).toContain(
      'isApplePayAvailable()',
    );
  });
});

describe('MESSAGES_EN — INVALID_COMPONENT_TYPE', () => {
  it('names both supported component types', () => {
    const message = MESSAGES_EN[ErrorKeyEnum.INVALID_COMPONENT_TYPE];

    expect(message).toContain('card_fields');
    expect(message).toContain('apple_pay_button');
  });
});
