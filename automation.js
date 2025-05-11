const Customer = require("./models/Customer");
const CustomerTransaction = require("./models/CustomerTransactionDetail");
const CustomerWalletTransaction = require("./models/CustomerWalletTransaction");
const Order = require("./models/Order");
const Task = require("./models/Task");
const Agent = require("./models/Agent");
const AgentWorkHistory = require("./models/AgentWorkHistory");
const Merchant = require("./models/Merchant");
const MerchantPayout = require("./models/MerchantPayout");

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
    const customerId = "C24091";

    // Fetch all orders for the customer
    const orders = await Order.find({ customerId });

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

    console.log(`Deleted orders and tasks for customer: ${customerId}`);
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
