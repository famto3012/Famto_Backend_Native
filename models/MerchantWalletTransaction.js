const mongoose = require("mongoose");

const merchantWalletTransactionSchema = new mongoose.Schema(
  {
    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Merchant",
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    temporaryOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TemporaryOrder",
      default: null,
      index: true,
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    mode: {
      type: String,
      enum: ["Own", "Platform"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "payout_initiated", "payout_completed", "payout_failed"],
      default: "completed",
    },
    payoutId: String, // Razorpay payout ID
    payoutFailureReason: String,
    description: String,
    createdAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: Date,
  },
  { timestamps: true }
);

merchantWalletTransactionSchema.index({ merchantId: 1, createdAt: -1 });
merchantWalletTransactionSchema.index({ merchantId: 1, status: 1 });

module.exports = mongoose.model(
  "MerchantWalletTransaction",
  merchantWalletTransactionSchema
);