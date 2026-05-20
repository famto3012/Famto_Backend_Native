const mongoose = require("mongoose");

const Order = require("../models/Order");
const ScheduledOrder = require("../models/ScheduledOrder");
const TemporaryOrder = require("../models/TemporaryOrder");
const CustomerCart = require("../models/CustomerCart");
const CustomerWalletTransaction = require("../models/CustomerWalletTransaction");
const PromoCode = require("../models/PromoCode");
const ActivityLog = require("../models/ActivityLog");
const CustomerTransaction = require("../models/CustomerTransactionDetail");

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

    await CustomerCart.deleteOne(
      {
        customerId: tempOrder.customerId,
      },
      { session }
    );

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
