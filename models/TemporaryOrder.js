const mongoose = require("mongoose");

const tempOrderSchema = new mongoose.Schema(
  {
    orderId: mongoose.Schema.Types.ObjectId,
    customerId: String,
    merchantId: String,
    items: Array,
    orderDetail: Object,
    billDetail: Object,
    totalAmount: Number,
    status: String,
    paymentMode: String,
    paymentStatus: String,
    paymentId: String,
    purchasedItems: Object,
  },
  { timestamps: true }
);

// Auto-delete orders after 60 seconds
tempOrderSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 });

const TemporaryOrder = mongoose.model("TemporaryOrder", tempOrderSchema);
module.exports = TemporaryOrder;
