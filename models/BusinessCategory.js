const mongoose = require("mongoose");

const BusinessCategorySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      unique: true,
    },
    geofenceId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Geofence",
        required: true,
      },
    ],
    bannerImageURL: {
      type: String,
      required: true,
    },
    status: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      required: true,
    },
    increasedPercentage: {
      type: Number,
      default: 0,
    },
    merchantFilters: {
      type: [String],
    },
    productFilters: {
      type: [String],
    },
    imageDisplayType: {
      type: String,
      enum: ["cover", "contain"],
      default: "cover",
    },
  },
  {
    timestamps: true,
  }
);

const BusinessCategory = mongoose.model(
  "BusinessCategory",
  BusinessCategorySchema
);
module.exports = BusinessCategory;
