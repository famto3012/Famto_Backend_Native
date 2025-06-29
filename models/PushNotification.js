const mongoose = require("mongoose");

const pushNotificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    geofenceId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Geofence",
        required: true,
      },
    ],
    imageUrl: {
      type: String,
      required: true,
    },
    merchant: {
      type: Boolean,
      default: false,
    },
    driver: {
      type: Boolean,
      default: false,
    },
    customer: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const PushNotification = mongoose.model(
  "PushNotification",
  pushNotificationSchema
);
module.exports = PushNotification;
