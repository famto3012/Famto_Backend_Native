const mongoose = require("mongoose");

// Per-merchant overrides for the platform feature switches.
// Only PRESENT fields override the global default (undefined = inherit global).
// Admin-managed; separate from merchantDetail to keep the hot Merchant subdoc clean.
const merchantFeatureOverrideSchema = new mongoose.Schema(
  {
    merchantId: {
      type: String,
      ref: "Merchant",
      required: true,
      unique: true,
      index: true,
    },
    gateways: {
      razorpay: {
        enabled: Boolean,
      },
      cashfree: {
        enabled: Boolean,
      },
      phonepe: {
        enabled: Boolean,
      },
    },
    selfPaymentOption: {
      enabled: Boolean,
    },
    whatsapp: {
      enabled: Boolean,
    },
    delivery: {
      enabled: Boolean,
    },
  },
  {
    timestamps: true,
  }
);

const MerchantFeatureOverride = mongoose.model(
  "MerchantFeatureOverride",
  merchantFeatureOverrideSchema
);
module.exports = MerchantFeatureOverride;
