const mongoose = require("mongoose");
const { encrypt, decrypt } = require("../utils/crypto");

const merchantPaymentConfigSchema = new mongoose.Schema(
  {
    merchantId: {
      type: String,
      ref: "Merchant",
      required: true,
      unique: true,
      index: true,
    },
    // Stored encrypted at rest
    keyId: {
      type: String,
      required: true,
    },
    keySecret: {
      type: String,
      required: true,
      select: false,
    },
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

// Encrypt keySecret before save
merchantPaymentConfigSchema.pre("save", function (next) {
  if (this.isModified("keySecret") && this.keySecret) {
    this.keySecret = encrypt(this.keySecret);
  }
  this.updatedAt = new Date();
  next();
});

// Helper to get decrypted keySecret
merchantPaymentConfigSchema.methods.getDecryptedKeySecret = function () {
  if (!this.keySecret) return null;
  return decrypt(this.keySecret);
};

// Static helper to get Razorpay client for a merchant
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