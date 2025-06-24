const mongoose = require("mongoose");
const DatabaseCounter = require("./DatabaseCounter");

// Reuse your cartItemSchema
const cartItemSchema = mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
    },
    itemName: { type: String, required: true },
    length: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    unit: { type: String, default: null },
    weight: { type: Number, default: null },
    numOfUnits: { type: Number, default: null },
    quantity: { type: Number, default: null },
    itemImageURL: { type: String, default: null },
  },
  { _id: false }
);

const pickupDropSchema = mongoose.Schema(
  {
    pickups: [
      {
        pickupLocation: { type: [Number], default: null },
        pickupAddress: {
          fullName: String,
          phoneNumber: String,
          flat: String,
          area: String,
          landmark: String,
        },
        instructionInPickup: { type: String, default: null },
        voiceInstructionInPickup: { type: String, default: null },
        items: [cartItemSchema],
      },
    ],

    drops: [
      {
        deliveryLocation: { type: [Number], default: null },
        deliveryAddress: {
          fullName: String,
          phoneNumber: String,
          flat: String,
          area: String,
          landmark: String,
        },
        instructionInDelivery: { type: String, default: null },
        voiceInstructionInDelivery: { type: String, default: null },
        items: [cartItemSchema],
      },
    ],
  },
  { _id: false }
);

const billSchema = mongoose.Schema(
  {
    deliveryChargePerDay: { type: Number, default: null },
    originalDeliveryCharge: { type: Number, required: true },
    discountedDeliveryCharge: { type: Number, default: null },
    discountedAmount: { type: Number, default: null },
    originalGrandTotal: { type: Number, default: null },
    discountedGrandTotal: { type: Number, default: null },
    itemTotal: { type: Number, default: 0 },
    addedTip: { type: Number, default: null },
    subTotal: { type: Number, default: null },
    vehicleType: { type: String, default: null },
    surgePrice: { type: Number, default: null },
    taxAmount: { type: Number, default: null },
    promoCodeUsed: { type: String, default: null },
    promoCodeDiscount: { type: Number, default: null },
  },
  { _id: false }
);

const orderSchema = mongoose.Schema(
  {
    _id: { type: String },
    customerId: { type: String, ref: "Customer", required: true },
    merchantId: { type: String, ref: "Merchant" },
    scheduledOrderId: { type: String, ref: "ScheduledOrder", default: null },
    agentId: { type: String, ref: "Agent", default: null },
    deliveryMode: {
      type: String,
      enum: ["Home Delivery", "Take Away", "Pick and Drop", "Custom Order"],
      required: true,
    },
    deliveryOption: {
      type: String,
      enum: ["On-demand", "Scheduled"],
      required: true,
    },
    pickupDropDetails: [pickupDropSchema],
    billDetail: billSchema,
    distance: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    time: { type: Date, default: null },
    numOfDays: { type: Number, default: null },
    voiceInstructionToDeliveryAgent: { type: String, default: null },
    status: {
      type: String,
      enum: ["Pending", "On-going", "Completed", "Cancelled"],
      default: "Pending",
    },
    paymentMode: {
      type: String,
      enum: ["Famto-cash", "Online-payment", "Cash-on-delivery"],
      required: true,
    },
    paymentId: { type: String, default: null },
    refundId: { type: String, default: null },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Completed", "Failed"],
      default: "Pending",
    },
    paymentCollectedFromCustomer: {
      type: String,
      enum: ["Pending", "Completed"],
      default: "Pending",
    },
    cancellationReason: { type: String, default: null },
    cancellationDescription: { type: String, default: null },
  },
  { timestamps: true }
);

orderSchema.pre("save", async function (next) {
  if (this.isNew) {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = `0${now.getMonth() + 1}`.slice(-2);
    let counter = await DatabaseCounter.findOneAndUpdate(
      { type: "Order", year: parseInt(year), month: parseInt(month) },
      { $inc: { count: 1 } },
      { new: true, upsert: true }
    );
    this._id = `O${year}${month}${counter.count}`;
  }
  next();
});

const Order = mongoose.model("Order", orderSchema);
module.exports = Order;
