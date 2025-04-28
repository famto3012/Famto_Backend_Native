const mongoose = require("mongoose");

const Order = require("../models/Order");
const Product = require("../models/Product");
const Merchant = require("../models/Merchant");

const preparePayoutForMerchant = async () => {
  try {
    const allMerchants = await Merchant.find({ isApproved: "Approved" }).lean();

    let startTime = new Date();
    let endTime = new Date();

    startTime.setUTCDate(startTime.getUTCDate() - 1);
    startTime.setUTCHours(18, 30, 0, 0);
    endTime.setUTCHours(18, 29, 59, 999);

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

    const bulkOperations = allMerchants.map((merchant) => {
      const payoutData = {
        payoutId: new mongoose.Types.ObjectId(),
        totalCostPrice:
          merchantPayouts.get(merchant._id.toString())?.totalCostPrice || 0,
        completedOrders:
          merchantPayouts.get(merchant._id.toString())?.completedOrders || 0,
        date: startTime,
      };

      return {
        updateOne: {
          filter: { _id: merchant._id },
          update: { $push: { payoutDetail: payoutData } },
        },
      };
    });

    if (bulkOperations.length > 0) {
      await Merchant.bulkWrite(bulkOperations);
    }
  } catch (err) {
    console.error("Error in preparing payout:", err);
  }
};

const resetStatusManualToggleForAllMerchants = async () => {
  try {
    const result = await Merchant.updateMany(
      { statusManualToggle: true }, // Match merchants with statusManualToggle set to true
      { $set: { statusManualToggle: false } } // Update the statusManualToggle to false
    );

    return result;
  } catch (error) {
    console.error(
      "Error while updating statusManualToggle for merchants:",
      error
    );
    // throw error; // Propagate the error to handle it further if needed
  }
};

module.exports = {
  preparePayoutForMerchant,
  resetStatusManualToggleForAllMerchants,
};
