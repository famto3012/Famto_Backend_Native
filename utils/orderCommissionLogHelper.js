const Commission = require("../models/Commission");
const CommissionLogs = require("../models/CommissionLog");
const Merchant = require("../models/Merchant");
const appError = require("./appError");

const orderCommissionLogHelper = async (order) => {
  try {
    if (!order) {
      throw new Error("Order not found");
    }

    const merchant = await Merchant.findById(order.merchantId);
    if (!merchant) {
      throw new Error("Merchant not found");
    }

    const merchantName = merchant.merchantDetail.merchantName;

    const commissions = await Commission.find({ merchantId: order.merchantId });

    // No commission configured for this merchant — return zeros so order
    // acceptance still proceeds instead of crashing
    if (commissions.length === 0) {
      console.warn(`[CommissionLog] No commission found for merchant ${order.merchantId} — defaulting to 0`);
      return { payableAmountToFamto: 0, payableAmountToMerchant: 0 };
    }

    const commission = commissions[0];

    const purchasedItems = order.purchasedItems || [];
    const totalAmount =
      purchasedItems.length > 0
        ? purchasedItems.reduce(
            (total, item) => total + (item.costPrice || 0) * item.quantity,
            0
          )
        : order.billDetail.itemTotal;

    let payableAmountToMerchant = 0;
    let payableAmountToFamto = 0;
    if (commission.commissionType === "Percentage") {
      payableAmountToFamto = (totalAmount * commission.commissionValue) / 100;
      payableAmountToMerchant = totalAmount - payableAmountToFamto;
    } else {
      payableAmountToFamto = Math.min(commission.commissionValue, totalAmount);
      payableAmountToMerchant = totalAmount - payableAmountToFamto;
    }

    const commissionLog = new CommissionLogs({
      orderId: order._id,
      merchantId: order.merchantId,
      merchantName,
      totalAmount,
      payableAmountToMerchant,
      payableAmountToFamto,
      paymentMode: order.paymentMode,
      status: "Unpaid",
    });

    await commissionLog.save();

    return { payableAmountToFamto, payableAmountToMerchant };
  } catch (err) {
    // Re-throw so the controller's next(appError(...)) can handle it properly
    throw new Error(err.message);
  }
};

const calculateMerchantAndFamtoEarnings = async (order) => {
  try {
    const purchasedItems = order.purchasedItems;

    if (purchasedItems.length === 0)
      return {
        merchantEarnings: 0,
        famtoEarnings: 0,
      };

    const totalPrice = purchasedItems.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );

    const totalCostPrice = purchasedItems.reduce(
      (total, item) => total + item.costPrice * item.quantity,
      0
    );

    return {
      merchantEarnings: totalCostPrice,
      famtoEarnings: totalPrice - totalCostPrice,
    };
  } catch (err) {
    throw new Error(err.message);
  }
};

module.exports = {
  orderCommissionLogHelper,
  calculateMerchantAndFamtoEarnings,
};
