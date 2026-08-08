const mongoose = require("mongoose");

const whatsappContactSchema = new mongoose.Schema(
  {
    waId: {
      type: String,
      required: true,
      index: true,
    },
    merchantId: {
      type: String,
      ref: "Merchant",
      default: null,
      index: true,
    },
    name: {
      type: String,
      default: "",
    },
    phone: {
      type: String,
      required: true,
    },
    email: String,
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    notes: {
      type: String,
      default: "",
    },
    customFields: {
      type: Map,
      of: String,
      default: {},
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsappConversation",
      default: null,
    },
    lastContactedAt: Date,
  },
  { timestamps: true }
);

whatsappContactSchema.index({ waId: 1, merchantId: 1 }, { unique: true });

module.exports = mongoose.model("WhatsappContact", whatsappContactSchema);
