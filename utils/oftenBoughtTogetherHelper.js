/**
 * oftenBoughtTogetherHelper.js
 *
 * Analyzes completed Order.purchasedItems to find which products are
 * frequently bought together, then writes the top results back to
 * Product.oftenBoughtTogetherId.
 *
 * Strategy (market-basket co-occurrence):
 *  - For every completed order with ≥2 purchased products, record every
 *    (productA, productB) pair.
 *  - Accumulate pair counts across all orders.
 *  - For each product, pick the top MAX_SUGGESTIONS partners and store their
 *    IDs in oftenBoughtTogetherId.
 *
 * This runs as a nightly cron so reads during the day are served from the
 * pre-computed field (fast, index-backed populate).
 */

const Order = require("../models/Order");
const Product = require("../models/Product");

const MAX_SUGGESTIONS = 5; // how many "often bought with" products to keep
const MIN_ORDER_THRESHOLD = 2; // minimum # of items in an order to be considered

/**
 * Compute and persist "often bought together" for every product.
 * Safe to call at any time – runs entirely on Order + Product collections.
 */
const computeAndSaveOftenBoughtTogether = async () => {
  try {
    console.log("[OftenBoughtTogether] Starting computation...");

    // co[productA][productB] = number of orders where both appear
    const co = {}; // Map<string, Map<string, number>>

    // Stream through completed orders with ≥2 purchased items
    const cursor = Order.find({
      status: "Completed",
      [`purchasedItems.${MIN_ORDER_THRESHOLD - 1}`]: { $exists: true }, // at least MIN items
    })
      .select("purchasedItems")
      .lean()
      .cursor();

    for await (const order of cursor) {
      // Extract unique productIds for this order (filter nulls)
      const ids = [
        ...new Set(
          order.purchasedItems
            .map((p) => p.productId?.toString())
            .filter(Boolean)
        ),
      ];

      if (ids.length < MIN_ORDER_THRESHOLD) continue;

      // Record every unordered pair
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i];
          const b = ids[j];

          if (!co[a]) co[a] = {};
          if (!co[b]) co[b] = {};

          co[a][b] = (co[a][b] || 0) + 1;
          co[b][a] = (co[b][a] || 0) + 1;
        }
      }
    }

    const productIds = Object.keys(co);
    if (!productIds.length) {
      console.log("[OftenBoughtTogether] No co-purchase data found.");
      return;
    }

    // Build bulk update operations
    const bulkOps = productIds.map((productId) => {
      // Sort partners by co-occurrence count desc, take top N
      const topPartners = Object.entries(co[productId])
        .sort(([, countA], [, countB]) => countB - countA)
        .slice(0, MAX_SUGGESTIONS)
        .map(([partnerId]) => partnerId);

      return {
        updateOne: {
          filter: { _id: productId },
          update: { $set: { oftenBoughtTogetherId: topPartners } },
        },
      };
    });

    await Product.bulkWrite(bulkOps);

    console.log(
      `[OftenBoughtTogether] Updated ${bulkOps.length} products.`
    );
  } catch (err) {
    console.error("[OftenBoughtTogether] Computation failed:", err.message);
  }
};

/**
 * Real-time fallback: compute top co-purchased products for ONE product on demand.
 * Used when oftenBoughtTogetherId is still empty (e.g. brand-new product).
 *
 * @param {string} productId
 * @param {number} limit
 * @returns {string[]} array of product IDs
 */
const getOftenBoughtTogetherForProduct = async (productId, limit = MAX_SUGGESTIONS) => {
  const co = {};

  const orders = await Order.find({
    status: "Completed",
    "purchasedItems.productId": productId,
  })
    .select("purchasedItems")
    .lean();

  for (const order of orders) {
    const ids = order.purchasedItems
      .map((p) => p.productId?.toString())
      .filter((id) => id && id !== productId.toString());

    for (const id of ids) {
      co[id] = (co[id] || 0) + 1;
    }
  }

  return Object.entries(co)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([id]) => id);
};

module.exports = {
  computeAndSaveOftenBoughtTogether,
  getOftenBoughtTogetherForProduct,
};
