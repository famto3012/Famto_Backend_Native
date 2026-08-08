const mongoose = require("mongoose");
const { encrypt, decrypt } = require("../utils/crypto");

// Credentials for each supported gateway. Secrets are stored encrypted at rest.
// `gateway` selects which credential set is active for this merchant.
const gatewayCredentialsSchema = new mongoose.Schema(
  {
    razorpay: {
      keyId: String,
      keySecret: { type: String, select: false },
    },
    cashfree: {
      clientId: String,
      clientSecret: { type: String, select: false },
    },
    phonepe: {
      merchantId: String,
      saltKey: { type: String, select: false },
      saltIndex: String,
    },
  },
  { _id: false }
);

const merchantPaymentConfigSchema = new mongoose.Schema(
  {
    merchantId: {
      type: String,
      ref: "Merchant",
      required: true,
      unique: true,
      index: true,
    },
    // Active gateway for this merchant (Own mode). Lowercase keys throughout.
    gateway: {
      type: String,
      enum: ["razorpay", "cashfree", "phonepe"],
      default: "razorpay",
      index: true,
    },
    // Legacy Razorpay mirror — kept for backward compat with merchantRazorpay.js
    // and the razorpay webhook route. Required-ness dropped (gateway may differ).
    keyId: {
      type: String,
    },
    keySecret: {
      type: String,
      select: false,
    },
    gatewayCredentials: gatewayCredentialsSchema,
    mode: {
      type: String,
      enum: ["Own", "Platform"],
      default: "Platform",
      index: true,
    },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Invalid"],
      default: "Inactive",
      index: true,
    },
    bankDetails: {
      accountName: String,
      accountNumber: String,
      ifsc: String,
    },
    validatedAt: Date,
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Encrypt secrets before save. Each leaf is guarded by isModified() so an
// already-encrypted value (untouched this save) is never re-encrypted.
const SECRET_PATHS = [
  "gatewayCredentials.razorpay.keySecret",
  "gatewayCredentials.cashfree.clientSecret",
  "gatewayCredentials.phonepe.saltKey",
];

merchantPaymentConfigSchema.pre("save", function (next) {
  // Legacy top-level mirror
  if (this.isModified("keySecret") && this.keySecret) {
    this.keySecret = encrypt(this.keySecret);
  }
  for (const path of SECRET_PATHS) {
    if (this.isModified(path) && this.get(path)) {
      this.set(path, encrypt(this.get(path)));
    }
  }
  this.updatedAt = new Date();
  next();
});

// Helper to get decrypted keySecret (legacy top-level mirror)
merchantPaymentConfigSchema.methods.getDecryptedKeySecret = function () {
  if (!this.keySecret) return null;
  return decrypt(this.keySecret);
};

// Get decrypted credentials for a gateway. Callers that need secrets must
// load the doc with .select() including the nested secret leaves — they are
// select:false and the parent path does NOT pull them in. Read each field
// directly (never spread a Mongoose subdoc — its data lives in _doc).
merchantPaymentConfigSchema.methods.getDecryptedGatewayCredentials = function (gateway) {
  const gw = this.gatewayCredentials?.[gateway];
  if (gateway === "razorpay") {
    // Legacy top-level mirror wins when the subdoc is absent/empty.
    if (gw?.keyId && gw?.keySecret) {
      return { keyId: gw.keyId, keySecret: decrypt(gw.keySecret) };
    }
    if (this.keyId && this.keySecret) {
      return { keyId: this.keyId, keySecret: this.getDecryptedKeySecret() };
    }
    return null;
  }
  if (!gw) return null;
  if (gateway === "cashfree") {
    return {
      clientId: gw.clientId,
      clientSecret: gw.clientSecret ? decrypt(gw.clientSecret) : undefined,
    };
  }
  if (gateway === "phonepe") {
    return {
      merchantId: gw.merchantId,
      saltKey: gw.saltKey ? decrypt(gw.saltKey) : undefined,
      saltIndex: gw.saltIndex,
    };
  }
  return null;
};

// Static helper to get Razorpay client for a merchant (legacy fallback).
merchantPaymentConfigSchema.statics.getRazorpayClient = async function (merchantId) {
  const Razorpay = require("razorpay");
  const config = await this.findOne({ merchantId });
  if (!config || config.mode !== "Own" || config.status !== "Active") {
    // Fallback to platform client
    return new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  const keySecret = config.getDecryptedKeySecret();
  if (!keySecret) {
    // Fallback to platform if decryption fails
    return new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return new Razorpay({
    key_id: config.keyId,
    key_secret: keySecret,
  });
};

module.exports = mongoose.model("MerchantPaymentConfig", merchantPaymentConfigSchema);
