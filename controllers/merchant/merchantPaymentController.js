const MerchantPaymentConfig = require("../../models/MerchantPaymentConfig");
const appError = require("../../utils/appError");
const { availableGateways, featureEnabled } = require("../../utils/featureConfig");
const {
  createCashfreeOrder,
  createPhonePeOrder,
} = require("../../utils/paymentGateways");

const GATEWAY_KEYS = ["razorpay", "cashfree", "phonepe"];
// Nested secret leaves are select:false — each must be selected explicitly.
const SECRET_SELECT =
  "+keySecret +gatewayCredentials.razorpay.keySecret +gatewayCredentials.cashfree.clientSecret +gatewayCredentials.phonepe.saltKey";
const provided = (v) => v !== undefined && v !== null && v !== "";

// Required credential fields per gateway (in `credentials[gateway]`).
const GATEWAY_REQUIRED_CREDS = {
  razorpay: ["keyId", "keySecret"],
  cashfree: ["clientId", "clientSecret"],
  phonepe: ["merchantId", "saltKey", "saltIndex"],
};

const stripSecrets = (configObj) => {
  if (!configObj) return configObj;
  delete configObj.keySecret;
  if (configObj.gatewayCredentials) {
    for (const gw of GATEWAY_KEYS) {
      delete configObj.gatewayCredentials[gw]?.keySecret;
      delete configObj.gatewayCredentials[gw]?.clientSecret;
      delete configObj.gatewayCredentials[gw]?.saltKey;
    }
  }
  return configObj;
};

const getMerchantPaymentConfig = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const [config, gateways, selfPaymentEnabled] = await Promise.all([
      MerchantPaymentConfig.findOne({ merchantId }).select("-keySecret").lean(),
      availableGateways(merchantId),
      featureEnabled("selfPaymentOption", merchantId),
    ]);

    const data = config || { mode: "Platform", status: "Inactive" };
    data.availableGateways = gateways; // [{ name, enabled, sortOrder }]
    data.selfPaymentEnabled = selfPaymentEnabled;

    res.status(200).json({
      success: true,
      data,
      message: config
        ? undefined
        : "No payment config found. Using platform Razorpay.",
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const updateMerchantPaymentConfig = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const {
      gateway = "razorpay",
      mode = "Own",
      bankDetails,
      credentials = {},
    } = req.body;

    if (!GATEWAY_KEYS.includes(gateway)) {
      return next(appError("Invalid gateway", 400));
    }

    // Load existing with secrets so we can tell "already configured" from
    // "missing" when the client only submits a partial update.
    let config = await MerchantPaymentConfig.findOne({ merchantId }).select(
      SECRET_SELECT
    );

    if (mode === "Own") {
      // Feature-flag enforcement — platform hard-blocks disabled features.
      const [selfEnabled, gwEnabled] = await Promise.all([
        featureEnabled("selfPaymentOption", merchantId),
        featureEnabled(`gateways.${gateway}`, merchantId),
      ]);
      if (!selfEnabled) {
        return next(
          appError("Self payment option is disabled by the platform", 403)
        );
      }
      if (!gwEnabled) {
        return next(
          appError(`${gateway} gateway is disabled by the platform`, 403)
        );
      }

      if (
        !bankDetails?.accountName ||
        !bankDetails?.accountNumber ||
        !bankDetails?.ifsc
      ) {
        return next(appError("Bank details required for Own mode", 400));
      }

      // The selected gateway must have credentials — either already stored or
      // provided in this request.
      const existing =
        config?.getDecryptedGatewayCredentials(gateway) || null;
      const incoming = credentials[gateway] || {};
      for (const field of GATEWAY_REQUIRED_CREDS[gateway]) {
        if (!existing?.[field] && !provided(incoming[field])) {
          return next(
            appError(
              `${gateway} ${field} is required for Own mode`,
              400
            )
          );
        }
      }
    }

    if (!config) {
      config = new MerchantPaymentConfig({ merchantId });
    }

    config.set("gateway", gateway);
    config.set("mode", mode);
    config.set("status", mode === "Own" ? "Active" : "Inactive");
    if (bankDetails) config.set("bankDetails", bankDetails);

    // Write only provided credential leaves. Setting leaves individually keeps
    // the per-path isModified() guard in the pre-save hook working — wholesale
    // subdoc assignment would re-encrypt already-encrypted secrets.
    const gwCreds = credentials[gateway] || {};
    for (const [leaf, value] of Object.entries(gwCreds)) {
      if (provided(value)) {
        config.set(`gatewayCredentials.${gateway}.${leaf}`, value);
      }
    }

    // Razorpay: mirror into the legacy top-level keyId/keySecret so the legacy
    // merchantRazorpay paths (getRazorpayClientForMerchant, webhook) keep working.
    if (gateway === "razorpay") {
      if (provided(gwCreds.keyId)) config.set("keyId", gwCreds.keyId);
      if (provided(gwCreds.keySecret)) config.set("keySecret", gwCreds.keySecret);
    }

    await config.save();

    const responseConfig = stripSecrets(config.toObject());

    res.status(200).json({
      success: true,
      data: responseConfig,
      message:
        mode === "Own"
          ? "Payment config saved. Test a payment to validate."
          : "Switched to platform payment processing.",
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const testMerchantPaymentConfig = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const config = await MerchantPaymentConfig.findOne({ merchantId }).select(
      SECRET_SELECT
    );

    if (!config || config.mode !== "Own" || config.status !== "Active") {
      return next(appError("No valid Own-mode config found", 400));
    }

    const gateway = config.gateway || "razorpay";
    let testOrderId = null;

    if (gateway === "razorpay") {
      const keySecret = config.getDecryptedKeySecret();
      if (!keySecret) {
        config.status = "Invalid";
        await config.save();
        return next(
          appError("Decryption failed. Re-enter credentials.", 500)
        );
      }
      const Razorpay = require("razorpay");
      const client = new Razorpay({
        key_id: config.keyId,
        key_secret: keySecret,
      });
      // Test by creating a small order (₹1 = 100 paise)
      const testOrder = await client.orders.create({
        amount: 100,
        currency: "INR",
        receipt: `test_${Date.now()}`,
      });
      testOrderId = testOrder.id;
    } else if (gateway === "cashfree") {
      // Order creation validates client creds (₹1, never charged).
      const result = await createCashfreeOrder(merchantId, 1, {
        name: "Famto Test",
        email: "test@famto.in",
        phone: "9999999999",
      });
      if (!result.success) {
        throw new Error(result.error || "Cashfree validation failed");
      }
      testOrderId = result.gatewayOrderId;
    } else if (gateway === "phonepe") {
      // Pay-page order creation validates merchantId + salt checksum.
      const result = await createPhonePeOrder(merchantId, 1, {
        name: "Famto Test",
        email: "test@famto.in",
        phone: "9999999999",
      });
      if (!result.success) {
        throw new Error(result.error || "PhonePe validation failed");
      }
      testOrderId = result.gatewayOrderId;
    }

    config.status = "Active";
    config.validatedAt = new Date();
    await config.save();

    res.status(200).json({
      success: true,
      message: `${gateway} credentials validated successfully`,
      data: { testOrderId, gateway },
    });
  } catch (err) {
    // If validation fails, mark as Invalid
    await MerchantPaymentConfig.findOneAndUpdate(
      { merchantId: req.merchantId },
      { status: "Invalid" }
    );
    next(appError(`Validation failed: ${err.message}`, 500));
  }
};

const disableMerchantPaymentConfig = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    await MerchantPaymentConfig.findOneAndUpdate(
      { merchantId },
      { mode: "Platform", status: "Inactive" }
    );
    res
      .status(200)
      .json({ success: true, message: "Switched to platform Razorpay" });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getMerchantPaymentConfig,
  updateMerchantPaymentConfig,
  testMerchantPaymentConfig,
  disableMerchantPaymentConfig,
};
