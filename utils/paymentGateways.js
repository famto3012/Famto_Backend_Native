const crypto = require("crypto");
const axios = require("axios");
const MerchantPaymentConfig = require("../models/MerchantPaymentConfig");
const TemporaryOrder = require("../models/TemporaryOrder");
const WebhookEvent = require("../models/WebhookEvent");
const { featureEnabled } = require("./featureConfig");
const { createMerchantRazorpayOrderId } = require("./merchantRazorpay");
const { createRazorpayOrderId } = require("./razorpayPayment");

// Platform processes payments only through Razorpay. Cashfree/PhonePe are
// self-payment (Own mode) gateways — merchants hold their own credentials.
const FALLBACK_GATEWAY = "razorpay";

// Provider endpoints (env-overridable for sandbox/testing).
const CASHFREE_BASE = process.env.CASHFREE_BASE_URL || "https://api.cashfree.com/pg";
const CASHFREE_PAYMENTS_BASE =
  process.env.CASHFREE_PAYMENTS_BASE_URL || "https://payments.cashfree.com";
const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || "2023-08-01";
const PHONEPE_BASE = process.env.PHONEPE_BASE_URL || "https://api.phonepe.com/apis/hermes";
const APP_CALLBACK_URL = process.env.APP_CALLBACK_URL || "https://famto.in";

const hasGatewayCredentials = (gw, creds) => {
  if (!creds) return false;
  if (gw === "razorpay") return Boolean(creds.keyId && creds.keySecret);
  if (gw === "cashfree") return Boolean(creds.clientId && creds.clientSecret);
  if (gw === "phonepe")
    return Boolean(creds.merchantId && creds.saltKey && creds.saltIndex);
  return false;
};

// Load a merchant's payment config WITH decrypted gateway credentials.
// Returns null when not found / not Own / not Active.
// Nested secret leaves are select:false — they must each be selected explicitly.
const SECRET_SELECT =
  "+keySecret +gatewayCredentials.razorpay.keySecret +gatewayCredentials.cashfree.clientSecret +gatewayCredentials.phonepe.saltKey";

const loadOwnConfig = async (merchantId) => {
  const config = await MerchantPaymentConfig.findOne({ merchantId }).select(
    SECRET_SELECT
  );
  if (!config || config.mode !== "Own" || config.status !== "Active") return null;
  return config;
};

/**
 * Decide the gateway + mode a checkout must use.
 * Own mode requires: config Own+Active, the merchant's chosen gateway enabled,
 * AND the self-payment option enabled (global or per-merchant override).
 * Otherwise → hard fallback to platform Razorpay.
 */
const resolvePaymentGateway = async (merchantId) => {
  const config = await loadOwnConfig(merchantId);
  if (!config) return { gateway: FALLBACK_GATEWAY, mode: "Platform", config: null };

  const gw = config.gateway || FALLBACK_GATEWAY;
  const [gwEnabled, selfEnabled] = await Promise.all([
    featureEnabled(`gateways.${gw}`, merchantId),
    featureEnabled("selfPaymentOption", merchantId),
  ]);
  if (!gwEnabled || !selfEnabled) {
    return { gateway: FALLBACK_GATEWAY, mode: "Platform", config: null };
  }
  if (!hasGatewayCredentials(gw, config.getDecryptedGatewayCredentials(gw))) {
    return { gateway: FALLBACK_GATEWAY, mode: "Platform", config: null };
  }
  return { gateway: gw, mode: "Own", config };
};

/**
 * Create a payment order on the resolved gateway.
 * customerInfo = { customerId, name, email, phone } (required by cashfree/phonepe).
 * mode = the mode decided by resolvePaymentGateway. For razorpay this matters:
 *   "Platform" (feature-flag fallback) MUST use the platform client — the
 *   merchant's Own keys would otherwise be used and mislabeled as Platform.
 * Returns a normalized payload for the app:
 *   razorpay → { gatewayOrderId, razorpayOrderId, keyId }  (inline SDK)
 *   cashfree → { token: payment_session_id, paymentUrl: hosted page }  (webview)
 *   phonepe  → { token: merchantTransactionId, paymentUrl: redirect }  (webview)
 */
const createGatewayOrderId = async (gateway, merchantId, amount, customerInfo = {}, mode = null) => {
  if (gateway === "razorpay") {
    if (mode === "Platform") {
      // Forced platform fallback (gateway/selfPayment disabled) — platform keys.
      const res = await createRazorpayOrderId(amount);
      if (!res.success) return { success: false, gateway, error: res.error };
      return {
        success: true,
        gateway,
        gatewayOrderId: res.orderId,
        razorpayOrderId: res.orderId,
        keyId: process.env.RAZORPAY_KEY_ID || null,
        mode: "Platform",
        token: null,
        paymentUrl: null,
      };
    }
    const res = await createMerchantRazorpayOrderId(merchantId, amount);
    if (!res.success) return { success: false, gateway, error: res.error };
    return {
      success: true,
      gateway,
      gatewayOrderId: res.orderId,
      razorpayOrderId: res.orderId,
      keyId: res.keyId || null,
      mode: res.mode || "Platform",
      token: null,
      paymentUrl: null,
    };
  }
  if (gateway === "cashfree") return createCashfreeOrder(merchantId, amount, customerInfo);
  if (gateway === "phonepe") return createPhonePeOrder(merchantId, amount, customerInfo);
  return { success: false, gateway, error: `Unsupported gateway: ${gateway}` };
};

// ── Cashfree PG (v2) ───────────────────────────────────────────────────────
const createCashfreeOrder = async (merchantId, amount, customerInfo) => {
  try {
    const config = await loadOwnConfig(merchantId);
    const creds = config?.getDecryptedGatewayCredentials("cashfree");
    console.log("=== CASHFREE CREATE ORDER DEBUG ===");
    console.log("Merchant ID:", merchantId);
    console.log("Config found:", !!config);
    console.log("Config mode:", config?.mode);
    console.log("Config status:", config?.status);
    console.log("Decrypted creds:", creds ? { clientId: creds.clientId, clientSecret: creds.clientSecret ? "***" : "MISSING" } : "NULL");
    console.log("ENV CASHFREE_BASE:", CASHFREE_BASE);
    console.log("ENV CASHFREE_API_VERSION:", CASHFREE_API_VERSION);
    console.log("====================================");

    if (!creds) return { success: false, gateway: "cashfree", error: "No Cashfree credentials" };

    const orderId = `famto_${crypto.randomBytes(8).toString("hex")}`;
    const payload = {
      order_id: orderId,
      order_amount: Number(amount),
      order_currency: "INR",
      order_note: "Famto order",
      customer_details: {
        customer_id: String(customerInfo.customerId || "famto-customer").slice(0, 50),
        customer_name: String(customerInfo.name || "Customer").slice(0, 50),
        customer_email: customerInfo.email || undefined,
        customer_phone: customerInfo.phone || undefined,
      },
    };
    const { data } = await axios.post(`${CASHFREE_BASE}/orders`, payload, {
      headers: {
        "Content-Type": "application/json",
        "x-client-id": creds.clientId,
        "x-client-secret": creds.clientSecret,
        "x-api-version": CASHFREE_API_VERSION,
      },
    });
    if (!data?.payment_session_id) {
      return { success: false, gateway: "cashfree", error: "Cashfree did not return a payment session" };
    }
    return {
      success: true,
      gateway: "cashfree",
      mode: "Own",
      gatewayOrderId: orderId,
      razorpayOrderId: null,
      keyId: null,
      token: data.payment_session_id,
      paymentUrl: `${CASHFREE_PAYMENTS_BASE}/order/${data.payment_session_id}`,
    };
  } catch (err) {
    const errorDetail = {
      message: err.response?.data?.message || err.message,
      code: err.response?.data?.code,
      type: err.response?.data?.type,
      status: err.response?.status,
      // Include request info for debugging (without secrets)
      requestUrl: err.config?.url,
      requestMethod: err.config?.method,
    };
    console.error("Cashfree order creation error:", JSON.stringify(errorDetail, null, 2));
    return { success: false, gateway: "cashfree", error: JSON.stringify(errorDetail) };
  }
};

const fetchCashfreeOrderStatus = async (merchantId, orderId) => {
  const config = await loadOwnConfig(merchantId);
  const creds = config?.getDecryptedGatewayCredentials("cashfree");
  if (!creds) return "UNKNOWN";
  const { data } = await axios.get(`${CASHFREE_BASE}/orders/${orderId}`, {
    headers: {
      "x-client-id": creds.clientId,
      "x-client-secret": creds.clientSecret,
      "x-api-version": CASHFREE_API_VERSION,
    },
  });
  return data?.order_status || "UNKNOWN";
};

// ── PhonePe PG (v4) ────────────────────────────────────────────────────────
const phonePeChecksum = (payloadBase64, saltKey, saltIndex) =>
  `${crypto.createHash("sha256").update(payloadBase64 + saltKey).digest("hex")}###${saltIndex}`;

const createPhonePeOrder = async (merchantId, amount, customerInfo) => {
  try {
    const config = await loadOwnConfig(merchantId);
    const creds = config?.getDecryptedGatewayCredentials("phonepe");
    if (!creds) {
      return { success: false, gateway: "phonepe", error: "No PhonePe credentials" };
    }

    const merchantTransactionId = `MT${Date.now()}${crypto.randomBytes(4).toString("hex")}`;
    const payload = {
      merchantId: creds.merchantId,
      merchantTransactionId,
      merchantUserId: `MUID${String(customerInfo.customerId || "cust").slice(0, 12)}`,
      amount: Math.round(Number(amount) * 100), // paise
      redirectUrl: `${APP_CALLBACK_URL}/payment/phonepe/redirect`,
      redirectMode: "GET",
      callbackUrl: `${APP_CALLBACK_URL}/api/v1/merchants/${merchantId}/phonepe-webhook`,
      mobileNumber: customerInfo.phone || undefined,
      paymentInstrument: { type: "PAY_PAGE" },
    };
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
    const checksum = phonePeChecksum(base64Payload, creds.saltKey, creds.saltIndex);

    const { data } = await axios.post(
      `${PHONEPE_BASE}/pg/v1/pay`,
      { request: base64Payload },
      { headers: { "Content-Type": "application/json", "X-VERIFY": checksum } }
    );
    if (!data?.success) {
      return { success: false, gateway: "phonepe", error: data?.message || "PhonePe payment initiation failed" };
    }
    const redirectUrl = data?.data?.instrumentResponse?.redirectInfo?.url;
    if (!redirectUrl) {
      return { success: false, gateway: "phonepe", error: "PhonePe did not return a payment URL" };
    }
    return {
      success: true,
      gateway: "phonepe",
      mode: "Own",
      gatewayOrderId: merchantTransactionId,
      razorpayOrderId: null,
      keyId: null,
      token: merchantTransactionId,
      paymentUrl: redirectUrl,
    };
  } catch (err) {
    console.error("PhonePe order creation error:", err.message);
    return { success: false, gateway: "phonepe", error: err.response?.data?.message || err.message };
  }
};

const fetchPhonePeOrderStatus = async (merchantId, merchantTransactionId) => {
  const config = await loadOwnConfig(merchantId);
  const creds = config?.getDecryptedGatewayCredentials("phonepe");
  if (!creds) return false;
  const checksum = phonePeChecksum("", creds.saltKey, creds.saltIndex);
  const { data } = await axios.get(
    `${PHONEPE_BASE}/pg/v1/status/${creds.merchantId}/${merchantTransactionId}`,
    { headers: { "Content-Type": "application/json", "X-VERIFY": checksum } }
  );
  return data?.success === true && data?.data?.state === "COMPLETED";
};

/**
 * Verify payment for non-razorpay gateways (status-API cross-check).
 * The razorpay path stays in verifyOnlinePaymentController (signature verify).
 */
const verifyGatewayPayment = async (paymentDetails, tempOrder) => {
  if (!tempOrder) return false;
  if (tempOrder.gateway === "cashfree") {
    return (await fetchCashfreeOrderStatus(tempOrder.merchantId, tempOrder.gatewayOrderId)) === "PAID";
  }
  if (tempOrder.gateway === "phonepe") {
    return fetchPhonePeOrderStatus(tempOrder.merchantId, tempOrder.gatewayOrderId);
  }
  return false;
};

// ── Webhooks ───────────────────────────────────────────────────────────────
// Dedup + mark TemporaryOrder. Shared by cashfree/phonepe handlers.
const applyWebhookResult = async (gateway, gatewayOrderId, paid, eventId, eventType, payload) => {
  const existing = await WebhookEvent.findOne({ eventId });
  if (existing) return { duplicate: true };
  if (paid) {
    await TemporaryOrder.findOneAndUpdate(
      { gateway, gatewayOrderId, paymentStatus: "PENDING_PAYMENT" },
      { paymentStatus: "PAYMENT_COMPLETED", paymentId: eventId }
    );
  } else {
    await TemporaryOrder.findOneAndUpdate(
      { gateway, gatewayOrderId },
      { paymentStatus: "PAYMENT_FAILED" }
    );
  }
  await WebhookEvent.create({ eventId, eventType, payload, processed: true });
  return { duplicate: false };
};

const handleCashfreeWebhook = async (merchantId, body, res) => {
  try {
    const orderId = body?.data?.order?.order_id;
    const eventId = body?.data?.payment?.cf_payment_id || orderId;
    if (!orderId) return res.status(400).json({ success: false, error: "Missing order_id" });

    // Authoritative truth comes from Cashfree's order-status API, not the
    // webhook body (no webhook_secret stored per merchant).
    const realStatus = await fetchCashfreeOrderStatus(merchantId, orderId);
    const paid = realStatus === "PAID";
    const result = await applyWebhookResult("cashfree", orderId, paid, eventId, body?.type || "cashfree-webhook", body);
    if (result.duplicate) return res.status(200).json({ success: true, message: "Duplicate webhook ignored" });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Cashfree webhook error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

const handlePhonePeWebhook = async (merchantId, body, req, res) => {
  try {
    const config = await loadOwnConfig(merchantId);
    const creds = config?.getDecryptedGatewayCredentials("phonepe");
    if (!creds) return res.status(400).json({ success: false, error: "No PhonePe config" });

    // PhonePe sends the checksum both in the body `signature` field and the
    // X-VERIFY header; accept either. expected = SHA256(base64payload+saltKey)+"###"+saltIndex.
    const base64Response = body?.response || "";
    const expected = phonePeChecksum(base64Response, creds.saltKey, creds.saltIndex);
    const bodySig = body?.signature || "";
    const headerSig = req.headers["x-verify"] || "";
    if (!expected || (bodySig !== expected && headerSig !== expected)) {
      return res.status(400).json({ success: false, error: "Invalid signature" });
    }

    const decoded = JSON.parse(Buffer.from(base64Response, "base64").toString("utf8"));
    const merchantTransactionId = decoded.merchantTransactionId;
    const eventId = decoded.transactionId || merchantTransactionId;
    const paid = decoded.state === "COMPLETED";
    const result = await applyWebhookResult("phonepe", merchantTransactionId, paid, eventId, "phonepe-webhook", body);
    if (result.duplicate) return res.status(200).json({ success: true, message: "Duplicate webhook ignored" });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("PhonePe webhook error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

const handleGatewayWebhook = (gateway) => async (req, res) => {
  try {
    const merchantId = req.params.merchantId;
    const rawBody = req.body; // Buffer (express.raw)
    const body = JSON.parse(rawBody.toString());
    if (gateway === "cashfree") return handleCashfreeWebhook(merchantId, body, res);
    if (gateway === "phonepe") return handlePhonePeWebhook(merchantId, body, req, res);
    return res.status(400).json({ success: false, error: `Unsupported gateway: ${gateway}` });
  } catch (err) {
    console.error(`${gateway} webhook parse error:`, err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
};

module.exports = {
  FALLBACK_GATEWAY,
  resolvePaymentGateway,
  createGatewayOrderId,
  verifyGatewayPayment,
  handleGatewayWebhook,
  hasGatewayCredentials,
  createCashfreeOrder,
  createPhonePeOrder,
};
