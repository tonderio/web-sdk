# Feature Proposal: applepay-sdk — Apple Pay en web-sdk (InlineCheckout y LiteInlineCheckout)

## Parent Release

Release: applepay — Apple Pay SDK Integration
Release Intent: Habilitar Apple Pay en el SDK de Tonder (InlineCheckout/LiteInlineCheckout) usando integración Direct Apple — Tonder desencripta PKPaymentToken server-side y tokeniza a través de Kushki.

## Intent

Integrar Apple Pay como método de pago en los componentes `InlineCheckout` y `LiteInlineCheckout` del web-sdk. El SDK detecta automáticamente compatibilidad del navegador (`ApplePaySession.canMakePayments()`), muestra el botón oficial de Apple Pay solo cuando aplica, orquesta el handshake de validación de merchant y envía el `PKPaymentToken` al backend de Tonder para su procesamiento. El merchant no escribe código adicional — solo habilita el flag en su dashboard.

## Scope

### In Scope
- Detección de compatibilidad: `ApplePaySession.canMakePayments()` antes de mostrar el botón
- Leer flag `apple_pay.enabled` del endpoint de business info para mostrar/ocultar el botón
- Implementar el flujo completo de `ApplePaySession` en Safari:
  - `onvalidatemerchant`: llamar `POST /api/v1/payments/apple-pay/validate-merchant/`
  - `onpaymentauthorized`: extraer `payment.token` (PKPaymentToken) y enviarlo al checkout
  - `oncancel`, `onerror`: manejar cancelación y errores del usuario
- Botón Apple Pay renderizado con el componente oficial de Apple (`-webkit-appearance: -apple-pay-button`)
- Integración en `LiteInlineCheckout` (flujo mínimo, configuración vía config) — **PRIORIDAD por definición de negocio: arrancar por aquí**
- Integración en `InlineCheckout` (flujo completo con formulario) — después de completar y validar Lite
- `applePayToken` enviado al checkout de Tonder junto con `payment_method: "apple_pay"`
- Tests unitarios y de integración (Vitest) — mock de `ApplePaySession` para entornos no-Safari

### Out of Scope
- Apps nativas iOS — solo web browser
- Chrome, Firefox, Edge — no soportan Apple Pay JS API (ni en iPhone)
- Mostrar el botón Apple Pay en su forma estándar en navegadores no compatibles — simplemente no se muestra
- Gestión del archivo `.well-known` por parte del SDK — el merchant debe alojarlo en su dominio
- Suscripciones Apple Pay

## Approach

### Detección y activación
En la inicialización del checkout, después de `fetchBusiness()`, verificar:
```typescript
const applePayEnabled =
  businessData.apple_pay?.enabled &&
  typeof ApplePaySession !== 'undefined' &&
  ApplePaySession.canMakePayments();
```
Si `applePayEnabled === true`, renderizar el botón Apple Pay y registrar el handler.

### Flujo ApplePaySession
```typescript
const request: ApplePayJS.ApplePayPaymentRequest = {
  countryCode: 'MX',
  currencyCode: checkout.currency,
  supportedNetworks: ['visa', 'masterCard'],
  merchantCapabilities: ['supports3DS'],
  total: { label: businessData.name, amount: checkout.total.toString() },
};

const session = new ApplePaySession(3, request);

session.onvalidatemerchant = async (event) => {
  const merchantSession = await validateMerchant(event.validationURL, domainName);
  session.completeMerchantValidation(merchantSession);
};

session.onpaymentauthorized = async (event) => {
  const result = await submitApplePayPayment(event.payment.token);
  session.completePayment(result.success
    ? ApplePaySession.STATUS_SUCCESS
    : ApplePaySession.STATUS_FAILURE);
};

session.begin();
```

### Envío al checkout

El cargo Apple Pay usa **el mismo endpoint que tarjeta** (`POST /api/v1/process/`) con el mismo esquema. El `PKPaymentToken` va como objeto en `payment_method.token` — **no** serializado como string, **no** en un campo separado.

```typescript
// POST /api/v1/process/ — mismo endpoint que para tarjeta
const body = {
  operation_type: 'payment',
  amount: total,
  currency: currency,
  customer: { name: customerName, email: customerEmail },
  payment_method: {
    type: 'apple_pay',
    token: pkPaymentToken, // PKPaymentToken como objeto (event.payment.token tal cual)
  },
};
```

El backend valida que `payment_method.token` sea un objeto con `paymentData`. El `PKPaymentToken` nunca se serializa a string — se envía como objeto JSON directamente.

### Arquitectura web-sdk
Siguiendo el patrón Ports & Adapters del web-sdk:
- **Port**: `IApplePayAdapter` — define `canUseApplePay()`, `startPayment(request)`, `completeMerchantValidation(session, merchantSession)`, `completePayment(session, status)`
- **Adapter**: `ApplePaySessionAdapter` — implementa IApplePayAdapter usando `ApplePaySession` real (sujeto a inyección para testing)
- **Mock Adapter**: `ApplePaySessionMockAdapter` — para tests en entornos no-Safari
- El botón Apple Pay es un componente CSS puro: `button { -webkit-appearance: -apple-pay-button; }`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/ApplePaySessionAdapter.ts` | New | Adapter que wrappea ApplePaySession |
| `src/ports/IApplePayAdapter.ts` | New | Interface/Port para Apple Pay |
| `src/components/ApplePayButton.ts` | New | Componente botón Apple Pay (CSS + evento click) |
| `src/checkouts/InlineCheckout.ts` | Modified | Integrar Apple Pay button y flujo |
| `src/checkouts/LiteInlineCheckout.ts` | Modified | Integrar Apple Pay button y flujo |
| `src/services/applePayService.ts` | New | Lógica: validateMerchant(), submitApplePayPayment() |
| `src/api/applePayApi.ts` | New | Llamadas HTTP: validate-merchant, merchant-id |
| `src/types/apple-pay.ts` | New | Tipos TypeScript para Apple Pay |
| Tests (`*.test.ts`) | New/Modified | Vitest tests con mock de ApplePaySession |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Tests en CI fallan porque ApplePaySession no existe en Node.js | High | Mock de ApplePaySession en setupTests; ya común en SDKs de pago |
| TypeScript types de ApplePayJS no disponibles | Medium | `@types/applepayjs` en devDependencies |
| Safari requiere HTTPS — no funciona en http://localhost | High | Documentar: testing de Apple Pay requiere ngrok o staging; los unit tests usan mock |
| La UX del botón varía según versión de Safari | Low | Usar siempre `-webkit-appearance: -apple-pay-button` — Apple lo maneja |
| Dave (owner) de vacaciones — bloqueante | High | Este documento SDD es la entrega completa para que Dave implemente sin contexto adicional |

## Rollback Plan

- El botón Apple Pay solo aparece cuando `apple_pay.enabled: true` y el browser es compatible
- Si hay un bug en el flujo Apple Pay, desactivar `apple_pay.enabled` en el merchant — el SDK deja de mostrar el botón sin nuevo deploy
- Los cambios en InlineCheckout y LiteInlineCheckout son aditivos (nuevo código de un método específico), no modifican el flujo de tarjeta existente

## Dependencies

- **feature-applepay-zplitback**: el endpoint `/apple-pay/validate-merchant/` debe existir antes de que el SDK pueda completar la sesión
- **feature-applepay-zplitback**: el endpoint de business debe retornar `apple_pay.enabled`
- **Dave (implementación)**: este documento + specs + tasks son el briefing completo para cuando regrese de vacaciones
- **`@types/applepayjs`**: agregar a devDependencies en web-sdk

## Success Criteria

- [ ] El botón Apple Pay aparece en Safari macOS/iOS cuando `apple_pay.enabled: true` y `ApplePaySession.canMakePayments()` es `true`
- [ ] El botón NO aparece en Chrome/Firefox/Edge — en ninguna plataforma
- [ ] El flujo completo (tap botón → Face ID → cargo exitoso) funciona en Safari con Tonder staging
- [ ] Los tests de Vitest pasan en CI usando mock de ApplePaySession (no requieren Safari real)
- [ ] No hay regresiones en el flujo de tarjeta regular en InlineCheckout ni LiteInlineCheckout

## Nota para Dave

Este documento + `specs/` + `tasks.md` tienen todo el contexto que necesitas para implementar sin consultar a Kushki nuevamente. Los campos exactos de la API de Kushki, el flujo de decryption, y las confirmaciones de soporte en México están en el release proposal padre (`openspec/changes/release-applepay/proposal.md`).

El backend (Lenin) implementará las features `applepay-kushki` y `applepay-zplitback` antes de que implementes el SDK, por lo que puedes mockear el backend para desarrollar y testear en paralelo.
