const mongoose = require("mongoose");

// Item Schema (remains same mostly)
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

// Pickup & Drop pair Schema
const pickupDropSchema = mongoose.Schema(
  {
    // Pickup (can be one or multiple depending on mode)
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
        items: [cartItemSchema], // Items linked to this pickup
      },
    ],

    // Drops (can be one or multiple depending on mode)
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
        items: [cartItemSchema], // Items linked to this drop
      },
    ],
  },
  { _id: false }
);

// Bill Schema (unchanged mostly)
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

// Master Cart Schema
const pickAndCustomCartSchema = mongoose.Schema(
  {
    customerId: { type: String, required: true },
    merchantId: { type: String, ref: "Merchant", required: false },

    deliveryMode: {
      type: String,
      enum: ["Pick and Drop", "Custom Order"],
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
  },
  {
    timestamps: true,
  }
);

const PickAndCustomCart = mongoose.model(
  "PickAndCustomCart",
  pickAndCustomCartSchema
);

module.exports = PickAndCustomCart;
