const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const puppeteer = require("puppeteer");
const moment = require("moment-timezone");
const csvWriter = require("csv-writer").createObjectCsvWriter;
const { validationResult } = require("express-validator");

const Customer = require("../../../models/Customer");
const Merchant = require("../../../models/Merchant");
const Order = require("../../../models/Order");
const ScheduledOrder = require("../../../models/ScheduledOrder");
const CustomerCart = require("../../../models/CustomerCart");
const PickAndCustomCart = require("../../../models/PickAndCustomCart");
const scheduledPickAndCustom = require("../../../models/ScheduledPickAndCustom");
const AgentAnnouncementLogs = require("../../../models/AgentAnnouncementLog");
const ActivityLog = require("../../../models/ActivityLog");
const Agent = require("../../../models/Agent");
const Manager = require("../../../models/Manager");
const ManagerRoles = require("../../../models/ManagerRoles");
const CustomerTransaction = require("../../../models/CustomerTransactionDetail");
const Task = require("../../../models/Task");
const AgentPricing = require("../../../models/AgentPricing");
const AgentSurge = require("../../../models/AgentSurge");
const AgentNotificationLogs = require("../../../models/AgentNotificationLog");

const appError = require("../../../utils/appError");
const { formatTime, formatDate } = require("../../../utils/formatters");
const {
  orderCommissionLogHelper,
  calculateMerchantAndFamtoEarnings,
} = require("../../../utils/orderCommissionLogHelper");
const {
  orderCreateTaskHelper,
} = require("../../../utils/orderCreateTaskHelper");
const { razorpayRefund } = require("../../../utils/razorpayPayment");
const {
  reduceProductAvailableQuantity,
} = require("../../../utils/customerAppHelpers");
const {
  findOrCreateCustomer,
  formattedCartItems,
  fetchMerchantDetails,
  validateCustomerAddress,
  processScheduledDelivery,
  handleDeliveryModeForAdmin,
  calculateDeliveryChargeHelperForAdmin,
  applyDiscounts,
  calculateBill,
  saveCustomerCart,
  getCartByDeliveryMode,
  calculateDeliveryTime,
  prepareOrderDetails,
  clearCart,
  updateCustomerTransaction,
} = require("../../../utils/createOrderHelpers");
const { formatToHours } = require("../../../utils/agentAppHelpers");
const {
  sendSocketDataAndNotification,
} = require("../../../utils/socketHelper");

const {
  sendNotification,
  findRolesToNotify,
  sendSocketData,
} = require("../../../socket/socket");

const fetchAllOrdersByAdminController = async (req, res, next) => {
  try {
    let {
      page = 1,
      limit = 50,
      status,
      paymentMode,
      deliveryMode,
      merchantId,
      startDate,
      endDate,
      orderId,
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    const skip = (page - 1) * limit;

    const filterCriteria = {};

    if (status && status?.trim()?.toLowerCase() !== "all") {
      filterCriteria.status = { $regex: status.trim(), $options: "i" };
    }

    if (paymentMode && paymentMode?.trim()?.toLowerCase() !== "all") {
      filterCriteria.paymentMode = {
        $regex: paymentMode.trim(),
        $options: "i",
      };
    }

    if (deliveryMode && deliveryMode?.trim()?.toLowerCase() !== "all") {
      filterCriteria["orderDetail.deliveryMode"] = {
        $regex: deliveryMode.trim(),
        $options: "i",
      };
    }

    if (merchantId && merchantId?.trim()?.toLowerCase() !== "all") {
      filterCriteria.merchantId = merchantId;
    }

    if (orderId && orderId !== "") {
      filterCriteria._id = { $regex: orderId.trim(), $options: "i" };
    }

    if (startDate && endDate) {
      const start = moment.tz(startDate, "Asia/Kolkata");
      const end = moment.tz(endDate, "Asia/Kolkata");

      startDate = start.startOf("day").toDate();
      endDate = end.endOf("day").toDate();

      filterCriteria.createdAt = { $gte: startDate, $lte: endDate };
    }

    const [orders, totalCount] = await Promise.all([
      await Order.find(filterCriteria)
        .populate({
          path: "merchantId",
          select: "merchantDetail.merchantName merchantDetail.deliveryTime",
        })
        .populate({ path: "customerId", select: "fullName" })
        .populate({ path: "agentId", select: "fullName" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filterCriteria),
    ]);

    const formattedOrders = orders?.map((order) => {
      return {
        orderId: order._id,
        orderStatus: order?.status,
        merchantName: order?.merchantId?.merchantDetail?.merchantName || "-",
        customerName:
          order?.customerId?.fullName ||
          order?.orderDetail?.deliveryAddress?.fullName ||
          null,
        assignedAgent: order?.agentId?.fullName || "Unassigned",
        deliveryMode: order?.orderDetail?.deliveryMode || null,
        orderDate: formatDate(order?.createdAt) || null,
        orderTime: formatTime(order?.createdAt) || null,
        deliveryDate: order?.orderDetail?.deliveryTime
          ? formatDate(order.orderDetail.deliveryTime)
          : "-",
        deliveryTime: order?.orderDetail?.deliveryTime
          ? formatTime(order.orderDetail.deliveryTime)
          : "-",
        paymentMethod:
          order?.paymentMode === "Cash-on-delivery"
            ? "Pay-on-delivery"
            : order?.paymentMode,
        deliveryOption: order?.orderDetail?.deliveryOption || null,
        amount: order.billDetail.grandTotal,
        isReady: order?.orderDetail?.isReady,
      };
    });

    res.status(200).json({
      totalCount,
      data: formattedOrders,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const fetchAllScheduledOrdersByAdminController = async (req, res, next) => {
  try {
    let {
      page = 1,
      limit = 50,
      status,
      paymentMode,
      deliveryMode,
      merchantId,
      startDate,
      endDate,
      orderId,
    } = req.query;

    // Convert to integers
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    // Calculate the number of documents to skip
    const skip = (page - 1) * limit;

    // Building filter criteria
    const filterCriteria = {};

    if (status && status.trim().toLowerCase() !== "all") {
      filterCriteria.status = { $regex: status.trim(), $options: "i" };
    }

    if (paymentMode && paymentMode.trim().toLowerCase() !== "all") {
      filterCriteria.paymentMode = {
        $regex: paymentMode.trim(),
        $options: "i",
      };
    }

    if (deliveryMode && deliveryMode.trim().toLowerCase() !== "all") {
      filterCriteria["orderDetail.deliveryMode"] = {
        $regex: deliveryMode.trim(),
        $options: "i",
      };
    }

    if (merchantId && merchantId.trim().toLowerCase() !== "all") {
      filterCriteria.merchantId = merchantId;
    }

    if (orderId && orderId !== "") {
      filterCriteria._id = { $regex: orderId.trim(), $options: "i" };
    }

    if (startDate && endDate) {
      startDate = new Date(startDate);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(endDate);
      endDate.setHours(23, 59, 59, 999);

      filterCriteria.createdAt = { $gte: startDate, $lte: endDate };
    }

    // Aggregation pipeline to merge and filter both collections
    const results = await ScheduledOrder.aggregate([
      {
        $match: filterCriteria,
      },
      {
        $unionWith: {
          coll: "scheduledpickandcustoms", // Name of the second collection
          pipeline: [{ $match: filterCriteria }],
        },
      },
      // Populate merchantId if available
      {
        $lookup: {
          from: "merchants", // Collection name for merchants
          localField: "merchantId",
          foreignField: "_id",
          as: "merchantData",
        },
      },
      {
        $unwind: {
          path: "$merchantData",
          preserveNullAndEmptyArrays: true, // Keep documents without a merchantId
        },
      },
      // Populate customerId
      {
        $lookup: {
          from: "customers", // Collection name for customers
          localField: "customerId",
          foreignField: "_id",
          as: "customerData",
        },
      },
      {
        $unwind: {
          path: "$customerData",
          preserveNullAndEmptyArrays: true, // Keep documents without a customerId
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $skip: skip,
      },
      {
        $limit: limit,
      },
    ]);

    const totalCount = await ScheduledOrder.countDocuments(filterCriteria);
    // Formatting the results
    const formattedOrders = results.map((order) => {
      return {
        orderId: order?._id,
        orderStatus: order?.status,
        merchantName: order?.merchantData?.merchantDetail?.merchantName || "-",
        customerName:
          order?.customerId?.fullName ||
          order?.orderDetail?.deliveryAddress?.fullName,
        deliveryMode: order?.orderDetail?.deliveryMode,
        orderDate: formatDate(order?.createdAt),
        orderTime: formatTime(order?.createdAt),
        deliveryDate: order?.time ? formatDate(order?.time) : "-",
        deliveryTime: order?.time ? formatTime(order?.time) : "-",
        paymentMethod:
          order.paymentMode === "Cash-on-delivery"
            ? "Pay-on-delivery"
            : order.paymentMode,
        deliveryOption: order.orderDetail.deliveryOption,
        amount: order.billDetail.grandTotal,
      };
    });

    res.status(200).json({
      totalCount,
      data: formattedOrders,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const confirmOrderByAdminController = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    let orderFound = await Order.findById(orderId).populate(
      "merchantId",
      "merchantDetail"
    );

    if (!orderFound) return next(appError("Order not found", 404));

    const stepperData = {
      by: "Admin",
      userId: process.env.ADMIN_ID,
      date: new Date(),
    };

    orderFound.status = "On-going";
    orderFound.orderDetailStepper.accepted = stepperData;

    const modelType =
      orderFound?.merchantId?.merchantDetail?.pricing[0]?.modelType;

    if (orderFound?.merchantId && modelType === "Commission") {
      console.log("Here");
      const { payableAmountToFamto, payableAmountToMerchant } =
        await orderCommissionLogHelper(orderFound);
      console.log("Here 2");

      let updatedCommission = {
        merchantEarnings: payableAmountToMerchant,
        famtoEarnings: payableAmountToFamto,
      };
      orderFound.commissionDetail = updatedCommission;
    }

    if (orderFound?.merchantId && modelType !== "Commission") {
      const { famtoEarnings, merchantEarnings } =
        await calculateMerchantAndFamtoEarnings(orderFound);

      orderFound.commissionDetail = { famtoEarnings, merchantEarnings };
    }

    if (orderFound?.orderDetail?.deliveryMode !== "Take Away") {
      const task = await orderCreateTaskHelper(orderId);

      if (!task) return next(appError("Task not created"));
    }

    if (orderFound?.purchasedItems && orderFound.merchantId) {
      await reduceProductAvailableQuantity(
        orderFound.purchasedItems,
        orderFound.merchantId
      );
    }

    await Promise.all([
      orderFound.save(),
      ActivityLog.create({
        userId: req.userAuth,
        userType: req.userRole,
        description: `Order (#${orderId}) is confirmed by ${req.userRole} (${req.userName} - ${req.userAuth})`,
      }),
    ]);

    const eventName = "orderAccepted";

    const { rolesToNotify, data } = await findRolesToNotify(eventName);

    const notificationData = {
      fcm: {
        orderId,
        customerId: orderFound.customerId,
        merchantId: orderFound?.merchantId?._id,
      },
    };

    const socketData = {
      ...data,

      orderId: orderFound._id,
      orderDetail: orderFound.orderDetail,
      billDetail: orderFound.billDetail,
      orderDetailStepper: orderFound.orderDetailStepper.accepted,
    };

    const userIds = {
      admin: process.env.ADMIN_ID,
      merchant: orderFound?.merchantId?._id,
      agent: orderFound?.agentId,
      customer: orderFound?.customerId,
    };

    await sendSocketDataAndNotification({
      rolesToNotify,
      eventName,
      userIds,
      notificationData,
      socketData,
    });

    res.status(200).json({
      message: `Order with ID: ${orderFound._id} is confirmed`,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const rejectOrderByAdminController = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    let orderFound = await Order.findById(orderId);

    if (!orderFound) {
      return next(appError("Order not found", 404));
    }

    const customerFound = await Customer.findById(orderFound.customerId);

    if (!customerFound) {
      return next(appError("Customer not found", 404));
    }

    let updatedTransactionDetail = {
      customerId: customerFound._id,
      transactionType: "Refund",
      madeOn: new Date(),
      type: "Credit",
      transactionAmount: null,
    };

    const stepperData = {
      by: "Admin",
      userId: process.env.ADMIN_ID,
      date: new Date(),
    };

    const updateOrderStatus = (order) => {
      order.status = "Cancelled";
      order.orderDetailStepper.cancelled = stepperData;
    };

    if (orderFound.paymentMode === "Famto-cash") {
      let orderAmount = orderFound.billDetail.grandTotal;

      if (orderFound.orderDetail.deliveryOption === "On-demand") {
        customerFound.customerDetails.walletBalance += orderAmount;
      } else if (orderFound.orderDetail.deliveryOption === "Scheduled") {
        orderAmount =
          orderFound.billDetail.grandTotal / orderFound.orderDetail.numOfDays;
        customerFound.customerDetails.walletBalance += orderAmount;
      }

      updatedTransactionDetail.transactionAmount = orderAmount;

      updateOrderStatus(orderFound);

      await Promise.all([
        customerFound.save(),
        orderFound.save(),
        CustomerTransaction.create(updatedTransactionDetail),
      ]);
    } else if (orderFound.paymentMode === "Cash-on-delivery") {
      updateOrderStatus(orderFound);

      await orderFound.save();
    } else if (orderFound.paymentMode === "Online-payment") {
      const paymentId = orderFound?.paymentId;

      let refundResponse;

      if (paymentId) {
        let refundAmount;
        if (orderFound.orderDetail.deliveryOption === "On-demand") {
          refundAmount = orderFound.billDetail.grandTotal;
        } else if (orderFound.orderDetail.deliveryOption === "Scheduled") {
          refundAmount =
            orderFound.billDetail.grandTotal / orderFound.orderDetail.numOfDays;
        }

        refundResponse = await razorpayRefund(paymentId, refundAmount);

        if (!refundResponse.success) {
          return next(appError("Refund failed: " + refundResponse.error, 500));
        }

        updatedTransactionDetail.transactionAmount = refundAmount;

        orderFound.refundId = refundResponse?.refundId;

        if (updatedTransactionDetail.$transactionAmount) {
          await CustomerTransaction.create(updatedTransactionDetail);
        }

        await Promise.all([customerFound.save()]);
      }

      updateOrderStatus(orderFound);

      await orderFound.save();
    }

    await ActivityLog.create({
      userId: req.userAuth,
      userType: req.userRole,
      description: `Order (#${orderId}) is rejected by ${req.userRole} (${req.userName} - ${req.userAuth})`,
    });

    const eventName = "orderRejected";

    const { rolesToNotify, data } = await findRolesToNotify(eventName);

    const socketData = {
      ...data,

      orderId: orderFound._id,
      orderDetail: orderFound.orderDetail,
      billDetail: orderFound.billDetail,
      orderDetailStepper: orderFound.orderDetailStepper.cancelled,
    };

    const notificationData = {
      fcm: {
        orderId,
        customerId: orderFound.customerId,
        merchantId: orderFound?.merchantId,
      },
    };

    const userIds = {
      admin: process.env.ADMIN_ID,
      merchant: orderFound?.merchantId,
      agent: orderFound?.agentId,
      customer: orderFound?.customerId,
    };

    await sendSocketDataAndNotification({
      rolesToNotify,
      userIds,
      eventName,
      notificationData,
      socketData,
    });

    res.status(200).json({ message: "Order cancelled" });
  } catch (err) {
    next(appError(err.message));
  }
};

const getOrderDetailByAdminController = async (req, res, next) => {
  try {
    const currentMerchant = req.userAuth;

    if (!currentMerchant) {
      return next(appError("Merchant is not authenticated", 401));
    }

    const { orderId } = req.params;

    const orderFound = await Order.findById(orderId)
      .populate({
        path: "customerId",
        select: "fullName phoneNumber email",
      })
      .populate({
        path: "merchantId",
        select: "merchantDetail",
      })
      .populate({
        path: "agentId",
        select: "fullName workStructure agentImageURL location phoneNumber",
        populate: {
          path: "workStructure.managerId",
          select: "name",
        },
      })
      .exec();

    if (!orderFound) {
      return next(appError("Order not found", 404));
    }

    const formattedResponse = {
      _id: orderFound._id,
      scheduledOrderId: orderFound?.scheduledOrderId || null,
      orderStatus: orderFound.status || "-",
      paymentStatus: orderFound.paymentStatus || "-",
      paymentMode:
        orderFound.paymentMode === "Cash-on-delivery"
          ? "Pay-on-delivery"
          : orderFound.paymentMode || "-",
      paymentCollectedFromCustomer:
        orderFound.paymentCollectedFromCustomer !== undefined
          ? orderFound.paymentCollectedFromCustomer
          : null,

      vehicleType: orderFound?.billDetail?.vehicleType || "-",
      deliveryMode: orderFound.orderDetail.deliveryMode || "-",
      deliveryOption: orderFound.orderDetail.deliveryOption || "-",
      orderTime: `${formatDate(orderFound.createdAt)} | ${formatTime(
        orderFound.createdAt
      )}`,
      deliveryTime: `${formatDate(
        orderFound.orderDetail.deliveryTime
      )} | ${formatTime(orderFound.orderDetail.deliveryTime)}`,
      customerDetail: {
        _id: orderFound.customerId._id,
        name:
          orderFound.customerId.fullName ||
          orderFound.orderDetail.deliveryAddress.fullName ||
          "-",
        email: orderFound.customerId.email || "-",
        phone: orderFound.customerId.phoneNumber || "-",
        dropAddress: orderFound.orderDetail.deliveryAddress || "-",
        pickAddress: orderFound.orderDetail.pickupAddress || "-",
        ratingsToDeliveryAgent: {
          rating: orderFound?.orderRating?.ratingToDeliveryAgent?.rating || 0,
          review: orderFound.orderRating?.ratingToDeliveryAgent.review || "-",
        },
        ratingsByDeliveryAgent: {
          rating: orderFound?.orderRating?.ratingByDeliveryAgent?.rating || 0,
          review: orderFound?.orderRating?.ratingByDeliveryAgent?.review || "-",
        },
      },
      merchantDetail: {
        _id: orderFound?.merchantId?._id || "-",
        name: orderFound?.merchantId?.merchantDetail?.merchantName || "-",
        instructionsByCustomer:
          orderFound?.orderDetail?.instructionToMerchant || "-",
        merchantEarnings: orderFound?.commissionDetail?.merchantEarnings || "-",
        famtoEarnings: orderFound?.commissionDetail?.famtoEarnings || "-",
      },
      deliveryAgentDetail: {
        _id: orderFound?.agentId?._id || "-",
        name: orderFound?.agentId?.fullName || "-",
        phoneNumber: orderFound?.agentId?.phoneNumber || "-",
        orderEarning: orderFound?.detailAddedByAgent?.agentEarning || "0.00",
        team: orderFound?.agentId?.workStructure?.managerId?.name || "-",
        instructionsByCustomer:
          orderFound?.orderDetail?.instructionToDeliveryAgent || "-",
        distanceTravelled:
          orderFound?.detailAddedByAgent?.distanceCoveredByAgent || 0,
        timeTaken: formatToHours(orderFound?.orderDetail?.timeTaken) || "-",
        delayedBy: formatToHours(orderFound?.orderDetail?.delayedBy) || "-",
      },
      items: orderFound.items || null,
      billDetail: orderFound.billDetail || null,
      pickUpLocation: orderFound?.orderDetail?.pickupLocation || null,
      deliveryLocation: orderFound?.orderDetail?.deliveryLocation || null,
      agentLocation: orderFound?.agentId?.location || null,
      orderDetailStepper: Array.isArray(orderFound?.orderDetailStepper)
        ? orderFound.orderDetailStepper
        : [orderFound.orderDetailStepper],
    };

    res.status(200).json({
      message: "Single order detail",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const downloadOrdersCSVByAdminController = async (req, res, next) => {
  try {
    let {
      status,
      paymentMode,
      deliveryMode,
      merchantId,
      startDate,
      endDate,
      orderId,
    } = req.query;

    // Build query object based on filters
    let filter = {};
    if (status && status !== "All") filter.status = status;
    if (paymentMode && paymentMode !== "All") filter.paymentMode = paymentMode;
    if (deliveryMode && deliveryMode !== "All")
      filter["orderDetail.deliveryMode"] = deliveryMode;
    if (orderId) {
      filter.$or = [{ _id: { $regex: orderId, $options: "i" } }];
    }
    if (merchantId && merchantId.trim().toLowerCase() !== "all") {
      filter.merchantId = merchantId;
    }

    if (startDate && endDate) {
      const start = moment.tz(startDate, "Asia/Kolkata");
      const end = moment.tz(endDate, "Asia/Kolkata");

      startDate = start.startOf("day").toDate();
      endDate = end.endOf("day").toDate();

      filter.createdAt = { $gte: startDate, $lte: endDate };
    }

    // Fetch the data based on filter
    let allOrders = await Order.find(filter)
      .populate("merchantId", "merchantDetail.merchantName")
      .populate("customerId", "fullName")
      .populate("agentId", "fullName phoneNumber")
      .sort({ createdAt: -1 })
      .exec();

    let formattedResponse = [];

    allOrders?.forEach((order) => {
      order.items.forEach((item) => {
        formattedResponse.push({
          orderId: order._id,
          status: order?.status || "-",
          merchantId: order?.merchantId?._id || "-",
          merchantName: order?.merchantId?.merchantDetail?.merchantName || "-",
          customerName: order?.customerId?.fullName || "-",
          customerPhoneNumber:
            order?.orderDetail?.deliveryAddress?.phoneNumber || "-",
          customerEmail: order?.customerId?.email || "-",
          agentName: order?.agentId?.fullName || "-",
          agentPhoneNumber: order?.agentId?.phoneNumber || "-",
          deliveryMode: order?.orderDetail?.deliveryMode || "-",
          orderTime:
            `${formatDate(order?.createdAt)} | ${formatTime(
              order?.createdAt
            )}` || "-",
          deliveryTime:
            `${formatDate(order?.orderDetail?.deliveryTime)} | ${formatTime(
              order?.orderDetail?.deliveryTime
            )}` || "-",
          paymentMode: order?.paymentMode || "-",
          deliveryOption: order?.orderDetail?.deliveryOption || "-",
          totalAmount: order?.billDetail?.grandTotal || "-",
          deliveryAddress:
            `${order?.orderDetail?.deliveryAddress?.fullName}, ${order?.orderDetail?.deliveryAddress?.flat}, ${order?.orderDetail?.deliveryAddress?.area}, ${order?.orderDetail?.deliveryAddress?.landmark}` ||
            "-",
          distanceInKM: order?.orderDetail?.distance || "-",
          distanceTravelledByAgent:
            order?.detailAddedByAgent?.distanceCoveredByAgent || "-",
          agentEarning: order?.detailAddedByAgent?.agentEarning || 0,
          cancellationReason: order?.cancellationReason || "-",
          cancellationDescription: order?.cancellationDescription || "-",
          merchantEarnings: order?.merchantEarnings || "-",
          famtoEarnings: order?.famtoEarnings || "-",
          deliveryCharge: order?.billDetail?.deliveryCharge || "-",
          taxAmount: order?.billDetail?.taxAmount || "-",
          discountedAmount: order?.billDetail?.discountedAmount || "-",
          itemTotal: order?.billDetail?.itemTotal || "-",
          addedTip: order?.billDetail?.addedTip || "-",
          subTotal: order?.billDetail?.subTotal || "-",
          surgePrice: order?.billDetail?.surgePrice || "-",
          transactionId: order?.paymentId || "-",
          itemName: item?.itemName || "-",
          quantity: item?.quantity || "-",
          length: item?.length || "-",
          width: item?.width || "-",
          height: item?.height || "-",
        });
      });
    });

    let filePath = path.join(__dirname, "../../../Order_CSV.csv");

    const csvHeaders = [
      { id: "orderId", title: "Order ID" },
      { id: "status", title: "Status" },
      { id: "merchantId", title: "Merchant ID" },
      { id: "merchantName", title: "Merchant Name" },
      { id: "customerName", title: "Customer Name" },
      { id: "customerPhoneNumber", title: "Customer Phone Number" },
      { id: "customerEmail", title: "Customer Email" },
      { id: "agentName", title: "Agent Name" },
      { id: "agentPhoneNumber", title: "Agent Phone Number" },
      { id: "deliveryMode", title: "Delivery Mode" },
      { id: "orderTime", title: "Order Time" },
      { id: "deliveryTime", title: "Delivery Time" },
      { id: "paymentMode", title: "Payment Mode" },
      { id: "deliveryOption", title: "Delivery Option" },
      { id: "totalAmount", title: "Total Amount" },
      { id: "deliveryAddress", title: "Delivery Address" },
      { id: "distanceInKM", title: "Distance (KM)" },
      {
        id: "distanceTravelledByAgent",
        title: "Distance Travelled by Agent (KM)",
      },
      {
        id: "agentEarning",
        title: "Agent Earning",
      },
      { id: "cancellationReason", title: "Cancellation Reason" },
      { id: "cancellationDescription", title: "Cancellation Description" },
      { id: "merchantEarnings", title: "Merchant Earnings" },
      { id: "famtoEarnings", title: "Famto Earnings" },
      { id: "deliveryCharge", title: "Delivery Charge" },
      { id: "taxAmount", title: "Tax Amount" },
      { id: "discountedAmount", title: "Discounted Amount" },
      { id: "itemTotal", title: "Item Total" },
      { id: "addedTip", title: "Added Tip" },
      { id: "subTotal", title: "Sub Total" },
      { id: "surgePrice", title: "Surge Price" },
      { id: "transactionId", title: "Transaction ID" },
      { id: "itemName", title: "Item name" },
      { id: "quantity", title: "Quantity" },
      { id: "length", title: "Length" },
      { id: "width", title: "Width" },
      { id: "height", title: "height" },
    ];

    let writer = csvWriter({
      path: filePath,
      header: csvHeaders,
    });

    await writer.writeRecords(formattedResponse);

    res.status(200).download(filePath, "Order_Data.csv", (err) => {
      if (err) {
        next(err);
      } else {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("File deletion error:", unlinkErr);
          }
        });
      }
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const downloadInvoiceBillController = async (req, res, next) => {
  try {
    const { cartId, deliveryMode } = req.body;

    const isStandardDelivery = ["Take Away", "Home Delivery"].includes(
      deliveryMode
    );
    const isCustomDelivery = ["Pick and Drop", "Custom Order"].includes(
      deliveryMode
    );

    if (!isStandardDelivery && !isCustomDelivery) {
      return next(appError("Invalid delivery mode specified"));
    }

    const cartFound = isStandardDelivery
      ? await CustomerCart.findById(cartId)
          .populate("merchantId", "merchantDetail.merchantName")
          .populate("customerId", "fullName phoneNumber")
      : await PickAndCustomCart.findById(cartId).populate(
          "customerId",
          "fullName phoneNumber"
        );

    if (!cartFound || !cartFound.billDetail) {
      return next(appError("Cart not found or no bill details available"));
    }

    let formattedItems;
    if (isStandardDelivery) {
      const populatedCartWithVariantNames = await formattedCartItems(cartFound);
      formattedItems = populatedCartWithVariantNames.items.map((item) => ({
        itemName: item.productId.productName,
        quantity: item.quantity,
        price: item.price,
        variantTypeName: item.variantTypeId?.variantTypeName || "",
      }));
    } else if (isCustomDelivery) {
      formattedItems = cartFound.items.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        price: 0,
        variantTypeName: "",
      }));
    }

    const { billDetail } = cartFound;
    const [
      deliveryCharge,
      taxAmount,
      discountedAmount,
      grandTotal,
      itemTotal,
      addedTip,
      subTotal,
      surgePrice,
    ] = [
      billDetail.discountedDeliveryCharge ||
        billDetail.originalDeliveryCharge ||
        0,
      billDetail.taxAmount || 0,
      billDetail.discountedAmount || 0,
      billDetail.discountedGrandTotal || billDetail.originalGrandTotal || 0,
      billDetail.itemTotal || 0,
      billDetail.addedTip || 0,
      billDetail.subTotal || 0,
      billDetail.surgePrice || 0,
    ].map((value) => Number(value));

    if (
      [
        deliveryCharge,
        taxAmount,
        discountedAmount,
        grandTotal,
        itemTotal,
        addedTip,
        subTotal,
        surgePrice,
      ].some(isNaN)
    ) {
      return next(
        appError("One or more bill details contain invalid numbers.")
      );
    }

    const htmlContent = `<!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 0;
            }

            .container {
                position: relative;
                min-height: 100vh;
                padding-bottom: 100px;
                margin: 0 auto;
                width: 90%;
            }

            header {
                display: flex;
                justify-content: space-between;
                margin-bottom: 20px;
            }

            .logo {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .logo img {
                height: 50px;
                width: 50px;
                object-fit: contain;
            }

            .header-info h3,
            .header-info h5 {
                margin: 0;
            }

            .date p {
                font-size: 16px;
            }

            .invoice-title {
                text-align: center;
                font-size: 22px;
                font-weight: 600;
                margin: 10px 0;
            }

            .info-section {
                display: flex;
                justify-content: space-between;
                margin-bottom: 20px;
            }

            .info-box {
                background-color: white;
                padding: 20px;
                width: 370px;
            }

            .info-box div {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
            }

            .info-box label {
                font-size: 14px;
                color: gray;
                width: 50%;
            }

            .info-box p {
                font-size: 14px;
                font-weight: 500;
                width: 50%;
                text-align: left;
            }

            table {
                width: 100%;
                border-collapse: collapse;
            }

            table,
            th,
            td {
                border: 1px solid gray;
            }

            th,
            td {
                padding: 10px;
                text-align: left;
            }

            thead {
                background-color: #f1f1f1;
            }

            .total-row {
                font-weight: 600;
            }

            .thank-you {
                text-align: center;
                margin: 15px 0;
            }

            .footer {
                text-align: center;
                position: absolute;
                bottom: 15px;
                width: 100%;
            }
        </style>
    </head>

    <body>

        <div class="container">
            <!-- Header Section -->
            <header>
                <div class="logo">
                    <img src="https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/admin_panel_assets%2FGroup.svg?alt=media&token=9629e049-c607-4f98-9fee-1cd435b5754f" alt="Logo">
                    <div class="header-info">
                        <h3>My Famto</h3>
                        <h5>Private Limited</h5>
                    </div>
                </div>
                <div class="date">
                    <p>Date: <span style="color:gray;">${formatDate(
                      new Date()
                    )}</span></p>
                </div>
            </header>

            <!-- Invoice Title -->
            <div class="invoice-title">
                <p>Invoice - ${cartFound?._id}</p>
            </div>

            <!-- Merchant and Order Information -->
            <div class="info-section">
                <!-- Merchant Info -->
                <div class="info-box">
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Merchant Name</p>
                        <p>${
                          cartFound?.merchantId?.merchantDetail?.merchantName ||
                          " "
                        }</p>
                    </div>
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Phone Number</p>
                        <p>${cartFound?.merchantId?.phoneNumber || " "}</p>
                    </div>
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Address</p>
                        <p>${
                          cartFound?.merchantId?.merchantDetail
                            ?.displayAddress || " "
                        }</p>
                    </div>
                </div>

                <!-- Order Info -->
                <div class="info-box">
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Order ID</p>
                        <p>${cartFound?._id}</p>
                    </div>
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Order Date</p>
                        <p>${formatDate(cartFound?.createdAt)} at ${formatTime(
      cartFound.createdAt
    )}</p>
                    </div>
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Delivery Mode</p>
                        <p>${cartFound?.cartDetail?.deliveryMode}</p>
                    </div>
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Delivery Option</p>
                        <p>${cartFound?.cartDetail?.deliveryOption}</p>
                    </div>
                </div>
            </div>

            <!-- Invoice Table -->
            <table>
                 <thead> 
      ${
        cartFound?.orderDetail?.deliveryMode === "Pick and Drop" ||
        cartFound?.orderDetail?.deliveryMode === "Custom Order"
          ? `<th colspan="3">Item</th><th>Price</th>`
          : `<th>Item</th><th>Rate</th><th>Quantity</th><th>Price</th>`
      }  
            </thead> 
                <tbody>
                     ${
                       cartFound?.orderDetail?.deliveryMode ===
                         "Pick and Drop" ||
                       cartFound?.orderDetail?.deliveryMode === "Custom Order"
                         ? ``
                         : `  ${(formattedItems || [])?.map((item) => {
                             let price = item?.quantity * item?.price;
                             return `
                      <tr>
                        <td>${item?.itemName} ${
                               item?.variantTypeName
                                 ? `(${item?.variantTypeName})`
                                 : ""
                             }</td>
                        <td>${item?.price || 0}</td>
                        <td>${item?.quantity || 0}</td>
                        <td>${price?.toFixed(2) || 0}</td>
                    </tr>
                      `;
                           })}
                    <!-- Item Total -->
                    <tr>
                        <td colspan="3">Item Total</td>
                        <td>${itemTotal?.toFixed(2) || 0}</td>
                    </tr>`
                     }   
                 <tr>
                        <td colspan="3">Delivery charge</td>
                        <td>${deliveryCharge?.toFixed(2) || 0}</td>
                    </tr>
                    <!-- Tip -->
                    <tr>
                        <td colspan="3">Added Tip</td>
                        <td>${addedTip?.toFixed(2) || 0}</td>
                    </tr>
                    <!-- Tip -->
                    <tr>
                        <td colspan="3">Surge Charge</td>
                        <td>${surgePrice?.toFixed(2) || 0}</td>
                    </tr>
                    <!-- Subtotal -->
                    <tr>
                        <td colspan="3">Waiting Charge</td>
                        <td>${surgePrice?.toFixed(2) || 0}</td>
                    </tr>
                    ${
                      discountedAmount
                        ? `
                      <!-- Discount -->
                    <tr>
                        <td colspan="3">Discount</td>
                        <td>${discountedAmount?.toFixed(2) || 0}</td>
                    </tr>
                      `
                        : ``
                    }
                    <!-- GST -->
                    <tr>
                        <td colspan="3">GST</td>
                        <td>${taxAmount?.toFixed(2) || 0}</td>
                    </tr>
                    <!-- Grand Total -->
                    <tr class="total-row">
                        <td colspan="3">Grand Total</td>
                        <td>${grandTotal?.toFixed(2) || 0}</td>
                    </tr>
                </tbody>
            </table>

            <!-- Thank You Message -->
            <p class="thank-you">~~~~~~~~~~ Thank you for choosing us ~~~~~~~~~~</p>

            <!-- Footer Contact Info -->
            <div class="footer">
                <p>For any enquiry, reach out via email at support@famto.in, or call on +91 97781 80794</p>
            </div>
        </div>

    </body>

    </html>`;

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "load" });
    const filePath = path.join(__dirname, "../../../sample_CSV/invoice.pdf");
    await page.pdf({ path: filePath, format: "A4", printBackground: true });
    await browser.close();

    res.download(filePath, "invoice.pdf", (err) => {
      if (err) next(appError(err.message));
      else
        fs.unlink(
          filePath,
          (err) => err && console.error("Failed to delete temporary PDF:", err)
        );
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const downloadOrderBillController = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    const orderFound = await Order.findById(orderId)
      .populate("merchantId", "merchantDetail.merchantName")
      .populate("customerId", "fullName phoneNumber");

    if (!orderFound || !orderFound.billDetail) {
      return next(appError("Order not found or no bill details available"));
    }

    const formattedItems = orderFound.items.map((item) => ({
      itemName: item.itemName,
      quantity: item.quantity,
      price: item.price,
      variantTypeName: item.variantTypeName,
    }));

    // Helper function to safely convert to number
    const toNumber = (value) => Number(value) || 0;

    const {
      deliveryCharge,
      taxAmount,
      discountedAmount,
      grandTotal,
      itemTotal,
      addedTip,
      subTotal,
      surgePrice,
    } = orderFound.billDetail;

    // Convert and validate numeric values
    const values = {
      deliveryCharge: toNumber(deliveryCharge),
      taxAmount: toNumber(taxAmount),
      discountedAmount: toNumber(discountedAmount),
      grandTotal: toNumber(grandTotal),
      itemTotal: toNumber(itemTotal),
      addedTip: toNumber(addedTip),
      subTotal: toNumber(subTotal),
      surgePrice: toNumber(surgePrice),
    };

    if (Object.values(values).some((value) => isNaN(value))) {
      return next(appError("Invalid bill details."));
    }

    const htmlContent = `<!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 0;
            }

            .container {
                position: relative;
                min-height: 100vh;
                padding-bottom: 100px;
                margin: 0 auto;
                width: 90%;
            }

            header {
                display: flex;
                justify-content: space-between;
                margin-bottom: 20px;
            }

            .logo {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .logo img {
                height: 50px;
                width: 50px;
                object-fit: contain;
            }

            .header-info h3,
            .header-info h5 {
                margin: 0;
            }

            .date p {
                font-size: 16px;
            }

            .invoice-title {
                text-align: center;
                font-size: 22px;
                font-weight: 600;
                margin: 10px 0;
            }

            .info-section {
                display: flex;
                justify-content: space-between;
                margin-bottom: 20px;
            }

            .info-box {
                background-color: white;
                padding: 20px;
                width: 370px;
            }

            .info-box div {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
            }

            .info-box label {
                font-size: 14px;
                color: gray;
                width: 50%;
            }

            .info-box p {
                font-size: 14px;
                font-weight: 500;
                width: 50%;
                text-align: left;
            }

            table {
                width: 100%;
                border-collapse: collapse;
            }

            table,
            th,
            td {
                border: 1px solid gray;
            }

            th,
            td {
                padding: 10px;
                text-align: left;
            }

            thead {
                background-color: #f1f1f1;
            }

            .total-row {
                font-weight: 600;
            }

            .thank-you {
                text-align: center;
                margin: 15px 0;
            }

            .footer {
                text-align: center;
                position: absolute;
                bottom: 15px;
                width: 100%;
            }
        </style>
    </head>

    <body>

        <div class="container">
            <!-- Header Section -->
            <header>
                <div class="logo">
                    <img src="https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/admin_panel_assets%2FGroup.svg?alt=media&token=9629e049-c607-4f98-9fee-1cd435b5754f" alt="Logo">
                    <div class="header-info">
                        <h3>My Famto</h3>
                        <h5>Private Limited</h5>
                    </div>
                </div>
                <div class="date">
                    <p>Date: <span style="color:gray;">${formatDate(
                      new Date()
                    )}</span></p>
                </div>
            </header>

            <!-- Invoice Title -->
            <div class="invoice-title">
                <p>Bill - ${orderId}</p>
            </div>

            <!-- Merchant and Order Information -->
            <div class="info-section">
                <!-- Merchant Info -->
                <div class="info-box">
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Merchant Name</p>
                        <p>${
                          orderFound?.merchantId?.merchantDetail
                            ?.merchantName || "-"
                        }</p>
                    </div>
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Phone Number</p>
                        <p>${orderFound?.merchantId?.merchantName || "-"}</p>
                    </div>
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Address</p>
                        <p>${
                          orderFound?.merchantId?.merchantDetail
                            ?.displayAddress || "-"
                        }</p>
                    </div>
                </div>

                <!-- Order Info -->
                <div class="info-box">
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Order ID</p>
                        <p>${orderId}</p>
                    </div>
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Order Date</p>
                        <p>${formatDate(orderFound?.createdAt)} at ${formatTime(
      orderFound?.createdAt
    )}</p>
                    </div>
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Delivery Mode</p>
                        <p>${orderFound?.orderDetail?.deliveryMode}</p>
                    </div>
                    <div style="margin-bottom: -10px;">
                        <p style="color: #919191;">Delivery Option</p>
                        <p>${orderFound?.orderDetail?.deliveryOption}</p>
                    </div>
                </div>
            </div>

            <!-- Invoice Table -->
            <table>
               <thead> 
      ${
        orderFound?.orderDetail?.deliveryMode === "Pick and Drop" ||
        orderFound?.orderDetail?.deliveryMode === "Custom Order"
          ? `<th colspan="3">Item</th><th>Price</th>`
          : `<th>Item</th><th>Rate</th><th>Quantity</th><th>Price</th>`
      }  
            </thead>   
                <tbody>
                 ${
                   orderFound?.orderDetail?.deliveryMode === "Pick and Drop" ||
                   orderFound?.orderDetail?.deliveryMode === "Custom Order"
                     ? ``
                     : `  ${formattedItems?.map((item) => {
                         let price = item?.quantity * item?.price;
                         return `
                      <tr>
                        <td>${item?.itemName} ${
                           item?.variantTypeName
                             ? `(${item?.variantTypeName})`
                             : ""
                         }</td>
                        <td>${item?.price || 0}</td>
                        <td>${item?.quantity || 0}</td>
                        <td>${price?.toFixed(2) || 0}</td>
                    </tr>
                      `;
                       })}
                    <!-- Item Total -->
                    <tr>
                        <td colspan="3">Item Total</td>
                        <td>${itemTotal?.toFixed(2) || 0}</td>
                    </tr>`
                 }   
                    <tr>
                        <td colspan="3">Delivery charge</td>
                        <td>${deliveryCharge?.toFixed(2) || 0}</td>
                    </tr>
                    <!-- Tip -->
                    <tr>
                        <td colspan="3">Added Tip</td>
                        <td>${addedTip?.toFixed(2) || 0}</td>
                    </tr>
                    <!-- Tip -->
                    <tr>
                        <td colspan="3">Surge Charge</td>
                        <td>${surgePrice?.toFixed(2) || 0}</td>
                    </tr>
                    <!-- Subtotal -->
                    <tr>
                        <td colspan="3">Waiting Charge</td>
                        <td>${surgePrice?.toFixed(2) || 0}</td>
                    </tr>
                    ${
                      discountedAmount
                        ? `
                      <!-- Discount -->
                    <tr>
                        <td colspan="3">Discount</td>
                        <td>${discountedAmount?.toFixed(2) || 0}</td>
                    </tr>
                      `
                        : ``
                    }
                    <!-- GST -->
                    <tr>
                        <td colspan="3">GST</td>
                        <td>${taxAmount?.toFixed(2) || 0}</td>
                    </tr>
                    <!-- Grand Total -->
                    <tr class="total-row">
                        <td colspan="3">Grand Total</td>
                        <td>${grandTotal?.toFixed(2) || 0}</td>
                    </tr>
                </tbody>
            </table>

            <!-- Thank You Message -->
            <p class="thank-you">~~~~~~~~~~ Thank you for choosing us ~~~~~~~~~~</p>

            <!-- Footer Contact Info -->
            <div class="footer">
                <p>For any enquiry, reach out via email at support@famto.in, or call on +91 97781 80794</p>
            </div>
        </div>

    </body>

    </html>`;

    const filePath = path.join(__dirname, "../../../invoice.pdf");

    // Generate PDF using Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "load" });
    await page.pdf({ path: filePath, format: "A4", printBackground: true });
    await browser.close();

    // Send the PDF
    res.download(filePath, "invoice.pdf", (err) => {
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) console.error("Failed to delete PDF:", unlinkErr);
      });
      if (err) return next(appError("Failed to send PDF"));
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const orderMarkAsReadyController = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const orderFound = await Order.findById(orderId);
    if (!orderFound) return next(appError("Order not found.", 400));

    if (orderFound.orderDetail.deliveryMode === "Take Away") {
      orderFound.orderDetail.isReady = true;

      await Promise.all([
        orderFound.save(),
        ActivityLog.create({
          userId: req.userAuth,
          userType: req.userRole,
          description: `Order (#${orderId}) is marked as ready by ${req.userRole} (${req.userName} - ${req.userAuth})`,
        }),
      ]);

      const eventName = "orderReadyCustomer";

      const { rolesToNotify, data } = await findRolesToNotify(eventName);

      // Send notifications to each role dynamically
      for (const role of rolesToNotify) {
        let roleId;

        if (role === "admin") {
          roleId = process.env.ADMIN_ID;
        } else if (role === "merchant") {
          roleId = orderFound?.merchantId;
        } else if (role === "driver") {
          roleId = orderFound.agentId;
        } else if (role === "customer") {
          roleId = orderFound?.customerId;
        } else {
          const roleValue = await ManagerRoles.findOne({ roleName: role });
          let manager;
          if (roleValue) {
            manager = await Manager.findOne({ role: roleValue._id });
          } // Assuming `role` is the role field to match in Manager model
          if (manager) {
            roleId = manager._id; // Set roleId to the Manager's ID
          }
        }

        if (roleId) {
          const notificationData = {
            fcm: {
              customerId: orderFound.customerId,
            },
          };

          await sendNotification(
            roleId,
            eventName,
            notificationData,
            role.charAt(0).toUpperCase() + role.slice(1)
          );
        }
      }
      const socketData = {
        ...data,
      };

      sendSocketData(orderFound.customerId, eventName, socketData);
    } else {
      if (orderFound.agentId === null) {
        return next(appError("Order not assigned to any agent.", 400));
      } else {
        orderFound.orderDetail.isReady = true;
        await orderFound.save();

        const eventName = "orderReadyAgent";

        const { rolesToNotify, data } = await findRolesToNotify(eventName);

        // Send notifications to each role dynamically
        for (const role of rolesToNotify) {
          let roleId;

          if (role === "admin") {
            roleId = process.env.ADMIN_ID;
          } else if (role === "merchant") {
            roleId = orderFound?.merchantId;
          } else if (role === "driver") {
            roleId = orderFound.agentId;
          } else if (role === "customer") {
            roleId = orderFound?.customerId;
          } else {
            const roleValue = await ManagerRoles.findOne({ roleName: role });
            let manager;
            if (roleValue) {
              manager = await Manager.findOne({ role: roleValue._id });
            } // Assuming `role` is the role field to match in Manager model
            if (manager) {
              roleId = manager._id; // Set roleId to the Manager's ID
            }
          }

          if (roleId) {
            await sendNotification(
              roleId,
              eventName,
              "",
              role.charAt(0).toUpperCase() + role.slice(1)
            );
          }
        }
        await AgentAnnouncementLogs.create({
          agentId: orderFound.agentId,
          title: data.title,
          description: data.description,
        });

        const socketData = {
          ...data,
        };

        sendSocketData(orderFound.agentId, eventName, socketData);
      }
    }
    res.status(200).json({ message: "Order marked as ready." });
  } catch (err) {
    return next(appError(err.message));
  }
};

const markTakeAwayOrderCompletedController = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const orderFound = await Order.findById(orderId);

    if (!orderFound) return next(appError("Order not found.", 400));

    if (orderFound.orderDetail.deliveryMode === "Take Away") {
      const stepperDetail = {
        by: orderFound.orderDetail.pickupAddress.fullName,
        userId: orderFound.merchantId,
        date: new Date(),
        location: orderFound.orderDetail.pickupLocation,
      };
      orderFound.status = "Completed";
      orderFound.orderDetailStepper.completed = stepperDetail;

      await Promise.all([
        orderFound.save(),
        ActivityLog.create({
          userId: req.userAuth,
          userType: req.userRole,
          description: `Order (#${orderId}) is marked as collected by customer by ${req.userRole} (${req.userName} - ${req.userAuth})`,
        }),
      ]);

      res.status(200).json({ message: "Order marked as completed." });
    } else {
      res.status(400).json({ message: "Order cannot be marked as ready." });
    }
  } catch (err) {
    return next(appError(err.message));
  }
};

const createInvoiceByAdminController = async (req, res, next) => {
  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(500).json({ errors: formattedErrors });
  }

  try {
    const {
      selectedBusinessCategory,
      customerId,
      newCustomer,
      deliveryOption,
      deliveryMode,
      items,
      instructionToMerchant = "",
      instructionToDeliveryAgent = "",
      // For Take Away and Home Delivery
      merchantId,
      customerAddressType,
      customerAddressOtherAddressId,
      flatDiscount = 0,
      newCustomerAddress,
      // For Pick and Drop and Custom Order
      pickUpAddressType,
      pickUpAddressOtherAddressId,
      deliveryAddressType,
      deliveryAddressOtherAddressId,
      newPickupAddress,
      newDeliveryAddress,
      vehicleType,
      customPickupLocation,
      instructionInPickup = "",
      instructionInDelivery = "",
      // For all orders (Optional)
      addedTip = 0,
    } = req.body;

    const merchantFound = await fetchMerchantDetails(
      merchantId,
      deliveryMode,
      deliveryOption,
      next
    );

    validateCustomerAddress(
      newCustomer,
      deliveryMode,
      newCustomerAddress,
      newPickupAddress,
      newDeliveryAddress
    );

    const customerAddress =
      newCustomerAddress || newPickupAddress || newDeliveryAddress;
    const addressType = customerAddressType || deliveryAddressType || "";
    const otherAddressId =
      customerAddressOtherAddressId || deliveryAddressOtherAddressId || "";

    const customer = await findOrCreateCustomer({
      customerId,
      newCustomer,
      customerAddress,
      deliveryMode,
      addressType,
      otherAddressId,
      formattedErrors,
    });

    if (!customer) return res.status(409).json({ errors: formattedErrors });

    const {
      pickupLocation,
      pickupAddress,
      deliveryLocation,
      deliveryAddress,
      distanceInKM,
    } = await handleDeliveryModeForAdmin(
      deliveryMode,
      customer,
      customerAddressType,
      customerAddressOtherAddressId,
      newCustomer,
      newCustomerAddress,
      merchantFound,
      pickUpAddressType,
      pickUpAddressOtherAddressId,
      deliveryAddressType,
      deliveryAddressOtherAddressId,
      newPickupAddress,
      newDeliveryAddress,
      customPickupLocation
    );

    const scheduledDetails = processScheduledDelivery(deliveryOption, req);

    const {
      oneTimeDeliveryCharge,
      surgeCharges,
      deliveryChargeForScheduledOrder,
      taxAmount,
      itemTotal,
    } = await calculateDeliveryChargeHelperForAdmin(
      deliveryMode,
      distanceInKM,
      merchantFound,
      customer,
      items,
      scheduledDetails,
      vehicleType,
      pickupLocation,
      selectedBusinessCategory
    );

    let merchantDiscountAmount;
    if (merchantFound) {
      merchantDiscountAmount = await applyDiscounts({
        items,
        itemTotal,
        merchantId,
      });
    }

    const billDetail = calculateBill(
      itemTotal || 0,
      deliveryChargeForScheduledOrder || oneTimeDeliveryCharge || 0,
      surgeCharges || 0,
      flatDiscount || 0,
      merchantDiscountAmount || 0,
      taxAmount || 0,
      addedTip || 0
    );

    const cart = await saveCustomerCart(
      deliveryMode,
      deliveryOption,
      merchantFound,
      customer,
      pickupLocation,
      pickupAddress,
      deliveryLocation,
      deliveryAddress,
      distanceInKM,
      scheduledDetails,
      billDetail,
      vehicleType,
      items,
      instructionToMerchant,
      instructionToDeliveryAgent,
      instructionInPickup,
      instructionInDelivery
    );

    let populatedCartWithVariantNames;
    let formattedItems;
    if (deliveryMode === "Take Away" || deliveryMode === "Home Delivery") {
      populatedCartWithVariantNames = await formattedCartItems(cart);

      formattedItems = populatedCartWithVariantNames.items.map((item) => ({
        itemName: item.productId.productName,
        itemImageURL: item.productId.productImageURL,
        quantity: item.quantity,
        price: item.price,
        variantTypeName: item?.variantTypeId?.variantTypeName,
      }));
    } else if (deliveryMode === "Custom Order") {
      formattedItems = cart.items.map((item) => ({
        itemId: new mongoose.Types.ObjectId(),
        itemName: item.itemName,
        itemImageURL: item.itemImageURL,
        quantity: item.quantity,
        unit: item.unit,
      }));
    }

    res.status(200).json({
      message: "Order invoice created successfully",
      data: {
        cartId: cart._id,
        billDetail: cart.billDetail,
        items: formattedItems || cart.items,
        deliveryMode,
        buyFromAnyWhere: cart.cartDetail.pickupLocation.length !== 2,
      },
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getScheduledOrderDetailByAdminController = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { deliveryMode } = req.query;

    let orderFound;

    if (["Home Delivery", "Take Away"].includes(deliveryMode)) {
      orderFound = await ScheduledOrder.findOne({ _id: id })
        .populate({
          path: "customerId",
          select: "fullName phoneNumber email",
        })
        .populate({
          path: "merchantId",
          select: "merchantDetail",
        })
        .populate({
          path: "customerId",
          select: "fullName phoneNumber email",
        })
        .populate({
          path: "merchantId",
          select: "merchantDetail",
        })
        .exec();
    } else {
      orderFound = await scheduledPickAndCustom
        .findOne({
          _id: id,
        })
        .populate({
          path: "customerId",
          select: "fullName phoneNumber email",
        })
        .exec();
    }

    let isScheduledOrder = true;

    if (!orderFound) {
      return next(appError("Order not found", 404));
    }

    const orderDetail = isScheduledOrder
      ? orderFound.orderDetail
      : orderFound.orderDetail;

    const customerDetail = {
      _id: orderFound.customerId._id,
      name:
        orderFound.customerId.fullName ||
        orderDetail?.deliveryAddress?.fullName ||
        "-",
      email: orderFound.customerId.email || "-",
      phone: orderFound.customerId.phoneNumber || "-",
      address: orderDetail?.deliveryAddress || "-",
      ratingsToDeliveryAgent: {
        rating: orderFound?.orderRating?.ratingToDeliveryAgent?.rating || 0,
        review: orderFound?.orderRating?.ratingToDeliveryAgent?.review || "-",
      },
      ratingsByDeliveryAgent: {
        rating: orderFound?.orderRating?.ratingByDeliveryAgent?.rating || 0,
        review: orderFound?.orderRating?.ratingByDeliveryAgent?.review || "-",
      },
    };

    const merchantDetail = isScheduledOrder
      ? {
          _id: orderFound?.merchantId?._id || "-",
          name: orderFound?.merchantId?.merchantDetail?.merchantName || "-",
          instructionsByCustomer: orderDetail?.instructionToMerchant || "-",
          merchantEarnings:
            orderFound?.commissionDetail?.merchantEarnings || "-",
          famtoEarnings: orderFound?.commissionDetail?.famtoEarnings || "-",
        }
      : null;

    const formattedResponse = {
      _id: orderFound._id,
      orderStatus: orderFound.status || "-",
      paymentStatus: orderFound.paymentStatus || "-",
      paymentMode: orderFound.paymentMode || "-",
      deliveryMode: orderDetail?.deliveryMode || "-",
      deliveryOption: orderDetail?.deliveryOption || "-",
      orderTime: `${formatDate(orderFound.startDate)} | ${formatTime(
        orderFound.startDate
      )} || ${formatDate(orderFound.endDate)} | ${formatTime(
        orderFound.endDate
      )}`,
      deliveryTime: `${formatDate(orderFound.time)} | ${formatTime(
        orderFound.time
      )}`,
      customerDetail,
      merchantDetail,
      deliveryAgentDetail: {
        _id: "-",
        name: "-",
        phoneNumber: "-",
        avatar: "-",
        team: "-",
        instructionsByCustomer: "-",
        distanceTravelled: "-",
        timeTaken: "-",
        delayedBy: "-",
      },
      items: orderFound.items || null,
      billDetail: orderFound.billDetail || null,
      pickUpLocation: orderDetail?.pickupLocation || null,
      deliveryLocation: orderDetail?.deliveryLocation || null,
      agentLocation: orderFound?.agentId?.location || null,
      orderDetailStepper: Array.isArray(orderFound?.orderDetailStepper)
        ? orderFound.orderDetailStepper
        : [orderFound.orderDetailStepper],
    };

    res.status(200).json({
      message: "Single order detail",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const createOrderByAdminController = async (req, res, next) => {
  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    const { paymentMode, deliveryMode, cartId } = req.body;

    const cartFound = await getCartByDeliveryMode(cartId, deliveryMode);
    if (!cartFound) return next(appError("Cart not found", 404));

    const customer = await Customer.findById(cartFound.customerId);
    if (!customer) return next(appError("Customer not found", 404));

    const merchant =
      cartFound.merchantId && (await Merchant.findById(cartFound.merchantId));

    const deliveryTime = calculateDeliveryTime(merchant, deliveryMode);

    const orderDetails = await prepareOrderDetails(
      cartFound,
      customer,
      deliveryTime,
      paymentMode
    );

    const orderOptions = {
      customerId: cartFound.customerId,
      merchantId: cartFound?.merchantId && cartFound.merchantId,
      items: ["Take Away", "Home Delivery"].includes(deliveryMode)
        ? orderDetails.formattedItems
        : cartFound.items,
      orderDetail: {
        ...cartFound.cartDetail,
        deliveryTime,
      },
      billDetail: orderDetails.billDetail,
      totalAmount: orderDetails.billDetail.grandTotal,
      status: "Pending",
      paymentMode,
      paymentStatus:
        paymentMode === "Cash-on-delivery" ? "Pending" : "Completed",
      purchasedItems: orderDetails.purchasedItems,
      "orderDetailStepper.created": {
        by: `${req.userRole} - ${req.userName}`,
        date: new Date(),
      },
    };

    const isScheduledOrder =
      cartFound.cartDetail.deliveryOption === "Scheduled";
    const isPickOrCustomOrder = ["Pick and Drop", "Custom Order"].includes(
      deliveryMode
    );

    let newOrderCreated;
    let OrderModelToUse;
    if (isScheduledOrder && !isPickOrCustomOrder) {
      newOrderCreated = await ScheduledOrder.create({
        ...orderOptions,
        startDate: cartFound.cartDetail.startDate,
        endDate: cartFound.cartDetail.endDate,
        time: cartFound.cartDetail.time,
      });
      OrderModelToUse = ScheduledOrder;
    } else if (isScheduledOrder && isPickOrCustomOrder) {
      newOrderCreated = await scheduledPickAndCustom.create({
        ...orderOptions,
        startDate: cartFound.cartDetail.startDate,
        endDate: cartFound.cartDetail.endDate,
        time: cartFound.cartDetail.time,
      });
      OrderModelToUse = scheduledPickAndCustom;
    } else {
      newOrderCreated = await Order.create(orderOptions);
      OrderModelToUse = Order;
    }

    const [, , , newOrder] = await Promise.all([
      ActivityLog.create({
        userId: req.userAuth,
        userType: req.userRole,
        description: `New ${isScheduledOrder ? `scheduled order` : `order`} (#${
          newOrderCreated._id
        }) is created by ${req.userRole} (${req.userName} - ${req.userAuth})`,
      }),
      clearCart(customer._id, deliveryMode),
      updateCustomerTransaction(customer, orderDetails.billDetail),
      OrderModelToUse.findById(newOrderCreated._id).populate("merchantId"),
    ]);

    const eventName = "newOrderCreated";

    const { rolesToNotify, data } = await findRolesToNotify(eventName);

    const socketData = {
      orderId: newOrder?._id,
      orderDetail: newOrder?.orderDetail,
      billDetail: newOrder?.billDetail,
      orderDetailStepper: newOrder?.orderDetailStepper?.created,
      _id: newOrder?._id,
      orderStatus: newOrder?.status,
      merchantName: newOrder?.merchantId?.merchantDetail?.merchantName || "-",
      customerName:
        newOrder?.orderDetail?.deliveryAddress?.fullName ||
        newOrder?.customerId?.fullName ||
        "-",
      deliveryMode: newOrder?.orderDetail?.deliveryMode,
      orderDate: formatDate(newOrder?.createdAt),
      orderTime: formatTime(newOrder?.createdAt),
      deliveryDate: newOrder?.orderDetail?.deliveryTime
        ? formatDate(newOrder?.orderDetail?.deliveryTime)
        : "-",
      deliveryTime: newOrder?.orderDetail?.deliveryTime
        ? formatTime(newOrder?.orderDetail?.deliveryTime)
        : "-",
      paymentMethod: newOrder?.paymentMode,
      deliveryOption: newOrder?.orderDetail?.deliveryOption,
      amount: newOrder?.billDetail?.grandTotal,
    };

    const notificationData = {
      fcm: {
        ...data,
        orderId: newOrder?._id,
        customerId: newOrder?.customerId,
      },
    };

    const userIds = {
      admin: process.env.ADMIN_ID,
      customer: newOrder?.customerId,
      merchant: newOrder?.merchantId?._id,
      driver: newOrder?.agentId,
    };

    await sendSocketDataAndNotification({
      rolesToNotify,
      userIds,
      eventName,
      socketData,
      notificationData,
    });

    res.status(201).json({ cartFound });
  } catch (err) {
    next(appError(err.message));
  }
};

const markOrderAsCompletedByAdminController = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const [orderFound, task] = await Promise.all([
      Order.findOne({
        _id: orderId,
        "orderDetail.deliveryMode": { $ne: "Take Away" },
      }).populate("customerId", "fullName"),
      Task.findOne({ orderId }),
    ]);

    if (orderFound.status === "Pending") {
      return next(appError("Order is not confirmed yet", 400));
    }

    if (
      !orderFound ||
      ["Completed", "Cancelled"].includes(orderFound?.status)
    ) {
      return next(
        appError("Order not found or already completed / cancelled", 404)
      );
    }

    if (!task) {
      return next(appError("Task not found", 404));
    }

    const agentFound = await Agent.findById(orderFound.agentId);

    if (!agentFound) {
      return next(appError("Agent not found", 404));
    }

    let calculatedSalary = 0;
    let calculatedSurge = 0;
    let totalOrderDistance = 0;

    const [agentPricing, agentSurge] = await Promise.all([
      AgentPricing.findById(agentFound?.workStructure?.salaryStructureId),
      AgentSurge.findOne({
        geofenceId: agentFound.geofenceId,
        status: true,
      }),
    ]);

    if (!agentPricing) throw new Error("Agent pricing not found");
    if (agentPricing?.type.startsWith("Monthly")) {
      calculatedSalary = 0;
    } else {
      const startToPickDistance =
        orderFound?.detailAddedByAgent?.startToPickDistance;

      totalOrderDistance = startToPickDistance
        ? startToPickDistance + orderFound.orderDetail.distance
        : orderFound.orderDetail.distance;

      let orderSalary = totalOrderDistance * agentPricing.baseDistanceFarePerKM;

      let surgePrice = 0;

      if (agentSurge) {
        const distance =
          orderFound?.detailAddedByAgent?.distanceCoveredByAgent ??
          orderFound.orderDetail.distance;

        const criteria = Math.ceil(distance / agentSurge.baseDistance);

        surgePrice = criteria * agentSurge.baseFare;
      }

      let totalPurchaseFare = 0;

      if (orderFound.orderDetail.deliveryMode === "Custom Order") {
        const taskFound = await Task.findOne({ orderId: orderFound._id });
        if (taskFound) {
          const durationInHours =
            (new Date(taskFound?.deliveryDetail?.startTime) -
              new Date(taskFound.pickupDetail.startTime)) /
            (1000 * 60 * 60);

          const normalizedHours =
            durationInHours < 1 ? 1 : Math.floor(durationInHours);

          totalPurchaseFare =
            normalizedHours * agentPricing.purchaseFarePerHour;
        }
      }

      const totalEarnings = orderSalary;
      const totalSurge = totalPurchaseFare + surgePrice;

      // Use Number to ensure it's a number with two decimal places
      calculatedSalary = Number(totalEarnings?.toFixed(2));
      calculatedSurge = Number(totalSurge?.toFixed(2));
    }

    const detail = {
      orderId,
      deliveryMode: orderFound.orderDetail.deliveryMode,
      customerName: orderFound.customerId.fullName || "-",
      completedOn: new Date(),
      grandTotal: calculatedSalary,
    };

    const currentDay = moment.tz(new Date(), "Asia/Kolkata");
    const startOfDay = currentDay.startOf("day").toDate();
    const endOfDay = currentDay.endOf("day").toDate();

    const agentTasks = await Task.find({
      taskStatus: "Assigned",
      agentId: agentFound._id,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    }).sort({
      createdAt: 1,
    });

    agentTasks.length > 1
      ? (agentFound.status = "Busy")
      : (agentFound.status = "Free");
    agentFound.appDetail.totalEarning += calculatedSalary;
    agentFound.appDetail.totalSurge += calculatedSurge;
    agentFound.appDetail.totalDistance += totalOrderDistance;
    agentFound.appDetail.orders += 1;
    agentFound.appDetail.orderDetail.push(detail);
    agentFound.taskCompleted += 1;

    if (!orderFound.detailAddedByAgent) {
      orderFound.detailAddedByAgent = {};
    }

    orderFound.status = "Completed";
    orderFound.detailAddedByAgent.agentEarning = calculatedSalary;
    orderFound.detailAddedByAgent.distanceCoveredByAgent = totalOrderDistance;

    task.taskStatus = "Completed";
    task.pickupDetail.pickupStatus = "Completed";
    task.pickupDetail.startTime = new Date();
    task.pickupDetail.completedTime = new Date();
    task.deliveryDetail.deliveryStatus = "Completed";
    task.deliveryDetail.startTime = new Date();
    task.deliveryDetail.completedTime = new Date();

    await Promise.all([
      orderFound.save(),
      agentFound.save(),
      task.save(),
      ActivityLog.create({
        userId: req.userAuth,
        userType: req.userRole,
        description: `Order (#${orderId}) is marked as completed by ${req.userRole} (${req.userName} - ${req.userAuth})`,
      }),
    ]);

    res.status(200).json({ message: "Order marked as completed" });
  } catch (err) {
    next(appError(err.message));
  }
};

const markPaymentCollectedFromCustomer = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { paymentCollectedFromCustomer: "Completed" },
      { new: true, upsert: false }
    );

    if (!updatedOrder) {
      return next(appError("Order not found", 404));
    }

    res.status(200).json({ success: true, message: "Payment status updated" });
  } catch (err) {
    next(appError(err.message));
  }
};

const markOrderAsCancelled = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const [order, task, notification, notificationCount] = await Promise.all([
      Order.findById(orderId),
      Task.findOne({ orderId }),
      AgentNotificationLogs.findOne({ orderId, status: "Accepted" }),
      AgentNotificationLogs.find({ status: "Accepted" }),
    ]);

    if (!order) return next(appError("Order not found", 404));
    if (!task) return next(appError("Task not found", 404));

    order.status = "Cancelled";
    task.taskStatus = "Cancelled";
    task.pickupDetail.pickupStatus = "Cancelled";
    task.deliveryDetail.deliveryStatus = "Cancelled";

    const promises = [
      order.save(),
      task.save(),
      ActivityLog.create({
        userId: req.userAuth,
        userType: req.userRole,
        description: `Order (#${orderId}) is marked as cancelled by ${req.userRole} (${req.userName} - ${req.userAuth})`,
      }),
    ];

    if (order?.agentId && notificationCount.length === 1) {
      promises.push(
        Agent.findByIdAndUpdate(
          order.agentId,
          { status: "Free" },
          { new: true }
        )
      );
    }

    if (notification) {
      promises.push(
        AgentNotificationLogs.findOneAndUpdate(
          { orderId },
          { status: "Cancelled" },
          { new: true }
        )
      );
    }

    await Promise.all(promises);

    res.status(200).json({
      success: true,
      message: "Order marked as cancelled",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  confirmOrderByAdminController,
  rejectOrderByAdminController,
  getOrderDetailByAdminController,
  createInvoiceByAdminController,
  createOrderByAdminController,
  downloadOrdersCSVByAdminController,
  downloadInvoiceBillController,
  downloadOrderBillController,
  orderMarkAsReadyController,
  markTakeAwayOrderCompletedController,
  getScheduledOrderDetailByAdminController,
  //
  fetchAllOrdersByAdminController,
  fetchAllScheduledOrdersByAdminController,
  markOrderAsCompletedByAdminController,
  markPaymentCollectedFromCustomer,
  markOrderAsCancelled,
};
