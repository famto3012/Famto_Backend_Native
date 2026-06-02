const mongoose = require("mongoose");

const campaignEventSchema = new mongoose.Schema(
  {
    waId: { type: String, required: true },
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "failed"],
      default: "queued",
    },
    metaMessageId: String,
    failureReason: String,
    timestamp: { type: Date, default: Date.now },
  },
  { _id: true }
);

const whatsappCampaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsappTemplate",
      required: true,
    },
    templateName: {
      type: String,
      required: true,
    },
    recipients: {
      type: [String],
      required: true,
    },
    templateParams: {
      type: Array,
      default: [],
    },
    status: {
      type: String,
      enum: ["draft", "sending", "completed", "failed", "partial"],
      default: "draft",
      index: true,
    },
    scheduledAt: Date,
    sentAt: Date,
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    events: [campaignEventSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsappCampaign", whatsappCampaignSchema);
