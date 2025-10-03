const Customer = require("./models/Customer");
const CustomerTransaction = require("./models/CustomerTransactionDetail");
const CustomerWalletTransaction = require("./models/CustomerWalletTransaction");
const Order = require("./models/Order");
const Task = require("./models/Task");
const Agent = require("./models/Agent");
const AgentWorkHistory = require("./models/AgentWorkHistory");
const Merchant = require("./models/Merchant");
const MerchantPayout = require("./models/MerchantPayout");
const Product = require("./models/Product");
const csvWriter = require("csv-writer").createObjectCsvWriter;
const fs = require("fs");
const path = require("path");

const moment = require("moment-timezone");
const {
  moveAppDetailToWorkHistoryAndResetForAllAgents,
} = require("./utils/agentAppHelpers");
const { formatDate } = require("./utils/formatters");
const appError = require("./utils/appError");
const Category = require("./models/Category");
const ProductDiscount = require("./models/ProductDiscount");
const AgentPricing = require("./models/AgentPricing");
const ActivityLog = require("./models/ActivityLog");

const migrateCustomerTransactions = async () => {
  try {
    const customers = await Customer.find({ transactionDetail: { $ne: [] } });

    for (const customer of customers) {
      let transactions = [];

      customer.transactionDetail.forEach((transaction) =>
        transactions.push({
          customerId: customer._id,
          transactionAmount: transaction.transactionAmount,
          transactionType: transaction.transactionType,
          type: transaction.type,
          madeOn: transaction.madeOn,
        })
      );

      if (transactions.length > 0) {
        CustomerTransaction.insertMany(transactions);
      }

      console.log(`Transactions of ${customer._id} migrated`);
    }
  } catch (err) {
    console.log(`Error in moving customer transactions: ${err}`);
  }
};

// migrateCustomerTransactions();

// *========================================
// *========================================
// *========================================

const deleteOrderAndTask = async () => {
  try {
    const customerId = "C241213";

    // Fetch all orders for the customer
    const orders = await Order.find({ customerId: { $ne: customerId } });

    // Collect task IDs related to the orders
    const taskIDs = [];
    for (const order of orders) {
      const task = await Task.findOne({ orderId: order._id });
      if (task) {
        taskIDs.push(task._id);
      }
    }

    // If there are any tasks, delete them
    if (taskIDs.length > 0) {
      await Task.deleteMany({ _id: { $in: taskIDs } });
    }

    // Delete the orders
    const orderIds = orders.map((order) => order._id);
    if (orderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: orderIds } });
    }

    console.log(`Deleted orders and tasks for customers: ${customerId}`);
  } catch (err) {
    console.log(`Error in deleting orders & tasks: ${err}`);
  }
};

// deleteOrderAndTask();

// *========================================
// *========================================
// *========================================

const migrateCustomerWalletTransactions = async () => {
  try {
    const customers = await Customer.find({
      walletTransactionDetail: { $ne: [] },
    });

    for (const customer of customers) {
      let transactions = [];

      customer.walletTransactionDetail.forEach((transaction) =>
        transactions.push({
          customerId: customer._id,
          closingBalance: transaction.closingBalance,
          transactionAmount: transaction.transactionAmount,
          transactionId: transaction.transactionId,
          orderId: transaction.orderId,
          date: transaction.date,
          type: transaction.type,
        })
      );

      if (transactions.length > 0) {
        CustomerWalletTransaction.insertMany(transactions);
      }

      console.log(`Transactions of ${customer._id} migrated`);
    }

    await Customer.updateMany(
      {},
      { $unset: { walletTransactionDetail: "", transactionDetail: "" } }
    );
  } catch (err) {
    console.log(`Error in moving customer transactions: ${err}`);
  }
};

// migrateCustomerWalletTransactions();

// *========================================
// *========================================
// *========================================

const migrateAgentAppDetailHistory = async () => {
  try {
    const agents = await Agent.find({
      isApproved: "Approved",
      isBlocked: false,
    });

    let detailArray = [];
    for (const agent of agents) {
      if (agent?.appDetailHistory?.length > 0) {
        agent.appDetailHistory.forEach((history) => {
          const {
            totalEarning,
            orders,
            pendingOrders,
            totalDistance,
            cancelledOrders,
            loginDuration,
            orderDetail,
            paymentSettled,
          } = history.details;

          return detailArray.push({
            agentId: agent._id,
            workDate: history.date,
            totalEarning,
            orders,
            pendingOrders,
            totalDistance,
            cancelledOrders,
            loginDuration,
            orderDetail,
            paymentSettled,
          });
        });

        console.log(`Prepared ${agent._id}`);
      }
    }

    await AgentWorkHistory.insertMany(detailArray);

    console.log(`Migrated agent work history completed`);
  } catch (err) {
    console.log(`Error in migrating detail of agents: ${err}`);
  }
};

// *========================================
// *========================================
// *========================================

const migrateMerchantPayoutData = async () => {
  try {
    const merchants = await Merchant.find({
      "merchantDetail.geofenceId": { $ne: null },
    });

    let payoutArray = [];
    for (const merchant of merchants) {
      if (merchant?.payoutDetail?.length > 0) {
        for (const payout of merchant.payoutDetail) {
          // Get merchant name and geofence ID from merchant details
          const merchantName =
            merchant.merchantDetail?.merchantName || merchant.fullName;
          const geofenceId = merchant.merchantDetail?.geofenceId;

          // Create new payout object
          payoutArray.push({
            merchantId: merchant._id,
            merchantName: merchantName,
            geofenceId: geofenceId,
            date: payout.date,
            totalCostPrice: payout.totalCostPrice,
            completedOrders: payout.completedOrders,
            isSettled: payout.isSettled,
          });
        }

        console.log(`Prepared payouts for merchant ${merchant._id}`);
      }
    }

    // Insert all payouts in batch
    if (payoutArray.length > 0) {
      await MerchantPayout.insertMany(payoutArray);
      console.log(
        `Successfully migrated ${payoutArray.length} merchant payouts`
      );
    } else {
      console.log("No payouts found to migrate");
    }

    console.log("Merchant payout migration completed");
  } catch (err) {
    console.error(`Error in migrating merchant payouts: ${err.message}`);
  }
};

// migrateMerchantPayoutData();

// *========================================
// *========================================
// *========================================

const preparePayoutForMerchant = async () => {
  try {
    const allMerchants = await Merchant.find({ isApproved: "Approved" }).lean();

    // Set date to May 10, 2025
    const targetDate = new Date(2025, 4, 11); // Month is 0-based, so 4 = May

    // Start time: Beginning of May 10 in IST (00:00:00), converted to UTC
    // IST is UTC+5:30, so 00:00 IST = 18:30 UTC of previous day
    let startTime = new Date(targetDate);
    startTime.setUTCHours(18, 30, 0, 0);
    startTime.setUTCDate(startTime.getUTCDate()); // Previous day in UTC

    // End time: End of May 10 in IST (23:59:59.999), converted to UTC
    // 23:59:59.999 IST = 18:29:59.999 UTC of the next day
    let endTime = new Date(targetDate);
    endTime.setUTCDate(endTime.getUTCDate() + 1); // Next day in UTC
    endTime.setUTCHours(18, 29, 59, 999);

    console.log("Start Time (UTC):", startTime);
    console.log("End Time (UTC):", endTime);

    const allOrders = await Order.find({
      createdAt: {
        $gte: startTime,
        $lte: endTime,
      },
      "orderDetail.deliveryMode": "Home Delivery",
      status: "Completed",
    })
      .select("merchantId purchasedItems")
      .lean();

    const merchantPayouts = new Map();

    const productIds = allOrders.flatMap((order) =>
      order.purchasedItems.map((item) => item.productId)
    );

    const products = await Product.find({ _id: { $in: productIds } }).lean();
    const productMap = new Map(
      products.map((product) => [product._id.toString(), product])
    );

    for (const order of allOrders) {
      const merchantId = order?.merchantId?.toString();
      const { purchasedItems } = order;
      let totalCostPrice = 0;

      for (const item of purchasedItems) {
        const { productId, variantId, quantity } = item;
        const product = productMap.get(productId.toString());

        if (product) {
          if (variantId) {
            const variant = product.variants.find((v) =>
              v.variantTypes.some((type) => type._id.equals(variantId))
            );

            if (variant) {
              const variantType = variant.variantTypes.find((type) =>
                type._id.equals(variantId)
              );
              if (variantType) {
                totalCostPrice += variantType.costPrice * quantity;
              }
            }
          } else {
            totalCostPrice += product.costPrice * quantity;
          }
        }
      }

      if (!merchantPayouts.has(merchantId)) {
        merchantPayouts.set(merchantId, {
          totalCostPrice: 0,
          completedOrders: 0,
        });
      }

      const payout = merchantPayouts.get(merchantId);
      payout.totalCostPrice += totalCostPrice;
      payout.completedOrders += 1;
    }

    // const bulkOperations = allMerchants.map((merchant) => {
    //   const payoutData = {
    //     merchantId: merchant._id,
    //     merchantName: merchant?.merchantDetail?.merchantName,
    //     geofenceId: merchant?.merchantDetail?.geofenceId,
    //     totalCostPrice:
    //       merchantPayouts.get(merchant._id.toString())?.totalCostPrice || 0,
    //     completedOrders:
    //       merchantPayouts.get(merchant._id.toString())?.completedOrders || 0,
    //     date: startTime,
    //   };
    //   // console.log("Payout Data:", payoutData);

    //   return payoutData;
    // });
    const bulkOperations = allMerchants
      .map((merchant) => {
        const merchantId = merchant._id.toString();
        const totalCostPrice =
          merchantPayouts.get(merchantId)?.totalCostPrice || 0;
        const completedOrders =
          merchantPayouts.get(merchantId)?.completedOrders || 0;

        // Only return data if either totalCostPrice or completedOrders is greater than zero
        if (totalCostPrice > 0 || completedOrders > 0) {
          const payoutData = {
            merchantId: merchant._id,
            merchantName: merchant?.merchantDetail?.merchantName,
            geofenceId: merchant?.merchantDetail?.geofenceId,
            totalCostPrice: totalCostPrice,
            completedOrders: completedOrders,
            date: startTime,
          };
          console.log("Payout Data:", payoutData);

          return payoutData;
        }
        return null; // Skip merchants with no activity
      })
      .filter(Boolean);

    // if (bulkOperations.length > 0) {
    //   await MerchantPayout.insertMany(bulkOperations);
    // }
  } catch (err) {
    console.error("Error in preparing payout:", err);
  }
};

// preparePayoutForMerchant();

// *========================================
// *========================================
// *========================================

const findOrdersOfAgentsDetails = async () => {
  try {
    const date = "2025-05-13";
    const agentId = "A250419";

    const formattedDay = moment.tz(date, "Asia/Kolkata");

    // Start and end of the previous day in IST
    const startDate = formattedDay.startOf("day").toDate();
    const endDate = formattedDay.endOf("day").toDate();

    const orders = await Order.find({
      agentId,
      createdAt: { $gte: startDate, $lte: endDate },
    });

    const result = orders.map((order) => ({
      orderId: order._id,
      distance: order.orderDetail.distance,
      agentDistance: order.detailAddedByAgent.distanceCoveredByAgent,
    }));

    const totalOrderDistance = result.reduce((acc, order) => {
      const distance = order.distance;
      return acc + distance;
    }, 0);

    const totalAgentDistance = result.reduce((acc, order) => {
      const distance = order.agentDistance ? order.agentDistance : 0;
      return acc + distance;
    }, 0);

    console.log({
      totalOrderDistance,
      totalAgentDistance,
      totalDistance: totalOrderDistance + totalAgentDistance,
      result,
    });
  } catch (err) {
    console.log(`Error in findOrdersOfAgentsDetails: ${err}`);
  }
};

// findOrdersOfAgentsDetails();

// *========================================
// *========================================
// *========================================

const prepareCSVOfAgentPayout = async (req, res, next) => {
  try {
    const agentIds = ["A250419", "A250428"];
    const startDate = "2025-05-16";
    const endDate = "2025-05-26";

    const formattedStartDay = moment.tz(startDate, "Asia/Kolkata");
    const formattedEndDay = moment.tz(endDate, "Asia/Kolkata");

    // Start and end of the previous day in IST
    const start = formattedStartDay.startOf("day").toDate();
    const end = formattedEndDay.endOf("day").toDate();

    const orders = await Order.find({
      agentId: { $in: agentIds },
      createdAt: { $gte: start, $lte: end },
    }).populate("agentId", "fullName");

    const formattedResponse = orders.map((order) => ({
      agentId: order.agentId._id,
      fullName: order.agentId.fullName,
      workedDate: formatDate(order.createdAt),
      distance: order.orderDetail.distance,
      agentDistance: order.detailAddedByAgent.distanceCoveredByAgent,
      agentEarning: order.detailAddedByAgent.agentEarning,
    }));

    const groupedResponse = formattedResponse.reduce((acc, curr) => {
      const key = `${curr.agentId}-${curr.workedDate}`;

      if (!acc[key]) {
        acc[key] = {
          agentId: curr.agentId,
          fullName: curr.fullName,
          workedDate: curr.workedDate,
          orders: 0,
          // agentDistance: 0,
          agentEarning: 0,
        };
      }

      acc[key].orders += 1;
      // acc[key].agentDistance += curr.agentDistance;
      acc[key].agentEarning += curr.agentEarning;

      return acc;
    }, {});

    const reducedArray = Object.values(groupedResponse);

    // console.log(reducedArray);

    const filePath = path.join(__dirname, "sample_CSV/Agent_Payments.csv");

    const csvHeaders = [
      { id: "agentId", title: "Agent ID" },
      { id: "fullName", title: "Full Name" },
      { id: "workedDate", title: "Worked Date" },
      { id: "orders", title: "Orders" },
      { id: "agentEarning", title: "Total Earnings" },
    ];

    const writer = csvWriter({
      path: filePath,
      header: csvHeaders,
    });

    await writer.writeRecords(reducedArray);

    res.status(200).download(filePath, "Agent_Payments.csv", (err) => {
      if (err) {
        next(err);
      } else {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Error deleting file:", unlinkErr);
          }
        });
      }
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// prepareCSVOfAgentPayout();

// *========================================
// *========================================
// *========================================

const findMerchantsWithoutDiscountForProducts = async () => {
  try {
    // Step 1: Find all products without a discount
    const products = await Product.find({
      $or: [{ discountId: null }, { discountId: { $exists: false } }],
    }).select("categoryId");

    // Step 2: Extract unique categoryIds
    const categoryIds = [
      ...new Set(products.map((p) => p.categoryId.toString())),
    ];

    // Step 3: Get all categories and extract merchantIds
    const categories = await Category.find({
      _id: { $in: categoryIds },
    }).select("merchantId");

    const merchantIds = categories.map((cat) => cat.merchantId.toString());
    const uniqueMerchantIds = [...new Set(merchantIds)];

    // Step 4: Get merchants that already have discounts
    const merchantsWithDiscounts = await ProductDiscount.distinct("merchantId");

    // Step 5: Filter out those merchants
    const merchantsWithoutDiscounts = uniqueMerchantIds.filter((id) =>
      merchantsWithDiscounts.includes(id)
    );

    console.log(merchantsWithoutDiscounts);

    const merchants = await Merchant.find({
      _id: { $in: merchantsWithoutDiscounts },
    }).select("merchantDetail.merchantName");

    console.log(
      merchants.map((merchant) => merchant.merchantDetail.merchantName)
    );
  } catch (err) {
    console.log(`Error in getting merchant list: ${err}`);
  }
};

// findMerchantsWithoutDiscountForProducts();

const prepareAgentPayout = async () => {
  try {
    const date = "2025-06-19";

    const formattedDay = moment.tz(date, "Asia/Kolkata");

    const startDate = formattedDay.startOf("day").toDate();
    const endDate = formattedDay.endOf("day").toDate();

    const orders = await Order.find({
      createdAt: { $gte: startDate, $lte: endDate },
    });

    const response = orders.map((order) => ({
      orderDistance: order.orderDetail.distance,
      totalDistance: order?.detailAddedByAgent?.distanceCoveredByAgent ?? 0,
      startToPick: order?.detailAddedByAgent?.startToPickDistance ?? 0,
      agentId: order?.agentId || null,
    }));

    const calculateDistanceForAllAgents = (data) => {
      const result = data.reduce((acc, curr) => {
        if (!curr.agentId) return acc;

        if (!acc[curr.agentId]) {
          acc[curr.agentId] = {
            agentId: curr.agentId,

            totalDistance: 0,
            totalStartToPickDistance: 0,
            orders: 0,
          };
        }

        acc[curr.agentId].totalDistance +=
          Number(curr.totalDistance.toFixed(2)) || 0;
        acc[curr.agentId].totalStartToPickDistance +=
          Number(curr.startToPick.toFixed(2)) || 0;
        acc[curr.agentId].orders += 1;

        return acc;
      }, {});

      // convert object to array of objects
      return Object.values(result);
    };

    let allAgentsResult = calculateDistanceForAllAgents(response);

    // allAgentsResult = allAgentsResult.filter(
    //   (agent) => agent.agentId === "A250623"
    // );
    // console.log(allAgentsResult);

    const historyDocuments = [];

    for (const agent of allAgentsResult) {
      let totalDistance = Number(agent?.totalDistance?.toFixed(2)) || 0;
      let totalStartToPickDistance =
        Number(agent?.totalStartToPickDistance?.toFixed(2)) || 0;

      const agentFound = await Agent.findById(agent.agentId);

      // Fetch agent pricing only once per agent
      const agentPricing = await AgentPricing.findById(
        agentFound.workStructure.salaryStructureId
      ).lean();

      if (agentPricing) {
        if (agentPricing?.type?.startsWith("Monthly")) {
          if (agent.orders > 0) {
            totalEarning = agentPricing.baseFare;
          }
        } else {
          const fareForStartToPick =
            totalStartToPickDistance * agentPricing.startToPickFarePerKM;
          const fareForPickToDrop =
            (totalDistance - totalStartToPickDistance) *
            agentPricing.baseDistanceFarePerKM;

          totalEarning = fareForStartToPick + fareForPickToDrop;

          const pricePerOrder =
            agentPricing.baseFare / agentPricing.minOrderNumber;
          const calculatedEarning = pricePerOrder * agent.orders;

          totalEarning += Math.min(calculatedEarning, agentPricing.baseFare);

          if (agent.orders > agentPricing.minOrderNumber) {
            const extraOrders = agent.orders - agentPricing.minOrderNumber;
            const earningForExtraOrders =
              extraOrders * agentPricing.fareAfterMinOrderNumber;

            totalEarning += earningForExtraOrders;
          }
        }
      }

      // Construct the work history document
      historyDocuments.push({
        agentId: agent.agentId,
        workDate: startDate,
        totalEarning: Number(totalEarning.toFixed(2)),
        orders: agent.orders,
        pendingOrders: 0,
        totalDistance: totalDistance,
        totalDistanceFromPickToDrop: totalStartToPickDistance,
        cancelledOrders: 0,
        loginDuration: 0,
        paymentSettled: false,
        orderDetail: [],
      });
    }

    console.log(historyDocuments);

    // if (historyDocuments.length > 0) {
    //   await AgentWorkHistory.insertMany(historyDocuments);
    // }

    console.log("History updated successfully");
  } catch (err) {
    console.log(`Error in preparing agent payout: ${err}`);
  }
};

// prepareAgentPayout();

const prepareOrderDetailsInPayout = async () => {
  try {
    const agentId = "A25047";
    const date = "2025-06-19";

    const formattedDay = moment.tz(date, "Asia/Kolkata");

    const startDate = formattedDay.startOf("day").toDate();
    const endDate = formattedDay.endOf("day").toDate();

    const orders = await Order.find({
      agentId,
      createdAt: { $gte: startDate, $lte: endDate },
    });

    const orderDetailPromises = orders.map(async (order) => {
      const task = await Task.findOne({ orderId: order._id });

      let activity;
      if (!task?.deliveryDetail?.completedTime) {
        activity = await ActivityLog.findOne({
          description: `Order (#${order._id}) is confirmed by Order Manager (Gopika S - 67ee1b60214cf3147f7d0624)`,
        });
      }

      return {
        orderId: order._id,
        deliveryMode: order.orderDetail.deliveryMode,
        customerName: order.orderDetail.deliveryAddress.fullName,
        completedOn:
          task?.deliveryDetail?.completedTime || activity.createdAt || null,
        grandTotal: order?.detailAddedByAgent?.agentEarning ?? 0,
      };
    });

    const orderDetail = await Promise.all(orderDetailPromises);

    console.log(orderDetail);

    // const workHistory = await AgentWorkHistory.findOneAndUpdate(
    //   {
    //     agentId,
    //     workDate: { $gte: startDate, $lte: endDate },
    //   },
    //   {
    //     $set: {
    //       orderDetail,
    //     },
    //   },
    //   { new: true, upsert: true }
    // );

    console.log(workHistory);
  } catch (err) {
    console.log(`Error in preparing order detail in payout: ${err}`);
  }
};

// prepareOrderDetailsInPayout();
