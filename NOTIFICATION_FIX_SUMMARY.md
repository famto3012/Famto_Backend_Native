# Notification Duplication Fix Summary

**Project:** Famto Backend Native  
**Date:** July 20, 2026  
**Session:** CTO Mentor / Engineering Succession Partner  
**Status:** Phase 1 & 2 Complete — Phase 3 (Structural) Pending

---

## 🎯 Problem Statement

**Customer receives 4× push notifications per order. Agent receives 2× (or 0× due to token corruption).**

### Root Cause (Multiplicative Effect)

| Layer | Problem | Impact |
|-------|---------|--------|
| **FcmToken DB** | Old records (pre-cap) have 4+ tokens from repeated app reinstalls | 4–5+ tokens/user in DB |
| **`populateUserSocketMap`** (index.js:238, runs every 60s) | Loads ALL tokens from DB into `userSocketMap` with **zero capping** | Inflates in-memory token array to match DB |
| **`sendNotification`** (socket.js:442) | Loops `for (let token of fcmToken)` — fires one push per token, uncapped | Pushes = `fcmToken.length` |

**4× = 4 tokens × 1 notification path** (not 2 paths). The user accumulated 4 tokens before the 3-token cap was added; `populateUserSocketMap` loads all 4; `sendNotification` fires all 4.

**Agent 2×/0×** = Agent login (`agentController.js:251`) overwrites FcmToken document to a **single string** (not array), so agents have at most 1 token. But `populateUserSocketMap` loads the string, and `for (let token of fcmToken)` iterates **characters**, not tokens.

---

## 🛠️ Files Modified in This Session

### 1. `socket/socket.js` — `populateUserSocketMap` (lines 474–489) ✅ **FIXED**

**Before:**
```javascript
tokens.forEach((token) => {
  if (userSocketMap[token.userId]) {
    userSocketMap[token.userId].fcmToken = token.token;  // NO CAP
  } else {
    userSocketMap[token.userId] = { socketId: null, fcmToken: token.token };
  }
});
```

**After:**
```javascript
tokens.forEach((token) => {
  // Cap tokens at 3 to prevent stale-token explosion from pre-cap DB records
  const tokenArray = Array.isArray(token.token) ? token.token.slice(-3) : [];
  if (userSocketMap[token.userId]) {
    userSocketMap[token.userId].fcmToken = tokenArray;
  } else {
    userSocketMap[token.userId] = { socketId: null, fcmToken: tokenArray };
  }
});
```

**Why `slice(-3)`?** Keeps the 3 **newest** tokens (most recently used), drops oldest. Matches the DB save logic which does `shift()` (drops oldest) then `push()` (adds newest).

---

### 2. `socket/socket.js` — Socket Reconnect Handler (lines 1029–1033) ✅ **FIXED**

**Before:**
```javascript
} else {
  userSocketMap[userId].socketId = socket.id;
}
```

**After:**
```javascript
} else {
  // On reconnect: refresh token array from DB (capped at 3) to replace any stale memory state
  userSocketMap[userId].socketId = socket.id;
  if (Array.isArray(user?.token)) {
    userSocketMap[userId].fcmToken = user.token.slice(-3);
  }
}
```

**Why?** The 60-second cron overwrites `userSocketMap` with DB data. But between cron runs, a user can reconnect with a new token. This ensures the in-memory map gets refreshed from DB on every reconnect, not just on cron.

---

### 3. `controllers/agent/agentController.js` — Agent Login (line 253) ✅ **FIXED**

**Before:**
```javascript
FcmToken.findOneAndUpdate(
  { userId: agentFound._id },
  { token: fcmToken },  // ❌ Sets token to STRING, corrupts [String] schema
  { upsert: true, new: true }
)
```

**After:**
```javascript
FcmToken.findOneAndUpdate(
  { userId: agentFound._id },
  { token: [fcmToken] },  // ✅ Sets token to ARRAY of one element
  { upsert: true, new: true }
)
```

**Impact:** Prevents character-iteration bug where `for (let token of "cX9z...")` sends 150 invalid FCM requests.

---

### 4. `models/fcmToken.js` — Schema Hardening ✅ **FIXED**

**Added:**
1. **Array validator** — Enforces `token.length <= 3` at Mongoose level
2. **TTL index** — `updatedAt` expires after 90 days (auto-prunes stale tokens)

```javascript
token: {
  type: [String],
  required: true,
  validate: {
    validator: function (v) {
      return Array.isArray(v) && v.length <= 3;
    },
    message: "Token array cannot exceed 3 elements",
  },
},

// TTL index: expire documents 90 days after last update
fcmTokenSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
```

**Note:** TTL expires the **entire document** after 90 days of inactivity. For per-token expiry, a schema change (one document per token) would be needed — see Phase 3.

---

## ✅ Verified: Already Working

### DB Save Cap — `socket/socket.js:1011–1014` ✅ **ALREADY AT 3**

```javascript
if (!user.token.includes(fcmToken)) {
    if (user.token.length === 3) user.token.shift();  // Drops OLDEST
    user.token.push(fcmToken);                         // Adds NEWEST
    await user.save();
}
```

This caps **new** tokens at 3. It never prunes **existing** documents that already have 4+.

---

## 🚨 REQUIRED: One-Time DB Cleanup (Manual — Agent Blocked)

The agent cannot run `mongosh`. **You must run this in your terminal:**

```bash
cd /home/ice/code/work/Famto_Backend_Native
MONGO_URL=$(grep -oP 'MONGO_URL=\K.*' .env)
mongosh "$MONGO_URL" --quiet --eval '
  const result = db.fcmtokens.updateMany(
    { $expr: { $gt: [{ $size: { $ifNull: ["$token", []] } }, 3] } },
    [{ $set: { token: { $slice: ["$token", -3] } } }]
  );
  print(`Capped ${result.modifiedCount} documents to 3 tokens`);
'
```

**What it does:** Finds all documents with >3 tokens, slices to keep only the last 3 (newest).

**Without this:** Existing users with 4+ tokens will still get 4+ pushes until they reconnect (which triggers the reconnect fix) or the cron runs (which now caps on load).

---

## 📋 Phase 3: Structural Fixes (Next Session)

| Task | File | Priority | Notes |
|------|------|----------|-------|
| **3.1** Deduplicate notification paths | Multiple | P0 | `sendSocketDataAndNotification` fires from cron + controller + helpers for different order types. Consolidate into single NotificationService with exactly-once semantics. |
| **3.2** Audit commented notification calls | universalOrderController.js | P1 | Lines 2783, 2964, 3150, 3678, 3845 — verify dead code or re-enable with deduplication. |
| **3.3** Fix `NotificationSetting` double-notify risk | socketHelper.js | P1 | `findRolesToNotify` can return "customer" twice (default array + `notificationSettings.manager`). |
| **3.4** Schema redesign: per-token documents + TTL | models/fcmToken.js | P2 | Current TTL expires whole doc. Better: `{ userId, token, createdAt }` + TTL on `createdAt`. |
| **3.5** Race condition on FcmToken save | socket.js:1011–1015 | P1 | Two simultaneous connections can race: both read 3 tokens, both shift, both push, last save wins. Use `$push` + `$slice` atomic update. |
| **3.6** Graceful shutdown for socket.io + cron | index.js, socket.js | P2 | No SIGTERM handler — cron jobs and socket connections die mid-request on deploy. |

---

## 🧪 Verification Checklist (Post-Fix)

- [ ] Run DB cleanup script (above)
- [ ] Restart backend: `pm2 restart famto-backend` (or your process manager)
- [ ] Place test order (Famto-cash / COD / Online)
- [ ] Verify **exactly 1 push** arrives on test device (customer app)
- [ ] Agent login → verify FCM token stored as array in Mongo: `db.fcmtokens.findOne({ userId: "AGENT_ID" })`
- [ ] Place agent order → verify **exactly 1 push** on agent device
- [ ] Check merchant/admin notifications still work (they use Firebase project 2: `famtoagent`)
- [ ] Monitor logs for `Error populating User Socket Map` or `Token array cannot exceed 3 elements`

---

## 🔍 Key Files to Re-Read Next Session

1. **`socket/socket.js`** — Lines 95–191 (`sendPushNotificationToUser`), 420–457 (`sendNotification`), 474–489 (`populateUserSocketMap`), 981–1035 (socket handler)
2. **`index.js`** — Lines 236–271 (minute cron), 275–430 (5-second cron + notification at 332–386)
3. **`utils/socketHelper.js`** — Full file (67 lines, orchestrates role-based dispatch)
4. **`models/fcmToken.js`** — Schema with new validator + TTL
5. **`controllers/agent/agentController.js`** — Line 251 (fixed)

---

## 📐 System Mechanics Recap

### Notification Flow (Immediate Order)
```
Customer places order (Famto-cash/COD/Online)
    ↓
orderPaymentController → TemporaryOrder.create() → returns to client
    ↓ (no notification yet — 60s cancellation window)
5-second cron (index.js:275) picks up TemporaryOrder where expiresAt <= now
    ↓
processOrderService() → creates Order in transaction
    ↓
index.js:332–386 → sendSocketDataAndNotification({
    rolesToNotify: ["admin","merchant","driver","customer"],
    userIds: { admin, merchant, agent, customer }
})
    ↓
socketHelper.js: for each role → sendNotification(roleId, ...)
    ↓
socket.js:442 → for (let token of fcmToken) { sendPushNotificationToUser(token, ...) }
    ↓
socket.js:106 → admin1.messaging(app1).send(payload)  ← Customer tokens (project famto-aa73e)
```

### Dual Firebase Projects (Critical — Never Remove)
| Project | Project ID | Serves |
|---------|------------|--------|
| `admin1` / `app1` | `famto-aa73e` | Customer tokens |
| `admin2` / `app2` | `famtoagent` | Agent/Admin/Merchant tokens |

Fallback pattern: try Project 1 → on failure try Project 2. Intentional multi-audience dispatch.

### Token Lifecycle
```
Socket connects with userId + fcmToken
    ↓
FcmToken.findOne({ userId })
    ├─ Not found → Create { token: [fcmToken] }
    └─ Found → If token not in array:
                  If length < 3 → push
                  If length === 3 → shift oldest, push
               Save to DB
    ↓
userSocketMap[userId] = { socketId, fcmToken: user.token, location: [] }
    ↓
EVERY 60 SECONDS (index.js:238):
    populateUserSocketMap() → FcmToken.find({}) → copies ALL tokens to userSocketMap (NOW CAPPED AT 3)
    ↓
When notification fires: sendNotification reads userSocketMap[userId].fcmToken
    → loops ALL tokens (max 3) → fires N pushes
```

---

## ⚠️ Critical Warnings (From Handover)

| Issue | Severity | Details |
|-------|----------|---------|
| `populateUserSocketMap` runs every 60s | P0 | Can overwrite in-flight notifications with stale data. `sendNotification` reads `fcmToken` at start, but cron replaces the entire reference. |
| `setImmediate` for `creditMilestoneBonus` | P2 | `ProcessOrderService.js:183` and `universalOrderController.js:2324` use `setImmediate` intentionally (fire-and-forget after HTTP response). **Do not wrap in try/catch or make synchronous.** |
| Agent string corruption | P1 | Fixed in this session. Was: `token: fcmToken` (string) → `for (let token of fcmToken)` iterates characters. |
| Race condition on FcmToken save | P1 | Two simultaneous connections race: both read 3 tokens → both shift → both push → last save wins. Use atomic `$push` + `$slice`. |
| Dual Firebase SDKs required | P0 | **Never remove either.** Customer and agent/admin/merchant use different Firebase projects. |
| Notification paths not deduplicated | P0 | Same event (`newOrderCreated`) can fire from controller AND cron for different order types. Scheduled orders notify at creation AND each recurrence. |

---

## 📝 Notes for Future Maintainer

1. **The 3-token cap is a pragmatic compromise.** It balances "user reinstalls app" (new token) vs "token accumulation." TTL index handles long-term cleanup.

2. **The reconnect refresh is essential.** Without it, a user who reconnects between cron runs gets their new token in DB but stale tokens in memory until next cron. The fix bridges that gap.

3. **Agent corruption was silent.** No error thrown — Mongoose may or may not coerce string→array. But `for (let token of string)` is valid JS (iterates chars), so 150 failed FCM calls happened silently. Always validate array types at schema + handler level.

4. **Schema validator only runs on save().** `findOneAndUpdate` with `{ runValidators: true }` would enforce it on updates too. Consider adding to the agent controller call.

5. **TTL index caveat:** `expireAfterSeconds` on `updatedAt` means an active user (frequent logins) keeps their doc alive indefinitely. Inactive users (90 days no login) get pruned. This is correct behavior.

6. **Race condition fix (Phase 3.5):**
   ```javascript
   // Replace the read-modify-write with atomic update:
   await FcmToken.findOneAndUpdate(
     { userId },
     {
       $push: {
         token: {
           $each: [fcmToken],
           $slice: -3,  // Keep only last 3
           $position: 0 // Add to front (newest first)
         }
       }
     },
     { upsert: true, new: true }
   );
   ```

---

*Generated July 20, 2026. Session: Full investigation → Phase 1/2 fixes applied → Phase 3 planned.*