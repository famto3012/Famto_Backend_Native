const mongoose = require("mongoose");

// Reuse same cartItemSchema from PickAndCustomCart
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
    price: { type: Number, default: null },
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
    deliveryCharge: { type: Number, required: true },
    discountedAmount: { type: Number, default: null },
    grandTotal: { type: Number, default: null },
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

const tempOrderSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    customerId: { type: String, ref: "Customer", required: true },
    merchantId: { type: String, ref: "Merchant", default: null },
    deliveryMode: {
      type: String,
      enum: ["Take Away", "Home Delivery", "Pick and Drop", "Custom Order"],
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
    deliveryTime: { type: Date, required: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    time: { type: Date, default: null },
    numOfDays: { type: Number, default: null },
    voiceInstructionToDeliveryAgent: { type: String, default: null },
    totalAmount: { type: Number, default: 0 },
    status: { type: String, default: "Pending" },
    paymentMode: {
      type: String,
      enum: ["Famto-cash", "Online-payment", "Cash-on-delivery"],
      default: null,
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Completed", "Failed"],
      default: "Pending",
    },
    paymentId: { type: String, default: null },
  },
  { timestamps: true }
);

// Auto-delete after 60 seconds
tempOrderSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 });

const TemporaryOrder = mongoose.model("TemporaryOrder", tempOrderSchema);
module.exports = TemporaryOrder;
