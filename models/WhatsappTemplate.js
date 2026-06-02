const mongoose = require("mongoose");

const whatsappTemplateSchema = new mongoose.Schema(
  {
    metaTemplateId: {
      type: String,
      unique: true,
      sparse: true,
    },
    name: {
      type: String,
      required: true,
      index: true,
    },
    language: {
      type: String,
      default: "en_US",
    },
    category: {
      type: String,
      enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
      required: true,
    },
    status: {
      type: String,
      enum: ["APPROVED", "PENDING", "REJECTED", "DISABLED", "PAUSED"],
      default: "PENDING",
      index: true,
    },
    components: {
      type: Array,
      default: [],
    },
    rejectedReason: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsappTemplate", whatsappTemplateSchema);
