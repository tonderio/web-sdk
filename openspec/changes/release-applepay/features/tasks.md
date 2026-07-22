# Tasks: applepay-sdk — Apple Pay en web-sdk

**Owner:** Dave  
**Repo:** `web-sdk` (`/Users/leningomez/Documents/dev/tndr/front/web-sdk`)  
**Branch:** `feature/applepay-sdk` (desde `release/applepay` del web-sdk repo)  
**Nota:** Lenin implementa las features de backend antes. Dave puede mockear los endpoints para desarrollar en paralelo.

---

## Phase 1: Foundation — Tipos, port e interfaces

- [ ] 1.1 Agregar `@types/applepayjs` a `devDependencies`:
  ```bash
  npm install --save-dev @types/applepayjs
  ```
  Verificar que los tipos `ApplePayJS.ApplePayPaymentRequest`, `ApplePayJS.ApplePayPaymentAuthorizedEvent`, etc. están disponibles.

- [ ] 1.2 Crear `src/types/apple-pay.ts` con tipos propios del SDK:
  ```typescript
  export interface ApplePayConfig {
    enabled: boolean;
  }
  export interface ApplePayPaymentResult {
    success: boolean;
    error?: string;
    chargeResponse?: unknown;
  }
  ```

- [ ] 1.3 Crear `src/ports/IApplePayAdapter.ts`:
  ```typescript
  export interface IApplePayAdapter {
    canUseApplePay(): boolean;
    createSession(version: number, request: ApplePayJS.ApplePayPaymentRequest): IApplePaySessionHandle;
  }
  export interface IApplePaySessionHandle {
    begin(): void;
    abort(): void;
    completeMerchantValidation(merchantSession: unknown): void;
    completePayment(status: number): void;
    onvalidatemerchant: ((event: ApplePayJS.ApplePayValidateMerchantEvent) => void) | null;
    onpaymentauthorized: ((event: ApplePayJS.ApplePayPaymentAuthorizedEvent) => void) | null;
    oncancel: ((event: Event) => void) | null;
  }
  ```

---

## Phase 2: Adapters — Real y Mock

- [ ] 2.1 [RED] Crear `src/adapters/ApplePaySessionAdapter.test.ts`:
  - Test: `canUseApplePay()` retorna `false` cuando `ApplePaySession` no está en window
  - Test: `canUseApplePay()` retorna el resultado de `ApplePaySession.canMakePayments()` cuando está disponible

- [ ] 2.2 [GREEN] Crear `src/adapters/ApplePaySessionAdapter.ts` implementando `IApplePayAdapter`:
  - `canUseApplePay()`: `return typeof ApplePaySession !== 'undefined' && ApplePaySession.canMakePayments()`
  - `createSession(version, request)`: `return new ApplePaySession(version, request)` — hace tipo casting a `IApplePaySessionHandle`

- [ ] 2.3 Crear `src/adapters/MockApplePaySessionAdapter.ts` para tests:
  - `canUseApplePay()`: retorna `true` por defecto (configurable en el constructor)
  - `createSession()`: retorna un objeto con `onvalidatemerchant`, `onpaymentauthorized`, `oncancel` como propiedades escribibles + métodos `begin()`, `abort()`, `completeMerchantValidation()`, `completePayment()` como spies/stubs

---

## Phase 3: API y servicio Apple Pay

- [ ] 3.1 Crear `src/api/applePayApi.ts`:
  ```typescript
  export async function getMerchantId(baseUrl: string, apiKey: string): Promise<string>
  export async function validateMerchant(baseUrl: string, apiKey: string, validationURL: string, domainName: string): Promise<unknown>
  ```
  Usar `fetch()` para llamar a los endpoints de zplit-back. Manejar errores HTTP con throws descriptivos.

- [ ] 3.2 [RED] Crear `src/services/applePayService.test.ts`:
  - Test: `submitApplePayCheckout()` llama al checkout con `payment_method: 'apple_pay'` y `apple_pay_token`
  - Test: falla si `apple_pay_token` es undefined
  - Mock de `fetch` en todos los tests

- [ ] 3.3 [GREEN] Crear `src/services/applePayService.ts`:
  - `startApplePaySession(config, checkoutData, adapter)`: función principal que orquesta el flujo
  - `onvalidatemerchant` handler: llama `validateMerchant()` → `session.completeMerchantValidation()`
  - `onpaymentauthorized` handler: extrae `event.payment.token` → llama checkout → `session.completePayment(STATUS_SUCCESS/FAILURE)`
  - `oncancel` handler: emite evento de cancelación al caller

---

## Phase 4: Componente botón Apple Pay

- [ ] 4.1 Crear `src/components/ApplePayButton.ts` (o equivalente según el patrón del web-sdk):
  - Función o clase que crea el elemento `<button class="apple-pay-button">` con el CSS correcto
  - El CSS DEBE incluir `-webkit-appearance: -apple-pay-button`
  - El botón recibe un callback `onClick` que el caller conecta al `startApplePaySession()`

- [ ] 4.2 [RED] Crear test para `ApplePayButton`:
  - Test: el elemento creado tiene la clase CSS correcta
  - Test: el callback `onClick` se invoca cuando se hace click en el botón

---

## Phase 5: Integración en InlineCheckout

- [ ] 5.1 [RED] En `InlineCheckout.test.ts`, agregar tests:
  - Test: Apple Pay button NO aparece cuando `apple_pay.enabled: false` (mock del businessData)
  - Test: Apple Pay button NO aparece cuando `canUseApplePay()` retorna `false` (mock adapter)
  - Test: Apple Pay button aparece cuando ambas condiciones son `true`
  - Test: click en Apple Pay button inicia `startApplePaySession()` (spy)
  - Test: flujo de tarjeta regular no se ve afectado (no regresión)

- [ ] 5.2 [GREEN] Modificar `InlineCheckout.ts`:
  - En el método de inicialización, después de `fetchBusiness()`, evaluar si mostrar botón Apple Pay
  - Inyectar `ApplePaySessionAdapter` (o mock en tests) via parámetro de configuración o DI del SDK
  - Conectar botón Apple Pay con `startApplePaySession()`
  - Manejar los eventos de éxito, error y cancelación del `startApplePaySession()`

---

## Phase 6: Integración en LiteInlineCheckout

- [ ] 6.1 [RED] En `LiteInlineCheckout.test.ts`, agregar los mismos tests de Apple Pay que en InlineCheckout (mismos escenarios)

- [ ] 6.2 [GREEN] Modificar `LiteInlineCheckout.ts` con la misma integración que InlineCheckout

---

## Phase 7: Verificación

- [ ] 7.1 Ejecutar `npm run test` — todos los tests Vitest deben pasar incluyendo los nuevos

- [ ] 7.2 Ejecutar type checking: `npm run typecheck` (o equivalente) — sin errores TypeScript

- [ ] 7.3 Probar manualmente en Safari (macOS o iOS con ngrok/staging):
  - El botón Apple Pay aparece en Safari con merchant habilitado
  - El botón Apple Pay NO aparece en Chrome
  - El flujo completo (click → Face ID → cargo) funciona en staging de Tonder

- [ ] 7.4 Verificar que `npm run build` genera el bundle sin errores (Rollup)

---

## Notas para Dave

- El backend de Apple Pay (usrv-kushki-acq + zplit-back) estará listo antes de que implementes. Mientras tanto, mockea los endpoints en tus tests.
- Todo el contexto técnico de Apple Pay (campos Kushki, decryption flow, compatibilidad de browsers) está en `openspec/changes/release-applepay/proposal.md` en el repo de usrv-kushki-acq. Lenin te puede compartir ese documento.
- Para testear en Safari local: Apple Pay requiere HTTPS y un dominio registrado. Usa ngrok o el ambiente de staging de Tonder.
- El tipo `ApplePayJS.ApplePaySession.STATUS_SUCCESS` y `STATUS_FAILURE` son constantes numéricas (0 y 1) disponibles en `@types/applepayjs`.
