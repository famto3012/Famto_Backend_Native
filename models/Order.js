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
    price: { type: Number, default: null },
    variantTypeName: { type: String, default: null },
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

const orderRatingSchema = mongoose.Schema(
  {
    ratingToDeliveryAgent: {
      review: {
        type: String,
        default: null,
      },
      rating: {
        type: Number,
        min: 1,
        max: 5,
      },
    },
    ratingByDeliveryAgent: {
      review: {
        type: String,
        default: null,
      },
      rating: {
        type: Number,
        min: 1,
        max: 5,
      },
    },
  },
  {
    _id: false,
  }
);

const commissionDetailSchema = mongoose.Schema(
  {
    merchantEarnings: {
      type: Number,
      required: true,
    },
    famtoEarnings: {
      type: Number,
      required: true,
    },
  },
  {
    _id: false,
  }
);

const shopUpdatesSchema = mongoose.Schema(
  {
    location: {
      type: [Number],
      required: true,
    },
    status: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: null,
    },
  },
  {
    _id: false,
  }
);

const detailAddedByAgentSchema = mongoose.Schema(
  {
    startToPickDistance: {
      type: Number,
      default: null,
    },
    agentEarning: {
      type: Number,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
    signatureImageURL: {
      type: String,
      default: null,
    },
    imageURL: {
      type: String,
      default: null,
    },
    distanceCoveredByAgent: {
      type: Number,
      default: null,
    },
    shopUpdates: [shopUpdatesSchema],
  },
  {
    _id: false,
  }
);

const stepperSchema = mongoose.Schema(
  {
    by: { type: String, default: null },
    userId: { type: String, default: null },
    date: { type: Date, default: null },
    detailURL: { type: String, default: null },
    location: { type: [Number], default: null },
  },
  {
    _id: false,
  }
);

const orderDetailStepperSchema = mongoose.Schema(
  {
    created: stepperSchema,
    accepted: stepperSchema,
    assigned: stepperSchema,
    pickupStarted: stepperSchema,
    reachedPickupLocation: stepperSchema,
    deliveryStarted: stepperSchema,
    reachedDeliveryLocation: stepperSchema,
    noteAdded: stepperSchema,
    signatureAdded: stepperSchema,
    imageAdded: stepperSchema,
    completed: stepperSchema,
    cancelled: stepperSchema,
  },
  {
    _id: false,
  }
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

const orderSchema = mongoose.Schema(
  {
    _id: { type: String },
    customerId: { type: String, ref: "Customer", required: true },
    merchantId: { type: String, ref: "Merchant", default: null },
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

    pickups: [detailSchema],
    drops: [detailSchema],

    billDetail: billSchema,
    distance: { type: Number, default: 0 },

    deliveryTime: { type: Date, default: 0 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    time: { type: Date, default: null },
    numOfDays: { type: Number, default: null },

    totalAmount: { type: Number, default: 0 },
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
    detailAddedByAgent: detailAddedByAgentSchema,
    orderDetailStepper: orderDetailStepperSchema,
    purchasedItems: [purchasedItemsSchema],
    orderRating: orderRatingSchema,
    commissionDetail: commissionDetailSchema,
    isReady: { type: Boolean, default: false },
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
