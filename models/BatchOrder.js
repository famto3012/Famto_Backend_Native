const mongoose = require("mongoose");

const detailSchema = new mongoose.Schema(
  {
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
  },
  { _id: false }
);

const batchOrderSchema = new mongoose.Schema(
  {
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
    pickupAddress: {
      location: { type: [Number] },
      fullName: String,
      phoneNumber: String,
      flat: String,
      area: String,
      landmark: String,
    },
    dropDetails: [
      {
        orderId: { type: String, ref: "Order", required: true },
        taskId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Task",
          required: true,
        },
        drops: detailSchema,
      },
    ],
  },
  { timestamps: true }
);

const BatchOrder = mongoose.model("BatchOrder", batchOrderSchema);
module.exports = BatchOrder;
