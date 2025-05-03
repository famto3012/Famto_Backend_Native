const mongoose = require("mongoose");

const orderDetailSchema = mongoose.Schema(
  {
    orderId: {
      type: String,
      ref: "Order",
    },
    deliveryMode: {
      type: String,
      required: true,
    },
    customerName: {
      type: String,
      required: true,
    },
    completedOn: {
      type: Date,
      required: true,
    },
    grandTotal: {
      type: Number,
      required: true,
    },
  },
  {
    _id: false,
  }
);

const agentWorkHistorySchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true,
    ref: "Agent",
  },
  workDate: {
    type: Date,
    required: true,
  },
  totalEarning: {
    type: Number,
    default: 0,
  },
  orders: {
    type: Number,
    default: 0,
  },
  pendingOrders: {
    type: Number,
    default: 0,
  },
  totalDistance: {
    type: Number,
    default: 0,
  },
  cancelledOrders: {
    type: Number,
    default: 0,
  },
  loginDuration: {
    type: Number,
    default: 0,
  },
  orderDetail: [orderDetailSchema],
  paymentSettled: {
    type: Boolean,
    default: false,
  },
});

const AgentWorkHistory = mongoose.model(
  "AgentWorkHistory",
  agentWorkHistorySchema
);

module.exports = AgentWorkHistory;
