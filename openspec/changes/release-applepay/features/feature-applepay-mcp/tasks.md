# Tasks: applepay-mcp — MCP web-sdk: guía de migración Direct API → web-sdk + Apple Pay

**Owner:** Bel  
**Repo:** `web-sdk` (`/Users/leningomez/Documents/dev/tndr/front/web-sdk`)  
**Nota:** Esta feature es pura documentación y configuración de herramientas del MCP. No requiere código de producción.

---

## Phase 1: Documentar la integración Direct API actual (estado "desde")

- [ ] 1.1 Crear `docs/migration/direct-api-reference.md` en web-sdk:
  - Documentar el flujo completo que el merchant tiene hoy:
    1. `GET /api/v1/payments/business/{apiKey}` — obtener config
    2. `POST /api/v1/payments/orders/` — crear orden
    3. `POST /api/v1/payments/checkout/` con `{ card: { name, number, expiryMonth, expiryYear, cvv }, amount, currency }`
  - Incluir ejemplo de código JavaScript/TypeScript real que el merchant típicamente tiene
  - Documentar qué datos maneja el merchant en su propio front: validación, formato de tarjeta, manejo de errores, 3DS redirect

- [ ] 1.2 Crear tabla de equivalencias API en el mismo documento:
  | Direct API (actual) | web-sdk (destino) |
  |---------------------|-------------------|
  | Formulario HTML propio | `InlineCheckout` montado en div |
  | `POST /checkout/` con `card` | `checkout.pay()` interno del SDK |
  | Manejo manual de errores | Callbacks `onError`, `onSuccess` del SDK |
  | 3DS redirect manual | Manejado automáticamente por SDK |
  | Sin Apple Pay | Apple Pay automático si está habilitado |

---

## Phase 2: Guía de migración paso a paso

- [ ] 2.1 Crear `docs/migration/direct-api-to-sdk-guide.md` en web-sdk:

  **Paso 0 — Prerequisitos**
  - Tener API Key de Tonder (ya la tienen)
  - Acceder a staging de Tonder para probar antes de producción

  **Paso 1 — Instalar el SDK**
  ```bash
  npm install @tonder.io/web-sdk
  # o via CDN:
  <script src="https://cdn.tonder.io/web-sdk/latest/iife/web-sdk.js"></script>
  ```

  **Paso 2 — Reemplazar el formulario**
  Antes (Direct API):
  ```html
  <form id="payment-form">
    <input name="cardNumber" />
    <input name="expiry" />
    <input name="cvv" />
    <button type="submit">Pagar</button>
  </form>
  <script>
    document.getElementById('payment-form').addEventListener('submit', async (e) => {
      // ... llamada manual a /api/v1/payments/checkout/
    });
  </script>
  ```
  
  Después (web-sdk):
  ```html
  <div id="tonder-checkout"></div>
  <script>
    const checkout = new InlineCheckout({
      apiKey: 'tu-api-key',
      returnUrl: 'https://tudominio.com/success',
      mode: 'production', // o 'sandbox'
    });
    checkout.mount('#tonder-checkout');
    checkout.on('success', (response) => { /* cargo exitoso */ });
    checkout.on('error', (error) => { /* manejar error */ });
  </script>
  ```

  **Paso 3 — Configurar Apple Pay (si se quiere)**
  - Contactar a Tonder para activar `apple_pay_enabled` en la cuenta
  - Obtener el archivo `.well-known/apple-developer-merchantid-domain-association` de Tonder
  - Alojar el archivo en `https://tudominio.com/.well-known/apple-developer-merchantid-domain-association`
  - Verificar que el archivo es accesible públicamente (el MCP puede hacer esta verificación)
  - Apple Pay aparecerá automáticamente en Safari — no se requiere código adicional

- [ ] 2.2 Agregar sección de "Errores comunes durante la migración":
  - El formulario antiguo y el SDK coexisten (duplicate payment): asegurarse de remover el formulario antiguo
  - CORS: si el merchant tenía el backend en el mismo servidor, el SDK llama a Tonder directamente
  - Apple Pay no aparece: verificar que el archivo `.well-known` es accesible y que `apple_pay.enabled` está activado
  - "ApplePaySession is not defined": el merchant está en Chrome, no Safari — es correcto que no aparezca

---

## Phase 3: Checklist de configuración Apple Pay para merchants

- [ ] 3.1 Crear `docs/migration/apple-pay-merchant-checklist.md` en web-sdk:

  **Checklist completa para activar Apple Pay:**
  - [ ] El merchant usa el web-sdk de Tonder (InlineCheckout o LiteInlineCheckout)
  - [ ] El merchant tiene dominio con HTTPS configurado
  - [ ] Contactar a soporte de Tonder para obtener el archivo `.well-known`
  - [ ] Alojar el archivo en `https://[dominio]/.well-known/apple-developer-merchantid-domain-association`
  - [ ] Verificar que el archivo retorna HTTP 200 con `Content-Type: application/octet-stream`
  - [ ] Confirmar con Tonder que `apple_pay_enabled` fue activado en la cuenta
  - [ ] Probar en Safari en macOS o iOS — el botón debe aparecer automáticamente

  **Verificación del archivo `.well-known`** (script de diagnóstico para el MCP):
  ```bash
  curl -I "https://[dominio]/.well-known/apple-developer-merchantid-domain-association"
  # Debe retornar HTTP 200
  ```

---

## Phase 4: Configurar el MCP con este caso de uso

- [ ] 4.1 Agregar tool definition al MCP: `guide_apple_pay_migration`
  - Input: dominio del merchant + tipo de integración actual (Direct API / propio)
  - Output: guía personalizada de migración + checklist para su dominio específico
  - El MCP puede verificar si el `.well-known` ya está alojado haciendo un GET al dominio

- [ ] 4.2 Agregar tool definition al MCP: `generate_sdk_snippet`
  - Input: tipo de checkout (InlineCheckout / LiteInlineCheckout), API key, returnUrl
  - Output: snippet completo listo para copiar y pegar
  - Si el merchant tiene Apple Pay habilitado, incluir nota sobre compatibilidad Safari

- [ ] 4.3 Agregar tool definition al MCP: `verify_apple_pay_setup`
  - Input: dominio del merchant
  - Output: resultado de verificación del `.well-known` + instrucciones si está mal configurado

- [ ] 4.4 Documentar en el README del MCP que el primer caso de uso validado es la migración Direct API → web-sdk con Apple Pay.

---

## Notas para Bel

- El contexto técnico completo de Apple Pay (por qué solo SDK, qué hace cada endpoint, campos Kushki) está en `openspec/changes/release-applepay/proposal.md` del repo `usrv-kushki-acq`. Lenin puede compartirte ese documento.
- Los endpoints exactos de zplit-back para Apple Pay están en `features/feature-applepay-zplitback/proposal.md`.
- La implementación del SDK (InlineCheckout/LiteInlineCheckout) de Dave está en `features/feature-applepay-sdk/proposal.md`.
- El archivo `.well-known` lo provee Lenin — viene de Apple Developer Portal (integración Direct Apple donde Tonder tiene el certificado raíz).
