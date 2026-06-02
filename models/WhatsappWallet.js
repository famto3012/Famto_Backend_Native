const mongoose = require("mongoose");

const rechargeHistorySchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    paymentMethod: String,
    transactionId: String,
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    notes: String,
  },
  { timestamps: true }
);

const whatsappWalletSchema = new mongoose.Schema(
  {
    balance: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    rechargeHistory: [rechargeHistorySchema],
    totalSpent: {
      type: Number,
      default: 0,
    },
    lastRechargedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsappWallet", whatsappWalletSchema);
