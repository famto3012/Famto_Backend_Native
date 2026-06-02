const mongoose = require("mongoose");

const whatsappBusinessProfileSchema = new mongoose.Schema(
  {
    phoneNumberId: {
      type: String,
      required: true,
    },
    displayPhoneNumber: String,
    verifiedName: String,
    about: String,
    address: String,
    description: String,
    email: String,
    vertical: String,
    websites: [String],
    profilePictureUrl: String,
    messagingLimitTier: String,
    qualityRating: {
      type: String,
      enum: ["GREEN", "YELLOW", "RED", "UNKNOWN"],
      default: "UNKNOWN",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "WhatsappBusinessProfile",
  whatsappBusinessProfileSchema
);
