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

/** Card-on-File payment provider contract used by the SDK runtime. */
export interface AcquirerPort {
  createCofSubscription(
    input: CofSubscriptionInput,
  ): Promise<CofSubscriptionResult>;
}
