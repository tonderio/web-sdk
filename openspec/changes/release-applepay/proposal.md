# Release Proposal: applepay — Apple Pay SDK Integration (web-sdk)

## Intent

Integrar Apple Pay como método de pago en el SDK de Tonder (`InlineCheckout` y `LiteInlineCheckout`). Apple Pay solo es viable en el producto SDK — Tonder controla el frontend y puede ejecutar `ApplePaySession` en Safari, detectar compatibilidad automáticamente y manejar el flujo completo sin que el merchant escriba código adicional. El merchant solo activa Apple Pay en su dashboard y aloja el archivo `.well-known` en su dominio.

**Restricción de browser:** Apple Pay JS API solo está disponible en Safari (macOS/iOS). No funciona en Chrome, Firefox ni Edge, ni siquiera en iPhone. El SDK detecta esto automáticamente con `ApplePaySession.canMakePayments()`.

## Features en este repo (web-sdk)

| Feature ID | Descripción | Owner | Priority |
|------------|-------------|-------|----------|
| feature-applepay-sdk | Apple Pay en InlineCheckout y LiteInlineCheckout | Dave | P0 |
| feature-applepay-mcp | Documentación MCP: migración Direct API → web-sdk + Apple Pay | Bel | P1 |

## Dependencias del backend (otros repos)

| Feature | Repo | Owner | Descripción |
|---------|------|-------|-------------|
| feature-applepay-kushki | usrv-kushki-acq | Lenin | Lambda que desencripta PKPaymentToken y ejecuta cargo con Kushki |
| feature-applepay-zplitback | zplit-back | Lenin | Endpoints validate-merchant, merchant-id y routing checkout |

Los docs completos del backend están en `usrv-kushki-acq/openspec/changes/release-applepay/`.

## Out of Scope (web-sdk)

- Decryption del PKPaymentToken — lo hace la lambda de Lenin (usrv-kushki-acq)
- Suscripciones Apple Pay
- Google Pay
- Apps nativas iOS

## Success Criteria

- [ ] El botón Apple Pay aparece automáticamente en Safari cuando `apple_pay.enabled: true`
- [ ] El botón NO aparece en Chrome/Firefox/Edge
- [ ] El flujo completo (click → biometría → cargo) funciona en staging de Tonder
- [ ] Tests Vitest pasan en CI (sin Safari real, usando mock de ApplePaySession)
- [ ] No hay regresiones en InlineCheckout ni LiteInlineCheckout con tarjeta regular

## Rollback Plan

- El botón Apple Pay se muestra solo cuando `apple_pay.enabled: true` — se puede desactivar sin deploy
- Los cambios en InlineCheckout y LiteInlineCheckout son aditivos — no tocan el flujo de tarjeta

## Contexto técnico (preservado — no re-consultar)

Ver documento completo en: `usrv-kushki-acq/openspec/changes/release-applepay/proposal.md`

Puntos clave:
- Direct Apple integration: Tonder tiene los certificados (no Kushki library)
- PKPaymentToken → desencriptado en Lambda usrv-kushki-acq → tokenización Kushki
- Sandbox México confirmado (solo Visa/Mastercard)
- `onvalidatemerchant` → zplit-back proxy → Apple (usando Merchant Identity Cert)
- Kushki token: usar `card.cryptogram` + `isNetworkToken: true` + `networkToken` object
