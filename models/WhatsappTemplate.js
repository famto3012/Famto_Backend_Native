const mongoose = require("mongoose");

const whatsappTemplateSchema = new mongoose.Schema(
  {
    metaTemplateId: {
      type: String,
      sparse: true,
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

whatsappTemplateSchema.index({ metaTemplateId: 1, merchantId: 1 }, { unique: true, sparse: true });
whatsappTemplateSchema.index({ merchantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("WhatsappTemplate", whatsappTemplateSchema);
