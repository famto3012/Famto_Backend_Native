const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.Mixed,
        required: true,
      },
    ],
    orderId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lastMessage: {
      text: String,
      sender: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
      },
      seen: {
        type: Boolean,
        default: false,
      },
    },
    deletionDate: {
      type: Date,
    },
  },
  { timestamps: true }
);

conversationSchema.index({ orderId: 1 });
conversationSchema.index({ participants: 1, orderId: 1 });

// Pre-save hook to set deletionDate 7 days after createdAt
conversationSchema.pre("save", function (next) {
  if (!this.deletionDate) {
    this.deletionDate = new Date(this.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days in milliseconds
  }
  next();
});

const Conversation = mongoose.model("Conversation", conversationSchema);

module.exports = Conversation;
