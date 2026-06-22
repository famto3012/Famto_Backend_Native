const mongoose = require("mongoose");

const Order = require("../models/Order");
const ScheduledOrder = require("../models/ScheduledOrder");
const TemporaryOrder = require("../models/TemporaryOrder");
const CustomerCart = require("../models/CustomerCart");
const CustomerWalletTransaction = require("../models/CustomerWalletTransaction");
const PromoCode = require("../models/PromoCode");
const ActivityLog = require("../models/ActivityLog");
const CustomerTransaction = require("../models/CustomerTransactionDetail");
const PickAndCustomCart = require("../models/PickAndCustomCart");
const DatabaseCounter = require("../models/DatabaseCounter");

const processOrderService = async (tempOrder) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const isScheduled =
      tempOrder.deliveryOption === "Scheduled";

    const orderPayload = {
      customerId: tempOrder.customerId,
      merchantId: tempOrder.merchantId,
      pickups: tempOrder.pickups,
      drops: tempOrder.drops,
      billDetail: tempOrder.billDetail,
      distance: tempOrder.distance,
      deliveryTime: tempOrder.deliveryTime,
      startDate: tempOrder.startDate,
      endDate: tempOrder.endDate,
      time: tempOrder.time,
      numOfDays: tempOrder.numOfDays,
      totalAmount: tempOrder.totalAmount,
      deliveryMode: tempOrder.deliveryMode,
      deliveryOption: tempOrder.deliveryOption,
      paymentMode: tempOrder.paymentMode,
      paymentId: tempOrder.paymentId,
      purchasedItems: tempOrder.purchasedItems,
      prescription: tempOrder.prescription,
      status: "Pending",
      paymentStatus:
        tempOrder.paymentStatus === "PAYMENT_COMPLETED"
          ? "Completed"
          : "Pending",

      orderDetailStepper: {
        created: {
          by: "Customer",
          userId: tempOrder.customerId,
          date: new Date(),
        },
      },
    };

    // Generate order ID inside the transaction to prevent counter drift on abort
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = `0${now.getMonth() + 1}`.slice(-2);
    const counterType = isScheduled ? "ScheduledOrder" : "Order";
    const prefix = isScheduled ? "SO" : "O";

    const counter = await DatabaseCounter.findOneAndUpdate(
      { type: counterType, year: parseInt(year), month: parseInt(month) },
      { $inc: { count: 1 } },
      { new: true, upsert: true, session }
    );

    orderPayload._id = `${prefix}${year}${month}${counter.count}`;

    let createdOrder;

    if (isScheduled) {
      createdOrder = await ScheduledOrder.create(
        [orderPayload],
        { session }
      );
    } else {
      createdOrder = await Order.create(
        [orderPayload],
        { session }
      );
    }

    const finalOrder = createdOrder[0];

    // Use the correct cart model based on delivery mode
    if (
      tempOrder.deliveryMode === "Pick and Drop" ||
      tempOrder.deliveryMode === "Custom Order"
    ) {
      await PickAndCustomCart.deleteOne(
        { customerId: tempOrder.customerId },
        { session }
      );
    } else {
      await CustomerCart.deleteOne(
        { customerId: tempOrder.customerId },
        { session }
      );
    }

    if (tempOrder.billDetail?.promoCodeUsed) {
      await PromoCode.findOneAndUpdate(
        {
          promoCode:
            tempOrder.billDetail.promoCodeUsed,
        },
        {
          $inc: {
            noOfUserUsed: 1,
          },
        },
        {
          session,
        }
      );
    }

    await CustomerTransaction.create(
      [
        {
          customerId: tempOrder.customerId,
          madeOn: new Date(),
          transactionType: "Order Created",
          transactionAmount: tempOrder.totalAmount,
          type: "Debit",
        },
      ],
      {
        session,
      }
    );

    if (
      tempOrder.paymentMode === "Famto-cash" &&
      tempOrder.orderId
    ) {
      await CustomerWalletTransaction.findOneAndUpdate(
        {
          orderId: tempOrder.orderId,
        },
        {
          $set: {
            orderId: finalOrder._id,
          },
        },
        {
          session,
        }
      );
    }

    await ActivityLog.create(
      [
        {
          userId: tempOrder.customerId,
          userType: "Customer",
          description: `Order (#${finalOrder._id}) created successfully`,
        },
      ],
      {
        session,
      }
    );

    await TemporaryOrder.findByIdAndUpdate(
      tempOrder._id,
      {
        processingStatus: "ORDER_CREATED",
      },
      {
        session,
      }
    );

    await session.commitTransaction();

    return finalOrder;
  } catch (err) {
    await session.abortTransaction();

    throw err;
  } finally {
    session.endSession();
  }
};

module.exports = processOrderService;
