const mongoose = require("mongoose");

const whatsappConnectionSchema = new mongoose.Schema(
  {
    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Merchant",
      required: true,
      index: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    phoneNumberId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    displayName: String,
    profilePic: String,
    status: {
      type: String,
      enum: ["Pending", "Active", "Failed"],
      default: "Pending",
      index: true,
    },
    wabaId: String,
    mode: {
      type: String,
      enum: ["PlatformWABA", "OwnWABA"],
      default: "PlatformWABA",
    },
    verifiedAt: Date,
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

whatsappConnectionSchema.index({ merchantId: 1, status: 1 });
whatsappConnectionSchema.index({ phoneNumberId: 1, merchantId: 1 });

module.exports = mongoose.model(
  "WhatsappConnection",
  whatsappConnectionSchema
);