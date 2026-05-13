const mongoose = require("mongoose");

const Merchant = require("../../models/Merchant");
const Product = require("../../models/Product");
const Category = require("../../models/Category");
const BusinessCategory = require("../../models/BusinessCategory");
const Customer = require("../../models/Customer");
const appError = require("../../utils/appError");

/**
 * GET /api/v1/customers/global-search
 *
 * Query params:
 *   query        {string}  required  – search term
 *   latitude     {number}  optional  – customer's latitude  (for geofence filter)
 *   longitude    {number}  optional  – customer's longitude (for geofence filter)
 *   limit        {number}  optional  – max results per section (default 5)
 *
 * Response sections (only populated when there are matches):
 *   merchants        – matched merchant stores
 *   products         – matched products (with owning merchant info)
 *   categories       – matched merchant sub-categories (e.g. "Burgers", "Drinks")
 *   businessCategories – matched top-level business categories (e.g. "Food", "Grocery")
 *
 * Every result carries a `navigate` object so the app can jump straight to the
 * correct screen without additional look-ups.
 */
const globalSearchController = async (req, res, next) => {
  try {
    let { query = "", latitude, longitude, limit = 5 } = req.query;

    query = query.trim();
    limit = Math.min(parseInt(limit, 10) || 5, 20); // cap at 20 per section

    if (!query || query.length < 2) {
      return res.status(200).json({
        merchants: [],
        products: [],
        categories: [],
        businessCategories: [],
      });
    }

    const searchRegex = { $regex: query, $options: "i" };
    const customerId = req.userAuth; // may be null (loosely authenticated)

    // ── Resolve customer's geofence ──────────────────────────────────────────
    let customerGeofenceId = null;
    if (customerId) {
      const customer = await Customer.findById(customerId)
        .select("customerDetails.geofenceId")
        .lean();
      customerGeofenceId = customer?.customerDetails?.geofenceId || null;
    }

    // ── Base merchant filter (always applied) ────────────────────────────────
    const baseMerchantFilter = {
      isApproved: "Approved",
      isBlocked: false,
      "merchantDetail.merchantName": { $exists: true, $ne: null },
    };

    // Narrow to customer's geofence if known
    if (customerGeofenceId) {
      baseMerchantFilter["merchantDetail.geofenceId"] = customerGeofenceId;
    }

    // ── Run all four searches in parallel ────────────────────────────────────
    const [merchants, businessCategories, products, merchantCategories] =
      await Promise.all([

        // 1. Merchants — match on store name or description
        Merchant.find({
          ...baseMerchantFilter,
          $or: [
            { "merchantDetail.merchantName": searchRegex },
            { "merchantDetail.description": searchRegex },
          ],
        })
          .select(
            "_id merchantDetail.merchantName merchantDetail.merchantImageURL " +
              "merchantDetail.displayAddress merchantDetail.averageRating " +
              "merchantDetail.businessCategoryId merchantDetail.geofenceId " +
              "status openedToday"
          )
          .limit(limit)
          .lean(),

        // 2. Business categories — top-level (Food, Grocery, Pharmacy …)
        BusinessCategory.find({
          status: true,
          title: searchRegex,
          ...(customerGeofenceId
            ? { geofenceId: customerGeofenceId }
            : {}),
        })
          .select("_id title bannerImageURL")
          .limit(limit)
          .lean(),

        // 3. Products — match on name or search tags
        Product.find({
          $or: [
            { productName: searchRegex },
            { searchTags: searchRegex },
          ],
        })
          .select(
            "_id productName productImageURL price type categoryId"
          )
          .limit(limit * 3) // fetch more; we'll resolve merchants below
          .lean(),

        // 4. Merchant categories (sub-categories like "Burgers", "Drinks")
        Category.find({
          status: true,
          categoryName: searchRegex,
        })
          .select(
            "_id categoryName categoryImageURL merchantId businessCategoryId type"
          )
          .limit(limit * 3) // fetch more; we'll resolve merchants below
          .lean(),
      ]);

    // ── Enrich products with merchant + category info ────────────────────────
    let enrichedProducts = [];
    if (products.length) {
      console.log(`[GlobalSearch] products raw hits: ${products.length}`);

      const catIds = [
        ...new Set(products.map((p) => p.categoryId?.toString())),
      ].filter(Boolean);

      console.log(`[GlobalSearch] unique catIds: ${catIds.length}`, catIds);

      const catDocs = await Category.find({ _id: { $in: catIds } })
        .select("_id merchantId businessCategoryId categoryName")
        .lean();

      console.log(`[GlobalSearch] catDocs found: ${catDocs.length}`);

      const catMap = Object.fromEntries(
        catDocs.map((c) => [c._id.toString(), c])
      );

      const merchantIds = [
        ...new Set(catDocs.map((c) => c.merchantId?.toString())),
      ].filter(Boolean);

      console.log(
        `[GlobalSearch] unique merchantIds: ${merchantIds.length}`,
        merchantIds
      );

      const merchantFilter = {
        _id: { $in: merchantIds },
        isApproved: "Approved",
        isBlocked: false,
        ...(customerGeofenceId
          ? { "merchantDetail.geofenceId": customerGeofenceId }
          : {}),
      };

      console.log(`[GlobalSearch] merchantFilter:`, JSON.stringify(merchantFilter));

      const merchantDocs = await Merchant.find(merchantFilter)
        .select(
          "_id merchantDetail.merchantName merchantDetail.merchantImageURL " +
            "status openedToday"
        )
        .lean();

      console.log(`[GlobalSearch] merchantDocs found: ${merchantDocs.length}`);

      const merchantMap = Object.fromEntries(
        merchantDocs.map((m) => [m._id.toString(), m])
      );

      enrichedProducts = products
        .map((product) => {
          const cat = catMap[product.categoryId?.toString()];
          if (!cat) {
            console.log(`[GlobalSearch] no category for product ${product._id} (catId: ${product.categoryId})`);
            return null;
          }

          const merchantKey = cat.merchantId?.toString();
          const merchant = merchantMap[merchantKey];
          if (!merchant) {
            console.log(`[GlobalSearch] no merchant for product ${product._id} (merchantId: ${merchantKey})`);
            return null;
          }

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
        .filter(Boolean)
        .slice(0, limit);

      console.log(`[GlobalSearch] enrichedProducts final: ${enrichedProducts.length}`);
    }

    // ── Enrich merchant categories with their merchant info ──────────────────
    let enrichedCategories = [];
    if (merchantCategories.length) {
      const catMerchantIds = [
        ...new Set(merchantCategories.map((c) => c.merchantId)),
      ].filter(Boolean);

      const catMerchantDocs = await Merchant.find({
        _id: { $in: catMerchantIds },
        isApproved: "Approved",
        isBlocked: false,
        ...(customerGeofenceId
          ? { "merchantDetail.geofenceId": customerGeofenceId }
          : {}),
      })
        .select(
          "_id merchantDetail.merchantName merchantDetail.merchantImageURL " +
            "merchantDetail.businessCategoryId status openedToday"
        )
        .lean();

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
        .filter(Boolean)
        .slice(0, limit);
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
