const Customer = require("./models/Customer");
const CustomerTransaction = require("./models/CustomerTransactionDetail");
const CustomerWalletTransaction = require("./models/CustomerWalletTransaction");
const Order = require("./models/Order");
const Task = require("./models/Task");

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
