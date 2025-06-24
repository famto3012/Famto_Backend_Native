const mongoose = require("mongoose");

const detailSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ["Pending", "Accepted", "Started", "Completed", "Cancelled"],
    default: "Pending",
  },
  location: { type: [Number] },
  address: {
    fullName: String,
    phoneNumber: String,
    flat: String,
    area: String,
    landmark: String,
  },
  startTime: { type: Date, default: null },
  completedTime: { type: Date, default: null },
});

const multiPickupDropSchema = new mongoose.Schema(
  {
    pickups: [detailSchema],
    drops: [detailSchema],
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema(
  {
    orderId: { type: String, ref: "Order", required: true },
    agentId: { type: String, ref: "Agent", default: null },
    taskStatus: {
      type: String,
      enum: ["Assigned", "Unassigned", "Completed", "Cancelled"],
      default: "Unassigned",
    },
    deliveryMode: {
      type: String,
      enum: ["Home Delivery", "Take Away", "Pick and Drop", "Custom Order"],
      required: true,
    },
    pickupDropDetails: [multiPickupDropSchema],
  },
  { timestamps: true }
);

const Task = mongoose.model("Task", taskSchema);
module.exports = Task;
