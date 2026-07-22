# Feature Proposal: applepay-mcp — MCP web-sdk: migración de Direct API a web-sdk con Apple Pay

## Parent Release

Release: applepay — Apple Pay SDK Integration
Release Intent: Habilitar Apple Pay en el SDK de Tonder (InlineCheckout/LiteInlineCheckout) usando integración Direct Apple — Tonder desencripta PKPaymentToken server-side y tokeniza a través de Kushki.

## Intent

Documentar el primer caso de uso del MCP de web-sdk: guiar a merchants que actualmente usan la integración Direct API (custom frontend + endpoints de zplit-back) a migrar a web-sdk (InlineCheckout/LiteInlineCheckout) como prerequisito para obtener Apple Pay. Este es el flujo crítico de adopción — los merchants que quieran Apple Pay **deben** migrar al SDK primero, ya que Apple Pay no es viable en el producto Direct API.

El MCP de Bel usa esta migración como caso de uso ancla para demostrar el valor del SDK y reducir la fricción de migración.

## Scope

### In Scope
- Documentar la integración actual Direct API: qué hace el merchant hoy (llamadas directas a endpoints Tonder)
- Documentar la integración web-sdk equivalente: cómo el merchant debe migrar cada paso
- Mapeo de equivalencias API: endpoint Direct API → comportamiento en web-sdk
- Guía paso a paso de migración para el MCP:
  1. Instalar `@tonder.io/web-sdk`
  2. Reemplazar formulario propio con `InlineCheckout` o `LiteInlineCheckout`
  3. Configurar Apple Pay: obtener archivo `.well-known`, alojarlo en dominio del merchant
  4. Solicitar a Tonder activación de `apple_pay.enabled` para el merchant
  5. Verificar en staging
- Recursos que el MCP debe proveer: snippets de código, checklist de configuración, errores comunes
- Análisis de riesgos de la migración: merchants con formulario custom muy personalizado

### Out of Scope
- Implementación del MCP en sí — eso es trabajo de Bel
- Documentar nuevas features más allá de Apple Pay para la versión inicial del MCP
- Migración de merchants que usen Google Pay u otros métodos alternativos (no implementados aún)

## Approach

### Integración Direct API (estado actual del merchant)
El merchant construye su propio formulario de pago y llama directamente a la API de Tonder:
```
1. GET /api/v1/payments/business/{apiKey} → obtener config del merchant
2. POST /api/v1/payments/orders/ → crear orden
3. POST /api/v1/payments/checkout/ → procesar pago con { card: {...}, amount, currency }
```
El merchant maneja su propio UI, validación, y flujo de error.

### Integración web-sdk (estado objetivo)
El merchant instala el SDK y reemplaza su formulario:
```html
<div id="tonder-checkout"></div>
<script>
  const checkout = new InlineCheckout({
    apiKey: 'merchant-api-key',
    returnUrl: 'https://merchant.com/success',
    mode: 'production',
  });
  checkout.mount('#tonder-checkout');
</script>
```
El SDK maneja: formulario, validación, Apple Pay (automático si está habilitado), flujo de error, y respuesta de éxito/fallo.

### Prerequisito Apple Pay para el merchant
Para que Apple Pay funcione, el merchant debe:
1. Alojar el archivo `.well-known/apple-developer-merchantid-domain-association` en `https://su-dominio.com/.well-known/`
2. El archivo lo provee Lenin/Tonder (desde Apple Developer Portal — integración Direct Apple)
3. Solicitar a Tonder que active `apple_pay: enabled` en su cuenta (flag en Django admin)
4. No hay código adicional que el merchant deba escribir — el SDK lo maneja automáticamente

### Contenido del MCP para este caso de uso
El MCP debe poder:
- Guiar interactivamente al merchant en la migración (preguntar sobre su integración actual, generar código)
- Proveer snippet `InlineCheckout` vs `LiteInlineCheckout` según preferencia del merchant
- Generar checklist de configuración Apple Pay específico para el dominio del merchant
- Responder preguntas sobre compatibilidad (browsers, países, métodos de pago soportados)
- Proveer ejemplos de manejo de errores en el nuevo SDK

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `docs/migration/direct-api-to-sdk.md` (web-sdk) | New | Guía de migración técnica completa |
| `docs/migration/apple-pay-setup.md` (web-sdk) | New | Checklist de configuración Apple Pay para merchants |
| MCP tool definitions (Bel) | New | Herramientas del MCP para guiar la migración |
| `examples/apple-pay/` (web-sdk) | New | Ejemplos de código para InlineCheckout con Apple Pay |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Merchants con UI muy customizada no pueden usar InlineCheckout (no permite customización full) | High | Documentar LiteInlineCheckout como alternativa para mayor control de UI; si aún no es suficiente, posponer su migración |
| El MCP puede generar código incorrecto si el contexto del web-sdk cambia | Medium | El MCP debe leer siempre la documentación actualizada del SDK (no hardcodear versiones) |
| Merchants no alojan el .well-known correctamente | High | Proveer en el MCP un verificador del archivo .well-known (GET request al dominio del merchant) |

## Rollback Plan

Esta feature es pura documentación y herramientas del MCP — no hay código de producción. Si hay un error en la guía, se actualiza el documento y se re-entrena/actualiza el MCP.

## Dependencies

- **feature-applepay-sdk**: el web-sdk debe estar implementado antes de que la guía de migración pueda ser testeada end-to-end
- **feature-applepay-zplitback**: los endpoints Apple Pay deben existir para que el flujo migrado funcione
- **Bel (implementación del MCP)**: este documento + guías de migración son el input para construir el MCP

## Success Criteria

- [ ] La guía de migración Direct API → web-sdk está completa y sin ambigüedades
- [ ] El checklist de configuración Apple Pay para merchants está documentado paso a paso
- [ ] El MCP puede guiar a un merchant en la migración completa sin intervención manual de Tonder
- [ ] Existe al menos un merchant real que migró usando el MCP como guía (criterio de beta)

## Nota para Bel

Este es el **primer caso de uso** del MCP de web-sdk. El foco es:
1. Un merchant que hoy usa Direct API quiere Apple Pay
2. Descubre que necesita migrar al SDK primero
3. El MCP le guía en la migración paso a paso

El contexto técnico completo de Apple Pay está en el release proposal padre (`openspec/changes/release-applepay/proposal.md`). Los endpoints exactos de Tonder están en `feature-applepay-zplitback/proposal.md`. La implementación del SDK está en `feature-applepay-sdk/proposal.md`.
