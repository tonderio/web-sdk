const DEFAULT_PAYMENT_METHOD_LOGO =
  'https://d35a75syrgujp0.cloudfront.net/payment_methods/store.png';

const PAYMENT_METHOD_CATALOG: Record<string, { label: string; logo: string }> =
  {
    card: {
      label: 'Card',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/card.png',
    },
    spei: {
      label: 'SPEI',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/spei.png',
    },
    oxxopay: {
      label: 'Oxxo Pay',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/oxxopay.png',
    },
    oxxo: {
      label: 'Oxxo',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/oxxo.png',
    },
    mercadopago: {
      label: 'Mercado Pago',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/mercadopago.png',
    },
    safetypaycash: {
      label: 'Paga en Efectivo',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/cash_apm_sp.png',
    },
    safetypaytransfer: {
      label: 'Paga por Transferencia',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/transfer_apm_sp.png',
    },
    neosurf: {
      label: 'Neosurf',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/neosurf.png',
    },
    paypal: {
      label: 'Paypal',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/paypal.png',
    },
    codi: {
      label: 'CoDi',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/codi.png',
    },
  };

/** Backend namespace prefix for every Apple Pay catalog entry. */
const APPLE_PAY_METHOD_PREFIX = 'apple_pay_';

/**
 * True when a catalog `payment_method` is an Apple Pay entry
 * (`apple_pay_debit_card`, `apple_pay_credit_card`, and any future variant).
 *
 * Lives here, with the other facts about method codes, rather than in the Apple
 * Pay strategy: the projection in `models/payment-method.model.ts` needs it, and
 * that module must not import from `core/`.
 *
 * Prefix rather than an allow-list on purpose: the two failure directions are
 * not symmetric. Missing a new variant LEAKS a dead-end method to merchants —
 * the exact bug the `getPaymentMethods()` filter exists to prevent — while
 * over-matching would require the backend to ship a non-Apple-Pay method inside
 * the `apple_pay_` namespace.
 *
 * A bare `apple_pay` entry (no trailing underscore) deliberately does NOT
 * match; no such entry exists in the backend contract, and widening the prefix
 * would start matching an unrelated `apple_payment_*` namespace. If one ever
 * ships, extend the predicate here — it is the single place the rule lives.
 */
export function isApplePayCatalogMethod(paymentMethod: string): boolean {
  return paymentMethod.startsWith(APPLE_PAY_METHOD_PREFIX);
}

export function getPaymentMethodCatalogDetails(method: string): {
  label: string;
  logo: string;
} {
  const key = method.toLowerCase().replace(/\s+/g, '');
  return (
    PAYMENT_METHOD_CATALOG[key] ?? {
      label: '',
      logo: DEFAULT_PAYMENT_METHOD_LOGO,
    }
  );
}
