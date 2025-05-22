const AgentNotificationLogs = require("../models/AgentNotificationLog");
const AgentPricing = require("../models/AgentPricing");
const AgentSurge = require("../models/AgentSurge");
const Customer = require("../models/Customer");
const CustomerPricing = require("../models/CustomerPricing");
const CustomerTransaction = require("../models/CustomerTransactionDetail");
const Referral = require("../models/Referral");
const SubscriptionLog = require("../models/SubscriptionLog");
const Task = require("../models/Task");
const { calculateDeliveryCharges } = require("./customerAppHelpers");
const moment = require("moment-timezone");

const formatToHours = (milliseconds) => {
  const totalMinutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  // Format the hours and minutes for readability
  const hoursFormatted = hours > 0 ? `${hours} h ` : "";
  const minutesFormatted = minutes > 0 ? `${minutes} min` : "";

  // If both hours and minutes are zero, return '0m'
  return hoursFormatted + (minutesFormatted || "0 min");
};

const moveAppDetailToWorkHistoryAndResetForAllAgents = async () => {
  try {
    const Agent = require("../models/Agent");
    const AgentPricing = require("../models/AgentPricing");
    const AgentWorkHistory = require("../models/AgentWorkHistory");

    const agents = await Agent.find({
      isApproved: "Approved",
      isBlocked: false,
    })
      .lean()
      .select([
        "_id",
        "appDetail",
        "loginStartTime",
        "workStructure.salaryStructureId",
        "status",
      ]);

    const currentTime = new Date();
    const lastDay = new Date();
    lastDay.setDate(lastDay.getDate() - 1);

    const historyDocuments = [];
    const bulkOperations = [];

    for (const agent of agents) {
      const appDetail = agent.appDetail || {
        totalEarning: 0,
        orders: 0,
        pendingOrders: 0,
        totalDistance: 0,
        cancelledOrders: 0,
        loginDuration: 0,
        orderDetail: [],
      };

      let totalEarning = appDetail?.totalEarning || 0;
      let totalDistance = appDetail?.totalDistance || 0;

      // Reset login duration before recalculating
      const loginStart = new Date(agent?.loginStartTime || currentTime);
      const loginDuration = currentTime - loginStart;
      appDetail.loginDuration += loginDuration;

      // Fetch agent pricing only once per agent
      const agentPricing = await AgentPricing.findById(
        agent.workStructure.salaryStructureId
      ).lean();

      if (agentPricing) {
        if (agentPricing?.type?.startsWith("Monthly")) {
          if (appDetail.orders > 0 && appDetail.loginDuration > 0) {
            totalEarning = agentPricing.baseFare;
          }
        } else {
          totalEarning = totalDistance * agentPricing.baseDistanceFarePerKM;

          if (
            appDetail.orders >= agentPricing.minOrderNumber &&
            appDetail.loginDuration >= agentPricing.minOrderNumber
          ) {
            totalEarning += agentPricing.baseFare;
          }

          if (appDetail.orders > agentPricing.minOrderNumber) {
            const extraOrders = appDetail.orders - agentPricing.minOrderNumber;
            const earningForExtraOrders =
              extraOrders * agentPricing.fareAfterMinOrderNumber;

            totalEarning += earningForExtraOrders;
          }

          const minLoginMillis = agentPricing.minLoginHours * 60 * 60 * 1000;
          const extraMillis = appDetail.loginDuration - minLoginMillis;

          if (extraMillis > 0) {
            const extraHours = Math.floor(extraMillis / (60 * 60 * 1000));

            if (extraHours >= 1) {
              const earningForExtraHours =
                Math.floor(extraHours) * agentPricing.fareAfterMinLoginHours;

              totalEarning += earningForExtraHours;
            }
          }
        }
      }

      // Construct the work history document
      historyDocuments.push({
        agentId: agent._id,
        workDate: lastDay,
        totalEarning: totalEarning,
        orders: appDetail.orders,
        pendingOrders: appDetail.pendingOrders,
        totalDistance: appDetail.totalDistance,
        cancelledOrders: appDetail.cancelledOrders,
        loginDuration: appDetail.loginDuration,
        paymentSettled: false,
        orderDetail: appDetail.orderDetail,
      });

      // Prepare the bulk update operation
      const update = {
        $set: {
          "appDetail.totalEarning": 0,
          "appDetail.orders": 0,
          "appDetail.pendingOrders": 0,
          "appDetail.totalDistance": 0,
          "appDetail.cancelledOrders": 0,
          "appDetail.loginDuration": 0,
          "appDetail.orderDetail": [],
          loginStartTime:
            agent.status !== "Inactive" ? currentTime : agent.loginStartTime,
        },
      };

      bulkOperations.push({
        updateOne: {
          filter: { _id: agent._id },
          update,
        },
      });
    }

    // Insert history documents
    if (historyDocuments.length > 0) {
      await AgentWorkHistory.insertMany(historyDocuments);
    }

    // Execute bulk update operations
    if (bulkOperations.length > 0) {
      await Agent.bulkWrite(bulkOperations);
    }

    console.log(
      "History documents inserted and agent data reset successfully."
    );
  } catch (err) {
    console.log(
      `Error moving appDetail to history for all agents: ${err.message}`
    );
  }
};

const updateLoyaltyPoints = (customer, criteria, orderAmount) => {
  if (!criteria || !orderAmount || orderAmount <= 0) {
    console.error("Invalid criteria or orderAmount.");
    return;
  }

  const {
    earningCriteriaRupee,
    earningCriteriaPoint,
    maxEarningPointPerOrder,
  } = criteria;

  let loyaltyPointEarnedToday =
    customer.customerDetails?.loyaltyPointEarnedToday || 0;

  // Calculate points for the current order
  const calculatedPoints =
    Math.floor(orderAmount / earningCriteriaRupee) * earningCriteriaPoint;

  // Cap points at maxEarningPointPerOrder if it exceeds
  const pointsOfOrder = Math.min(calculatedPoints, maxEarningPointPerOrder);

  loyaltyPointEarnedToday += pointsOfOrder;

  // Update customer details
  customer.customerDetails.loyaltyPointEarnedToday = loyaltyPointEarnedToday;
  customer.customerDetails.loyaltyPointLeftForRedemption += pointsOfOrder;
  customer.customerDetails.totalLoyaltyPointEarned += pointsOfOrder;

  // Add new loyalty point entry
  customer.loyaltyPointDetails.push({
    earnedOn: new Date(),
    point: pointsOfOrder,
  });
};

const processReferralRewards = async (customer, orderAmount) => {
  const referralType = customer?.referralDetail?.referralType;
  const referralFound = await Referral.findOne({ referralType });

  const now = new Date();
  const registrationDate = new Date(customer.createdAt);

  const durationInDays = Math.floor(
    (now - registrationDate) / (1000 * 60 * 60 * 24)
  );

  if (durationInDays > 7) return;

  if (!referralFound || orderAmount < referralFound.minOrderAmount) return;

  const referrerFound = await Customer.findById(
    customer?.referralDetail?.referrerUserId
  );

  const {
    referrerDiscount,
    refereeDiscount,
    referrerMaxDiscountValue,
    refereeMaxDiscountValue,
  } = referralFound;

  let referrerTransaction;
  let customerTransaction;

  if (referralType === "Flat-discount") {
    referrerTransaction = {
      madeOn: new Date(),
      transactionType: "Referal",
      transactionAmount: parseFloat(referrerDiscount),
      type: "Credit",
    };

    customerTransaction = {
      madeOn: new Date(),
      transactionType: "Referal",
      transactionAmount: parseFloat(refereeDiscount),
      type: "Credit",
    };

    referrerFound.customerDetails.walletBalance += parseFloat(referrerDiscount);

    customer.customerDetails.walletBalance += parseFloat(refereeDiscount);
  } else if (referralType === "Percentage-discount") {
    const referrerAmount = Math.min(
      (orderAmount * referrerDiscount) / 100,
      referrerMaxDiscountValue
    );
    const refereeAmount = Math.min(
      (orderAmount * refereeDiscount) / 100,
      refereeMaxDiscountValue
    );

    referrerTransaction = {
      madeOn: new Date(),
      transactionType: "Referal",
      transactionAmount: parseFloat(referrerAmount),
      type: "Credit",
    };

    customerTransaction = {
      madeOn: new Date(),
      transactionType: "Referal",
      transactionAmount: parseFloat(refereeAmount),
      type: "Credit",
    };

    referrerFound.customerDetails.walletBalance += parseFloat(referrerAmount);

    customer.customerDetails.walletBalance += parseFloat(refereeAmount);
  }

  customer.referralDetail.processed = true;

  const transactions = [];

  if (referrerTransaction) {
    transactions.push({
      ...referrerTransaction,
      customerId: referrerFound._id,
    });
  }

  if (customerTransaction) {
    transactions.push({ ...customerTransaction, customerId: customer._id });
  }

  if (transactions.length > 0) {
    await Promise.all([
      referrerFound.save(),
      customer.save(),
      CustomerTransaction.insertMany(transactions),
    ]);
  }
};

const calculateAgentEarnings = async (agent, order) => {
  const [agentPricing, agentSurge] = await Promise.all([
    AgentPricing.findById(agent?.workStructure?.salaryStructureId),
    AgentSurge.findOne({
      geofenceId: agent.geofenceId,
      status: true,
    }),
  ]);

  if (!agentPricing) throw new Error("Agent pricing not found");
  if (agentPricing?.type.startsWith("Monthly")) {
    return 0;
  }

  const distanceForOrder = order?.detailAddedByAgent?.distanceCoveredByAgent
    ? order.detailAddedByAgent.distanceCoveredByAgent
    : order.orderDetail.distance;

  let orderSalary = distanceForOrder * agentPricing.baseDistanceFarePerKM;

  let surgePrice = 0;

  if (agentSurge) {
    surgePrice =
      (distanceForOrder / agentSurge.baseDistance) * agentSurge.baseFare;
  }

  let totalPurchaseFare = 0;

  if (order.orderDetail.deliveryMode === "Custom Order") {
    const taskFound = await Task.findOne({ orderId: order._id });
    if (taskFound) {
      const durationInHours =
        (new Date(taskFound?.deliveryDetail?.startTime) -
          new Date(taskFound.pickupDetail.startTime)) /
        (1000 * 60 * 60);

      const normalizedHours =
        durationInHours < 1 ? 1 : Math.floor(durationInHours);

      totalPurchaseFare = normalizedHours * agentPricing.purchaseFarePerHour;
    }
  }

  const totalEarnings = orderSalary + totalPurchaseFare + surgePrice;

  // Use Number to ensure it's a number with two decimal places
  return Number(totalEarnings?.toFixed(2));
};

const updateOrderDetails = (order, calculatedSalary) => {
  const currentTime = new Date();
  let delayedBy = null;

  if (currentTime > new Date(order.orderDetail.deliveryTime)) {
    delayedBy = currentTime - new Date(order.orderDetail.deliveryTime);
  }

  order.status = "Completed";
  order.paymentStatus = "Completed";
  order.orderDetail.deliveryTime = currentTime;
  order.orderDetail.timeTaken =
    currentTime - new Date(order.orderDetail.agentAcceptedAt);
  order.orderDetail.delayedBy = delayedBy;

  if (!order?.detailAddedByAgent) order.detailAddedByAgent = {};

  order.detailAddedByAgent.agentEarning = calculatedSalary;
};

const updateAgentDetails = async (
  agent,
  order,
  calculatedSalary,
  isOrderCompleted
) => {
  if (isOrderCompleted) {
    agent.appDetail.orders += 1;
  } else {
    agent.appDetail.cancelledOrders += 1;
  }

  agent.appDetail.totalEarning += parseFloat(calculatedSalary);
  agent.appDetail.totalDistance += parseFloat(
    order.detailAddedByAgent?.distanceCoveredByAgent.toFixed(2)
  );

  agent.appDetail.orderDetail.push({
    orderId: order._id,
    deliveryMode: order?.orderDetail?.deliveryMode,
    customerName: order?.orderDetail?.deliveryAddress?.fullName,
    completedOn: new Date(),
    grandTotal: order?.billDetail?.grandTotal,
  });

  const currentDay = moment.tz(new Date(), "Asia/Kolkata");
  const startOfDay = currentDay.startOf("day").toDate();
  const endOfDay = currentDay.endOf("day").toDate();

  const agentTasks = await Task.find({
    taskStatus: "Assigned",
    agentId: agent._id,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  }).sort({
    createdAt: 1,
  });

  agentTasks.length > 0 ? (agent.status = "Busy") : (agent.status = "Free");
};

const updateNotificationStatus = async (orderId) => {
  try {
    const notificationFound = await AgentNotificationLogs.findOne({
      orderId,
      status: "Accepted",
    });

    if (!notificationFound) throw new Error("Notification not found");

    notificationFound.status = "Completed";

    await notificationFound.save();
  } catch (err) {
    throw new Error(`Error in updating notification: ${err}`);
  }
};

const updateCustomerSubscriptionCount = async (customerId) => {
  try {
    const subscriptionOfCustomer = await Customer.findById(customerId).select(
      "customerDetails.pricing"
    );

    if (subscriptionOfCustomer?.customerDetails?.pricing?.length > 0) {
      const subscriptionLog = await SubscriptionLog.findById(
        subscriptionOfCustomer.customerDetails.pricing[0]
      );

      if (subscriptionLog) {
        subscriptionLog.currentNumberOfOrders += 1;

        await subscriptionLog.save();
      }
    }
  } catch (err) {
    throw new Error("Error in updating subscription count of customer");
  }
};

const updateBillOfCustomOrderInDelivery = async (order, task, socket) => {
  try {
    const reachedPickupAt = task?.pickupDetail?.completedTime;
    const deliveryStartAt = task?.deliveryDetail?.startTime;
    const pickupStartAt = task?.pickupDetail?.startTime;
    const now = new Date();

    let calculatedWaitingFare = 0;
    let totalDistance = order?.orderDetail?.distance;

    const customerPricing = await CustomerPricing.findOne({
      deliveryMode: "Custom Order",
      geofenceId: order?.customerId?.customerDetails?.geofenceId,
      status: true,
    });

    if (!customerPricing) {
      return socket.emit("error", {
        message: `Customer pricing for custom order not found`,
        success: false,
      });
    }

    console.log("customerPricing", customerPricing);

    const {
      baseFare,
      baseDistance,
      fareAfterBaseDistance,
      waitingFare,
      waitingTime,
    } = customerPricing;

    const deliveryCharge = calculateDeliveryCharges(
      totalDistance,
      baseFare,
      baseDistance,
      fareAfterBaseDistance
    );

    console.log("deliveryCharge", deliveryCharge);

    const minutesWaitedAtPickup = Math.floor(
      (new Date(deliveryStartAt) - new Date(reachedPickupAt)) / 60000
    );

    console.log("minutesWaitedAtPickup", minutesWaitedAtPickup);

    if (minutesWaitedAtPickup > waitingTime) {
      const additionalMinutes = Math.round(minutesWaitedAtPickup - waitingTime);
      calculatedWaitingFare = parseFloat(waitingFare * additionalMinutes);
    }

    console.log("Calculating");

    const totalTaskTime = new Date(now) - new Date(pickupStartAt);

    console.log("totalTaskTime", totalTaskTime);

    // Convert the difference to minutes
    const diffInHours = Math.ceil(totalTaskTime / 3600000);

    console.log("diffInHours", diffInHours);

    let calculatedPurchaseFare = 0;

    if (diffInHours > 0) {
      calculatedPurchaseFare = parseFloat(
        (diffInHours * customerPricing.purchaseFarePerHour).toFixed(2)
      );
    }

    const calculatedDeliveryFare =
      deliveryCharge + calculatedPurchaseFare + calculatedWaitingFare;

    console.log("calculatedDeliveryFare", calculatedDeliveryFare);

    order.billDetail.waitingCharges = calculatedDeliveryFare;
    order.billDetail.deliveryCharge = calculatedDeliveryFare;
    order.billDetail.grandTotal += calculatedDeliveryFare;
    order.billDetail.subTotal += calculatedDeliveryFare;

    await order.save();
  } catch (err) {
    return socket.emit("error", {
      message: `Error in updating bill ${err}`,
      success: false,
    });
  }
};

module.exports = {
  formatToHours,
  // moveAppDetailToHistoryAndResetForAllAgents,
  moveAppDetailToWorkHistoryAndResetForAllAgents,
  updateLoyaltyPoints,
  processReferralRewards,
  calculateAgentEarnings,
  updateOrderDetails,
  updateAgentDetails,
  updateNotificationStatus,
  updateCustomerSubscriptionCount,
  updateBillOfCustomOrderInDelivery,
};
