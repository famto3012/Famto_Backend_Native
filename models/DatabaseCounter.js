const mongoose = require("mongoose");

const databaseCounterSchema = mongoose.Schema({
  type: {
    type: String,
    enum: ["Agent", "Customer", "Merchant", "Order", "ScheduledOrder"],
    required: true,
  },
  year: {
    type: Number,
    required: true,
  },
  month: {
    type: Number,
    required: true,
  },
  count: {
    type: Number,
    default: 0,
  },
});

// P0 multi-tenant fix: no unique index meant two concurrent upserts could both
// $inc the same type/year/month counter and mint the same custom _id (duplicate
// Merchant/Agent/Order IDs). Compound unique prevents that.
databaseCounterSchema.index({ type: 1, year: 1, month: 1 }, { unique: true });

const DatabaseCounter = mongoose.model(
  "DatabaseCounter",
  databaseCounterSchema
);

module.exports = DatabaseCounter;
