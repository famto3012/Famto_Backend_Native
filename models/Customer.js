const mongoose = require("mongoose");
const DatabaseCounter = require("./DatabaseCounter");

const addressSchema = new mongoose.Schema(
  {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      default: function () {
        return new mongoose.Types.ObjectId();
      },
    },
    fullName: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    flat: {
      type: String,
      required: true,
    },
    area: {
      type: String,
      required: true,
    },
    landmark: {
      type: String,
      default: null,
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  },
  {
    _id: false,
  }
);

const ratingByAgentSchema = new mongoose.Schema(
  {
    agentId: {
      type: String,
      ref: "Agent",
      required: true,
    },
    review: {
      type: String,
      default: null,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
  },
  {
    _id: false,
  }
);

const customerDetailSchema = new mongoose.Schema(
  {
    customerImageURL: {
      type: String,
    },
    location: {
      type: [Number],
    },
    geofenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Geofence",
      default: null,
    },
    pricing: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SubscriptionLog",
        required: true,
        default: [],
      },
    ],
    walletBalance: {
      type: Number,
      default: 0,
    },
    referralCode: {
      type: String,
      default: null,
    },
    ratingsByAgents: [ratingByAgentSchema],
    isBlocked: {
      type: Boolean,
      default: false,
    },
    reasonForBlockingOrDeleting: {
      type: String,
    },
    blockedDate: {
      type: Date,
    },
    homeAddress: {
      type: addressSchema,
      default: null,
    },
    workAddress: {
      type: addressSchema,
      default: null,
    },
    otherAddress: [addressSchema],
    loyaltyPointEarnedToday: {
      type: Number,
      default: 0,
    },
    loyaltyPointLeftForRedemption: {
      type: Number,
      default: 0,
    },
    totalLoyaltyPointEarned: {
      type: Number,
      default: 0,
    },
    favoriteProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    favoriteMerchants: [
      {
        merchantId: {
          type: String,
          ref: "Merchant",
        },
        businessCategoryId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "BusinessCategory",
        },
      },
    ],
  },
  {
    _id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

const referralDetailSchema = mongoose.Schema({
  referralType: {
    type: String,
    required: true,
  },
  referrerUserId: {
    type: String,
    ref: "Customer",
    required: true,
  },
  processed: {
    type: Boolean,
    default: false,
  },
});

const customerSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
    },
    fullName: {
      type: String,
    },
    email: {
      type: String,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    lastPlatformUsed: {
      type: String,
    },
    role: {
      type: String,
      default: "Customer",
    },
    customerDetails: customerDetailSchema,
    referralDetail: referralDetailSchema,
    loyaltyPointDetails: [
      {
        earnedOn: {
          type: Date,
          default: Date.now,
        },
        point: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],
    refreshToken: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Middleware to set the custom _id before saving
customerSchema.pre("save", async function (next) {
  try {
    if (this.isNew) {
      const now = new Date();
      const year = now.getFullYear().toString().slice(-2);
      const month = `0${now.getMonth() + 1}`.slice(-2);

      let counter = await DatabaseCounter.findOneAndUpdate(
        {
          type: "Customer",
          year: parseInt(year, 10),
          month: parseInt(month, 10),
        },
        { $inc: { count: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      if (!counter) {
        throw new Error("Counter document could not be created or updated.");
      }

      const customId = `C${year}${month}${counter.count}`;
      this._id = customId;
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Adding virtual for averageRating in customerDetailSchema
customerDetailSchema.virtual("averageRating").get(function () {
  if (!this.ratingsByAgents || this.ratingsByAgents.length === 0) {
    return 0;
  }

  const total = this.ratingsByAgents.reduce(
    (acc, rating) => acc + rating.rating,
    0
  );

  return total / this.ratingsByAgents.length;
});

const Customer = mongoose.model("Customer", customerSchema);
module.exports = Customer;
