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
