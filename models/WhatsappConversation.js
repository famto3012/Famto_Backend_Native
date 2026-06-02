const mongoose = require("mongoose");

const whatsappConversationSchema = new mongoose.Schema(
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
    profilePicUrl: String,
    status: {
      type: String,
      enum: ["open", "closed", "archived"],
      default: "open",
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
      index: true,
    },
    lastMessage: {
      text: { type: String, default: "" },
      timestamp: { type: Date, default: Date.now },
      direction: {
        type: String,
        enum: ["inbound", "outbound"],
        default: "inbound",
      },
    },
    unreadCount: {
      type: Number,
      default: 0,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsappContact",
      default: null,
    },
  },
  { timestamps: true }
);

whatsappConversationSchema.index({ "lastMessage.timestamp": -1 });
whatsappConversationSchema.index({ status: 1, "lastMessage.timestamp": -1 });

module.exports = mongoose.model(
  "WhatsappConversation",
  whatsappConversationSchema
);
