const mongoose = require("mongoose");

const fcmTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      unique: true,
    },
    token: {
      type: [String],
      required: true,
      validate: {
        validator: function (v) {
          return Array.isArray(v) && v.length <= 3;
        },
        message: "Token array cannot exceed 3 elements",
      },
    },
  },
  {
    timestamps: true,
  }
);

// TTL index: expire documents 90 days after last update (tokens older than 90 days auto-removed)
fcmTokenSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const FcmToken = mongoose.model("FcmToken", fcmTokenSchema);
module.exports = FcmToken;
