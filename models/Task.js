const mongoose = require("mongoose");

const detailSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["Pending", "Accepted", "Started", "Completed", "Cancelled"],
      default: "Pending",
    },
    location: { type: [Number] },
    stepIndex: { type: Number },
    address: {
      fullName: String,
      phoneNumber: String,
      flat: String,
      area: String,
      landmark: String,
    },
    items: [
      {
        itemName: String,
        length: Number,
        width: Number,
        height: Number,
        unit: String,
        weight: Number,
        numOfUnits: Number,
        quantity: Number,
        itemImageURL: String,
        price: Number,
        variantTypeName: String,
      },
    ],

    startTime: { type: Date, default: null },
    completedTime: { type: Date, default: null },
  },
  {
    _id: false,
  }
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
    pickupDropDetails: [
      {
        // orderId: { type: String, ref: "Order", required: true },
        pickups: [detailSchema],
        drops: [detailSchema],
      },
    ],
    deliveryMode: {
      type: String,
      enum: ["Home Delivery", "Take Away", "Pick and Drop", "Custom Order"],
      required: true,
    },
  },
  { timestamps: true }
);

const Task = mongoose.model("Task", taskSchema);
module.exports = Task;
