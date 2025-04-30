const mongoose = require("mongoose");

const customerTransactionSchema = new mongoose.Schema({
  customerId: {
    type: String,
    ref: "Customer",
    required: true,
  },
  transactionAmount: {
    type: Number,
    required: true,
  },
  transactionType: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["Credit", "Debit"],
    required: true,
  },
  madeOn: {
    type: Date,
    required: true,
  },
});

const CustomerTransaction = mongoose.model(
  "CustomerTransaction",
  customerTransactionSchema
);
module.exports = CustomerTransaction;
