const mongoose = require("mongoose");

// Per-gateway availability toggle. `enabled` controls whether the gateway is
// offered to merchants (self-payment mode) at all. `sortOrder` controls the
// display order in the merchant gateway selector.
const gatewayToggleSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

// Platform-wide feature switches (global defaults).
// Per-merchant overrides live in MerchantFeatureOverride.
// This is a singleton doc — always read via findOne({}) and create-or-update.
const platformFeatureConfigSchema = new mongoose.Schema(
  {
    gateways: {
      razorpay: gatewayToggleSchema,
      cashfree: gatewayToggleSchema,
      phonepe: gatewayToggleSchema,
    },
    // Whether merchants are allowed to process their own payments (Own mode)
    selfPaymentOption: {
      type: Boolean,
      default: true,
    },
    whatsapp: {
      enabled: {
        type: Boolean,
        default: true,
      },
    },
    delivery: {
      enabled: {
        type: Boolean,
        default: true,
      },
    },
  },
  {
    timestamps: true,
  }
);

const PlatformFeatureConfig = mongoose.model(
  "PlatformFeatureConfig",
  platformFeatureConfigSchema
);
module.exports = PlatformFeatureConfig;
