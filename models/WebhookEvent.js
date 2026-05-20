const mongoose = require("mongoose");

const webhookEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      unique: true,
      required: true,
    },

    eventType: String,

    processed: {
      type: Boolean,
      default: false,
    },

    payload: Object,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "WebhookEvent",
  webhookEventSchema
);