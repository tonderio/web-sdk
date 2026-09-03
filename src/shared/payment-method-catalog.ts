/** Path, under the environment's static asset host, holding method artwork. */
const LOGO_PATH = '/payment_methods/';

/** Artwork served for a method the catalog has no file for, known or not. */
const DEFAULT_LOGO_FILE = 'store.png';

/**
 * Every method code the backend can return. An entry with no artwork of its own
 * omits `logoFile`; it is still listed, because a miss here renders an unnamed
 * option in the merchant's UI.
 *
 * `logoFile` is a FILE NAME, not a URL: the host it hangs off depends on the
 * SDK's mode, so the full URL is only assembled in
 * {@link getPaymentMethodCatalogDetails}, which is handed the resolved host.
 */
const PAYMENT_METHOD_CATALOG: Record<
  string,
  { label: string; logoFile?: string }
> = {
  card: {
    label: 'Card',
    logoFile: 'card.png',
  },
  spei: {
    label: 'SPEI',
    logoFile: 'spei.png',
  },
  oxxopay: {
    label: 'Oxxo Pay',
    logoFile: 'oxxopay.png',
  },
  oxxo: {
    label: 'Oxxo',
    logoFile: 'oxxo.png',
  },
  mercadopago: {
    label: 'Mercado Pago',
    logoFile: 'mercadopago.png',
  },
  safetypaycash: {
    label: 'Paga en Efectivo',
    logoFile: 'cash_apm_sp.png',
  },
  safetypaytransfer: {
    label: 'Paga por Transferencia',
    logoFile: 'transfer_apm_sp.png',
  },
  neosurf: {
    label: 'Neosurf',
    logoFile: 'neosurf.png',
  },
  paypal: {
    label: 'Paypal',
    logoFile: 'paypal.png',
  },
  codi: {
    label: 'CoDi',
    logoFile: 'codi.png',
  },
  soriana: { label: 'Soriana', logoFile: 'soriana.png' },
  comercialmexicana: {
    label: 'Comercial Mexicana',
    logoFile: 'comercial_exicana.png',
  },
  bancomer: { label: 'Bancomer', logoFile: 'bancomer.png' },
  walmart: { label: 'Walmart', logoFile: 'walmart.png' },
  bodega: { label: 'Bodega Aurrera', logoFile: 'bodega_aurrera.png' },
  samsclub: { label: 'Sam´s Club', logoFile: 'sams_club.png' },
  superama: { label: 'Superama', logoFile: 'superama.png' },
  calimax: { label: 'Calimax', logoFile: 'calimax.png' },
  extra: { label: 'Tiendas Extra', logoFile: 'tiendas_extra.png' },
  circulok: { label: 'Círculo K', logoFile: 'circulo_k.png' },
  '7eleven': { label: '7 Eleven', logoFile: '7_eleven.png' },
  telecomm: { label: 'Telecomm', logoFile: 'telecomm.png' },
  banorte: { label: 'Banorte', logoFile: 'banorte.png' },
  benavides: {
    label: 'Farmacias Benavides',
    logoFile: 'farmacias_benavides.png',
  },
  delahorro: {
    label: 'Farmacias del Ahorro',
    logoFile: 'farmacias_ahorro.png',
  },
  elasturiano: { label: 'El Asturiano', logoFile: 'asturiano.png' },
  waldos: { label: 'Waldos', logoFile: 'waldos.png' },
  alsuper: { label: 'Alsuper', logoFile: 'al_super.png' },
  kiosko: { label: 'Kiosko', logoFile: 'kiosko.png' },
  stamaria: {
    label: 'Farmacias Santa María',
    logoFile: 'farmacias_santa_maria.png',
  },
  lamasbarata: {
    label: 'Farmacias la más barata',
    logoFile: 'farmacias_barata.png',
  },
  farmroma: { label: 'Farmacias Roma', logoFile: 'farmacias_roma.png' },
  farmunion: {
    label: 'Pago en Farmacias Unión',
    logoFile: 'farmacias_union.png',
  },
  farmatodo: {
    label: 'Pago en Farmacias Farmatodo',
    logoFile: 'farmacias_farmatodo.png',
  },
  sfdeasis: {
    label: 'Pago en Farmacias San Francisco de Asís',
    logoFile: 'farmacias_san_francisco.png',
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

/**
 * Label and logo URL for a backend method code.
 *
 * `assetsBaseUrl` is the environment's resolved static asset host — see
 * `TonderBaseUrls.assets`. It is a parameter rather than a module constant
 * because this module is a leaf that must not read the SDK's configuration;
 * the caller that holds the resolved environment passes it down.
 */
export function getPaymentMethodCatalogDetails(
  method: string,
  assetsBaseUrl: string,
): {
  label: string;
  logo: string;
} {
  const key = method.toLowerCase().replace(/\s+/g, '');
  const entry = PAYMENT_METHOD_CATALOG[key];
  return {
    label: entry?.label ?? '',
    logo: assetsBaseUrl + LOGO_PATH + (entry?.logoFile ?? DEFAULT_LOGO_FILE),
  };
}
