const Merchant = require("../../models/Merchant");
const Product = require("../../models/Product");
const Category = require("../../models/Category");
const BusinessCategory = require("../../models/BusinessCategory");
const SubscriptionLog = require("../../models/SubscriptionLog");
const Commission = require("../../models/Commission");
const appError = require("../../utils/appError");

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Active Merchant Pricing Filter Pipeline
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Returns MongoDB aggregation pipeline stages that filter merchants to only
 * those with ACTIVE pricing plans (Subscription OR Commission).
 *
 * Business Logic:
 * - Merchants can have two types of pricing in merchantDetail.pricing array:
 *   1. Subscription: Time-limited plan requiring payment validation
 *   2. Commission: Ongoing plan requiring only existence validation
 *
 * A merchant is considered "active" if they have EITHER:
 * - At least one paid, non-expired subscription
 * - OR at least one commission plan configured
 * - OR both
 *
 * Pipeline Performance:
 * - Stage 0: Pre-filters merchants without Subscription/Commission (saves expensive lookups)
 * - Stage 1: Extracts modelIds from pricing array for both types
 * - Stage 2-3: Performs $lookup joins to validate subscription/commission
 * - Stage 4: Applies OR logic to keep merchants with either valid plan
 * - Stage 5: Cleans up temporary fields
 *
 * @returns {Array} MongoDB aggregation pipeline stages
 */
const getActiveMerchantPricingPipeline = () => {
  const now = new Date();

  return [
    // ─────────────────────────────────────────────────────────────────
    // Stage 0: EARLY FILTER - Drop merchants without sub/commission plans
    // ─────────────────────────────────────────────────────────────────
    // Checks if pricing array contains at least one entry with modelType
    // "Subscription" or "Commission". This pre-filter significantly improves
    // performance by eliminating merchants that would fail anyway, avoiding
    // expensive $lookup operations on documents with no pricing.
    {
      $match: {
        "merchantDetail.pricing.modelType": {
          $in: ["Subscription", "Commission"],
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Stage 1: EXTRACT MODEL IDs - Separate subscription & commission IDs
    // ─────────────────────────────────────────────────────────────────
    // Creates two temporary arrays by filtering merchantDetail.pricing:
    // - subscriptionModelIds: IDs of SubscriptionLog documents
    // - commissionModelIds: IDs of Commission documents
    // These IDs will be used in subsequent $lookup stages for validation.
      {
        $addFields: {
          subscriptionModelIds: {
            $map: {
              input: {
                $filter: {
                  input: { $ifNull: ["$merchantDetail.pricing", []] },
                  as: "pricing",
                  cond: { $eq: ["$$pricing.modelType", "Subscription"] },
                },
              },
              as: "pricing",
              in: "$$pricing.modelId",
            },
          },
          commissionModelIds: {
            $map: {
              input: {
                $filter: {
                  input: { $ifNull: ["$merchantDetail.pricing", []] },
                  as: "pricing",
                  cond: { $eq: ["$$pricing.modelType", "Commission"] },
                },
              },
              as: "pricing",
              in: "$$pricing.modelId",
            },
          },
        },
      },

    // ─────────────────────────────────────────────────────────────────
    // Stage 2: LOOKUP ACTIVE SUBSCRIPTIONS - Validate subscription plans
    // ─────────────────────────────────────────────────────────────────
    // Joins with subscriptionlogs collection using correlated subquery.
    // A subscription is considered ACTIVE only if ALL conditions are met:
    // 1. SubscriptionLog._id is IN the merchant's subscriptionModelIds array
    // 2. SubscriptionLog.userId matches the merchant's _id
    // 3. SubscriptionLog.typeOfUser is "Merchant" (not Customer)
    // 4. SubscriptionLog.paymentStatus is "Paid" (not Pending/Unpaid)
    // 5. SubscriptionLog.endDate >= current date (not expired)
    //
    // Result: activeSubscriptions array contains matching docs (0 or more)
    {
      $lookup: {
        from: "subscriptionlogs",
        let: {
          merchantId: "$_id",
          pricingIds: "$subscriptionModelIds",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$pricingIds"] }, // ID matches pricing array
                  { $eq: ["$userId", "$$merchantId"] }, // Belongs to merchant
                  { $eq: ["$typeOfUser", "Merchant"] }, // Is merchant subscription
                  { $eq: ["$paymentStatus", "Paid"] }, // Payment completed
                  { $gte: ["$endDate", now] }, // Not expired
                ],
              },
            },
          },
        ],
        as: "activeSubscriptions",
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Stage 3: LOOKUP COMMISSIONS - Validate commission plans
    // ─────────────────────────────────────────────────────────────────
    // Joins with commissions collection using correlated subquery.
    // A commission is considered ACTIVE if:
    // 1. Commission._id is IN the merchant's commissionModelIds array
    // 2. Commission.merchantId matches the merchant's _id
    //
    // No date/status validation needed - commission plans are perpetual
    // once configured. Result: activeCommissions array (0 or more docs)
    {
      $lookup: {
        from: "commissions",
        let: {
          merchantId: "$_id",
          commissionIds: "$commissionModelIds",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$commissionIds"] }, // ID matches pricing array
                  { $eq: ["$merchantId", "$$merchantId"] }, // Belongs to merchant
                ],
              },
            },
          },
        ],
        as: "activeCommissions",
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Stage 4: OR FILTER - Keep merchants with EITHER active plan
    // ─────────────────────────────────────────────────────────────────
    // Applies OR logic: merchant passes if they have:
    // - At least 1 active subscription (array size > 0)
    // - OR at least 1 commission plan (array size > 0)
    // - OR both
    //
    // Merchants with only expired subscriptions and no commission are filtered out
    {
      $match: {
        $expr: {
          $or: [
            { $gt: [{ $size: "$activeSubscriptions" }, 0] },
            { $gt: [{ $size: "$activeCommissions" }, 0] },
          ],
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Stage 5: CLEANUP - Remove temporary fields
    // ─────────────────────────────────────────────────────────────────
    // Removes temporary arrays added during pipeline processing to keep
    // the output document clean and matching expected schema
    {
      $project: {
        subscriptionModelIds: 0,
        commissionModelIds: 0,
        activeSubscriptions: 0,
        activeCommissions: 0,
      },
    },
  ];
};

const globalSearchController = async (req, res, next) => {
  try {
    let { query = "", serviceId } = req.query;

    query = query.trim();

    if (!query || query.length < 2) {
      return res.status(200).json({
        merchants: [],
        products: [],
        categories: [],
        businessCategories: [],
      });
    }

    // Get business categories for the specified service
    let businessCategoryIds = [];
    if (serviceId) {
      const businessCategories = await BusinessCategory.find({
        serviceId: serviceId,
        status: true,
      })
        .select("_id")
        .lean();

      businessCategoryIds = businessCategories.map((cat) => cat._id);

      // If no business categories found for this service, return empty results
      if (businessCategoryIds.length === 0) {
        return res.status(200).json({
          query,
          merchants: [],
          products: [],
          categories: [],
          businessCategories: [],
        });
      }
    }

    // Get valid category IDs if filtering by service
    let validCategoryIds = [];
    if (businessCategoryIds.length > 0) {
      const validCategories = await Category.find({
        businessCategoryId: { $in: businessCategoryIds },
      })
        .select("_id")
        .lean();

      validCategoryIds = validCategories.map((cat) => cat._id);
    }

    const searchRegex = { $regex: query, $options: "i" };

    const [merchants, businessCategories, products, merchantCategories] =
      await Promise.all([
        // ═══════════════════════════════════════════════════════════════
        // MAIN MERCHANT SEARCH - Now filters by active pricing (Subscription/Commission)
        // ═══════════════════════════════════════════════════════════════
        // Converted from .find() to .aggregate() to apply pricing validation pipeline.
        // This ensures only merchants with active subscriptions OR commission plans appear
        // in search results, preventing customers from seeing inactive merchants.
        //
        // Pipeline flow:
        // 1. $match: Apply original search/filter criteria
        // 2. getActiveMerchantPricingPipeline(): Validate subscription/commission
        // 3. $project: Select only required fields (replaces .select())
        Merchant.aggregate([
          // Stage 1: Original search criteria (replaces .find() filter)
          {
            $match: {
              isApproved: "Approved",
              isBlocked: false,
              "merchantDetail.merchantName": { $exists: true, $ne: null },
              ...(businessCategoryIds.length > 0 && {
                "merchantDetail.businessCategoryId": {
                  $in: businessCategoryIds,
                },
              }),
              $or: [
                { "merchantDetail.merchantName": searchRegex },
                { "merchantDetail.description": searchRegex },
              ],
            },
          },
          // Stage 2-6: Active pricing validation pipeline
          ...getActiveMerchantPricingPipeline(),
          // Stage 7: Field selection (replaces .select())
          {
            $project: {
              _id: 1,
              "merchantDetail.merchantName": 1,
              "merchantDetail.merchantImageURL": 1,
              "merchantDetail.displayAddress": 1,
              "merchantDetail.averageRating": 1,
              "merchantDetail.businessCategoryId": 1,
              status: 1,
              openedToday: 1,
            },
          },
        ]),

        BusinessCategory.find({
          status: true,
          title: searchRegex,
          ...(businessCategoryIds.length > 0 && {
            _id: { $in: businessCategoryIds },
          }),
        })
          .select("_id title bannerImageURL")
          .lean(),

        Product.find({
          ...(validCategoryIds.length > 0 && {
            categoryId: { $in: validCategoryIds },
          }),
          $or: [
            { productName: searchRegex },
            { searchTags: searchRegex },
          ],
        })
          .select("_id productName productImageURL price type categoryId")
          .lean(),

        Category.find({
          status: true,
          categoryName: searchRegex,
          ...(businessCategoryIds.length > 0 && {
            businessCategoryId: { $in: businessCategoryIds },
          }),
        })
          .select(
            "_id categoryName categoryImageURL merchantId businessCategoryId type"
          )
          .lean(),
      ]);

    // ── Enrich products with merchant + category info ────────────────────────
    let enrichedProducts = [];
    if (products.length) {
      const catIds = [
        ...new Set(products.map((p) => p.categoryId?.toString())),
      ].filter(Boolean);

      const catDocs = await Category.find({ _id: { $in: catIds } })
        .select("_id merchantId businessCategoryId categoryName")
        .lean();

      const catMap = Object.fromEntries(
        catDocs.map((c) => [c._id.toString(), c])
      );

      const merchantIds = [
        ...new Set(catDocs.map((c) => c.merchantId?.toString())),
      ].filter(Boolean);

      // ═══════════════════════════════════════════════════════════════
      // PRODUCT ENRICHMENT - Fetch merchants with active pricing validation
      // ═══════════════════════════════════════════════════════════════
      // Ensures product results only show merchants with active subscriptions
      // or commission plans. Without this, products from inactive merchants
      // would appear in search results, creating poor user experience.
      const merchantDocs = await Merchant.aggregate([
        // Stage 1: Filter by merchant IDs from products
        {
          $match: {
            _id: { $in: merchantIds },
            isApproved: "Approved",
            isBlocked: false,
          },
        },
        // Stage 2-6: Active pricing validation
        ...getActiveMerchantPricingPipeline(),
        // Stage 7: Select required fields
        {
          $project: {
            _id: 1,
            "merchantDetail.merchantName": 1,
            "merchantDetail.merchantImageURL": 1,
            status: 1,
            openedToday: 1,
          },
        },
      ]);

      const merchantMap = Object.fromEntries(
        merchantDocs.map((m) => [m._id.toString(), m])
      );

      enrichedProducts = products
        .map((product) => {
          const cat = catMap[product.categoryId?.toString()];
          if (!cat) return null;

          const merchantKey = cat.merchantId?.toString();
          const merchant = merchantMap[merchantKey];
          if (!merchant) return null;

          return {
            type: "product",
            productId: product._id,
            productName: product.productName,
            productImage: product.productImageURL || null,
            price: product.price,
            foodType: product.type || null,
            categoryId: cat._id,
            categoryName: cat.categoryName,
            merchantId: merchant._id,
            merchantName: merchant.merchantDetail?.merchantName || null,
            merchantImage: merchant.merchantDetail?.merchantImageURL || null,
            businessCategoryId: cat.businessCategoryId || null,
            isOpen: merchant.openedToday && merchant.status,
            navigate: {
              screen: "MerchantPage",
              params: {
                merchantId: merchant._id,
                businessCategoryId: cat.businessCategoryId || null,
                scrollToCategoryId: cat._id,
                highlightProductId: product._id,
              },
            },
          };
        })
        .filter(Boolean);
    }

    // ── Enrich merchant categories with their merchant info ──────────────────
    let enrichedCategories = [];
    if (merchantCategories.length) {
      const catMerchantIds = [
        ...new Set(merchantCategories.map((c) => c.merchantId)),
      ].filter(Boolean);

      // ═══════════════════════════════════════════════════════════════
      // CATEGORY ENRICHMENT - Fetch merchants with active pricing validation
      // ═══════════════════════════════════════════════════════════════
      // Ensures category results only show merchants with active subscriptions
      // or commission plans. This prevents showing categories from merchants
      // who no longer have active pricing, improving search result quality.
      const catMerchantDocs = await Merchant.aggregate([
        // Stage 1: Filter by merchant IDs from categories
        {
          $match: {
            _id: { $in: catMerchantIds },
            isApproved: "Approved",
            isBlocked: false,
          },
        },
        // Stage 2-6: Active pricing validation
        ...getActiveMerchantPricingPipeline(),
        // Stage 7: Select required fields
        {
          $project: {
            _id: 1,
            "merchantDetail.merchantName": 1,
            "merchantDetail.merchantImageURL": 1,
            "merchantDetail.businessCategoryId": 1,
            status: 1,
            openedToday: 1,
          },
        },
      ]);

      const catMerchantMap = Object.fromEntries(
        catMerchantDocs.map((m) => [m._id.toString(), m])
      );

      enrichedCategories = merchantCategories
        .map((cat) => {
          const merchant = catMerchantMap[cat.merchantId?.toString()];
          if (!merchant) return null;

          const businessCategoryId =
            cat.businessCategoryId ||
            merchant.merchantDetail?.businessCategoryId?.[0] ||
            null;

          return {
            type: "category",
            categoryId: cat._id,
            categoryName: cat.categoryName,
            categoryImage: cat.categoryImageURL || null,
            merchantId: merchant._id,
            merchantName: merchant.merchantDetail?.merchantName || null,
            merchantImage: merchant.merchantDetail?.merchantImageURL || null,
            businessCategoryId,
            isOpen: merchant.openedToday && merchant.status,
            navigate: {
              screen: "MerchantPage",
              params: {
                merchantId: merchant._id,
                businessCategoryId,
                scrollToCategoryId: cat._id,
              },
            },
          };
        })
        .filter(Boolean);
    }

    // ── Shape merchant results ───────────────────────────────────────────────
    const formattedMerchants = merchants.map((m) => ({
      type: "merchant",
      merchantId: m._id,
      merchantName: m.merchantDetail?.merchantName || null,
      merchantImage: m.merchantDetail?.merchantImageURL || null,
      displayAddress: m.merchantDetail?.displayAddress || null,
      rating: m.merchantDetail?.averageRating || 0,
      isOpen: m.openedToday && m.status,
      businessCategoryId: m.merchantDetail?.businessCategoryId?.[0] || null,
      navigate: {
        screen: "MerchantPage",
        params: {
          merchantId: m._id,
          businessCategoryId: m.merchantDetail?.businessCategoryId?.[0] || null,
        },
      },
    }));

    // ── Shape business category results ──────────────────────────────────────
    const formattedBusinessCategories = businessCategories.map((bc) => ({
      type: "businessCategory",
      businessCategoryId: bc._id,
      title: bc.title,
      bannerImage: bc.bannerImageURL || null,
      navigate: {
        screen: "BusinessCategoryPage",
        params: {
          businessCategoryId: bc._id,
        },
      },
    }));

    // ── Build response ───────────────────────────────────────────────────────
    return res.status(200).json({
      query,
      merchants: formattedMerchants,
      products: enrichedProducts,
      categories: enrichedCategories,
      businessCategories: formattedBusinessCategories,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = { globalSearchController };
