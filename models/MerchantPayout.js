const mongoose = require("mongoose");

const merchantPayoutSchema = mongoose.Schema(
  {
    merchantId: {
      type: String,
      ref: "Merchant",
      required: true,
    },
    merchantName: {
      type: String,
      required: true,
    },
    geofenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Geofence",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    totalCostPrice: {
      type: Number,
      required: true,
    },
    completedOrders: {
      type: Number,
      required: true,
    },
    isSettled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const MerchantPayout = mongoose.model("MerchantPayout", merchantPayoutSchema);
module.exports = MerchantPayout;
