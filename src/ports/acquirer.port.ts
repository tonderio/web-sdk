/** Detokenized card payload required by the COF subscription calls. INTERNAL. */
export interface CofCardTokens {
  name: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
}

/** Cardholder contact details forwarded to the subscription. */
export interface CofContact {
  firstName: string;
  lastName: string;
  email: string;
}

/** Input required to create a card-on-file (COF) subscription. */
export interface CofSubscriptionInput {
  merchantId: string;
  /** Card BIN (first digits), resolved from the first card save. */
  cardBin: string;
  cardTokens: CofCardTokens;
  contact: CofContact;
  customerId: string;
  currency: string;
}

/** Result of a COF subscription creation. */
export interface CofSubscriptionResult {
  subscriptionId: string;
}

/**
 * Driven port: card-on-file acquirer. Drives the 3DS-backed subscription
 * creation. Implemented by the acquirer adapter (runtime-loaded). The domain
 * depends on this interface only — never on the acquirer SDK directly.
 */
export interface AcquirerPort {
  createCofSubscription(
    input: CofSubscriptionInput,
  ): Promise<CofSubscriptionResult>;
}
