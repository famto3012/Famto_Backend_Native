const mongoose = require("mongoose");

const whatsappContactSchema = new mongoose.Schema(
  {
    waId: {
      type: String,
      required: true,
      unique: true,
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

module.exports = mongoose.model("WhatsappContact", whatsappContactSchema);
