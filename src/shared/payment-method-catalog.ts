const LOGO = 'https://d35a75syrgujp0.cloudfront.net/payment_methods/';

const DEFAULT_PAYMENT_METHOD_LOGO = LOGO + 'store.png';

/**
 * Every method code the backend can return. An entry with no artwork of its own
 * omits `logo`; it is still listed, because a miss here renders an unnamed
 * option in the merchant's UI.
 */
const PAYMENT_METHOD_CATALOG: Record<string, { label: string; logo?: string }> =
  {
    card: {
      label: 'Card',
      logo: LOGO + 'card.png',
    },
    spei: {
      label: 'SPEI',
      logo: LOGO + 'spei.png',
    },
    oxxopay: {
      label: 'Oxxo Pay',
      logo: LOGO + 'oxxopay.png',
    },
    oxxo: {
      label: 'Oxxo',
      logo: LOGO + 'oxxo.png',
    },
    mercadopago: {
      label: 'Mercado Pago',
      logo: LOGO + 'mercadopago.png',
    },
    safetypaycash: {
      label: 'Paga en Efectivo',
      logo: LOGO + 'cash_apm_sp.png',
    },
    safetypaytransfer: {
      label: 'Paga por Transferencia',
      logo: LOGO + 'transfer_apm_sp.png',
    },
    neosurf: {
      label: 'Neosurf',
      logo: LOGO + 'neosurf.png',
    },
    paypal: {
      label: 'Paypal',
      logo: LOGO + 'paypal.png',
    },
    codi: {
      label: 'CoDi',
      logo: LOGO + 'codi.png',
    },
    soriana: { label: 'Soriana', logo: LOGO + 'soriana.png' },
    comercialmexicana: {
      label: 'Comercial Mexicana',
      logo: LOGO + 'comercial_exicana.png',
    },
    bancomer: { label: 'Bancomer', logo: LOGO + 'bancomer.png' },
    walmart: { label: 'Walmart', logo: LOGO + 'walmart.png' },
    bodega: { label: 'Bodega Aurrera', logo: LOGO + 'bodega_aurrera.png' },
    samsclub: { label: 'Sam´s Club', logo: LOGO + 'sams_club.png' },
    superama: { label: 'Superama', logo: LOGO + 'superama.png' },
    calimax: { label: 'Calimax', logo: LOGO + 'calimax.png' },
    extra: { label: 'Tiendas Extra', logo: LOGO + 'tiendas_extra.png' },
    circulok: { label: 'Círculo K', logo: LOGO + 'circulo_k.png' },
    '7eleven': { label: '7 Eleven', logo: LOGO + '7_eleven.png' },
    telecomm: { label: 'Telecomm', logo: LOGO + 'telecomm.png' },
    banorte: { label: 'Banorte', logo: LOGO + 'banorte.png' },
    benavides: {
      label: 'Farmacias Benavides',
      logo: LOGO + 'farmacias_benavides.png',
    },
    delahorro: {
      label: 'Farmacias del Ahorro',
      logo: LOGO + 'farmacias_ahorro.png',
    },
    elasturiano: { label: 'El Asturiano', logo: LOGO + 'asturiano.png' },
    waldos: { label: 'Waldos', logo: LOGO + 'waldos.png' },
    alsuper: { label: 'Alsuper', logo: LOGO + 'al_super.png' },
    kiosko: { label: 'Kiosko', logo: LOGO + 'kiosko.png' },
    stamaria: {
      label: 'Farmacias Santa María',
      logo: LOGO + 'farmacias_santa_maria.png',
    },
    lamasbarata: {
      label: 'Farmacias la más barata',
      logo: LOGO + 'farmacias_barata.png',
    },
    farmroma: { label: 'Farmacias Roma', logo: LOGO + 'farmacias_roma.png' },
    farmunion: {
      label: 'Pago en Farmacias Unión',
      logo: LOGO + 'farmacias_union.png',
    },
    farmatodo: {
      label: 'Pago en Farmacias Farmatodo',
      logo: LOGO + 'farmacias_farmatodo.png',
    },
    sfdeasis: {
      label: 'Pago en Farmacias San Francisco de Asís',
      logo: LOGO + 'farmacias_san_francisco.png',
    },
    farm911: { label: 'Farmacias 911' },
    farmeconomicas: { label: 'Farmacias Economicas' },
    farmmedicity: { label: 'Farmacias Medicity' },
    rianxeira: { label: 'Rianxeira' },
    westernunion: { label: 'Western Union' },
    zonapago: { label: 'Zona Pago' },
    cajalosandes: { label: 'Caja Los Andes' },
    cajapaita: { label: 'Caja Paita' },
    cajasanta: { label: 'Caja Santa' },
    cajasullana: { label: 'Caja Sullana' },
    cajatrujillo: { label: 'Caja Trujillo' },
    edpyme: { label: 'Edpyme' },
    kasnet: { label: 'KasNet' },
    norandino: { label: 'Norandino' },
    qapaq: { label: 'Qapaq' },
    raiz: { label: 'Raiz' },
    payser: { label: 'Paysera' },
    wunion: { label: 'Western Union' },
    bancocontinental: { label: 'Banco Continental' },
    gmoney: { label: 'Go money' },
    gopay: { label: 'Go pay' },
    wu: { label: 'Western Union' },
    puntoshey: { label: 'Puntoshey' },
    ampm: { label: 'Ampm' },
    jumbomarket: { label: 'Jumbomarket' },
    smelpueblo: { label: 'Smelpueblo' },
    bam: { label: 'Bam' },
    refacil: { label: 'Refacil' },
    acyvalores: { label: 'Acyvalores' },
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
  const entry = PAYMENT_METHOD_CATALOG[key];
  return {
    label: entry?.label ?? '',
    logo: entry?.logo ?? DEFAULT_PAYMENT_METHOD_LOGO,
  };
}
