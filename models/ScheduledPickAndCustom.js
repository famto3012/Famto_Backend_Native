const mongoose = require("mongoose");
const DatabaseCounter = require("./DatabaseCounter");

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

const detailSchema = new mongoose.Schema(
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

const billSchema = mongoose.Schema(
  {
    deliveryChargePerDay: {
      type: Number,
      default: null,
    },
    deliveryCharge: {
      type: Number,
      required: true,
    },
    taxAmount: {
      type: Number,
      default: 0,
    },
    discountedAmount: {
      type: Number,
      default: null,
    },
    grandTotal: {
      type: Number,
      required: true,
    },
    itemTotal: {
      type: Number,
      default: 0,
    },
    addedTip: {
      type: Number,
      default: 0,
    },
    subTotal: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const scheduledPickAndCustomSchema = mongoose.Schema(
  {
    _id: { type: String },
    customerId: { type: String, ref: "Customer", required: true },
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

    pickups: [detailSchema],
    drops: [detailSchema],

    billDetail: billSchema,
    distance: { type: Number, default: 0 },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    time: { type: Date, required: true },

    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      required: true,
      enum: ["Pending", "Completed"],
      default: "Pending",
    },
    paymentMode: {
      type: String,
      required: true,
      enum: ["Famto-cash", "Online-payment", "Cash-on-delivery"],
    },
    paymentId: { type: String, default: null },
    paymentStatus: {
      type: String,
      required: true,
      enum: ["Pending", "Completed", "Failed"],
      default: "Pending",
    },
    isViewed: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

// Middleware to set the custom _id before saving
scheduledPickAndCustomSchema.pre("save", async function (next) {
  try {
    if (this.isNew) {
      const now = new Date();
      const year = now.getFullYear().toString().slice(-2); // Last two digits of the year
      const month = `0${now.getMonth() + 1}`.slice(-2); // Zero-padded month

      let counter = await DatabaseCounter.findOneAndUpdate(
        {
          type: "ScheduledOrder",
          year: parseInt(year, 10),
          month: parseInt(month, 10),
        },
        { $inc: { count: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      if (!counter) {
        throw new Error("Counter document could not be created or updated.");
      }

      const customId = `SO${year}${month}${counter.count}`;

      this._id = customId;
    }
    next();
  } catch (error) {
    next(error);
  }
});

const scheduledPickAndCustom = mongoose.model(
  "scheduledPickAndCustom",
  scheduledPickAndCustomSchema
);
module.exports = scheduledPickAndCustom;
