import { describe, expect, it } from 'vitest';

import {
  INTERNAL_SEAMS,
  findUnexportedReachableTypes,
  formatFindings,
} from './check-dist-exports.mjs';

/** The shape `rollup-plugin-dts` emits: bare declarations, one export list. */
function bundle(declarations, exported) {
  return `${declarations}\n\nexport type { ${exported.join(', ')} };\n`;
}

describe('findUnexportedReachableTypes', () => {
  it('is importable', () => {
    expect(typeof findUnexportedReachableTypes).toBe('function');
  });

  it('reports a type reached through an exported interface property', () => {
    const source = bundle(
      `interface BillingAddress { zip_code?: string; }
       interface PayInput { billing_address?: BillingAddress; }`,
      ['PayInput'],
    );

    const findings = findUnexportedReachableTypes(source);

    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('BillingAddress');
    expect(findings[0].path).toEqual(['PayInput', 'BillingAddress']);
  });

  it('reports a type reached only through a callback parameter', () => {
    const source = bundle(
      `interface CardFieldState { is_valid: boolean; }
       interface CardFieldEvents { on_change?(state: CardFieldState): void; }`,
      ['CardFieldEvents'],
    );

    expect(findUnexportedReachableTypes(source).map((f) => f.name)).toEqual([
      'CardFieldState',
    ]);
  });

  it('follows an exported class through its constructor and method signatures', () => {
    const source = `interface Handle { id: string; }
      interface Options { name: string; }
      declare class Tonder {
        constructor(options: Options);
        create(): Handle;
      }
      export { Tonder };`;

    expect(
      findUnexportedReachableTypes(source)
        .map((f) => f.name)
        .sort(),
    ).toEqual(['Handle', 'Options']);
  });

  it('follows a heritage clause', () => {
    const source = bundle(
      `interface Mountable { mount(): Promise<void>; }
       interface CardFieldsComponent extends Mountable { reveal(): void; }`,
      ['CardFieldsComponent'],
    );

    expect(findUnexportedReachableTypes(source).map((f) => f.name)).toEqual([
      'Mountable',
    ]);
  });

  it('follows an indexed access and a type argument', () => {
    const source = bundle(
      `interface Handle { id: string; }
       interface ByType { card_fields: Handle; }
       type Kind = 'card_fields';
       type Component = ByType[Kind];
       declare function make(): Promise<Component>;`,
      ['Component'],
    );

    expect(
      findUnexportedReachableTypes(source)
        .map((f) => f.name)
        .sort(),
    ).toEqual(['ByType', 'Handle', 'Kind']);
  });

  it('stays silent when every reachable type is exported', () => {
    const source = bundle(
      `interface BillingAddress { zip_code?: string; }
       interface PayInput { billing_address?: BillingAddress; }`,
      ['BillingAddress', 'PayInput'],
    );

    expect(findUnexportedReachableTypes(source)).toEqual([]);
  });

  it('ignores a declared type that nothing exported reaches', () => {
    const source = bundle(
      `interface Orphan { a: string; }
       interface PayInput { amount: number; }`,
      ['PayInput'],
    );

    expect(findUnexportedReachableTypes(source)).toEqual([]);
  });

  it('does not report built-in types it cannot resolve in the file', () => {
    const source = bundle(
      `interface PayInput { at: Date; tags: Map<string, unknown>; }`,
      ['PayInput'],
    );

    expect(findUnexportedReachableTypes(source)).toEqual([]);
  });

  it('reports the shortest path when a type is reachable two ways', () => {
    const source = bundle(
      `interface Leaf { a: string; }
       interface Middle { leaf: Leaf; }
       interface Root { leaf: Leaf; middle: Middle; }`,
      ['Root'],
    );

    const leaf = findUnexportedReachableTypes(source).find(
      (finding) => finding.name === 'Leaf',
    );

    expect(leaf.path).toEqual(['Root', 'Leaf']);
  });

  it('stops at an internal seam, so the seam itself is not reported', () => {
    const source = `interface CofSubscriptionInput { merchantId: string; }
      interface AcquirerPort { createCofSubscription(input: CofSubscriptionInput): void; }
      declare class Tonder { constructor(acquirer?: AcquirerPort); }
      export { Tonder };`;

    expect(
      findUnexportedReachableTypes(source, {
        seams: [{ name: 'AcquirerPort', reason: 'runtime injection seam' }],
      }),
    ).toEqual([]);
  });

  it('stops at an internal seam even when the seam is itself exported', () => {
    const source = bundle(
      `interface ThreeDsHostOptions { closable: boolean; }
       interface ThreeDsHostPort { open(url: string, options: ThreeDsHostOptions): void; }`,
      ['ThreeDsHostPort'],
    );

    expect(
      findUnexportedReachableTypes(source, {
        seams: [{ name: 'ThreeDsHostPort', reason: 'runtime injection seam' }],
      }),
    ).toEqual([]);
  });

  it('does not let a seam hide a type that is also reachable another way', () => {
    const source = bundle(
      `interface Shared { a: string; }
       interface Port { use(s: Shared): void; }
       interface PayInput { shared: Shared; port: Port; }`,
      ['PayInput'],
    );

    expect(
      findUnexportedReachableTypes(source, {
        seams: [{ name: 'Port', reason: 'runtime injection seam' }],
      }).map((f) => f.name),
    ).toEqual(['Shared']);
  });

  it('reports a declaration line for every finding', () => {
    const source = bundle(
      `interface BillingAddress { zip_code?: string; }
       interface PayInput { billing_address?: BillingAddress; }`,
      ['PayInput'],
    );

    expect(findUnexportedReachableTypes(source)[0].line).toBe(1);
  });
});

describe('INTERNAL_SEAMS', () => {
  it('covers every runtime-injection port the Tonder constructor accepts', () => {
    expect(INTERNAL_SEAMS.map((seam) => seam.name).sort()).toEqual([
      'AcquirerPort',
      'CheckoutMessengerPort',
      'HttpPort',
      'ThreeDsHostPort',
      'TokenizerPort',
    ]);
  });

  it('gives every seam a reason, because the reason is the failure output', () => {
    for (const seam of INTERNAL_SEAMS) {
      expect(seam.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('formatFindings', () => {
  it('names the offending type and the path that reaches it', () => {
    const report = formatFindings(
      [
        {
          name: 'BillingAddress',
          path: ['PayInput', 'BillingAddress'],
          line: 4,
        },
      ],
      INTERNAL_SEAMS,
    );

    expect(report).toContain('BillingAddress');
    expect(report).toContain('PayInput -> BillingAddress');
    expect(report).toContain(':4');
  });

  it('lists the seams and their reasons, so an allowed port explains itself', () => {
    const report = formatFindings(
      [{ name: 'Whatever', path: ['Root', 'Whatever'], line: 1 }],
      INTERNAL_SEAMS,
    );

    for (const seam of INTERNAL_SEAMS) {
      expect(report).toContain(seam.name);
      expect(report).toContain(seam.reason);
    }
  });
});
