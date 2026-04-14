const mongoose = require("mongoose");

const AdminNotificationLogSchema = new mongoose.Schema(
  {
    orderId: [
      {
        type: String,
        ref: "Order",
      },
    ],
    merchantId: {
      type: String,
      default: null,
    },
    geofenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Geofence",
      default: null,
    },
    imageUrl: {
      type: String,
      default: null,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const AdminNotificationLogs = mongoose.model(
  "AdminNotificationLogs",
  AdminNotificationLogSchema
);

module.exports = AdminNotificationLogs;
