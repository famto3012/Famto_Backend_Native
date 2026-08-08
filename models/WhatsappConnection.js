const mongoose = require("mongoose");
const { encrypt, decrypt } = require("../utils/crypto");

const whatsappConnectionSchema = new mongoose.Schema(
  {
    merchantId: {
      type: String,
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
    // Meta access token for the merchant's own number — encrypted at rest,
    // hidden from queries by default (select: false).
    token: {
      type: String,
      select: false,
    },
    // Meta WABA business account id. resolveConfig() reads this (falling back
    // to wabaId) so template APIs hit the merchant's WABA, not the platform's.
    businessAccountId: String,
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

// Encrypt token before save (only when modified, so updates that don't touch it
// keep the existing ciphertext).
whatsappConnectionSchema.pre("save", function (next) {
  if (this.isModified("token") && this.token) {
    this.token = encrypt(this.token);
  }
  next();
});

// Helper to get the plaintext token for send paths.
whatsappConnectionSchema.methods.getDecryptedToken = function () {
  if (!this.token) return null;
  return decrypt(this.token);
};

module.exports = mongoose.model(
  "WhatsappConnection",
  whatsappConnectionSchema
);