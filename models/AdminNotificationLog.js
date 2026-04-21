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

AdminNotificationLogSchema.index({ createdAt: -1 });
AdminNotificationLogSchema.index({ merchantId: 1, createdAt: -1 });
AdminNotificationLogSchema.index({ geofenceId: 1, createdAt: -1 });

const AdminNotificationLogs = mongoose.model(
  "AdminNotificationLogs",
  AdminNotificationLogSchema
);

module.exports = AdminNotificationLogs;
