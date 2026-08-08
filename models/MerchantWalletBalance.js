const mongoose = require("mongoose");

const merchantWalletBalanceSchema = new mongoose.Schema(
  {
    merchantId: {
      type: String,
      ref: "Merchant",
      required: true,
      unique: true,
      index: true,
    },
    balance: {
      type: Number,
      default: 0,
    },
    pendingPayout: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    lastPayoutAt: Date,
    lastPayoutId: String,
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MerchantWalletBalance", merchantWalletBalanceSchema);