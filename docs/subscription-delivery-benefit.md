# Subscription Delivery Benefit

- **Author:** adithyan-sajan
- **Branch:** `feat/dynamicallyChangeFreeDeliveryDetails`
- **PR:** #166
- **Status:** Merged

---

## 1. Why This Exists

Subscribers get reduced or free delivery as part of their subscription plan.
Before this feature, all active subscribers got free delivery with no caps.
This added:

1. **Three benefit types** — free, percentage discount, or fixed discount.
2. **Distance gating** — a subscriber can get free delivery up to a max KM;
   beyond that they pay full price.
3. **Slot consumption** — free delivery consumes one order slot (`currentNumberOfOrders`).
   If all slots are used, subsequent orders charge full delivery.

---

## 2. Data Model

### 2.1 Plan Definition — `models/CustomerSubscription.js`

This is the **plan template** — defines what subscribers get. Admins create these
in the dashboard.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `deliveryBenefitType` | `String` | `"free"` | One of `free`, `percentage`, `fixed` |
| `deliveryBenefitValue` | `Number` | `0` | Amount for % or fixed discount (percentage: 1–100, fixed: rupees) |
| `freeDeliveryUpToKm` | `Number` | `0` | Distance cap for "free" type. `0` = unlimited. |

```javascript
// Example plans

// 1) Free delivery, any distance (legacy)
{ deliveryBenefitType: "free", freeDeliveryUpToKm: 0 }

// 2) Free delivery only within 5 km
{ deliveryBenefitType: "free", freeDeliveryUpToKm: 5 }

// 3) 20% off delivery, no distance cap
{ deliveryBenefitType: "percentage", deliveryBenefitValue: 20 }

// 4) ₹15 off delivery, no distance cap
{ deliveryBenefitType: "fixed", deliveryBenefitValue: 15 }
```

### 2.2 Subscription Log — `models/SubscriptionLog.js`

Created when a customer subscribes (or when payment is confirmed). This is a
**snapshot** linked to a plan. The relevant fields:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `planId` | Mixed | required | References the plan used to subscribe |
| `startDate` | Date | required | When subscription starts |
| `endDate` | Date | required | When subscription expires |
| `maxOrders` | Number | `null` | Max orders in this period (`null` = unlimited) |
| `currentNumberOfOrders` | Number | `0` | Orders consumed so far |

**Note:** `maxFreeDistanceKm` on `SubscriptionLog` is a legacy field from PR #148,
no longer read by the controller. Distance caps now come from the plan
(`deliveryBenefitType` + `freeDeliveryUpToKm`).

#### When is a subscription log created?

In `controllers/admin/commissionAndSubscription/subscriptionLogController.js`:

```javascript
// Line ~103 (for "Cash" payment mode)
await SubscriptionLog.create({
  planId,
  userId,
  amount: totalAmount,
  paymentMode: "Cash",
  startDate,
  endDate,
  typeOfUser: "Merchant",
  maxOrders,
  paymentStatus: "Unpaid",
  razorpayOrderId: null,
});
```

The same happens in the online-payment flow after Razorpay confirmation.

---

## 3. Control Flow (Order Confirmation)

All logic lives in the `confirmOrderDetailController` function inside
`controllers/customer/universalOrderController.js`, lines ~2030–2091.

### 3.1 Flow Diagram

```
confirmOrderDetailController
  │
  ├── Calculate delivery charge │
  ├── Get customer subscription log (by customer.pricing[0])
  │
  └── if subscription exists AND delivery mode is "Home Delivery"
        │
        ├── Check: subscription active?
        │     • startDate <= now (inclusive)
        │     • endDate >= now   (inclusive)
        │     • maxOrders === null OR currentNumberOfOrders < maxOrders
        │
        ├── YES → Fetch plan definition (CustomerSubscription.findById(planId).lean())
        │
        │     ├── Plan found?
        │     │   YES → Read benefitType
        │     │   │
        │     │   ├── "percentage"
        │     │   │     actualDeliveryCharge = charge - (charge * benefitValue / 100)
        │     │   │     Minimum 0.
        │     │   │
        │     │   ├── "fixed"
        │     │   │     actualDeliveryCharge = charge - benefitValue (rupees)
        │     │   │     Minimum 0.
        │     │   │
        │     │   └── "free" (else)
        │     │         ├── freeDeliveryUpToKm > 0 AND distance > freeDeliveryUpToKm?
        │     │         │   YES → actualDeliveryCharge = full charge (distance too far)
        │     │         │   NO  → actualDeliveryCharge = 0
        │     │         │          currentNumberOfOrders += 1
        │     │         │          subscriptionLog.save()
        │     │         │          (slot consumed only when free delivery actually applied)
        │     │         │
        │     │         └── Note: freeDeliveryUpToKm = 0 means unlimited distance
        │     │
        │     └── Plan not found → actualDeliveryCharge = 0
        │                          (fail-safe for legacy subscriptions)
        │
        └── NO → actualDeliveryCharge = oneTimeDeliveryCharge (full price)
```

### 3.2 Pseudo-code

```
function getDeliveryCharge(customer, distance, baseCharge):
  if customer has no subscription OR mode ≠ "Home Delivery":
    return baseCharge

  log = SubscriptionLog.findById(customer.pricing[0])
  if not log:
    return baseCharge

  now = new Date()

  // Subscription must be active
  if log.startDate > now || log.endDate < now:
    return baseCharge

  // Must have remaining order slots
  if log.maxOrders != null && log.currentNumberOfOrders >= log.maxOrders:
    return baseCharge

  // Fetch the plan to read benefit rules
  plan = CustomerSubscription.findById(log.planId).lean()
  if not plan:
    return 0  // Safety fallback

  benefitType = plan.deliveryBenefitType || "free"
  benefitValue = plan.deliveryBenefitValue || 0

  if benefitType == "percentage":
    return max(0, baseCharge - (baseCharge * benefitValue / 100))

  if benefitType == "fixed":
    return max(0, baseCharge - benefitValue)

  // "free" type
  capKm = plan.freeDeliveryUpToKm || 0
  if capKm > 0 && distance > capKm:
    return baseCharge  // Too far — charge full

  // Free delivery — consume a slot and charge 0
  log.currentNumberOfOrders += 1
  await log.save()
  return 0
```

### 3.3 Key Points

- **Dates are inclusive** (`<=` / `>=`) — a subscription starting today is
  considered active.
- **Null-safe maxOrders** — `maxOrders === null` means unlimited; the check
  skips the limit comparison.
- **Slot consumption** — `currentNumberOfOrders` increments only when
  free delivery actually applies, not when distance exceeds the cap. This
  matches the semantics in PR #148.
- **Plan not found** — falls back to `actualDeliveryCharge = 0` so existing
  subscribers don't get charged unexpectedly if the plan was deleted.

---

## 4. Benefit Type Behaviours

| Type | `benefitValue` | Example | Result |
|---|---|---|---|
| `free` | ignored | 50 km distance, cap 5 km | Full charge (distance exceeds cap) |
| `free` | ignored | 3 km distance, cap 5 km | Free delivery, slot consumed |
| `free` | ignored | Any distance, cap 0 (unlimited) | Free delivery, slot consumed |
| `percentage` | `20` | ₹100 delivery | ₹80 (20% off) |
| `percentage` | `50` | ₹30 delivery | ₹15 (50% off) |
| `fixed` | `15` | ₹50 delivery | ₹35 (₹15 off) |
| `fixed` | `100` | ₹50 delivery | ₹0 (clamped to 0) |

---

## 5. Admin Workflow

In the dashboard, when creating or editing a subscription plan:

1. Select **Delivery Benefit Type**:
   - **Free** — default; optionally set a max distance (KM) for free delivery.
   - **Percentage** — enter a number (1–100). That % is deducted from the
     delivery charge.
   - **Fixed** — enter a rupee amount. That amount is deducted from the
     delivery charge (minimum ₹0).

2. The fields `deliveryBenefitType`, `deliveryBenefitValue`, and
   `freeDeliveryUpToKm` are stored on the **plan definition** in the
   `CustomerSubscription` collection.

3. All active subscriptions on that plan pick up changes immediately —
   no migration needed.

---

## 6. Merge History

This feature (`feat/dynamicallyChangeFreeDeliveryDetails`) conflicts with
PR #148 (`fix/subscription-free-delivery`) because both modified the same
`if` block in `confirmOrderDetailController`.

**What PR #148 did:**
- Added `maxFreeDistanceKm` to both `CustomerSubscription` and `SubscriptionLog`
- Read the distance cap directly from the subscription log at order time
- Only handled "free" benefit (no percentage/fixed support)

**What this branch does:**
- Adds `deliveryBenefitType`, `deliveryBenefitValue`, `freeDeliveryUpToKm` to
  the plan only
- Reads benefit rules from the plan (requires one extra query)
- Supports three benefit types
- Adopted PR #148's fixes: inclusive dates, null-safe maxOrders, slot
  consumption on free delivery

**Resolution:** Plan-based (normalized) architecture retained — more flexible
and changes propagate to active subs automatically.
`maxFreeDistanceKm` was removed from both schemas; the controller only reads
from `deliveryBenefitType` / `freeDeliveryUpToKm`.

---

## 7. Testing

The following edge cases are covered by an ad-hoc test script at
`/tmp/hermes-verify-merge-subscription.js` (11 tests, all passing):

1. Active subscription with free delivery → charge = 0
2. Free delivery but distance exceeds cap → full charge
3. Free delivery within distance cap → charge = 0
4. Percentage discount → reduced charge
5. Fixed discount → reduced charge
6. Expired subscription → full charge
7. Max orders reached → full charge
8. Null maxOrders (unlimited) → free delivery
9. Missing plan → fallback to free
10. Fixed discount clamped at 0
11. Inclusive start date (today) → free delivery
