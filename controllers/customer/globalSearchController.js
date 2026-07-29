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
                  { $in: ["$_id", "$$pricingIds"] },
                  { $eq: ["$userId", "$$merchantId"] },
                  { $eq: ["$typeOfUser", "Merchant"] },
                  { $eq: ["$paymentStatus", "Paid"] },
                  { $gte: ["$endDate", now] },
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
                  { $in: ["$_id", "$$commissionIds"] },
                  { $eq: ["$merchantId", "$$merchantId"] },
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

/**
 * Builds a merchant aggregate pipeline for search with the given $match stage,
 * active pricing validation, field projection, and pagination.
 *
 * @param {Object} matchStage - The $match stage for filtering merchants
 * @param {number} skip - Number of docs to skip
 * @param {number} limit - Max docs to return
 * @returns {Array} Aggregation pipeline
 */
const buildMerchantSearchPipeline = (matchStage, skip, limit) => [
  { $match: matchStage },
  ...getActiveMerchantPricingPipeline(),
  { $project: { _id: 1, "merchantDetail.merchantName": 1, "merchantDetail.merchantImageURL": 1, "merchantDetail.displayAddress": 1, "merchantDetail.averageRating": 1, "merchantDetail.businessCategoryId": 1, status: 1, openedToday: 1 } },
  { $skip: skip },
  { $limit: limit },
];

const globalSearchController = async (req, res, next) => {
  try {
    let { query = "", serviceId, page = 1, limit = 20 } = req.query;

    // Coerce pagination params
    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (page - 1) * limit;

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

    // ── Build common match stages for merchants ──────────────────────
    const merchantMatch = {
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
    };

    // ── Fire all queries in parallel ─────────────────────────────────
    const [merchants, businessCategories, products, merchantCategories, merchantCount, businessCategoryCount, productCount, merchantCategoryCount] =
      await Promise.all([
        // ═══════════════════════════════════════════════════════════════
        // PAGINATED MERCHANT SEARCH
        // ═══════════════════════════════════════════════════════════════
        Merchant.aggregate(buildMerchantSearchPipeline(merchantMatch, skip, limit)),

        // ═══════════════════════════════════════════════════════════════
        // PAGINATED BUSINESS CATEGORY SEARCH
        // ═══════════════════════════════════════════════════════════════
        BusinessCategory.find({
          status: true,
          title: searchRegex,
          ...(businessCategoryIds.length > 0 && {
            _id: { $in: businessCategoryIds },
          }),
        })
          .select("_id title bannerImageURL")
          .skip(skip)
          .limit(limit)
          .lean(),

        // ═══════════════════════════════════════════════════════════════
        // PAGINATED PRODUCT SEARCH
        // ═══════════════════════════════════════════════════════════════
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
          .skip(skip)
          .limit(limit)
          .lean(),

        // ═══════════════════════════════════════════════════════════════
        // PAGINATED CATEGORY SEARCH
        // ═══════════════════════════════════════════════════════════════
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
          .skip(skip)
          .limit(limit)
          .lean(),

        // ═══════════════════════════════════════════════════════════════
        // MERCHANT COUNT
        // ═══════════════════════════════════════════════════════════════
        Merchant.aggregate([
          { $match: merchantMatch },
          ...getActiveMerchantPricingPipeline(),
          { $count: "total" },
        ]),

        // ═══════════════════════════════════════════════════════════════
        // BUSINESS CATEGORY COUNT
        // ═══════════════════════════════════════════════════════════════
        BusinessCategory.countDocuments({
          status: true,
          title: searchRegex,
          ...(businessCategoryIds.length > 0 && {
            _id: { $in: businessCategoryIds },
          }),
        }),

        // ═══════════════════════════════════════════════════════════════
        // PRODUCT COUNT
        // ═══════════════════════════════════════════════════════════════
        Product.countDocuments({
          ...(validCategoryIds.length > 0 && {
            categoryId: { $in: validCategoryIds },
          }),
          $or: [
            { productName: searchRegex },
            { searchTags: searchRegex },
          ],
        }),

        // ═══════════════════════════════════════════════════════════════
        // CATEGORY COUNT
        // ═══════════════════════════════════════════════════════════════
        Category.countDocuments({
          status: true,
          categoryName: searchRegex,
          ...(businessCategoryIds.length > 0 && {
            businessCategoryId: { $in: businessCategoryIds },
          }),
        }),
      ]);

    // ── Parse counts ─────────────────────────────────────────────────
    const totalMerchants = merchantCount.length > 0 ? merchantCount[0].total : 0;
    const totalBusinessCategories = businessCategoryCount;
    const totalProducts = productCount;
    const totalCategories = merchantCategoryCount;

    // ── Pagination metadata ──────────────────────────────────────────
    const pagination = {
      merchants: {
        total: totalMerchants,
        page,
        limit,
        totalPages: Math.ceil(totalMerchants / limit) || 1,
      },
      businessCategories: {
        total: totalBusinessCategories,
        page,
        limit,
        totalPages: Math.ceil(totalBusinessCategories / limit) || 1,
      },
      products: {
        total: totalProducts,
        page,
        limit,
        totalPages: Math.ceil(totalProducts / limit) || 1,
      },
      categories: {
        total: totalCategories,
        page,
        limit,
        totalPages: Math.ceil(totalCategories / limit) || 1,
      },
    };

    // ── Enrich products with merchant + category info ────────────────
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

      const merchantDocs = await Merchant.aggregate([
        {
          $match: {
            _id: { $in: merchantIds },
            isApproved: "Approved",
            isBlocked: false,
          },
        },
        ...getActiveMerchantPricingPipeline(),
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

    // ── Enrich merchant categories with their merchant info ──────────
    let enrichedCategories = [];
    if (merchantCategories.length) {
      const catMerchantIds = [
        ...new Set(merchantCategories.map((c) => c.merchantId)),
      ].filter(Boolean);

      const catMerchantDocs = await Merchant.aggregate([
        {
          $match: {
            _id: { $in: catMerchantIds },
            isApproved: "Approved",
            isBlocked: false,
          },
        },
        ...getActiveMerchantPricingPipeline(),
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

    // ── Shape merchant results ───────────────────────────────────────
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

    // ── Shape business category results ──────────────────────────────
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

    // ── Build response ───────────────────────────────────────────────
    return res.status(200).json({
      query,
      pagination,
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