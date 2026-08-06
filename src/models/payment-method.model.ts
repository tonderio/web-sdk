/**
 * Wire shapes for `GET /api/v1/payment_methods?status=active`, plus the
 * projection into the merchant-facing shape.
 *
 * Shapes and their projection live together here, mirroring
 * `transaction.model.ts` (`BackendTransactionResponse` + `toRawTransaction`).
 * The transport service fetches; this module converts; the facade composes.
 *
 * NO imports from `core/` — that would invert the layering and cycle, since
 * `core/` imports these types. Only `shared/`, which is a leaf.
 */
import type { PaymentMethodInfo } from '../shared/types';
import {
  getPaymentMethodCatalogDetails,
  isApplePayCatalogMethod,
} from '../shared/payment-method-catalog';

/** SDK transport shape for one payment-method record. */
export interface BackendPaymentMethod {
  pk: number;
  payment_method: string;
  acquirer?: string;
  status?: string;
  priority: number;
  category: string;
  label?: string;
  name?: string;
  logo?: string;
  icon?: string;
  unavailable_countries?: string[];
}

/** SDK transport shape for a paginated payment-method response. */
export interface BackendPaymentMethodsPage {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results: BackendPaymentMethod[];
}

/** Pure snake→camel projection of one payment-method record. */
function mapPaymentMethod(raw: BackendPaymentMethod): PaymentMethodInfo {
  const catalog = getPaymentMethodCatalogDetails(raw.payment_method);
  return {
    id: raw.pk,
    payment_method: raw.payment_method,
    label: raw.label ?? raw.name ?? catalog.label,
    logo: raw.logo ?? raw.icon ?? catalog.logo,
    category: raw.category,
  };
}

/**
 * Project the raw catalog into the merchant-facing shape.
 *
 * THE APPLE PAY FILTER LIVES HERE AND NOWHERE ELSE. This is the only function
 * in the SDK that produces `PaymentMethodInfo[]`, and `mapPaymentMethod` is
 * module-private with exactly one call site — this one — so an `apple_pay_*`
 * entry cannot reach a merchant without passing through the filter.
 *
 * Apple Pay is a mountable component, not a `pay()` method: it needs the button
 * and the user gesture. A leaked `apple_pay_debit_card` row would be rendered
 * as a generic selectable APM and then charged via `pay()`, which cannot work.
 *
 * The `apple_pay_*` entries keep arriving from the backend, so this filter is
 * load-bearing regardless of how Apple Pay availability is decided elsewhere.
 */
export function toPublicPaymentMethods(
  raw: readonly BackendPaymentMethod[],
): PaymentMethodInfo[] {
  return raw
    .filter((method) => !isApplePayCatalogMethod(method.payment_method))
    .map(mapPaymentMethod);
}
