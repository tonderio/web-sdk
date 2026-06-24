import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSkyflowLoader } from './skyflow-loader';
import type { SkyflowStatic } from './skyflow-loader';

declare global {
  interface Window {
    Skyflow?: SkyflowStatic;
  }
}

function fakeSkyflowStatic(): SkyflowStatic {
  return {
    init: vi.fn(),
    ContainerType: { COLLECT: 'COLLECT', REVEAL: 'REVEAL' },
    ElementType: {
      CVV: 'CVV',
      CARD_NUMBER: 'CARD_NUMBER',
      EXPIRATION_MONTH: 'EXPIRATION_MONTH',
      EXPIRATION_YEAR: 'EXPIRATION_YEAR',
      CARDHOLDER_NAME: 'CARDHOLDER_NAME',
      INPUT_FIELD: 'INPUT_FIELD',
    },
    LogLevel: { ERROR: 'ERROR' },
    Env: { DEV: 'DEV', PROD: 'PROD' },
    RedactionType: { MASKED: 'MASKED', PLAIN_TEXT: 'PLAIN_TEXT' },
    ValidationRuleType: {
      LENGTH_MATCH_RULE: 'LENGTH_MATCH_RULE',
      REGEX_MATCH_RULE: 'REGEX_MATCH_RULE',
    },
  } as unknown as SkyflowStatic;
}

describe('createSkyflowLoader', () => {
  afterEach(() => {
    delete window.Skyflow;
  });

  it('resolves with the already-present window.Skyflow without injecting a script', async () => {
    const existing = fakeSkyflowStatic();
    window.Skyflow = existing;
    const appendSpy = vi.spyOn(document.head, 'appendChild');

    const loader = createSkyflowLoader();
    const result = await loader();

    expect(result).toBe(existing);
    expect(appendSpy).not.toHaveBeenCalled();
    appendSpy.mockRestore();
  });
});
