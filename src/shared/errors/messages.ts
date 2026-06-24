import { ErrorKeyEnum } from './ErrorKeyEnum';

/**
 * English default messages keyed by error code. Used by {@link AppError} to
 * resolve a human-readable message when the caller does not provide one.
 */
export const MESSAGES_EN: Record<string, string> = {
  [ErrorKeyEnum.INIT_ERROR]: 'Error initializing the SDK.',
  [ErrorKeyEnum.CREATE_ERROR]: 'Error creating the SDK.',
  [ErrorKeyEnum.INVALID_TYPE]: 'SDK type invalid.',
  [ErrorKeyEnum.STATE_ERROR]: 'Error updating SDK state.',
  [ErrorKeyEnum.FETCH_BUSINESS_ERROR]: 'Error retrieving merchant information.',
  [ErrorKeyEnum.INVALID_CONFIG]: 'Required configuration options are missing.',
  [ErrorKeyEnum.MERCHANT_CREDENTIAL_REQUIRED]: 'Merchant credential required.',
  [ErrorKeyEnum.INVALID_PAYMENT_REQUEST]: 'Invalid payment request.',
  [ErrorKeyEnum.INVALID_PAYMENT_REQUEST_CARD_PM]:
    'Payment method must be a card for this operation.',
  [ErrorKeyEnum.INVALID_COMPONENT_TYPE]:
    "Unknown component type. Supported: 'card_fields'.",
  [ErrorKeyEnum.ENVIRONMENT_REQUIRED]: 'Environment required.',
  [ErrorKeyEnum.FETCH_CARDS_ERROR]: 'Error retrieving cards.',
  [ErrorKeyEnum.FETCH_TRANSACTION_ERROR]: 'Error retrieving the transaction.',
  [ErrorKeyEnum.CUSTOMER_AUTH_TOKEN_NOT_VALID]:
    "The customer's auth token is invalid.",
  [ErrorKeyEnum.SAVE_CARD_ERROR]: 'Error saving the card.',
  [ErrorKeyEnum.REMOVE_CARD_ERROR]: 'Error deleting the card.',
  [ErrorKeyEnum.PAYMENT_PROCESS_ERROR]:
    'There was an issue processing the payment.',
  [ErrorKeyEnum.INVALID_CARD_DATA]: 'Invalid card data.',
  [ErrorKeyEnum.SAVE_CARD_PROCESS_ERROR]: 'Error processing card data.',
  [ErrorKeyEnum.CUSTOMER_OPERATION_ERROR]:
    'Error registering or fetching the customer.',
  [ErrorKeyEnum.FETCH_PAYMENT_METHODS_ERROR]:
    'Error retrieving active payment methods.',
  [ErrorKeyEnum.FETCH_PAYMENT_METHOD_BANKS_ERROR]:
    'Error retrieving payment method bank list.',
  [ErrorKeyEnum.INVALID_APM_CONFIG]:
    'APM configuration is missing required fields (country, channel, bank_ids).',
  [ErrorKeyEnum.INVALID_VAULT_TOKEN]:
    'An invalid secure card fields session response was received.',
  [ErrorKeyEnum.VAULT_TOKEN_ERROR]:
    'Error preparing the secure card fields session.',
  [ErrorKeyEnum.SECURE_TOKEN_INVALID]: 'Invalid secure token.',
  [ErrorKeyEnum.SECURE_TOKEN_REQUIRED]:
    'No secure token. Provide `session.secure_token` in createTonder() config.',
  [ErrorKeyEnum.MISSING_CUSTOMER]:
    'No customer set. Provide `session.customer` in createTonder() config.',
  [ErrorKeyEnum.INVALID_EMAIL]: 'A valid customer email is required.',
  [ErrorKeyEnum.NOT_INITIALIZED]:
    'The SDK is not initialized. Call init() before this operation.',
  [ErrorKeyEnum.SECURE_FIELDS_LOAD_ERROR]:
    'Failed to load the secure card fields library.',
  [ErrorKeyEnum.ACQUIRER_LOAD_ERROR]: 'Failed to load the acquirer library.',
  [ErrorKeyEnum.MOUNT_COLLECT_ERROR]:
    'Mount failed. Make sure all inputs are complete and valid.',
  [ErrorKeyEnum.CARD_ON_FILE_DECLINED]:
    'Transaction declined. Please verify your card details.',
  [ErrorKeyEnum.REQUEST_ABORTED]: 'Request canceled.',
  [ErrorKeyEnum.REQUEST_FAILED]: 'Request failed.',
  [ErrorKeyEnum.POLL_TIMEOUT_ERROR]: 'Transaction polling timed out.',
  [ErrorKeyEnum.THREEDS_REDIRECTION_ERROR]:
    'An error occurred during the 3DS redirection.',
  [ErrorKeyEnum.UNKNOWN_ERROR]: 'An unexpected error occurred.',
};
