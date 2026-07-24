const mongoose = require("mongoose");

const customerSubscriptionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "Subscription",
    },
    name: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    duration: {
      type: Number,
      required: true,
    },
    taxId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tax",
      default: null,
    },
    renewalReminder: {
      type: Number,
      required: true,
    },
    noOfOrder: {
      type: Number,
      required: true,
    },
    // NEW: Controls what delivery discount subscribers get
    // "free"     → delivery charge = ₹0 (current behavior)
    // "percentage" → delivery charge reduced by deliveryBenefitValue%
    // "fixed"      → delivery charge reduced by deliveryBenefitValue rupees
    deliveryBenefitType: {
      type: String,
      enum: ["free", "percentage", "fixed"],
      default: "free",
    },
    // Used when deliveryBenefitType is "percentage" or "fixed"
    // Percentage: 1–100. Fixed: any rupee amount.
    deliveryBenefitValue: {
      type: Number,
      default: 0,
    },
    // When deliveryBenefitType is "free", this caps the distance for free delivery.
    // 0 means unlimited (free at any distance).
    // When distanceInKM exceeds this value, full delivery charge applies.
    freeDeliveryUpToKm: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const CustomerSubscription = mongoose.model(
  "CustomerSubscription",
  customerSubscriptionSchema
);
module.exports = CustomerSubscription;
