const moment = require("moment-timezone");

const Task = require("../models/Task");
const Referral = require("../models/Referral");
const Customer = require("../models/Customer");
const AgentSurge = require("../models/AgentSurge");
const AgentPricing = require("../models/AgentPricing");
const CustomerPricing = require("../models/CustomerPricing");
const SubscriptionLog = require("../models/SubscriptionLog");
const AgentNotificationLogs = require("../models/AgentNotificationLog");
const CustomerTransaction = require("../models/CustomerTransactionDetail");

const { calculateDeliveryCharges } = require("./customerAppHelpers");
const { errorLogger } = require("../middlewares/errorLogger");

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
        totalSurge: 0,
        deduction: 0,
        orders: 0,
        pendingOrders: 0,
        totalDistance: 0,
        totalStartToPickDistance: 0,
        cancelledOrders: 0,
        loginDuration: 0,
        orderDetail: [],
      };

      let totalEarning = appDetail?.totalEarning || 0;
      let totalSurge = appDetail?.totalSurge || 0;
      let totalDistance = appDetail?.totalDistance || 0;
      let totalStartToPickDistance = appDetail?.totalStartToPickDistance || 0;

      // Reset login duration before recalculating
      const loginStart = new Date(agent?.loginStartTime || currentTime);
      const loginDuration = currentTime - loginStart;
      appDetail.loginDuration += loginDuration;

      // Fetch agent pricing only once per agent
      const agentPricing = await AgentPricing.findById(
        agent?.workStructure?.salaryStructureId
      ).lean();

      if (agentPricing) {
        if (agentPricing?.type?.startsWith("Monthly")) {
          if (appDetail.orders > 0 && appDetail.loginDuration > 0) {
            totalEarning = agentPricing.baseFare;
          }
        } else {
          const fareForStartToPick =
            totalStartToPickDistance * agentPricing.startToPickFarePerKM;
          const fareForPickToDrop =
            (totalDistance - totalStartToPickDistance) *
            agentPricing.baseDistanceFarePerKM;

          totalEarning = fareForStartToPick + fareForPickToDrop + totalSurge;

          // const minLoginDurationInMilli =
          //   agentPricing.minLoginHours * 60 * 60 * 1000;
          // if (
          //   appDetail.orders >= agentPricing.minOrderNumber &&
          //   appDetail.loginDuration >= minLoginDurationInMilli
          // ) {
          //   totalEarning += agentPricing.baseFare;
          // }

          const pricePerOrder =
            agentPricing.baseFare / agentPricing.minOrderNumber;
          const calculatedEarning = pricePerOrder * appDetail.orders;

          totalEarning += Math.min(calculatedEarning, agentPricing.baseFare);

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
        totalEarning: Number(totalEarning.toFixed(2)),
        totalSurge: Number(totalSurge.toFixed(2)),
        deduction: appDetail?.deduction ?? 0,
        orders: appDetail.orders,
        pendingOrders: appDetail.pendingOrders,
        totalDistance: appDetail.totalDistance,
        totalDistanceFromPickToDrop: totalStartToPickDistance,
        cancelledOrders: appDetail.cancelledOrders,
        loginDuration: appDetail.loginDuration,
        paymentSettled: false,
        orderDetail: appDetail.orderDetail,
      });

      // Prepare the bulk update operation
      const update = {
        $set: {
          "appDetail.totalEarning": 0,
          "appDetail.totalSurge": 0,
          "appDetail.deduction": 0,
          "appDetail.orders": 0,
          "appDetail.pendingOrders": 0,
          "appDetail.totalDistance": 0,
          "appDetail.totalStartToPickDistance": 0,
          "appDetail.cancelledOrders": 0,
          "appDetail.loginDuration": 0,
          "appDetail.orderDetail": [],
          loginStartTime:
            agent.status !== "Inactive" ? currentTime : agent.loginStartTime,
          taskCompleted: 0,
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
    errorLogger(
      `Error in moving agent app detail to work history: ${JSON.stringify(err)}`
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

  const distanceFromStartToPick =
    order?.detailAddedByAgent?.startToPickDistance ?? 0;

  const distanceForOrder = order?.detailAddedByAgent?.distanceCoveredByAgent
    ? order.detailAddedByAgent.distanceCoveredByAgent - distanceFromStartToPick
    : order.distance;

  let orderSalary =
    distanceFromStartToPick * agentPricing.startToPickFarePerKM +
    distanceForOrder * agentPricing.baseDistanceFarePerKM;

  let surgePrice = 0;

  if (agentSurge) {
    surgePrice =
      (order?.detailAddedByAgent?.distanceCoveredByAgent ??
        order.distance / agentSurge.baseDistance) * agentSurge.baseFare;
  }

  let totalPurchaseFare = 0;

  if (order.deliveryMode === "Custom Order") {
    const taskFound = await Task.findOne({ orderId: order._id });
    if (taskFound) {
      const pickupStartTime =
        taskFound.pickupDropDetails?.[0]?.pickups?.[0]?.startTime;
      const dropStartTime =
        taskFound.pickupDropDetails?.[0]?.drops?.[0]?.startTime;

      if (pickupStartTime && dropStartTime) {
        const durationInHours =
          (new Date(dropStartTime) - new Date(pickupStartTime)) /
          (1000 * 60 * 60);

        const normalizedHours =
          durationInHours < 1 ? 1 : Math.floor(durationInHours);

        totalPurchaseFare = normalizedHours * agentPricing.purchaseFarePerHour;
      }
    }
  }

  const totalEarnings = orderSalary;
  const totalSurge = surgePrice + totalPurchaseFare;

  // Use Number to ensure it's a number with two decimal places
  return {
    calculatedSalary: Number(totalEarnings?.toFixed(2)),
    calculatedSurge: Number(totalSurge?.toFixed(2)),
  };
};

const updateOrderDetails = (order, calculatedSalary) => {
  const currentTime = new Date();
  let delayedBy = null;

  if (currentTime > new Date(order.deliveryTime)) {
    delayedBy = currentTime - new Date(order.deliveryTime);
  }

  order.status = "Completed";
  order.paymentStatus = "Completed";
  order.deliveryTime = currentTime;
  order.timeTaken = currentTime - new Date(order.agentAcceptedAt);
  order.delayedBy = delayedBy;

  if (!order?.detailAddedByAgent) order.detailAddedByAgent = {};

  order.detailAddedByAgent.agentEarning = calculatedSalary;
};

// const updateAgentDetails = async (
//   agent,
//   order,
//   calculatedSalary,
//   calculatedSurge,
//   isOrderCompleted
// ) => {
//   if (isOrderCompleted) {
//     agent.appDetail.orders += 1;
//   } else {
//     agent.appDetail.cancelledOrders += 1;
//   }

//   console.log("Agent ID:", agent._id);
//   console.log("Order ID:", order._id);
//   console.log("Order Completed Status:", isOrderCompleted);
//   console.log("Calculated Salary:", calculatedSalary);
//   console.log("Calculated Surge:", calculatedSurge);

//   agent.appDetail.totalEarning += parseFloat(calculatedSalary);
//   agent.appDetail.totalDistance += parseFloat(
//     order.detailAddedByAgent?.distanceCoveredByAgent?.toFixed(2)
//   );
//   agent.appDetail.totalStartToPickDistance += parseFloat(
//     order?.detailAddedByAgent?.startToPickDistance?.toFixed(2)
//   );
//   agent.appDetail.totalSurge += parseFloat(calculatedSurge);

//   agent.appDetail.orderDetail.push({
//     orderId: order._id,
//     deliveryMode: order?.deliveryMode,
//     customerName: order?.deliveryAddress?.fullName,
//     completedOn: new Date(),
//     grandTotal: order?.detailAddedByAgent?.agentEarning || 0,
//   });

//   const currentDay = moment.tz(new Date(), "Asia/Kolkata");
//   const startOfDay = currentDay.startOf("day").toDate();
//   const endOfDay = currentDay.endOf("day").toDate();

//   const agentTasks = await Task.find({
//     taskStatus: "Assigned",
//     agentId: agent._id,
//     createdAt: { $gte: startOfDay, $lte: endOfDay },
//   }).sort({
//     createdAt: 1,
//   });

//   agentTasks.length > 0 ? (agent.status = "Busy") : (agent.status = "Free");
// };

const updateAgentDetails = async (
  agent,
  order,
  calculatedSalary,
  calculatedSurge,
  isOrderCompleted
) => {
  console.log("👉 Entering updateAgentDetails...");

  if (isOrderCompleted) {
    agent.appDetail.orders += 1;
  } else {
    agent.appDetail.cancelledOrders += 1;
  }

  agent.appDetail.totalEarning += parseFloat(calculatedSalary);
  agent.appDetail.totalDistance += parseFloat(
    order.detailAddedByAgent?.distanceCoveredByAgent?.toFixed(2) || 0
  );
  agent.appDetail.totalStartToPickDistance += parseFloat(
    order?.detailAddedByAgent?.startToPickDistance?.toFixed(2) || 0
  );
  agent.appDetail.totalSurge += parseFloat(calculatedSurge);

  agent.appDetail.orderDetail.push({
    orderId: order._id,
    deliveryMode: order?.deliveryMode,
    customerName: order?.drops[0]?.address?.fullName || "N/A",
    completedOn: new Date(),
    grandTotal: order?.detailAddedByAgent?.agentEarning || 0,
  });

  console.log("👉 Agent appDetail after push:", agent.appDetail);

  const currentDay = moment.tz(new Date(), "Asia/Kolkata");
  const startOfDay = currentDay.startOf("day").toDate();
  const endOfDay = currentDay.endOf("day").toDate();

  const agentTasks = await Task.find({
    taskStatus: "Assigned",
    agentId: agent._id,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  }).sort({ createdAt: 1 });

  agent.status = agentTasks.length > 0 ? "Busy" : "Free";

  console.log("👉 Agent status set to:", agent.status);

  // mark nested changes
  agent.markModified("appDetail");
};

const updateAgentDetailsForBatch = async (agent, batchOrders) => {
  console.log("👉 Entering updateAgentDetailsForBatch...");

  // calculate salary & surge for all orders
  const { calculatedSalary, calculatedSurge } =
    await calculateBatchAgentEarnings(agent, batchOrders);

  // Increase order count
  agent.appDetail.orders += 1;

  // Update earnings & surge
  agent.appDetail.totalEarning += calculatedSalary;
  agent.appDetail.totalSurge += calculatedSurge;

  let totalDistance = 0;
  let totalStartToPickDistance = 0;

  for (const order of batchOrders) {
    totalDistance += parseFloat(
      order.detailAddedByAgent?.distanceCoveredByAgent?.toFixed(2) || 0
    );
    totalStartToPickDistance += parseFloat(
      order.detailAddedByAgent?.startToPickDistance?.toFixed(2) || 0
    );

    // Push order detail for history
    agent.appDetail.orderDetail.push({
      orderId: order._id,
      deliveryMode: order.deliveryMode,
      customerName: order.drops[0]?.address?.fullName || "N/A",
      completedOn: new Date(),
      grandTotal: order.detailAddedByAgent?.agentEarning || 0,
    });
  }

  // Save total distances
  agent.appDetail.totalDistance += totalDistance;
  agent.appDetail.totalStartToPickDistance += totalStartToPickDistance;

  console.log("👉 Agent appDetail after batch update:", agent.appDetail);

  // Check agent status
  const currentDay = moment.tz(new Date(), "Asia/Kolkata");
  const startOfDay = currentDay.startOf("day").toDate();
  const endOfDay = currentDay.endOf("day").toDate();

  const agentTasks = await Task.find({
    taskStatus: "Assigned",
    agentId: agent._id,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  }).sort({ createdAt: 1 });

  agent.status = agentTasks.length > 0 ? "Busy" : "Free";

  console.log("👉 Agent status set to:", agent.status);

  agent.markModified("appDetail");
  await agent.save();
};

const calculateBatchAgentEarnings = async (agent, batchOrders) => {
  let totalSalary = 0;
  let totalSurge = 0;

  for (const order of batchOrders) {
    const { calculatedSalary, calculatedSurge } = await calculateAgentEarnings(
      agent,
      order
    );

    totalSalary += calculatedSalary;
    totalSurge += calculatedSurge;
  }

  return {
    calculatedSalary: Number(totalSalary.toFixed(2)),
    calculatedSurge: Number(totalSurge.toFixed(2)),
  };
};

const updateNotificationStatus = async (orderId) => {
  console.log("Updating notification status for orderId:", orderId);
  try {
    const notificationFound = await AgentNotificationLogs.findOne({
      orderId,
      status: "Accepted",
    });

    console.log("notification Found", notificationFound);

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

const updateBillOfCustomOrderInDelivery = async (
  order,
  task,
  socket
) => {
  try {
    // =========================
    // VALIDATIONS
    // =========================

    if (!order) {
      return socket.emit("error", {
        message: "Order not found",
        success: false,
      });
    }

    if (!task) {
      return socket.emit("error", {
        message: "Task not found",
        success: false,
      });
    }

    // =========================
    // TASK TIMES
    // =========================

    const reachedPickupAt =
      task?.pickupDetail?.completedTime;

    const deliveryStartAt =
      task?.deliveryDetail?.startTime;

    const pickupStartAt =
      task?.pickupDetail?.startTime;

    if (
      !reachedPickupAt ||
      !deliveryStartAt ||
      !pickupStartAt
    ) {
      return socket.emit("error", {
        message: "Required task timestamps are missing",
        success: false,
      });
    }

    // =========================
    // CUSTOMER PRICING
    // =========================

    const geofenceId =
      order?.customerId?.customerDetails?.geofenceId;

    const customerPricing =
      await CustomerPricing.findOne({
        deliveryMode: "Custom Order",
        geofenceId,
        status: true,
      });

    if (!customerPricing) {
      return socket.emit("error", {
        message:
          "Customer pricing for custom order not found",
        success: false,
      });
    }

    // =========================
    // NORMALIZE PRICING VALUES
    // =========================

    const baseFare = Number(
      customerPricing?.baseFare || 0
    );

    const baseDistance = Number(
      customerPricing?.baseDistance || 0
    );

    const fareAfterBaseDistance = Number(
      customerPricing?.fareAfterBaseDistance || 0
    );

    const waitingFare = Number(
      customerPricing?.waitingFare || 0
    );

    const waitingTime = Number(
      customerPricing?.waitingTime || 0
    );

    const purchaseFarePerHour = Number(
      customerPricing?.purchaseFarePerHour || 0
    );

    // =========================
    // DISTANCE
    // =========================

    const totalDistance = Number(order?.distance || 0);

    // =========================
    // DELIVERY CHARGE
    // =========================

    const calculatedDeliveryCharge =
      calculateDeliveryCharges(
        totalDistance,
        baseFare,
        baseDistance,
        fareAfterBaseDistance
      );

    // =========================
    // WAITING CHARGE
    // =========================

    let calculatedWaitingFare = 0;

    const waitingMinutes = Math.max(
      0,
      Math.floor(
        (new Date(deliveryStartAt) -
          new Date(reachedPickupAt)) /
          60000
      )
    );

    if (waitingMinutes > waitingTime) {
      const extraMinutes =
        waitingMinutes - waitingTime;

      calculatedWaitingFare = parseFloat(
        (extraMinutes * waitingFare).toFixed(2)
      );
    }

    // =========================
    // PURCHASE CHARGE
    // =========================

    let calculatedPurchaseFare = 0;

    const totalTaskDurationMs =
      new Date() - new Date(pickupStartAt);

    // Charge hourly
    const totalHours =
      totalTaskDurationMs / 3600000;

    if (totalHours > 0) {
      calculatedPurchaseFare = parseFloat(
        (
          totalHours * purchaseFarePerHour
        ).toFixed(2)
      );
    }

    // =========================
    // TOTAL ADDITIONAL CHARGES
    // =========================

    const additionalCharges =
      calculatedDeliveryCharge +
      calculatedWaitingFare +
      calculatedPurchaseFare;

    // =========================
    // INITIAL BILL VALUES
    // =========================

    const itemTotal = Number(
      order?.billDetail?.itemTotal || 0
    );

    const tax = Number(
      order?.billDetail?.tax || 0
    );

    const discount = Number(
      order?.billDetail?.discount || 0
    );

    // =========================
    // UPDATE BILL DETAILS
    // =========================

    order.billDetail = order.billDetail || {};

    order.billDetail.deliveryCharge =
      parseFloat(
        calculatedDeliveryCharge.toFixed(2)
      );

    order.billDetail.waitingCharges =
      parseFloat(
        calculatedWaitingFare.toFixed(2)
      );

    order.billDetail.purchaseCharges =
      parseFloat(
        calculatedPurchaseFare.toFixed(2)
      );

    order.billDetail.additionalCharges =
      parseFloat(
        additionalCharges.toFixed(2)
      );

    // =========================
    // RECALCULATE TOTALS
    // =========================

    order.billDetail.subTotal = parseFloat(
      (
        itemTotal + additionalCharges
      ).toFixed(2)
    );

    order.billDetail.grandTotal =
      parseFloat(
        (
          order.billDetail.subTotal +
          tax -
          discount
        ).toFixed(2)
      );

    // =========================
    // OPTIONAL DEBUG INFO
    // =========================

    order.billDetail.calculationBreakdown = {
      distance: totalDistance,
      waitingMinutes,
      purchaseHours: parseFloat(
        totalHours.toFixed(2)
      ),
      updatedAt: new Date(),
    };

    // =========================
    // SAVE ORDER
    // =========================

    await order.save();

    return {
      success: true,
      deliveryCharge:
        order.billDetail.deliveryCharge,
      waitingCharges:
        order.billDetail.waitingCharges,
      purchaseCharges:
        order.billDetail.purchaseCharges,
      grandTotal:
        order.billDetail.grandTotal,
    };
  } catch (err) {
    console.error(
      "[updateBillOfCustomOrderInDelivery]",
      err
    );

    return socket.emit("error", {
      message: `Error updating custom order bill: ${
        err?.message || err
      }`,
      success: false,
    });
  }
};

// const updateBillOfCustomOrderInDelivery = async (order, task, socket) => {
//   try {
//     const reachedPickupAt = task?.pickupDetail?.completedTime;
//     const deliveryStartAt = task?.deliveryDetail?.startTime;
//     const pickupStartAt = task?.pickupDetail?.startTime;
//     const now = new Date();

//     let calculatedWaitingFare = 0;
//     let totalDistance = order?.distance;

//     const customerPricing = await CustomerPricing.findOne({
//       deliveryMode: "Custom Order",
//       geofenceId: order?.customerId?.customerDetails?.geofenceId,
//       status: true,
//     });

//     if (!customerPricing) {
//       return socket.emit("error", {
//         message: `Customer pricing for custom order not found`,
//         success: false,
//       });
//     }

//     const {
//       baseFare,
//       baseDistance,
//       fareAfterBaseDistance,
//       waitingFare,
//       waitingTime,
//     } = customerPricing;

//     const deliveryCharge = calculateDeliveryCharges(
//       totalDistance,
//       baseFare,
//       baseDistance,
//       fareAfterBaseDistance
//     );

//     const minutesWaitedAtPickup = Math.floor(
//       (new Date(deliveryStartAt) - new Date(reachedPickupAt)) / 60000
//     );

//     if (minutesWaitedAtPickup > waitingTime) {
//       const additionalMinutes = Math.round(minutesWaitedAtPickup - waitingTime);
//       calculatedWaitingFare = parseFloat(waitingFare * additionalMinutes);
//     }

//     const totalTaskTime = new Date(now) - new Date(pickupStartAt);

//     // Convert the difference to minutes
//     const diffInHours = Math.ceil(totalTaskTime / 3600000);

//     let calculatedPurchaseFare = 0;

//     if (diffInHours > 0) {
//       calculatedPurchaseFare = parseFloat(
//         (diffInHours * customerPricing.purchaseFarePerHour).toFixed(2)
//       );
//     }

//     const calculatedDeliveryFare =
//       deliveryCharge + calculatedPurchaseFare + calculatedWaitingFare;

//     order.billDetail.waitingCharges = calculatedDeliveryFare;
//     order.billDetail.deliveryCharge = calculatedDeliveryFare;
//     order.billDetail.grandTotal += calculatedDeliveryFare;
//     order.billDetail.subTotal += calculatedDeliveryFare;

//     await order.save();
//   } catch (err) {
//     return socket.emit("error", {
//       message: `Error in updating bill ${err}`,
//       success: false,
//     });
//   }
// };

module.exports = {
  formatToHours,
  moveAppDetailToWorkHistoryAndResetForAllAgents,
  updateLoyaltyPoints,
  processReferralRewards,
  calculateAgentEarnings,
  updateOrderDetails,
  updateAgentDetails,
  updateAgentDetailsForBatch,
  calculateBatchAgentEarnings,
  updateNotificationStatus,
  updateCustomerSubscriptionCount,
  updateBillOfCustomOrderInDelivery,
};
