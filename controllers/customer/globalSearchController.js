const Merchant = require("../../models/Merchant");
const Product = require("../../models/Product");
const Category = require("../../models/Category");
const BusinessCategory = require("../../models/BusinessCategory");
const appError = require("../../utils/appError");

const globalSearchController = async (req, res, next) => {
  try {
    let { query = "" } = req.query;

    query = query.trim();

    if (!query || query.length < 2) {
      return res.status(200).json({
        merchants: [],
        products: [],
        categories: [],
        businessCategories: [],
      });
    }

    const searchRegex = { $regex: query, $options: "i" };

    const [merchants, businessCategories, products, merchantCategories] =
      await Promise.all([
        Merchant.find({
          isApproved: "Approved",
          isBlocked: false,
          "merchantDetail.merchantName": { $exists: true, $ne: null },
          $or: [
            { "merchantDetail.merchantName": searchRegex },
            { "merchantDetail.description": searchRegex },
          ],
        })
          .select(
            "_id merchantDetail.merchantName merchantDetail.merchantImageURL " +
              "merchantDetail.displayAddress merchantDetail.averageRating " +
              "merchantDetail.businessCategoryId status openedToday"
          )
          .lean(),

        BusinessCategory.find({
          status: true,
          title: searchRegex,
        })
          .select("_id title bannerImageURL")
          .lean(),

        Product.find({
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

      const merchantDocs = await Merchant.find({
        _id: { $in: merchantIds },
        isApproved: "Approved",
        isBlocked: false,
      })
        .select(
          "_id merchantDetail.merchantName merchantDetail.merchantImageURL " +
            "status openedToday"
        )
        .lean();

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

      const catMerchantDocs = await Merchant.find({
        _id: { $in: catMerchantIds },
        isApproved: "Approved",
        isBlocked: false,
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
