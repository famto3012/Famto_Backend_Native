const mongoose = require("mongoose");

const agentTransactionSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true,
    ref: "Agent",
  },
  type: {
    type: String,
    enum: ["Credit", "Debit"],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  madeOn: {
    type: Date,
    required: true,
  },
});

const AgentTransaction = mongoose.model(
  "AgentTransaction",
  agentTransactionSchema
);

module.exports = AgentTransaction;
