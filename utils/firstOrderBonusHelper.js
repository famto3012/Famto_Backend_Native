const Customer = require("../models/Customer");
const CustomerWalletTransaction = require("../models/CustomerWalletTransaction");

const BONUS_AMOUNT = 50;
const MIN_ORDER_AMOUNT = 300;

/**
 * Defensive helper: handles both pre-fetched order objects and raw ID strings.
 */
const resolveOrderObject = async (orderInput) => {
  if (typeof orderInput === "string") {
    const Order = require("../models/Order");
    return await Order.findById(orderInput);
  }
  return orderInput;
};

/**
 * Credit 50rs bonus if customer's first qualifying order (>= 300) completed.
 * One-time only — uses three-state enum: unclaimed / claimed / clawed_back.
 * Non-blocking: never throws, never blocks the completion flow.
 * 
 * For COD orders, only credits after payment is collected from customer.
 */
exports.creditMilestoneBonus = async (orderInput) => {
  try {
    const order = await resolveOrderObject(orderInput);
    if (!order || !order.customerId) return;

    const grandTotal = order.billDetail?.grandTotal || 0;
    if (grandTotal < MIN_ORDER_AMOUNT) return;

    // For COD orders, only credit after delivery completed AND payment collected
    if (order.paymentMode === "Cash-on-delivery") {
      if (
        order.paymentCollectedFromCustomer !== "Completed" ||
        order.status !== "Completed"
      ) {
        console.log(
          `[BONUS] Skipping bonus for COD order ${order._id} - payment not collected yet`
        );
        return;
      }
    }

    const customer = await Customer.findById(order.customerId);
    if (!customer) return;

    // Normalize old boolean/undefined values — skip migration
    const currentStatus = customer.milestoneBonusClaimed;
    const normalizedStatus = (currentStatus === false || !currentStatus) ? "unclaimed" : currentStatus;

    // Only credit if never claimed or clawed back
    if (normalizedStatus !== "unclaimed") return;

    const prevBalance = customer.customerDetails?.walletBalance || 0;
    const newBalance = prevBalance + BONUS_AMOUNT;

    customer.customerDetails.walletBalance = newBalance;
    customer.milestoneBonusClaimed = "claimed";
    customer.milestoneBonusOrderId = order._id;
    await customer.save();

    await CustomerWalletTransaction.create({
      customerId: customer._id,
      closingBalance: newBalance,
      transactionAmount: BONUS_AMOUNT,
      orderId: order._id,
      date: new Date(),
      type: "Credit",
    });

    console.log(
      `[BONUS] Credited ${BONUS_AMOUNT}rs to customer ${customer._id} for order ${order._id}`
    );
  } catch (err) {
    console.error("[BONUS] credit error:", err.message);
  }
};

/**
 * Clawback 50rs if the cancelled order was the one that triggered the bonus.
 * Sets status to "clawed_back" (not back to "unclaimed") to prevent
 * the cancel-reorder exploit loop.
 */
exports.clawbackMilestoneBonus = async (orderInput) => {
  try {
    const order = await resolveOrderObject(orderInput);
    if (!order || !order.customerId) return;

    const customer = await Customer.findById(order.customerId);
    if (!customer) return;

    // Only clawback if THIS specific order triggered the bonus
    if (String(customer.milestoneBonusOrderId) !== String(order._id)) return;
    if (customer.milestoneBonusClaimed !== "claimed") return;

    const prevBalance = customer.customerDetails?.walletBalance || 0;
    const newBalance = Math.max(0, prevBalance - BONUS_AMOUNT);

    customer.customerDetails.walletBalance = newBalance;
    customer.milestoneBonusClaimed = "clawed_back";
    await customer.save();

    await CustomerWalletTransaction.create({
      customerId: customer._id,
      closingBalance: newBalance,
      transactionAmount: -BONUS_AMOUNT,
      orderId: order._id,
      date: new Date(),
      type: "Debit",
    });

    console.log(
      `[BONUS] Clawed back ${BONUS_AMOUNT}rs from customer ${customer._id} for cancelled order ${order._id}`
    );
  } catch (err) {
    console.error("[BONUS] clawback error:", err.message);
  }
};