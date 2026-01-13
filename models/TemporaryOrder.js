const mongoose = require("mongoose");

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

const pickupDetailSchema = new mongoose.Schema(
  {
    location: { type: [Number] },
    address: {
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
  { _id: false }
);

const dropDetailSchema = new mongoose.Schema(
  {
    location: { type: [Number] },
    address: {
      fullName: String,
      phoneNumber: String,
      flat: String,
      area: String,
      landmark: String,
    },
    instructionInDrop: { type: String, default: null },
    voiceInstructionInDrop: { type: String, default: null },
    items: [cartItemSchema],
  },
  { _id: false }
);

const purchasedItemsSchema = mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    price: {
      type: Number,
      default: null,
    },
    productName: {
      type: String,
      required: false,
    },
    costPrice: {
      type: Number,
      default: null,
    },
    quantity: {
      type: Number,
      required: true,
    },
  },
  {
    _id: false,
  }
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

    pickups: [pickupDetailSchema],
    drops: [dropDetailSchema],

    billDetail: billSchema,
    distance: { type: Number, default: 0 },

    deliveryTime: { type: Date, required: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    time: { type: Date, default: null },
    numOfDays: { type: Number, default: null },

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
    purchasedItems : [purchasedItemsSchema]
  },
  { timestamps: true }
);

// Auto-delete after 60 seconds
tempOrderSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 });

const TemporaryOrder = mongoose.model("TemporaryOrder", tempOrderSchema);
module.exports = TemporaryOrder;
