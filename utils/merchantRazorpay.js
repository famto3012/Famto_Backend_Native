const MerchantPaymentConfig = require("../models/MerchantPaymentConfig");
const crypto = require("crypto");
const TemporaryOrder = require("../models/TemporaryOrder");
const WebhookEvent = require("../models/WebhookEvent");

/**
 * Get a Razorpay client for a merchant.
 * If merchant has valid Own config → use their keys.
 * Else → fall back to platform client.
 */
const getRazorpayClientForMerchant = async (merchantId) => {
  const Razorpay = require("razorpay");
  const config = await MerchantPaymentConfig.findOne({ merchantId });
  if (!config || config.mode !== "Own" || config.status !== "Active") {
    return {
      client: new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      }),
      mode: "Platform",
      config: null,
    };
  }
  const keySecret = config.getDecryptedKeySecret();
  if (!keySecret) {
    return {
      client: new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      }),
      mode: "Platform",
      config: null,
    };
  }
  return {
    client: new Razorpay({
      key_id: config.keyId,
      key_secret: keySecret,
    }),
    mode: "Own",
    config,
  };
};

/**
 * Create Razorpay order for a merchant.
 * Returns { success, orderId, keyId, mode }
 */
const createMerchantRazorpayOrderId = async (merchantId, amount) => {
  try {
    const { client, mode, config } = await getRazorpayClientForMerchant(merchantId);
    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: crypto.randomBytes(10).toString("hex"),
    };
    const order = await client.orders.create(options);
    return {
      success: true,
      orderId: order.id,
      keyId: config?.keyId || process.env.RAZORPAY_KEY_ID,
      mode,
    };
  } catch (err) {
    console.error("Error creating merchant Razorpay order:", err);
    return { success: false, error: err.message };
  }
};

/**
 * Verify payment signature using the correct secret.
 * mode="Own" → use merchant's keySecret from config
 * mode="Platform" → use platform secret
 */
const verifyMerchantPayment = async (paymentDetails, mode, merchantConfig = null) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = paymentDetails;

  const body = `${razorpay_order_id}|${razorpay_payment_id}`;

  let secret;
  if (mode === "Own" && merchantConfig) {
    secret = merchantConfig.getDecryptedKeySecret();
  } else {
    secret = process.env.RAZORPAY_KEY_SECRET;
  }

  if (!secret) {
    console.error("No secret available for verification");
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  return expectedSignature === razorpay_signature;
};

/**
 * Per-merchant webhook handler (POST /api/v1/merchants/:merchantId/razorpay-webhook)
 * Validates signature using merchant's secret.
 */
const merchantRazorpayWebhookController = async (req, res) => {
  try {
    const merchantId = req.params.merchantId;
    const config = await MerchantPaymentConfig.findOne({ merchantId });
    if (!config || config.mode !== "Own" || config.status !== "Active") {
      return res.status(400).send("Invalid merchant config for webhook");
    }

    const keySecret = config.getDecryptedKeySecret();
    if (!keySecret) {
      return res.status(500).send("Decryption failed");
    }

    const signature = req.headers["x-razorpay-signature"];
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(req.body.toString())
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(400).send("Invalid signature");
    }

    const payload = JSON.parse(req.body);
    const eventId = payload?.payload?.payment?.entity?.id;

    const existingEvent = await WebhookEvent.findOne({ eventId });
    if (existingEvent) {
      return res.status(200).json({ success: true, message: "Duplicate webhook ignored" });
    }

    if (payload.event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      await TemporaryOrder.findOneAndUpdate(
        {
          razorpayOrderId: payment.order_id,
          paymentStatus: "PENDING_PAYMENT",
        },
        {
          paymentStatus: "PAYMENT_COMPLETED",
          paymentId: payment.id,
        }
      );
      console.log(`✅ [Merchant ${merchantId}] Payment completed for ${payment.order_id}`);
    }

    if (payload.event === "payment.failed") {
      const payment = payload.payload.payment.entity;
      await TemporaryOrder.findOneAndUpdate(
        { razorpayOrderId: payment.order_id },
        { paymentStatus: "PAYMENT_FAILED" }
      );
      console.log(`❌ [Merchant ${merchantId}] Payment failed for ${payment.order_id}`);
    }

    await WebhookEvent.create({
      eventId,
      eventType: payload.event,
      payload,
      processed: true,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Merchant Webhook Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  getRazorpayClientForMerchant,
  createMerchantRazorpayOrderId,
  verifyMerchantPayment,
  merchantRazorpayWebhookController,
};