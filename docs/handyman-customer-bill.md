# Branch: `handyman-customer-bill`

Changes on this branch compared to `main`. Three categories: revert, tax fix restore, and new endpoint.

---

## 1. Revert of PR #176 — Customer bill field / Pickup item feature

**PR #176** (`feat/handymanBillForCustomer`) was reverted in full. Everything it introduced is gone:

### Reverted: `models/Order.js`
- `lineItemType` (enum: `order`, `handyman_added`, `customer_pickup`) — removed from `purchasedItemsSchema`
- `addedAt` (Date) — removed from `purchasedItemsSchema`
- `_id: true` on `purchasedItemsSchema` — restored to `_id: false`

### Reverted: `controllers/agent/agentController.js`
- `addPickupItemController` — removed entirely
- `CustomerAppCustomization`, `Tax` imports — removed (restored in Section 2)
- Event name `customOrderItemPriceUpdated` — restored (was changed to `billUpdate`)
- Event name `orderItemsUpdatedByAgent` — restored (was changed to `billUpdate`)
- Socket data shape for `customOrderItemPriceUpdated` — restored old shape (no `changeType`/`changeDescription`)
- Socket data shape for `orderItemsUpdatedByAgent` — restored old shape (`addedItems` array, no `changeType`/`changeDescription`)
- `lineItemType` parameter in `addHomeDeliveryItemController` — removed
- Dynamic tax recalculation in `addCustomOrderItemPriceController` — removed (restored in Section 2)
- Dynamic tax recalculation in `addHomeDeliveryItemController` — removed (restored in Section 2)

### Reverted: `routes/agentRoute/agentRoute.js`
- `addPickupItemController` import — removed
- `POST /add-pickup-item/:orderId` route — removed

---

## 2. Dynamic tax recalculation (restored independently)

The tax recalculation logic that was bundled inside PR #176 was re-applied as a standalone commit, without the reverted customer-bill features.

### File: `controllers/agent/agentController.js`

#### New imports (lines 21-22)

```js
const CustomerAppCustomization = require("../../models/CustomerAppCustomization");
const Tax = require("../../models/Tax");
```

#### `addCustomOrderItemPriceController` (custom order item price update)

**Before:** Grand total was `itemTotal + deliveryCharge + surgePrice`. No tax was computed.

```js
const updatedGrandTotal = updatedSubTotal;
```

**After:** Tax is recalculated from the `CustomerAppCustomization.taxId` configuration on every price update. The taxable base is `itemTotal + deliveryCharge + surgePrice`. Tax is written to `billDetail.taxAmount`.

```js
// ── Recalculate tax on the full taxable base ──
const appCustomization = await CustomerAppCustomization.findOne({}).select(
  "customOrderCustomization"
);
const taxId = appCustomization?.customOrderCustomization?.taxId;
let taxAmount = 0;
if (taxId) {
  const taxFound = await Tax.findById(taxId);
  if (taxFound && taxFound.status && taxFound.taxType === "Percentage") {
    const taxableBase = updatedItemTotal + deliveryCharge + surgePrice;
    taxAmount = parseFloat(((taxableBase * taxFound.tax) / 100).toFixed(2));
  }
}

const updatedGrandTotal = updatedSubTotal + taxAmount;

orderFound.billDetail.taxAmount = taxAmount;
```

#### `addHomeDeliveryItemController` (home delivery item addition)

**Before:** Used the stale `billDetail.taxAmount` from order creation, unchanged when new items are added.

```js
const taxAmount = orderFound.billDetail.taxAmount || 0;
const subTotal = itemTotal + deliveryCharge + surgePrice + taxAmount;
const grandTotal = subTotal + addedTip - discountedAmount;
```

**After:** Computes tax fresh from the same configuration source, on the full updated base.

```js
const subTotal = itemTotal + deliveryCharge + surgePrice;

// ── Recalculate tax on the full taxable base ──
const appCustomization = await CustomerAppCustomization.findOne({}).select(
  "customOrderCustomization"
);
const taxId = appCustomization?.customOrderCustomization?.taxId;
let taxAmount = 0;
if (taxId) {
  const taxFound = await Tax.findById(taxId);
  if (taxFound && taxFound.status && taxFound.taxType === "Percentage") {
    const taxableBase = itemTotal + deliveryCharge + surgePrice;
    taxAmount = parseFloat(((taxableBase * taxFound.tax) / 100).toFixed(2));
  }
}

const grandTotal = subTotal + addedTip - discountedAmount + taxAmount;

orderFound.billDetail.taxAmount = taxAmount;
```

**Why this matters:** Without this fix, when a handyman adds items mid-delivery, the tax stays frozen at whatever was calculated at order creation. The recalculation ensures the customer is billed the correct tax on the full post-addition amount.

---

## 3. New endpoint: Download notes receipt as PDF/Image

### Purpose

When a handyman adds notes to an order (via `POST /add-order-detail/:orderId`), this endpoint lets both dashboard users and customers download those notes as a formatted receipt — either as a PDF or a PNG image.

### Files changed

| File | Change |
|---|---|
| `controllers/admin/order/adminOrderController.js` | New `downloadNotesReceiptController` + export |
| `routes/adminRoute/orderRoute/orderRoute.js` | New `POST /orders/download-notes-receipt` route (admin/merchant) |
| `routes/customerRoute/customerRoute.js` | New `POST /download-notes-receipt` route (customer) |

### Route registration

**Dashboard (admin/merchant):**
```
POST /orders/download-notes-receipt
Middleware: isAuthenticated, isAdminOrMerchant
```

**Customer app (Flutter):**
```
POST /download-notes-receipt
Middleware: isAuthenticated
```

Both routes call the **same controller function**. Authorization is handled inside the controller, not duplicated in route middleware.

### Request

```json
{
  "orderId": "O-67d6a08f7c6cd6e8534a4a5d",
  "format": "pdf"
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `orderId` | string | Yes | — | The order ID |
| `format` | string | No | `"pdf"` | `"pdf"` or `"image"` |

### Responses

| Status | Condition |
|---|---|
| `200` | File download (`Order_Notes_O-XXXX.pdf` or `Order_Notes_O-XXXX.png`) |
| `400` | Missing `orderId` or invalid `format` |
| `403` | Customer trying to access another customer's order |
| `404` | Order not found, or no notes on the order |

**Note:** Role comparison is case-insensitive (`req.userRole?.toLowerCase()`) — JWTs from the auth system use `"Admin"` / `"Merchant"` / `"Customer"`, and this works regardless.

### Authorization rules (inside the controller)

| Role | Access |
|---|---|
| `admin` | Any order |
| `merchant` | Any order |
| `customer` | Only orders where `customerId._id` matches `req.userAuth` |

### Generated document layout

```
┌──────────────────────────────────┐
│  [Famto Logo]  Famto            │
│                Private Limited   │  Order ID: O-XXXXX
│──────────────────────────────────│
│        RECEIPT                     │  ← Main heading, large, centered
│──────────────────────────────────│
│  Customer     │  Date            │
│  John Doe     │  30 Jul 2026     │
│──────────────────────────────────│
│                                  │
│  {Agent's notes text,            │
│   line breaks preserved,         │
│   pre-wrap formatting}           │
│                                  │
│──────────────────────────────────│
│  Thank you for choosing Famto    │
│  contact@famto.in | +91 97781..  │
└──────────────────────────────────┘
```

- PDF output: A4 format, print background enabled
- Image output: Full-page PNG screenshot
- Uses the same Puppeteer instance and launch config as existing bill PDFs
- Temp file is deleted after download

### How to call from the Dashboard (React)

Same pattern as the existing `downloadOrderBill`:

```js
import { useApiClient } from "@/utils/api";

export const downloadNotesReceipt = async (orderId, format, navigate) => {
  try {
    const api = useApiClient(navigate);
    const res = await api.post(
      "/orders/download-notes-receipt",
      { orderId, format },
      { responseType: "blob" }
    );

    const ext = format === "image" ? "png" : "pdf";
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Order_Notes_${orderId}.${ext}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    return res.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.message || "Failed to download notes receipt"
    );
  }
};
```

### How to call from Flutter (customer app)

```dart
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'dart:io';

Future<File> downloadNotesReceipt({
  required String orderId,
  required String token,
  String format = 'pdf',
}) async {
  final response = await http.post(
    Uri.parse('$baseUrl/download-notes-receipt'),
    headers: {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
    },
    body: jsonEncode({
      'orderId': orderId,
      'format': format,
    }),
  );

  if (response.statusCode != 200) {
    throw Exception(jsonDecode(response.body)['message'] ?? 'Download failed');
  }

  final dir = await getTemporaryDirectory();
  final ext = format == 'image' ? 'png' : 'pdf';
  final file = File('${dir.path}/Order_Notes_$orderId.$ext');
  await file.writeAsBytes(response.bodyBytes);
  return file;
}
```

Then open with `open_file` or `share_plus` for the user to view/share.

---

## Summary: What's different from `main`

| Aspect | `main` | `handyman-customer-bill` |
|---|---|---|
| `purchasedItemsSchema` | has `lineItemType`, `addedAt`, `_id: true` | no `lineItemType`, no `addedAt`, `_id: false` |
| `addPickupItemController` | exists | removed |
| `POST /add-pickup-item/:orderId` | exists | removed |
| Event names in handyman controllers | `billUpdate`, `billUpdate` | `customOrderItemPriceUpdated`, `orderItemsUpdatedByAgent` |
| Socket payload for item price update | `{changeType, changeDescription, billDetail}` | `{orderId, addedItems, billDetail}` (old shape) |
| Tax on handyman item price update | off (grandTotal = subTotal) | **recaculated from CustomerAppCustomization.taxId** |
| Tax on handyman home-delivery add | off (uses stale billDetail.taxAmount) | **recalculated from CustomerAppCustomization.taxId** |
| Invoice bill download | yes (`/orders/download-order-bill`) | yes |
| Notes receipt download | **does not exist** | `POST /orders/download-notes-receipt` (admin) + `POST /download-notes-receipt` (customer) |
