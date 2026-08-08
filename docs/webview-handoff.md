# Cashfree / PhonePe — Mobile App Handoff

Status: **backend done, app not done**. The dashboard needs nothing (admin toggles,
per-merchant overrides, merchant gateway-credentials screen are all shipped). The
changes below are for the **mobile app** (`famto_app`, Flutter) — forward to the
app developers.

---

## 1. Order-create response (what the app receives now)

`POST <base>/order` with `paymentMode: "Online-payment"` — the backend already
returns this superset. **Branch on `gateway`; never assume.**

> **The request body is exactly `{ "paymentMode": "Online-payment" }`**. No gateway,
> no merchant id, no cart fields leave the app. The backend reads the customer's
> cart from their token, looks up the merchant, and calls
> `resolvePaymentGateway(merchantId)` — which applies admin toggles, the
> merchant's Own/Platform choice, credential presence, and falls back to
> platform Razorpay if anything is disabled. The app just reads the returned
> `gateway` + `keyId`/`paymentUrl`.

### Cashfree or PhonePe (merchant's own gateway, "Own" mode)

```jsonc
{
  "success": true,
  "orderId": "663f...",
  "gateway": "cashfree",            // "razorpay" | "cashfree" | "phonepe"
  "gatewayOrderId": "famto_ab12cd34ef56",
  "razorpayOrderId": null,          // null for cashfree/phonepe
  "amount": 250.0,                  // rupees (decimal)
  "keyId": null,                    // only set for razorpay
  "token": "session_8a1b...",       // cashfree: payment_session_id | phonepe: merchantTransactionId
  "paymentUrl": "https://payments.cashfree.com/order/session_8a1b...",  // hosted page (webview target)
  "paymentAccountMode": "Own",      // "Own" | "Platform"
  "walletBalance": "0.00"
}
```

### Razorpay (unchanged, legacy shape)

```jsonc
{
  "success": true,
  "orderId": "663f...",
  "gateway": "razorpay",
  "gatewayOrderId": "order_P...",   // === razorpayOrderId
  "razorpayOrderId": "order_P...",
  "amount": 250.0,
  "keyId": "rzp_live_...",          // present for razorpay
  "token": null,
  "paymentUrl": null,
  "paymentAccountMode": "Platform",
  "walletBalance": "0.00"
}
```

## Gateway handling only applies to `Online-payment`

The app sends exactly `{ "paymentMode": "Online-payment" | "Cash-on-delivery" | "Famto-cash" }`.

| `paymentMode` | Backend action | Gateway involved? |
|---|---|---|
| `Online-payment` | `resolvePaymentGateway(merchantId)` → creates order on razorpay/cashfree/phonepe | **Yes** — this doc's entire scope |
| `Cash-on-delivery` | Creates order, marks payment pending for delivery collection | **No** |
| `Famto-cash` | Deducts customer wallet balance | **No** |

---

> **Important:** even if a merchant is configured for cashfree/phonepe, if the
> gateway or the self-payment option is disabled the backend **falls back to
> `gateway: "razorpay"`** (with `keyId` set). The app must switch on the returned
> `gateway`, not on merchant config.

COD and wallet are completely separate branches in the backend — **zero gateway code runs** for them. They behave exactly as before.

## "Own gateway" vs "Our gateway" — who decides

The merchant's choice is **resolved entirely server-side** in
`resolvePaymentGateway`; the app never knows or cares which mode the merchant
picked. It only reads the returned `gateway` + `keyId`.

| Merchant config | Order-create returns | App flow |
|---|---|---|
| Our gateway (Platform) | `gateway:"razorpay"`, `paymentAccountMode:"Platform"`, `keyId` = **platform key** | inline Razorpay SDK (legacy, unchanged) |
| Own gateway + Razorpay | `gateway:"razorpay"`, `paymentAccountMode:"Own"`, `keyId` = **merchant's key** | inline Razorpay SDK — **use returned `keyId`, not a hardcoded key** |
| Own gateway + Cashfree | `gateway:"cashfree"`, `paymentUrl` | webview |
| Own gateway + PhonePe | `gateway:"phonepe"`, `paymentUrl` | webview |

**App rule:** branch on `gateway` only. Razorpay → inline SDK; cashfree/phonepe →
webview. For razorpay, always pass the returned `keyId` into the SDK — the key
differs for Platform vs Own merchants.

---

## 2. Verify request + response

```
POST <base>/verify
Content-Type: application/json
```

### Cashfree / PhonePe

```jsonc
{ "paymentDetails": { "gatewayOrderId": "famto_ab12cd34ef56", "paymentId": "optional" } }
```

### Razorpay — unchanged, keep existing

```jsonc
{ "paymentDetails": { "razorpay_order_id": "...", "razorpay_payment_id": "...", "razorpay_signature": "..." } }
```

### Response (same for all gateways)

```json
{ "success": true, "message": "Payment verified successfully", "orderId": "663f..." }
```

Failure → HTTP 400:

```json
{ "errors": { "general": "Payment verification failed" } }
```

### How verification works (why the app only sends `gatewayOrderId`)

For cashfree/phonepe the backend does an authoritative **status-API cross-check**
against the gateway (not a client signature), so the app only needs to send back
`gatewayOrderId`. The provider also posts a webhook
(`/api/v1/merchants/:merchantId/cashfree-webhook` / `phonepe-webhook`) that marks
the order `PAYMENT_COMPLETED` server-side — verify is the app's confirmation step,
not the only one.

---

## 3. App changes (famto_app — Flutter)

### 3.1 Add a webview package

`webview_flutter` (or `flutter_inappwebview`). Cashfree and PhonePe both use
hosted pages, so a generic webview is enough; no native SDK required.

### 3.2 Branch in `checkout_page.dart` (~line 1710)

On the create-order response:

- `gateway == "razorpay"` → inline Razorpay SDK, **but pass `keyId` too**:
  `startPayment(orderId: orderData['razorpayOrderId'], amount: orderData['amount'], key: orderData['keyId'])`.
  Today `payment_provider.dart` hardcodes `ApiConstants.razorpayKey` (platform
  key); an **Own + Razorpay** merchant returns the *merchant's* key, so the SDK
  must use the response `keyId` or the payment fails key/order mismatch.
- `gateway == "cashfree" || gateway == "phonepe"` → open a **webview screen**
  with `orderData['paymentUrl']`. Pass `orderData` through (the screen needs
  `gatewayOrderId` + `amount` for the post-payment step).

### 3.3 New webview payment screen (e.g. `webview_payment_page.dart`)

- Load `paymentUrl`.
- **Completion detection:** the hosted page ends by redirecting (cashfree → the
  merchant account's return URL; phonepe → the server-set `redirectUrl`). Either
  works because backend verify is a status cross-check:
  - Intercept navigation in the webview when it reaches the return host, **or**
  - Dismiss the webview when the user closes it and just call verify.
- On completion → call verify with `{ gatewayOrderId }`.

### 3.4 Verify path

`UniversalService.verifyPayment` + `PaymentNotifier` currently hardcode
`razorpay_order_id`. Add a `gatewayOrderId` branch (razorpay signature path
untouched). On `success == true` → same post-payment flow as today (clear cart,
go to home).

### 3.5 `pubspec.yaml`

Add the webview dependency (Android/iOS webview permissions come with
`webview_flutter`).

---

## Optional (no backend change required)

If you want the webview to auto-close on payment completion instead of
user-dismiss: the return/redirect host is set server-side via `APP_CALLBACK_URL`
env (currently `https://famto.in`). The webview can watch for that host and pop
itself. For an app-scheme deep link, tell us the scheme and we set
`APP_CALLBACK_URL` to it — one-line backend change, currently optional.

---

## Current app state (famto_app)

- `lib/services/UniversalFlow/payment_Service.dart` — thin Razorpay SDK wrapper
  (`init` / `open` / `dispose`).
- `lib/providers/UniversalFlow/payment_provider.dart` — `PaymentNotifier` calls
  `_razorpay.open(...)` inline with a **hardcoded platform `key`**, verifies via
  `UniversalService.verifyPayment` with `razorpay_order_id`. Needs to accept the
  response `keyId` (for Own+razorpay) and add a `gatewayOrderId` verify branch.
- `lib/views/universal/checkout_page.dart` ~line 1710 — `startPayment` is only
  called with `razorpayOrderId`; needs to branch on `gateway` and pass `keyId`.

---

## Backend Notes (for the mobile team)

### Cache invalidation fix
A bug was found where merchant-specific feature cache (60s TTL) was not being
cleared when the **global** feature config changed. Fixed in
`utils/featureConfig.js`: `invalidateFeatureCache()` called without `merchantId`
now clears **all** cache entries (`_cache.clear()`). The backend must be
restarted after this fix for the global toggle enforcement to work immediately
(without waiting for the 60s TTL).

### Fallback behavior
Even if a merchant is configured for cashfree/phonepe, if the gateway or the
self-payment option is disabled the backend **falls back to
`gateway: "razorpay"`** (with `keyId` set). The app must switch on the returned
`gateway`, not on merchant config.
