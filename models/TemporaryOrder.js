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
      default: null,
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


const temporaryOrderSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    razorpayOrderId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    paymentId: {
      type: String,
      sparse: true,
      index: true,
      unique: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Merchant",
      required: true,
    },

    idempotencyKey: {
      type: String,
      unique: true,
    },
    pickups: Array,
    drops: Array,
    purchasedItems: Array,

    billDetail: Object,

    distance: Number,
    deliveryTime: Date,
    startDate: Date,
    endDate: Date,
    time: Date,
    numOfDays: Number,

    totalAmount: Number,

    deliveryMode: String,
    deliveryOption: String,

    paymentMode: String,

    paymentStatus: {
      type: String,
      enum: [
        "PENDING_PAYMENT",
        "PAYMENT_COMPLETED",
        "PAYMENT_FAILED",
      ],
      default: "PENDING_PAYMENT",
      index: true,
    },

    processingStatus: {
      type: String,
      enum: [
        "PENDING",
        "PROCESSING",
        "ORDER_CREATED",
        "FAILED",
      ],
      default: "PENDING",
      index: true,
    },

    retryCount: {
      type: Number,
      default: 0,
    },

    maxRetries: {
      type: Number,
      default: 5,
    },

    lastError: {
      type: String,
      default: null,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    prescription: String,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "TemporaryOrder",
  temporaryOrderSchema
);
