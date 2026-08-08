const mongoose = require("mongoose");

const whatsappNoteSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsappConversation",
      required: true,
      index: true,
    },
    merchantId: {
      type: String,
      ref: "Merchant",
      default: null,
      index: true,
    },
    content: {
      type: String,
      required: true,
    },
    createdBy: {
      type: String,
      ref: "Admin",
      required: true,
    },
    createdByName: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsappNote", whatsappNoteSchema);
