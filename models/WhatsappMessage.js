const mongoose = require("mongoose");

const whatsappMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsappConversation",
      required: true,
      index: true,
    },
    waId: {
      type: String,
      required: true,
      index: true,
    },
    metaMessageId: {
      type: String,
      sparse: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ["inbound", "outbound"],
      required: true,
    },
    messageType: {
      type: String,
      enum: [
        "text",
        "image",
        "audio",
        "video",
        "document",
        "location",
        "contacts",
        "template",
        "reaction",
        "sticker",
        "interactive",
      ],
      required: true,
    },
    body: {
      type: String,
      default: "",
    },
    media: {
      link: String,
      mimeType: String,
      caption: String,
      fileName: String,
    },
    location: {
      latitude: Number,
      longitude: Number,
      name: String,
      address: String,
    },
    contact: {
      firstName: String,
      lastName: String,
      fullName: String,
      phone: String,
      waId: String,
    },
    templateName: String,
    deliveryStatus: {
      type: String,
      enum: ["pending", "sent", "delivered", "read", "failed"],
      default: "pending",
    },
    failureReason: String,
    senderName: String,
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

whatsappMessageSchema.index({ conversationId: 1, timestamp: -1 });

module.exports = mongoose.model("WhatsappMessage", whatsappMessageSchema);
