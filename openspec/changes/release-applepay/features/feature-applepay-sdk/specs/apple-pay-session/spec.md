# Apple Pay Session Specification — web-sdk

## Purpose

Define el comportamiento del SDK de Tonder al integrar Apple Pay en `InlineCheckout` y `LiteInlineCheckout`: detección de compatibilidad, renderizado del botón, flujo completo de `ApplePaySession`, y envío del resultado al checkout de Tonder.

---

## Requirements

### Requirement: Detección de compatibilidad y visibilidad del botón

El sistema MUST verificar dos condiciones antes de mostrar el botón de Apple Pay:
1. `typeof ApplePaySession !== 'undefined' && ApplePaySession.canMakePayments()` — el browser soporta Apple Pay
2. `businessData.apple_pay?.enabled === true` — el merchant tiene Apple Pay habilitado

El sistema MUST NOT mostrar el botón de Apple Pay si cualquiera de las dos condiciones es `false`.
El sistema MUST NOT lanzar errores cuando `ApplePaySession` no está definido (browsers no-Safari).

#### Scenario: Safari con merchant Apple Pay habilitado

- GIVEN el checkout carga en Safari macOS o iOS
- AND `ApplePaySession.canMakePayments()` retorna `true`
- AND `businessData.apple_pay.enabled` es `true`
- WHEN el checkout termina de inicializarse
- THEN el botón de Apple Pay es visible y clickeable

#### Scenario: Chrome con merchant Apple Pay habilitado

- GIVEN el checkout carga en Chrome (cualquier plataforma)
- AND `ApplePaySession` no está definido en `window`
- AND `businessData.apple_pay.enabled` es `true`
- WHEN el checkout termina de inicializarse
- THEN el botón de Apple Pay NO aparece (no hay error, simplemente no existe el elemento)

#### Scenario: Safari con merchant Apple Pay deshabilitado

- GIVEN el checkout carga en Safari
- AND `ApplePaySession.canMakePayments()` es `true`
- AND `businessData.apple_pay.enabled` es `false`
- WHEN el checkout termina de inicializarse
- THEN el botón de Apple Pay NO aparece

---

### Requirement: Inicialización de ApplePaySession

El sistema MUST inicializar `ApplePaySession` con `version: 3` y un `ApplePayPaymentRequest` con los campos:
- `countryCode`: código del país del merchant (del businessData o configuración)
- `currencyCode`: moneda de la transacción
- `supportedNetworks`: `['visa', 'masterCard']`
- `merchantCapabilities`: `['supports3DS']`
- `total.label`: nombre del merchant (del businessData)
- `total.amount`: monto total como string

El sistema MUST obtener el `merchantIdentifier` desde `GET /api/v1/payments/apple-pay/merchant-id/` antes de iniciar la sesión.

El sistema MUST NOT iniciar la sesión Apple Pay fuera de un evento de interacción del usuario (click handler del botón).

#### Scenario: Sesión iniciada correctamente

- GIVEN el usuario hace click en el botón de Apple Pay en Safari
- AND el `merchantIdentifier` fue obtenido exitosamente
- WHEN el sistema llama `new ApplePaySession(3, paymentRequest).begin()`
- THEN Apple muestra el sheet de pago nativo en el dispositivo

---

### Requirement: Validación de merchant (onvalidatemerchant)

El sistema MUST manejar el evento `session.onvalidatemerchant` llamando a `POST /api/v1/payments/apple-pay/validate-merchant/` con `{ validationURL, domainName: window.location.hostname }`.

El sistema MUST llamar `session.completeMerchantValidation(merchantSession)` con la respuesta del backend.

El sistema MUST llamar `session.abort()` y notificar al usuario si la validación falla.

#### Scenario: Validación exitosa

- GIVEN Apple dispara `onvalidatemerchant` con `event.validationURL`
- WHEN el SDK llama al backend con esa URL y el backend retorna `merchantSession`
- THEN el SDK llama `session.completeMerchantValidation(merchantSession)`
- AND Apple procede a mostrar el sheet de pago

#### Scenario: Validación fallida (error del backend)

- GIVEN Apple dispara `onvalidatemerchant` pero el backend retorna error
- WHEN el SDK recibe el error
- THEN el SDK llama `session.abort()`
- AND se emite un evento de error al merchant con un mensaje descriptivo

---

### Requirement: Autorización de pago (onpaymentauthorized)

El sistema MUST manejar el evento `session.onpaymentauthorized` extrayendo `event.payment.token` (PKPaymentToken).

El sistema MUST enviar el checkout a Tonder con `payment_method: 'apple_pay'` y `apple_pay_token: event.payment.token`.

El sistema MUST llamar `session.completePayment(ApplePaySession.STATUS_SUCCESS)` cuando el cargo sea exitoso.

El sistema MUST llamar `session.completePayment(ApplePaySession.STATUS_FAILURE)` cuando el cargo falle.

#### Scenario: Pago autorizado y cargo exitoso

- GIVEN el usuario autoriza el pago con Face ID/Touch ID
- AND Apple dispara `onpaymentauthorized` con `event.payment.token` válido
- WHEN el SDK envía el checkout a Tonder y el cargo es exitoso
- THEN el SDK llama `session.completePayment(STATUS_SUCCESS)`
- AND Apple muestra la pantalla de confirmación de pago
- AND el SDK emite el evento de éxito al merchant con la respuesta del cargo

#### Scenario: Pago autorizado pero cargo fallido

- GIVEN el usuario autoriza el pago
- AND el cargo de Tonder/Kushki falla (fondos insuficientes, etc.)
- WHEN el SDK recibe el error del cargo
- THEN el SDK llama `session.completePayment(STATUS_FAILURE)`
- AND Apple muestra la pantalla de error de pago
- AND el SDK emite el evento de error al merchant

---

### Requirement: Cancelación (oncancel)

El sistema MUST manejar el evento `session.oncancel` emitiendo un evento de cancelación al merchant.

El sistema MUST NOT reintentar el pago automáticamente cuando el usuario cancela.

#### Scenario: Usuario cancela el pago

- GIVEN el sheet de pago de Apple Pay está abierto
- WHEN el usuario presiona "Cancel" o cierra el sheet
- THEN Apple dispara `oncancel`
- AND el SDK emite un evento de cancelación al merchant (no es un error — es acción del usuario)

---

### Requirement: Botón Apple Pay (CSS)

El sistema MUST renderizar el botón Apple Pay usando el estilo oficial de Apple:
```css
button.apple-pay-button {
  -webkit-appearance: -apple-pay-button;
  -apple-pay-button-type: 'buy';
}
```

El sistema MUST NOT usar imágenes custom del logo de Apple Pay (violación de HIG de Apple).

#### Scenario: Botón renderizado correctamente en Safari

- GIVEN el botón Apple Pay es visible
- WHEN se inspecciona el elemento en Safari
- THEN el botón tiene `-webkit-appearance: -apple-pay-button` en su CSS
- AND el botón muestra el logo de Apple Pay oficial renderizado por WebKit

---

### Requirement: Compatibilidad con InlineCheckout y LiteInlineCheckout

El sistema MUST implementar el flujo Apple Pay tanto en `InlineCheckout` como en `LiteInlineCheckout` con el mismo comportamiento.

El sistema MUST NOT romper el flujo de pago con tarjeta regular en ninguno de los dos checkouts.

#### Scenario: InlineCheckout con Apple Pay y tarjeta

- GIVEN InlineCheckout muestra tanto el formulario de tarjeta como el botón Apple Pay
- WHEN el usuario usa el formulario de tarjeta (no Apple Pay)
- THEN el flujo de tarjeta regular funciona exactamente igual que antes de este feature

---

### Requirement: Testing en entornos no-Safari

El sistema MUST exponer un `IApplePayAdapter` port que permita inyectar un mock de `ApplePaySession` en tests.

El sistema MUST proveer un `MockApplePaySessionAdapter` que simule el comportamiento de `ApplePaySession` para Vitest.

#### Scenario: Tests unitarios en CI (Node.js, sin Safari)

- GIVEN los tests de Vitest corren en Node.js (no tiene `ApplePaySession`)
- AND el test inyecta `MockApplePaySessionAdapter`
- WHEN se ejecuta el flujo Apple Pay en el test
- THEN el test puede verificar que `onvalidatemerchant`, `onpaymentauthorized` y `oncancel` se llaman correctamente
- AND los tests pasan sin requerir Safari o un dispositivo real
