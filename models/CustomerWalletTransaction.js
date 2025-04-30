const mongoose = require("mongoose");

const customerWalletTransactionSchema = new mongoose.Schema({
  customerId: {
    type: String,
    ref: "Customer",
    required: true,
  },
  closingBalance: {
    type: Number,
    required: true,
  },
  transactionAmount: {
    type: Number,
    required: true,
  },
  transactionId: {
    type: String,
  },
  orderId: {
    type: String,
  },
  date: {
    type: Date,
    required: true,
  },
  type: {
    type: String,
    enum: ["Credit", "Debit"],
    required: true,
  },
});

const CustomerWalletTransaction = mongoose.model(
  "CustomerWalletTransaction",
  customerWalletTransactionSchema
);
module.exports = CustomerWalletTransaction;
