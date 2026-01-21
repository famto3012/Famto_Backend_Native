const mongoose = require("mongoose");
const turf = require("@turf/turf");
const { validationResult } = require("express-validator");

const Task = require("../../models/Task");
const Order = require("../../models/Order");
const Product = require("../../models/Product");
const Category = require("../../models/Category");
const Customer = require("../../models/Customer");
const Merchant = require("../../models/Merchant");
const PromoCode = require("../../models/PromoCode");
const ActivityLog = require("../../models/ActivityLog");
const CustomerCart = require("../../models/CustomerCart");
const ScheduledOrder = require("../../models/ScheduledOrder");
const TemporaryOrder = require("../../models/TemporaryOrder");
const SubscriptionLog = require("../../models/SubscriptionLog");
const BusinessCategory = require("../../models/BusinessCategory");
const CustomerTransaction = require("../../models/CustomerTransactionDetail");
const CustomerWalletTransaction = require("../../models/CustomerWalletTransaction");

const {
  sortMerchantsBySponsorship,
  getDistanceFromPickupToDelivery,
  calculateDiscountedPrice,
  filterProductIdAndQuantity,
  fetchCustomerAndMerchantAndCart,
  processVoiceInstructions,
  getDiscountAmountFromLoyalty,
} = require("../../utils/customerAppHelpers");
const {
  createRazorpayOrderId,
  verifyPayment,
  razorpayRefund,
} = require("../../utils/razorpayPayment");
const { formatDate, formatTime } = require("../../utils/formatters");
const appError = require("../../utils/appError");
const { geoLocation } = require("../../utils/getGeoLocation");
const {
  validateDeliveryOption,
  processHomeDeliveryDetailInApp,
  calculateDeliveryChargesHelper,
  applyDiscounts,
  calculateBill,
  processScheduledDelivery,
} = require("../../utils/createOrderHelpers");
const { sendSocketDataAndNotification } = require("../../utils/socketHelper");

const { findRolesToNotify } = require("../../socket/socket");

// Get all available business categories according to the order
const getAllBusinessCategoryController = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude)
      return next(appError("Latitude & Longitude are required", 400));

    const geofence = await geoLocation(latitude, longitude);

    if (!geofence) return res.status(200).json({ outside: true, data: [] });

    const allBusinessCategories = await BusinessCategory.find({
      status: true,
      geofenceId: { $in: [geofence._id] },
    })
      .select("title bannerImageURL")
      .sort({ order: 1 });

    const formattedResponse = allBusinessCategories?.map((category) => {
      return {
        id: category._id,
        title: category.title,
        bannerImageURL: category.bannerImageURL,
      };
    });

    res.status(200).json({
      outside: false,
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// search for Business category in the home
const homeSearchController = async (req, res, next) => {
  const { query } = req.query;

  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude)
      return next(appError("Latitude & Longitude are required", 400));

    const geofence = await geoLocation(latitude, longitude);

    if (!geofence)
      return next(appError("Customer is outside the listed geofences", 500));

    // Search in BusinessCategory by title
    const businessCategories = await BusinessCategory.find({
      title: { $regex: query, $options: "i" },
      status: true,
      geofenceId: { $in: [geofence._id] },
    })
      .select("title bannerImageURL")
      .exec();

    const formattedResponse = businessCategories?.map((category) => {
      return {
        id: category._id,
        title: category.title,
        bannerImageURL: category.bannerImageURL,
      };
    });

    res.status(200).json({
      message: "Search results",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// List the available restaurants in the customers geofence
const listRestaurantsController = async (req, res, next) => {
  let {
    latitude,
    longitude,
    businessCategoryId,
    page = 1,
    limit = 10,
    query,
  } = req.query;

  try {
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const customerId = req.userAuth;

    let currentCustomer;

    if (customerId) {
      currentCustomer = await Customer.findById(customerId)
        .select("customerDetails.favoriteMerchants")
        .exec();

      if (!currentCustomer) return next(appError("Customer not found", 404));
    }

    const customerLocation = [latitude, longitude];

    const foundGeofence = await geoLocation(latitude, longitude);

    if (!foundGeofence) return next(appError("Geofence not found", 404));

    const merchants = await Merchant.find({
      "merchantDetail.geofenceId": foundGeofence._id,
      "merchantDetail.businessCategoryId": { $in: [businessCategoryId] },
      "merchantDetail.pricing.0": { $exists: true },
      "merchantDetail.pricing.modelType": { $exists: true },
      "merchantDetail.pricing.modelId": { $exists: true },
      "merchantDetail.location": { $ne: [] },
      isBlocked: false,
      isApproved: "Approved",
    })
      .skip(skip)
      .limit(limit)
      .lean();

    const filteredMerchants = merchants?.filter((merchant) => {
      const servingRadius = merchant.merchantDetail.servingRadius || 0;
      if (servingRadius > 0) {
        const merchantLocation = merchant.merchantDetail.location;
        const distance = turf.distance(
          turf.point(merchantLocation),
          turf.point(customerLocation),
          { units: "kilometers" }
        );
        return distance <= servingRadius;
      }
      return true;
    });

    const sortedMerchants = await sortMerchantsBySponsorship(filteredMerchants);

    const openedMerchantsFirst = sortedMerchants.sort((a, b) => {
      return b.status - a.status;
    });

    const simplifiedMerchants = await Promise.all(
      openedMerchantsFirst.map(async (merchant) => {
        return {
          id: merchant._id,
          merchantName: merchant?.merchantDetail?.merchantName || null,
          description: merchant?.merchantDetail?.description || null,
          averageRating: merchant?.merchantDetail?.averageRating,
          status: merchant?.status,
          restaurantType: merchant?.merchantDetail?.merchantFoodType || null,
          merchantImageURL:
            merchant?.merchantDetail?.merchantImageURL ||
            "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FMerchantDefaultImage.png?alt=media&token=a7a11e18-047c-43d9-89e3-8e35d0a4e231",
          displayAddress: merchant?.merchantDetail?.displayAddress || null,
          preOrderStatus: merchant?.merchantDetail?.preOrderStatus,
          isFavorite:
            currentCustomer?.customerDetails?.favoriteMerchants?.some(
              (favorite) => favorite?.merchantId === merchant?._id
            ) ?? false,
        };
      })
    );

    res.status(200).json(simplifiedMerchants);
  } catch (err) {
    next(appError(err.message));
  }
};

// Get all categories of merchant
const getAllCategoriesOfMerchants = async (req, res, next) => {
  try {
    let { merchantId, businessCategoryId, page = 1, limit = 1 } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const skip = (page - 1) * limit;

    const category = await Category.find({
      businessCategoryId,
      merchantId,
    })
      .select("categoryName status")
      .sort({
        order: 1,
      })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedResponse = category?.map((category) => {
      return {
        categoryId: category._id,
        categoryName: category?.categoryName || null,
        status: category?.status || null,
      };
    });

    res.status(200).json({
      hasNextPage: formattedResponse.length === limit,
      page,
      limit,
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get all product of a category
const getAllProductsOfMerchantController = async (req, res, next) => {
  try {
    let { categoryId, filter, page = 1, limit = 10 } = req.query;
    const customerId = req.userAuth;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    const skip = (page - 1) * limit;

    const currentCustomer = await Customer.findById(customerId)
      .select("customerDetails.favoriteProducts")
      .lean();

    if (customerId && !currentCustomer)
      return next(appError("Customer not found", 404));

    const matchCriteria = {
      categoryId: mongoose.Types.ObjectId.createFromHexString(categoryId),
    };

    if (filter && filter.toLowerCase() !== "all") {
      matchCriteria.type = filter;
    }

    // Fetch all products
    const allProducts = await Product.find(matchCriteria)
      .populate(
        "discountId",
        "discountName maxAmount discountType discountValue validFrom validTo onAddOn status"
      )
      .sort({ order: 1 })
      .skip(skip)
      .limit(limit);

    const productsWithDetails = allProducts.map((product) => {
      const currentDate = new Date();
      const validFrom = new Date(product?.discountId?.validFrom);
      const validTo = new Date(product?.discountId?.validTo);

      // Adjusting the validTo date to the end of the day
      validTo?.setHours(18, 29, 59, 999);

      let discountPrice = null;

      // Calculate the discount price if applicable
      if (
        product?.discountId &&
        validFrom <= currentDate &&
        validTo >= currentDate &&
        product?.discountId?.status
      ) {
        const discount = product.discountId;

        if (discount.discountType === "Percentage-discount") {
          let discountAmount = (product.price * discount.discountValue) / 100;
          if (discountAmount > discount.maxAmount) {
            discountAmount = discount.maxAmount;
          }
          discountPrice = Math.max(0, product.price - discountAmount);
        } else if (discount.discountType === "Flat-discount") {
          discountPrice = Math.max(0, product.price - discount.discountValue);
        }
      }

      const isFavorite =
        currentCustomer?.customerDetails?.favoriteProducts?.some(
          (fav) => fav.toString() === product._id.toString()
        ) ?? false;

      return {
        productId: product._id,
        productName: product.productName || null,
        price: product.price || null,
        discountPrice: Number(discountPrice?.toFixed(2)) || null,
        minQuantityToOrder: product.minQuantityToOrder || null,
        maxQuantityPerOrder: product.maxQuantityPerOrder || null,
        isFavorite,
        preparationTime: product?.preparationTime
          ? `${product.preparationTime} min`
          : null,
        description: product.description || null,
        longDescription: product.longDescription || null,
        type: product.type || null,
        productImageURL:
          product.productImageURL ||
          "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FProductDefaultImage.png?alt=media&token=044503ee-84c8-487b-9df7-793ad0f70e1c",
        inventory: product.inventory,
        variantAvailable: product.variants && product.variants.length > 0,
      };
    });

    res.status(200).json({
      hasNextPage: productsWithDetails.length === limit,
      page,
      limit,
      data: productsWithDetails,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get merchant data
const getMerchantData = async (req, res, next) => {
  try {
    const { merchantId, latitude, longitude } = req.query;

    const customerId = req.userAuth;

    const [merchantFound, customerFound] = await Promise.all([
      Merchant.findById(merchantId),
      Customer.findById(customerId),
    ]);

    if (!merchantFound) return next(appError("Merchant not found", 404));
    if (customerId && !customerFound)
      return next(appError("Customer not found", 404));

    let distanceInKM = 0;

    if (latitude && longitude) {
      const merchantLocation = merchantFound.merchantDetail.location;
      const customerLocation =
        latitude && longitude
          ? [latitude, longitude]
          : customerFound.customerDetails.location;

      if (merchantLocation.length) {
        const distance = await getDistanceFromPickupToDelivery(
          merchantLocation,
          customerLocation
        );

        distanceInKM = distance.distanceInKM;
      }
    }

    let distanceWarning = false;
    if (distanceInKM > 12) distanceWarning = true;

    let isFavourite = false;

    if (
      customerId &&
      customerFound.customerDetails.favoriteMerchants.some(
        (favorite) => favorite.merchantId === merchantFound._id
      )
    ) {
      isFavourite = true;
    }

    const merchantData = {
      merchantName: merchantFound.merchantDetail.merchantName,
      distanceInKM: distanceInKM || null,
      deliveryTime: merchantFound.merchantDetail.deliveryTime || null,
      description: merchantFound.merchantDetail.description || null,
      displayAddress: merchantFound.merchantDetail.displayAddress || null,
      preOrderStatus: merchantFound.merchantDetail.preOrderStatus || false,
      rating: merchantFound.merchantDetail.averageRating || 0,
      phoneNumber: merchantFound.phoneNumber,
      fssaiNumber: merchantFound.merchantDetail.FSSAINumber || null,
      isFavourite,
      distanceWarning,
      merchantImage: merchantFound.merchantDetail.merchantImageURL || null,
    };

    res.status(200).json(merchantData);
  } catch (err) {
    next(appError(err.message));
  }
};

// Get variants of a product
const getProductVariantsByProductIdController = async (req, res, next) => {
  try {
    const { productId } = req.params;

    const product = await Product.findById(productId)
      .populate(
        "discountId",
        "discountType discountValue maxAmount status validFrom validTo onAddOn"
      )
      .exec();

    if (!product) return next(appError("Product not found", 404));

    const currentDate = new Date();
    const validFrom = new Date(product?.discountId?.validFrom);
    const validTo = new Date(product?.discountId?.validTo);
    validTo?.setHours(18, 29, 59, 999);

    let variantsWithDiscount = product.variants.map((variant) => {
      return {
        ...variant._doc,
        variantTypes: variant.variantTypes.map((variantType) => ({
          ...variantType._doc,
          discountPrice: null, // Default discount price is null
        })),
      };
    });

    // Apply discount if applicable
    if (
      product?.discountId &&
      validFrom <= currentDate &&
      validTo >= currentDate &&
      product?.discountId?.status
    ) {
      const discount = product.discountId;

      if (discount.onAddOn) {
        variantsWithDiscount = product.variants.map((variant) => {
          const variantTypesWithDiscount = variant.variantTypes.map(
            (variantType) => {
              let variantDiscountPrice = variantType.price;
              if (discount.discountType === "Percentage-discount") {
                let discountAmount =
                  (variantType.price * discount.discountValue) / 100;
                if (discountAmount > discount.maxAmount) {
                  discountAmount = discount.maxAmount;
                }
                variantDiscountPrice = Math.max(
                  0,
                  variantType.price - discountAmount
                );
              } else if (discount.discountType === "Flat-discount") {
                variantDiscountPrice = Math.max(
                  0,
                  variantType.price - discount.discountValue
                );
              }

              return {
                ...variantType._doc,
                discountPrice: Number(variantDiscountPrice.toFixed(2)),
              };
            }
          );
          return {
            ...variant._doc,
            variantTypes: variantTypesWithDiscount,
          };
        });
      }
    }

    res.status(200).json({
      message: "Product variants",
      data: variantsWithDiscount,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const distanceCache = {};

const filterAndSearchMerchantController = async (req, res, next) => {
  try {
    let {
      businessCategoryId,
      filterType,
      query = "",
      latitude,
      longitude,
      page = 1,
      limit = 10,
      merchantId,
      productName,
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const cacheKey = `${businessCategoryId}_${latitude}_${longitude}_${query.trim()}_${filterType}_${merchantId}_${productName}`;
    let cachedDistances = distanceCache[cacheKey];

    const customerId = req.userAuth;

    if (!businessCategoryId) {
      return next(appError("Business category is required", 400));
    }

    let customer;
    if (customerId) {
      customer = await Customer.findById(customerId).select("customerDetails");
      if (!customer) return next(appError("Customer not found", 404));
    }

    // const foundGeofence = await geoLocation(latitude, longitude);
    // if (!foundGeofence) {
    //   return next(appError("Geofence not found", 404));
    // }

    const baseCriteria = {
      isBlocked: false,
      isApproved: "Approved",
      // "merchantDetail.geofenceId": foundGeofence._id,
      "merchantDetail.businessCategoryId": { $in: [businessCategoryId] },
      "merchantDetail.location": { $exists: true, $ne: [] },
      "merchantDetail.pricing.0": { $exists: true },
      "merchantDetail.pricing.modelType": { $exists: true },
      "merchantDetail.pricing.modelId": { $exists: true },
    };

    if (query) {
      baseCriteria["merchantDetail.merchantName"] = {
        $regex: query.trim(),
        $options: "i",
      };
    }

    if (filterType?.toLowerCase() === "veg") {
      baseCriteria["merchantDetail.merchantFoodType"] = "Veg";
    } else if (filterType?.toLowerCase() === "rating 4.0+") {
      baseCriteria["merchantDetail.averageRating"] = { $gte: 4.0 };
    }

    let merchants = await Merchant.find(baseCriteria).lean();

    let sortedCount = 0;
    let merchantsWithProducts = [];

    if (productName) {
      const matchingProducts = await Product.find({
        productName: { $regex: productName, $options: "i" },
      }).select("categoryId");

      const categoryIds = matchingProducts.map((product) =>
        product.categoryId.toString()
      );
      const matchingCategories = await Category.find({
        _id: { $in: categoryIds },
      }).select("merchantId");

      const merchantIdsFromProducts = matchingCategories.map((category) =>
        category.merchantId.toString()
      );

      merchantsWithProducts = merchants.filter((merchant) =>
        merchantIdsFromProducts.includes(merchant._id.toString())
      );

      sortedCount = merchantsWithProducts.length;
    }

    // Sort merchants: First by productName match, then by merchantId match
    let sortedMerchants = [
      ...merchantsWithProducts, // Merchants with matching products
      ...merchants.filter((m) => !merchantsWithProducts.includes(m)), // Remaining merchants
    ];

    if (merchantId) {
      sortedMerchants = sortedMerchants.sort((a, b) => {
        if (a._id.toString() === merchantId) {
          sortedCount++;
          return -1;
        }
        if (b._id.toString() === merchantId) return 1;
        return 0;
      });
    }

    if (!cachedDistances) {
      const customerLocation = [latitude, longitude];

      const merchantsWithDistance = await Promise.all(
        sortedMerchants.map(async (merchant) => {
          const merchantLocation = merchant.merchantDetail.location;
          const { distanceInKM: distance } =
            await getDistanceFromPickupToDelivery(
              customerLocation,
              merchantLocation
            );
          return { ...merchant, distance };
        })
      );

      // Cache the distances
      distanceCache[cacheKey] = merchantsWithDistance;
      cachedDistances = merchantsWithDistance;
    }

    cachedDistances.sort((a, b) => {
      if (a.status === true && b.status === false) return -1;
      if (a.status === false && b.status === true) return 1;
      return a.distance - b.distance;
    });

    // Apply pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    const paginatedMerchants = cachedDistances.slice(startIndex, endIndex);

    const responseMerchants = paginatedMerchants.map((merchant) => ({
      id: merchant._id,
      merchantName: merchant.merchantDetail.merchantName,
      description: merchant.merchantDetail.description || "",
      averageRating: merchant.merchantDetail.averageRating || 0,
      status: merchant.status,
      restaurantType: merchant.merchantDetail.merchantFoodType || null,
      merchantImageURL: merchant.merchantDetail.merchantImageURL || null,
      displayAddress: merchant.merchantDetail.displayAddress || null,
      preOrderStatus: merchant.merchantDetail.preOrderStatus,
      distance: merchant.distance,
      isFavorite: customer?.customerDetails?.favoriteMerchants?.some(
        (fav) => fav.merchantId === merchant._id
      ),
    }));

    res.status(200).json(responseMerchants);
  } catch (err) {
    next(appError(err.message));
  }
};

const searchProductsInMerchantToOrderController = async (req, res, next) => {
  try {
    const { merchantId, businessCategoryId } = req.params;
    const { query } = req.query;

    // Find all categories belonging to the merchant with the given business category
    const categories = await Category.find({ merchantId, businessCategoryId });

    // Extract all category ids to search products within all these categories
    const categoryIds = categories.map((category) => category._id.toString());

    // Search products within the found categoryIds
    const products = await Product.find({
      categoryId: { $in: categoryIds },
      $or: [
        { productName: { $regex: query, $options: "i" } },
        { searchTags: { $elemMatch: { $regex: query, $options: "i" } } },
      ],
    })
      .populate(
        "discountId",
        "discountName maxAmount discountType discountValue validFrom validTo onAddOn status"
      )
      .select(
        "_id productName price description discountId productImageURL inventory variants"
      )
      .sort({ order: 1 });

    const currentDate = new Date();

    const formattedResponse = products?.map((product) => {
      const discount = product?.discountId;
      const validFrom = new Date(discount?.validFrom);
      const validTo = new Date(discount?.validTo);
      validTo?.setHours(23, 59, 59, 999); // Adjust validTo to the end of the day

      let discountPrice = null;

      // Check if discount is applicable
      if (
        discount &&
        validFrom <= currentDate &&
        validTo >= currentDate &&
        discount.status
      ) {
        if (discount.onAddOn) {
          // Apply discount to each variant type price if onAddOn is true
          return {
            id: product._id,
            productName: product.productName,
            price: product.price,
            discountPrice: null,
            description: product.description,
            productImageUrl:
              product?.productImageURL ||
              "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FProductDefaultImage.png?alt=media&token=044503ee-84c8-487b-9df7-793ad0f70e1c",
            variants: product.variants.map((variant) => ({
              id: variant._id,
              variantName: variant.variantName,
              variantTypes: variant.variantTypes.map((variantType) => {
                let variantDiscountPrice = null;

                if (discount.discountType === "Percentage-discount") {
                  let discountAmount =
                    (variantType.price * discount.discountValue) / 100;
                  if (discountAmount > discount.maxAmount)
                    discountAmount = discount.maxAmount;
                  variantDiscountPrice = Math.round(
                    Math.max(0, variantType.price - discountAmount)
                  );
                } else if (discount.discountType === "Flat-discount") {
                  variantDiscountPrice = Math.round(
                    Math.max(0, variantType.price - discount.discountValue)
                  );
                }

                return {
                  id: variantType._id,
                  typeName: variantType.typeName,
                  price: variantType.price,
                  discountPrice: variantDiscountPrice,
                };
              }),
            })),
          };
        } else {
          // Apply discount to the main product price if onAddOn is false
          if (discount.discountType === "Percentage-discount") {
            let discountAmount = (product.price * discount.discountValue) / 100;
            if (discountAmount > discount.maxAmount)
              discountAmount = discount.maxAmount;
            discountPrice = Math.round(
              Math.max(0, product.price - discountAmount)
            );
          } else if (discount.discountType === "Flat-discount") {
            discountPrice = Math.round(
              Math.max(0, product.price - discount.discountValue)
            );
          }
        }
      }

      // Return a unified format regardless of discount type or application
      return {
        id: product._id,
        productName: product.productName,
        price: product.price,
        discountPrice, // Null if no discount or discount is applied to variants
        description: product.description,
        productImageUrl:
          product?.productImageURL ||
          "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FProductDefaultImage.png?alt=media&token=044503ee-84c8-487b-9df7-793ad0f70e1c",
        variants: product.variants.map((variant) => ({
          id: variant._id,
          variantName: variant.variantName,
          variantTypes: variant.variantTypes.map((variantType) => ({
            id: variantType._id,
            typeName: variantType.typeName,
            price: variantType.price,
            discountPrice: discount?.onAddOn
              ? variantType.discountPrice || null
              : null,
          })),
        })),
      };
    });

    res.status(200).json({
      message: "Products found in merchant",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Filter and sort products
const filterAndSortAndSearchProductsController = async (req, res, next) => {
  try {
    const { merchantId } = req.params;
    const { filter, sort, productName } = req.query;

    const customerId = req.userAuth;

    let currentCustomer;

    if (customerId) {
      currentCustomer = await Customer.findById(customerId)
        .select("customerDetails.favoriteProducts")
        .lean();

      if (!currentCustomer) return next(appError("Customer not found", 404));
    }

    // Get category IDs associated with the merchant
    const categories = await Category.find({ merchantId }).select("_id");
    const categoryIds = categories.map((category) => category._id);

    // Build the query object
    let query = { categoryId: { $in: categoryIds } };

    // Add filter conditions
    if (filter) {
      if (filter === "Veg") {
        query.type = filter;
      } else if (filter === "Favorite") {
        query._id = { $in: currentCustomer.customerDetails.favoriteProducts };
      }
    }

    if (productName) {
      query.productName = { $regex: productName.trim(), $options: "i" };
    }

    // Build the sort object
    let sortObj = {};
    if (sort) {
      if (sort === "Price - low to high") {
        sortObj.price = 1;
      } else if (sort === "Price - high to low") {
        sortObj.price = -1;
      }
    }

    // Fetch the filtered and sorted products
    const products = await Product.find(query)
      .select(
        "productName price longDescription type productImageURL inventory variants minQuantityToOrder maxQuantityPerOrder preparationTime description discountId"
      )
      .populate(
        "discountId",
        "discountName maxAmount discountType discountValue validFrom validTo onAddOn status"
      )
      .sort(sortObj);

    const currentDate = new Date();

    const formattedResponse = products?.map((product) => {
      const discount = product?.discountId;
      const validFrom = new Date(discount?.validFrom);
      const validTo = new Date(discount?.validTo);
      validTo?.setHours(18, 29, 59, 999);

      let discountPrice = null;

      // Check if discount is applicable
      if (
        discount &&
        validFrom <= currentDate &&
        validTo >= currentDate &&
        discount.status
      ) {
        if (discount.discountType === "Percentage-discount") {
          let discountAmount = (product.price * discount.discountValue) / 100;
          if (discountAmount > discount.maxAmount)
            discountAmount = discount.maxAmount;
          discountPrice = Math.max(0, product.price - discountAmount);
        } else if (discount.discountType === "Flat-discount") {
          discountPrice = Math.max(0, product.price - discount.discountValue);
        }
      }

      return {
        productId: product._id,
        productName: product.productName || null,
        price: product.price || null,
        discountPrice: Number(discountPrice?.toFixed(2)) || null,
        minQuantityToOrder: product.minQuantityToOrder || null,
        maxQuantityPerOrder: product.maxQuantityPerOrder || null,
        isFavorite:
          currentCustomer?.customerDetails?.favoriteProducts?.includes(
            product._id
          ) ?? false,
        preparationTime: product?.preparationTime
          ? `${product.preparationTime} min`
          : null,
        description: product?.description || null,
        longDescription: product?.longDescription || null,
        type: product.type || null,
        productImageURL:
          product?.productImageURL ||
          "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FProductDefaultImage.png?alt=media&token=044503ee-84c8-487b-9df7-793ad0f70e1c",
        inventory: product.inventory || null,
        variantAvailable: product?.variants && product?.variants?.length > 0,
      };
    });

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

// Get average rating and total rating count of merchant
const getTotalRatingOfMerchantController = async (req, res, next) => {
  try {
    const { merchantId } = req.params;

    const merchantFound = await Merchant.findById(merchantId);

    if (!merchantFound) {
      return next(appError("Merchant not found", 404));
    }

    const totalReviews =
      merchantFound?.merchantDetail?.ratingByCustomers?.length || 0;
    const averageRating = merchantFound?.merchantDetail?.averageRating || 0;

    res.status(200).json({
      message: "Rating details of merchant",
      totalReviews,
      averageRating,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// ========================
// Protected Routes
// ========================

// Add or remove Products from favorite
const toggleProductFavoriteController = async (req, res, next) => {
  try {
    const currentCustomer = await Customer.findById(req.userAuth);

    if (!currentCustomer) {
      return next(appError("Customer is not authenticated", 403));
    }

    const { productId } = req.params;

    const productFound = await Product.findById(productId).lean();

    if (!productFound) {
      return next(appError("Product not found", 404));
    }

    let favoriteProducts = new Set(
      currentCustomer.customerDetails.favoriteProducts.map((fav) =>
        fav.toString()
      )
    );

    if (favoriteProducts.has(productId)) {
      favoriteProducts.delete(productId);

      res.status(200).json({
        success: true,
        message: "Successfully removed product from favorite list",
      });
    } else {
      favoriteProducts.add(productId);

      res.status(200).json({
        success: true,
        message: "Successfully added product to favorite list",
      });
    }

    currentCustomer.customerDetails.favoriteProducts =
      Array.from(favoriteProducts);

    await currentCustomer.save();
  } catch (err) {
    next(appError(err.message));
  }
};

// Add or remove Merchants from favorite
const toggleMerchantFavoriteController = async (req, res, next) => {
  try {
    // Find the current customer
    const currentCustomer = await Customer.findById(req.userAuth);

    if (!currentCustomer) {
      return next(appError("Customer is not authenticated", 403));
    }

    const { merchantId, businessCategoryId } = req.params;

    // Check if the merchant exists
    const merchantFound = await Merchant.findById(merchantId).lean();

    if (!merchantFound) {
      return next(appError("Merchant not found", 404));
    }

    let favoriteMerchants = new Set(
      currentCustomer.customerDetails.favoriteMerchants.map((fav) =>
        JSON.stringify({
          merchantId: fav.merchantId.toString(),
          businessCategoryId: fav.businessCategoryId.toString(),
        })
      )
    );

    const merchantKey = JSON.stringify({ merchantId, businessCategoryId });

    if (favoriteMerchants.has(merchantKey)) {
      favoriteMerchants.delete(merchantKey);

      res.status(200).json({
        success: true,
        message: "Successfully removed merchant from favorite list",
      });
    } else {
      favoriteMerchants.add(merchantKey);

      res.status(200).json({
        success: true,
        message: "Successfully added merchant to favorite list",
      });
    }

    // Convert Set back to array and update database
    currentCustomer.customerDetails.favoriteMerchants = Array.from(
      favoriteMerchants
    ).map((fav) => JSON.parse(fav));

    await currentCustomer.save();
  } catch (err) {
    console.error("❌ Error:", err.message);
    next(appError(err.message));
  }
};

// Add ratings to the merchant
const addRatingToMerchantController = async (req, res, next) => {
  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(500).json({ errors: formattedErrors });
  }

  try {
    const { review, rating, merchantId } = req.body;

    const currentCustomer = await Customer.findById(req.userAuth);

    if (!currentCustomer) {
      return next(appError("Customer is not authenticated", 401));
    }

    const merchantFound = await Merchant.findById(merchantId);

    if (!merchantFound) {
      return next(appError("Merchant not found", 404));
    }

    const ratingData = {
      customerId: currentCustomer,
      review,
      rating,
    };

    merchantFound.merchantDetail.ratingByCustomers.push(ratingData);

    await merchantFound.save();

    res.status(200).json({ message: "Rating submitted successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

// Update cart items
const addOrUpdateCartItemController = async (req, res, next) => {
  try {
    const { productId, quantity, variantTypeId } = req.body;

    const customerId = req.userAuth;

    if (!customerId) {
      return next(appError("Customer is not authenticated", 401));
    }

    const product = await Product.findById(productId).populate(
      "categoryId discountId"
    );

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const merchantId = product.categoryId.merchantId;

    let variantType = null;
    if (variantTypeId) {
      variantType = product.variants
        .flatMap((variant) => variant.variantTypes)
        .find((vt) => vt._id.equals(variantTypeId));

      if (!variantType) {
        return res.status(400).json({
          error: "VariantType not found for this product",
        });
      }
    }

    const { discountPrice, variantsWithDiscount } = calculateDiscountedPrice(
      product,
      variantTypeId
    );

    let finalPrice = discountPrice;
    if (variantTypeId) {
      const variant = variantsWithDiscount
        .flatMap((variant) => variant.variantTypes)
        .find((vt) => vt._id.equals(variantTypeId));

      finalPrice = variant
        ? variant.discountPrice || variant.price
        : discountPrice;
    }

    let cart = await CustomerCart.findOne({ customerId });

    if (cart) {
      if (cart.merchantId !== merchantId) {
        cart.merchantId = merchantId;
        cart.items = [];
      }
    } else {
      cart = new CustomerCart({ customerId, merchantId, items: [] });
    }

    const existingItemIndex = cart.items.findIndex(
      (item) =>
        item.productId.equals(productId) &&
        ((variantTypeId &&
          item.variantTypeId &&
          item.variantTypeId.equals(variantTypeId)) ||
          (!variantTypeId && !item.variantTypeId))
    );

    if (existingItemIndex >= 0) {
      cart.items[existingItemIndex].quantity = quantity;
      cart.items[existingItemIndex].price = finalPrice;
      cart.items[existingItemIndex].totalPrice = quantity * finalPrice;

      if (cart.items[existingItemIndex].quantity <= 0) {
        cart.items.splice(existingItemIndex, 1);
      }
    } else {
      if (quantity > 0) {
        const newItem = {
          productId,
          quantity,
          price: finalPrice,
          totalPrice: quantity * finalPrice,
          variantTypeId: variantTypeId || null,
        };
        cart.items.push(newItem);
      }
    }

    // Calculate the itemTotal ensuring no NaN values
    cart.itemTotal = cart.items.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );

    await cart.save();

    if (cart.items.length === 0) {
      await CustomerCart.findByIdAndDelete(cart._id);
      return res.status(200).json({
        success: false,
      });
    }

    const updatedCart = await CustomerCart.findOne({ customerId })
      .populate({
        path: "items.productId",
        select: "productName productImageURL description variants",
      })
      .exec();

    const updatedCartWithVariantNames = updatedCart.toObject();

    updatedCartWithVariantNames.items = updatedCartWithVariantNames.items.map(
      (item) => {
        const product = item.productId;
        let variantTypeName = null;
        let variantTypeData = null;
        if (item.variantTypeId && product.variants) {
          const variantType = product.variants
            .flatMap((variant) => variant.variantTypes)
            .find((type) => type._id.equals(item.variantTypeId));
          if (variantType) {
            variantTypeName = variantType.typeName;
            variantTypeData = {
              id: variantType._id,
              variantTypeName: variantTypeName,
            };
          }
        }

        return {
          ...item,
          productId: {
            id: product._id,
            productName: product.productName,
            description: product.description,
            productImageURL: product.productImageURL,
          },
          variantTypeId: variantTypeData,
        };
      }
    );

    res.status(200).json({
      success: true,
      data: {
        cartId: updatedCartWithVariantNames._id,
        customerId: updatedCartWithVariantNames.customerId,
        billDetail: updatedCartWithVariantNames.billDetail,
        cartDetail: updatedCartWithVariantNames.cartDetail,
        createdAt: updatedCartWithVariantNames.createdAt,
        updatedAt: updatedCartWithVariantNames.updatedAt,
        items: updatedCartWithVariantNames.items,
        itemTotal: updatedCart.itemTotal,
      },
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const addItemsToCart = async (req, res, next) => {
  try {
    const { merchantId, items } = req.body;

    const customerId = req.userAuth;

    if (!customerId) {
      return next(appError("Customer is not authenticated", 401));
    }

    const formattedItems = items?.map((item) => ({
      productId: item.productId,
      price: item.price,
      quantity: item.quantity,
      variantTypeId: item?.variantTypeId || null,
    }));

    const cart = await CustomerCart.findOneAndUpdate(
      { customerId },
      {
        $set: { merchantId, items: formattedItems },
      },
      { new: true, upsert: true }
    );

    res.status(200).json({
      cartId: cart._id,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getProductsWithVariantsInCart = async (req, res, next) => {
  try {
    const { productId } = req.query;
    const customerId = req.userAuth;

    // Fetch cart and product details in one optimized query
    const cart = await CustomerCart.findOne({ customerId }).populate({
      path: "items.productId",
      select: "productName variants",
    });

    if (!cart) {
      return next(appError("Cart not found", 404));
    }

    // Find the specific product from the cart
    const cartItems = cart.items.filter(
      (item) => item.productId._id.toString() === productId
    );

    if (!cartItems.length) {
      return next(appError("Product not found in cart", 404));
    }

    // Map and format the response
    const formattedItems = cartItems.map((cartItem) => {
      const product = cartItem.productId;

      // Find the correct variant type
      const variantTypeName =
        product.variants
          .flatMap((variant) => variant.variantTypes)
          .find(
            (vType) =>
              vType._id.toString() === cartItem.variantTypeId?.toString()
          )?.typeName || null;

      return {
        productId: product._id,
        productName: product.productName, // Optimized retrieval
        quantity: cartItem.quantity,
        variantTypeId: cartItem.variantTypeId,
        variantTypeName, // Directly assign variant type name
        price: cartItem.price,
      };
    });

    res.status(200).json(formattedItems);
  } catch (err) {
    next(appError(err.message));
  }
};

// Get delivery option of merchant
const getDeliveryOptionOfMerchantController = async (req, res, next) => {
  try {
    const { merchantId } = req.params;

    const merchantFound = await Merchant.findById(merchantId);

    if (!merchantFound) return next(appError("Merchant not found", 404));

    res.status(200).json({
      deliveryOption: merchantFound.merchantDetail.deliveryOption,
      preOrderStatus: merchantFound.merchantDetail.preOrderStatus,
      preOrderType: merchantFound.merchantDetail.preOrderType,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Confirm Order detail (Add - address, items)
const confirmOrderDetailController = async (req, res, next) => {
  try {
    const {
      businessCategoryId,
      deliveryAddressType,
      deliveryAddressOtherAddressId,
      newDeliveryAddress,
      deliveryMode,
      instructionToMerchant,
      instructionToDeliveryAgent,
      ifScheduled,
      isSuperMarketOrder = false,
    } = req.body;

    const { customer, cart, merchant } = await fetchCustomerAndMerchantAndCart(
      req.userAuth,
      next
    );

    console.log(req.body);
    console.log(ifScheduled?.startDate);

    let deliveryOption = "On-demand";
    if (ifScheduled?.startDate && ifScheduled?.endDate && ifScheduled?.time) {
      deliveryOption = "Scheduled";
    }

    console.log(deliveryOption);

    validateDeliveryOption(merchant, deliveryOption, next);

    const scheduledDetails = processScheduledDelivery(deliveryOption, req);

    const { voiceInstructionToMerchantURL, voiceInstructionToAgentURL } =
      await processVoiceInstructions(req, cart, next);

    const {
      pickupLocation,
      pickupAddress,
      deliveryLocation,
      deliveryAddress,
      distance,
    } = await processHomeDeliveryDetailInApp(
      deliveryMode,
      customer,
      merchant,
      deliveryAddressType,
      deliveryAddressOtherAddressId,
      newDeliveryAddress
    );

    const cartItems = cart.items;

    const booleanSuperMarketOrder = isSuperMarketOrder === "true";

    const {
      oneTimeDeliveryCharge,
      surgeCharges,
      deliveryChargeForScheduledOrder,
      taxAmount,
      itemTotal,
    } = await calculateDeliveryChargesHelper({
      deliveryMode,
      distanceInKM: distance,
      merchant,
      customer,
      items: cartItems,
      scheduledDetails,
      selectedBusinessCategory: businessCategoryId,
      isSuperMarketOrder: booleanSuperMarketOrder,
    });

    const merchantDiscountAmount = await applyDiscounts({
      items: cartItems,
      itemTotal,
      merchant,
    });

    const loyaltyDiscount = await getDiscountAmountFromLoyalty(
      customer,
      itemTotal
    );

    const discountTotal = merchantDiscountAmount + loyaltyDiscount;

    let actualDeliveryCharge = 0;

    const subscriptionOfCustomer = customer.customerDetails.pricing;

    if (subscriptionOfCustomer?.length > 0) {
      const subscriptionLog = await SubscriptionLog.findById(
        subscriptionOfCustomer[0]
      );

      if (subscriptionLog) {
        const now = new Date();

        if (
          (new Date(subscriptionLog?.startDate) < now ||
            new Date(subscriptionLog?.endDate) > now) &&
          subscriptionLog?.currentNumberOfOrders < subscriptionLog?.maxOrders
        ) {
          actualDeliveryCharge = 0;
        }
      }
    } else {
      actualDeliveryCharge = oneTimeDeliveryCharge;
    }

    const billDetail = calculateBill(
      itemTotal,
      deliveryChargeForScheduledOrder || actualDeliveryCharge || 0,
      surgeCharges || 0,
      0,
      discountTotal,
      taxAmount || 0,
      cart?.billDetail?.addedTip || 0
    );

    const customerCart = await CustomerCart.findOneAndUpdate(
      { customerId: customer._id },
      {
        customerId: customer._id,
        merchantId: merchant._id,
        items: cart.items,
        cartDetail: {
          ...req.body,
          pickupLocation,
          pickupAddress,
          deliveryLocation,
          deliveryAddress,
          deliveryOption,
          instructionToMerchant,
          instructionToDeliveryAgent,
          voiceInstructionToMerchant: voiceInstructionToMerchantURL,
          voiceInstructionToDeliveryAgent: voiceInstructionToAgentURL,
          distance,
          startDate: scheduledDetails?.startDate || null,
          endDate: scheduledDetails?.endDate || null,
          time: scheduledDetails?.time || null,
          numOfDays: scheduledDetails?.numOfDays || null,
        },
        billDetail: {
          ...billDetail,
          deliveryChargePerDay: actualDeliveryCharge,
          loyaltyDiscount: loyaltyDiscount ? loyaltyDiscount : null,
        },
      },
      { new: true, upsert: true }
    );

    res.status(200).json({
      cartId: customerCart._id,
      merchantId: customerCart.merchantId,
      deliveryOption: customerCart.cartDetail.deliveryOption,
    });
  } catch (err) {
    console.log(err.message);
    next(appError(err.message));
  }
};

// Get cart bill
const getCartBillController = async (req, res, next) => {
  try {
    const { cartId } = req.query;

    const cartFound = await CustomerCart.findById(cartId).select(
      "billDetail merchantId"
    );

    res.status(200).json({
      billDetail: cartFound.billDetail,
      merchantId: cartFound.merchantId,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Order Product
const orderPaymentController = async (req, res, next) => {
  try {
    const { paymentMode } = req.body;
    const customerId = req.userAuth;

    const [customer, cart] = await Promise.all([
      Customer.findById(customerId),
      CustomerCart.findOne({ customerId })
        .populate({
          path: "items.productId",
          select: "productName productImageURL description variants",
        })
        .exec(),
    ]);

    if (!customer) return next(appError("Customer not found", 404));
    if (!cart) return next(appError("Cart not found", 404));

    const orderAmount =
      cart.billDetail.discountedGrandTotal ||
      cart.billDetail.originalGrandTotal;

    const merchant = await Merchant.findById(cart.merchantId);

    if (!merchant) return next(appError("Merchant not found", 404));

    const deliveryTimeMinutes = parseInt(
      merchant.merchantDetail.deliveryTime,
      10
    );

    const deliveryTime = new Date();
    deliveryTime.setMinutes(deliveryTime.getMinutes() + deliveryTimeMinutes);

    let startDate, endDate;
    if (cart.cartDetail.deliveryOption === "Scheduled") {
      startDate = new Date(cart.cartDetail.startDate);
      startDate.setHours(18, 30, 0, 0);

      endDate = new Date(cart.cartDetail.endDate);
      endDate.setHours(18, 29, 59, 999);
    }

    const populatedCartWithVariantNames = cart.toObject();
    populatedCartWithVariantNames.items =
      populatedCartWithVariantNames.items.map((item) => {
        const product = item.productId;
        let variantTypeName = null;
        let variantTypeData = null;
        if (item.variantTypeId && product.variants) {
          const variantType = product.variants
            .flatMap((variant) => variant.variantTypes)
            .find((type) => type._id.equals(item.variantTypeId));
          if (variantType) {
            variantTypeName = variantType.typeName;
            variantTypeData = {
              _id: variantType._id,
              variantTypeName: variantTypeName,
            };
          }
        }
        return {
          ...item,
          productId: {
            _id: product._id,
            productName: product.productName,
            description: product.description,
            productImageURL: product.productImageURL,
          },
          variantTypeId: variantTypeData,
        };
      });

    const purchasedItems = await filterProductIdAndQuantity(
      populatedCartWithVariantNames.items
    );

    let formattedItems = populatedCartWithVariantNames.items.map((items) => {
      return {
        itemName: items.productId.productName,
        description: items.productId.description,
        itemImageURL: items.productId.productImageURL,
        quantity: items.quantity,
        price: items.price,
        variantTypeName: items?.variantTypeId?.variantTypeName,
      };
    });

    let orderBill = {
      deliveryChargePerDay: cart.billDetail.deliveryChargePerDay,
      deliveryCharge:
        cart.billDetail.discountedDeliveryCharge ||
        cart.billDetail.originalDeliveryCharge,
      taxAmount: cart.billDetail.taxAmount,
      discountedAmount: cart.billDetail.discountedAmount,
      promoCodeUsed: cart.billDetail.promoCodeUsed,
      grandTotal:
        cart.billDetail.discountedGrandTotal ||
        cart.billDetail.originalGrandTotal,
      itemTotal: cart.billDetail.itemTotal,
      addedTip: cart.billDetail.addedTip,
      subTotal: cart.billDetail.subTotal,
      surgePrice: cart.billDetail.surgePrice,
    };

    let walletTransaction = {
      customerId,
      closingBalance: customer?.customerDetails?.walletBalance,
      transactionAmount: orderAmount,
      date: new Date(),
      type: "Debit",
    };

    let customerTransaction = {
      customerId,
      madeOn: new Date(),
      transactionType: "Bill",
      transactionAmount: orderAmount,
      type: "Debit",
    };

    const pickups = [
      {
        location: cart.cartDetail.pickupLocation,
        address: cart.cartDetail.pickupAddress,
        instructionInPickup: cart.cartDetail.instructionToMerchant,
        voiceInstructionInPickup: cart.cartDetail.voiceInstructionToMerchant,
        items: [],
      },
    ];
    const drops = [
      {
        location: cart.cartDetail.deliveryLocation,
        address: cart.cartDetail.deliveryAddress,
        instructionInDrop: cart.cartDetail.instructionToDeliveryAgent,
        voiceInstructionInDrop:
          cart.cartDetail.voiceInstructionToDeliveryAgent,
        items: cart.items?.map((item) => ({
          itemName: item.productId.productName,
          quantity: item.quantity,
          price: item.price,
          variantTypeId: item.variantTypeId,
        })),
      },
    ];

    let newOrder;
    if (paymentMode === "Famto-cash") {
      if (customer.customerDetails.walletBalance < orderAmount) {
        return next(appError("Insufficient funds in wallet", 400));
      }

      // Deduct the amount from wallet
      customer.customerDetails.walletBalance = Number(
        (customer.customerDetails.walletBalance - orderAmount).toFixed(2)
      );

      if (cart.cartDetail.deliveryOption === "Scheduled") {
        // Create a scheduled order

        const newOrderCreated = await ScheduledOrder.create({
          customerId,
          merchantId: cart.merchantId,
          items: formattedItems,
          orderDetail: cart.cartDetail,
          billDetail: orderBill,
          totalAmount: orderAmount,
          deliveryMode: cart.cartDetail.deliveryMode,
          deliveryOption : cart.cartDetail.deliveryOption,
          status: "Pending",
          paymentMode: "Famto-cash",
          paymentStatus: "Completed",
          startDate,
          endDate,
          time: cart.cartDetail.time,
          purchasedItems,
        });

        console.log("Scheduled Order Created", newOrderCreated);

        walletTransaction.orderId = newOrderCreated._id;

        await Promise.all([
          PromoCode.findOneAndUpdate(
            { promoCode: newOrderCreated.billDetail.promoCodeUsed },
            { $inc: { noOfUserUsed: 1 } }
          ),
          customer.save(),
          CustomerCart.deleteOne({ customerId }),
          CustomerTransaction.create(customerTransaction),
          CustomerWalletTransaction.create(walletTransaction),
          ActivityLog.create({
            userId: req.userAuth,
            userType: req.userRole,
            description: `Scheduled order (#${newOrderCreated._id
              }) from customer app by ${req?.userName || "N/A"} ( ${req.userAuth
              } )`,
          }),
        ]);

        newOrder = await ScheduledOrder.findById(newOrderCreated._id).populate(
          "merchantId"
        );

        const eventName = "newOrderCreated";

        // Fetch notification settings to determine roles
        const { rolesToNotify, data } = await findRolesToNotify(eventName);

        const notificationData = {
          fcm: {
            orderId: newOrder._id,
            customerId: newOrder.customerId,
          },
        };

        const socketData = {
          ...data,

          orderId: newOrder._id,
          orderDetail: newOrder.orderDetail,
          billDetail: newOrder.billDetail,

          //? Data for displaying detail in all orders table
          _id: newOrder._id,
          orderStatus: newOrder.status,
          merchantName:
            newOrder?.merchantId?.merchantDetail?.merchantName || "-",
          customerName:
            newOrder?.orderDetail?.deliveryAddress?.fullName ||
            newOrder?.customerId?.fullName ||
            "-",
          deliveryMode: newOrder?.deliveryMode,
          orderDate: formatDate(newOrder.createdAt),
          orderTime: formatTime(newOrder.createdAt),
          deliveryDate: newOrder?.orderDetail?.deliveryTime
            ? formatDate(newOrder.orderDetail.deliveryTime)
            : "-",
          deliveryTime: newOrder?.orderDetail?.deliveryTime
            ? formatTime(newOrder.orderDetail.deliveryTime)
            : "-",
          paymentMethod: newOrder.paymentMode,
          deliveryOption: newOrder?.deliveryOption,
          amount: newOrder.billDetail.grandTotal,
        };

        const userIds = {
          admin: process.env.ADMIN_ID,
          merchant: newOrder?.merchantId._id,
          agent: newOrder?.agentId,
          customer: newOrder?.customerId,
        };

        res.status(200).json({
          success: true,
          orderId: newOrder._id,
          createdAt: newOrder.createdAt,
          merchantName: merchant.merchantDetail.merchantName,
          deliveryMode: newOrder.deliveryMode,
        });

        // Send notifications to each role dynamically
        await sendSocketDataAndNotification({
          rolesToNotify,
          userIds,
          eventName,
          notificationData,
          socketData,
        });

        return;
      } else {
        // Generate a unique order ID
        const orderId = new mongoose.Types.ObjectId();

        // Store order details temporarily in the database
        const tempOrder = await TemporaryOrder.create({
          orderId,
          customerId,
          merchantId: cart.merchantId,
          deliveryMode: cart.cartDetail.deliveryMode,
          deliveryOption: cart.cartDetail.deliveryOption,
          pickups,
          drops,
          billDetail: orderBill,
          distance: cart.cartDetail.distance,
          deliveryTime,
          startDate: cart.cartDetail.startDate,
          endDate: cart.cartDetail.endDate,
          time: cart.cartDetail.time,
          numOfDays: cart.cartDetail.numOfDays,
          totalAmount: orderAmount,
          paymentMode: "Famto-cash",
          paymentStatus: "Completed",
          purchasedItems,
        });

        // Clear the cart

        if (!tempOrder) {
          return next(appError("Error in creating temporary order"));
        }

        walletTransaction.orderId = orderId;

        await Promise.all([
          customer.save(),
          CustomerCart.deleteOne({ customerId }),
          CustomerTransaction.create(customerTransaction),
          CustomerWalletTransaction.create(walletTransaction),
          PromoCode.findOneAndUpdate(
            { promoCode: tempOrder.billDetail.promoCodeUsed },
            { $inc: { noOfUserUsed: 1 } }
          ),
        ]);

        // Return countdown timer to client
        res.status(200).json({
          success: true,
          orderId,
          createdAt: tempOrder.createdAt,
          merchantName: merchant.merchantDetail.merchantName,
          deliveryMode: tempOrder.deliveryMode,
        });

        // After 60 seconds, create the order if not canceled
        setTimeout(async () => {
          const storedOrderData = await TemporaryOrder.findOne({ orderId });

          if (storedOrderData) {
            let newOrderCreated = await Order.create({
              customerId: storedOrderData.customerId,
              merchantId: storedOrderData.merchantId,
              pickups: storedOrderData.pickups,
              drops: storedOrderData.drops,
              billDetail: storedOrderData.billDetail,
              distance: storedOrderData.distance,
              deliveryTime: storedOrderData.deliveryTime,
              startDate: storedOrderData.startDate,
              endDate: storedOrderData.endDate,
              time: storedOrderData.time,
              numOfDays: storedOrderData.numOfDays,
              deliveryMode: storedOrderData.deliveryMode,
              deliveryOption: storedOrderData.deliveryOption,
              totalAmount: storedOrderData.totalAmount,
              status: storedOrderData.status,
              paymentMode: storedOrderData.paymentMode,
              paymentStatus: storedOrderData.paymentStatus,
              "orderDetailStepper.created": {
                by: "Customer",
                userId: storedOrderData.customerId,
                date: new Date(),
              },
              purchasedItems: storedOrderData.purchasedItems,
            });

            if (!newOrderCreated)
              return next(appError("Error in creating order"));

            const newOrder = await Order.findById(newOrderCreated._id).populate(
              "merchantId"
            );

            // Check if population was successful
            if (!newOrder.merchantId) {
              return next(
                appError("Error in populating order's merchant information")
              );
            }

            const oldOrderId = orderId;

            await Promise.all([
              TemporaryOrder.deleteOne({ orderId }),
              customer.save(),
              CustomerWalletTransaction.findOneAndUpdate(
                { orderId: oldOrderId },
                { $set: { orderId: newOrderCreated._id } },
                { new: true }
              ),
              ActivityLog.create({
                userId: req.userAuth,
                userType: req.userRole,
                description: `Order (#${newOrderCreated._id
                  }) from customer app by ${req?.userName || "N/A"} ( ${req.userAuth
                  } )`,
              }),
            ]);

            const eventName = "newOrderCreated";

            // Fetch notification settings to determine roles
            const { rolesToNotify, data } = await findRolesToNotify(eventName);

            const notificationData = {
              fcm: {
                orderId: newOrder._id,
                customerId: newOrder.customerId,
              },
            };

            const socketData = {
              ...data,

              orderId: newOrder._id,
              billDetail: newOrder.billDetail,
              orderDetailStepper: newOrder.orderDetailStepper.created,

              //? Data for displaying detail in all orders table
              _id: newOrder._id,
              orderStatus: newOrder.status,
              merchantName:
                newOrder?.merchantId?.merchantDetail?.merchantName || "-",
              customerName:
                newOrder?.drops[0]?.deliveryAddress
                  ?.fullName ||
                newOrder?.customerId?.fullName ||
                "-",
              deliveryMode: newOrder?.deliveryMode,
              orderDate: formatDate(newOrder.createdAt),
              orderTime: formatTime(newOrder.createdAt),
              deliveryDate: newOrder?.deliveryTime
                ? formatDate(newOrder.deliveryTime)
                : "-",
              deliveryTime: newOrder?.deliveryTime
                ? formatTime(newOrder.deliveryTime)
                : "-",
              paymentMethod: newOrder.paymentMode,
              deliveryOption: newOrder.deliveryOption,
              amount: newOrder.billDetail.grandTotal,
            };

            const userIds = {
              admin: process.env.ADMIN_ID,
              merchant: newOrder?.merchantId._id,
              agent: newOrder?.agentId,
              customer: newOrder?.customerId,
            };

            // Send notifications to each role dynamically
            await sendSocketDataAndNotification({
              rolesToNotify,
              userIds,
              eventName,
              notificationData,
              socketData,
            });
          }
        }, 60000);
      }
    } else if (paymentMode === "Cash-on-delivery") {
      if (cart.cartDetail.deliveryOption === "Scheduled") {
        return res.status(400).json({
          success: false,
          message: "Scheduled orders cannot be paid through Cash on delivery",
        });
      }

      // Generate a unique order ID
      const orderId = new mongoose.Types.ObjectId();

      // Store order details temporarily in the database
      const tempOrder = await TemporaryOrder.create({
        orderId,
        customerId,
        merchantId: cart.merchantId,
        deliveryMode: cart.cartDetail.deliveryMode,
        deliveryOption: cart.cartDetail.deliveryOption,
        pickups,
        drops,
        billDetail: orderBill,
        distance: cart.cartDetail.distance,
        deliveryTime,
        startDate: cart.cartDetail.startDate,
        endDate: cart.cartDetail.endDate,
        time: cart.cartDetail.time,
        numOfDays: cart.cartDetail.numOfDays,
        totalAmount: orderAmount,
        paymentMode: "Cash-on-delivery",
        paymentStatus: "Pending",
        purchasedItems,
      });

      if (!tempOrder) {
        return next(appError("Error in creating temporary order"));
      }

      await Promise.all([
        CustomerCart.deleteOne({ customerId }),
        customer.save(),
        CustomerTransaction.create(customerTransaction),
        PromoCode.findOneAndUpdate(
          { promoCode: tempOrder.billDetail.promoCodeUsed },
          { $inc: { noOfUserUsed: 1 } }
        ),
      ]);

      // Return countdown timer to client
      res.status(200).json({
        success: true,
        orderId,
        createdAt: tempOrder.createdAt,
        merchantName: merchant.merchantDetail.merchantName,
        deliveryMode: tempOrder.deliveryMode,
      });

      // After 60 seconds, create the order if not canceled
      setTimeout(async () => {
        console.log('⏱️ setTimeout triggered for orderId:', orderId);

        const storedOrderData = await TemporaryOrder.findOne({ orderId });

        console.log('Stored temp order:', storedOrderData?._id);

        if (!storedOrderData) {
          console.log('⚠️ Temporary order not found, probably cancelled');
          return;
        }

        if (storedOrderData) {
          let newOrderCreated = await Order.create({
            customerId: storedOrderData.customerId,
            merchantId: storedOrderData.merchantId,
            pickups: storedOrderData.pickups,
            drops: storedOrderData.drops,
            billDetail: storedOrderData.billDetail,
            distance: storedOrderData.distance,
            deliveryTime: storedOrderData.deliveryTime,
            startDate: storedOrderData.startDate,
            endDate: storedOrderData.endDate,
            time: storedOrderData.time,
            numOfDays: storedOrderData.numOfDays,
            deliveryMode: storedOrderData.deliveryMode,
            totalAmount: storedOrderData.totalAmount,
            deliveryOption: storedOrderData.deliveryOption,
            status: storedOrderData.status,
            paymentMode: storedOrderData.paymentMode,
            paymentStatus: storedOrderData.paymentStatus,
            "orderDetailStepper.created": {
              by: "Customer",
              userId: storedOrderData.customerId,
              date: new Date(),
            },
            purchasedItems: storedOrderData.purchasedItems,
          });

          if (!newOrderCreated) {
            return next(appError("Error in creating order"));
          }

          const newOrder = await Order.findById(newOrderCreated._id).populate(
            "merchantId"
          );

          // Check if population was successful
          if (!newOrder.merchantId) {
            return next(
              appError("Error in populating order's merchant information")
            );
          }

          // Remove the temporary order data from the database
          await Promise.all([
            TemporaryOrder.deleteOne({ orderId }),
            ActivityLog.create({
              userId: req.userAuth,
              userType: req.userRole,
              description: `Order (#${newOrderCreated._id
                }) from customer app by ${req?.userName || "N/A"} ( ${req.userAuth
                } )`,
            }),
          ]);

          const eventName = "newOrderCreated";

          const { rolesToNotify, data } = await findRolesToNotify(eventName);

          const notificationData = {
            fcm: {
              orderId: newOrder._id,
              customerId: newOrder.customerId,
            },
          };

          const socketData = {
            ...data,

            orderId: newOrder._id,
            billDetail: newOrder.billDetail,
            orderDetailStepper: newOrder.orderDetailStepper.created,

            //? Data for displaying detail in all orders table
            _id: newOrder._id,
            orderStatus: newOrder.status,
            merchantName:
              newOrder?.merchantId?.merchantDetail?.merchantName || "-",
            customerName:
              newOrder?.drops[0]?.address
                ?.fullName ||
              newOrder?.customerId?.fullName ||
              "-",
            deliveryMode: newOrder?.deliveryMode,
            orderDate: formatDate(newOrder.createdAt),
            orderTime: formatTime(newOrder.createdAt),
            deliveryDate: newOrder?.deliveryTime
              ? formatDate(newOrder.deliveryTime)
              : "-",
            deliveryTime: newOrder?.deliveryTime
              ? formatTime(newOrder.deliveryTime)
              : "-",
            paymentMethod: newOrder.paymentMode,
            deliveryOption: newOrder.deliveryOption,
            amount: newOrder.billDetail.grandTotal,
          };

          const userIds = {
            admin: process.env.ADMIN_ID,
            merchant: newOrder?.merchantId?._id,
            driver: newOrder?.agentId,
            customer: newOrder?.customerId,
          };

          // Send notifications to each role dynamically
          await sendSocketDataAndNotification({
            rolesToNotify,
            userIds,
            eventName,
            notificationData,
            socketData,
          });
        }
      }, 60000);
    } else if (paymentMode === "Online-payment") {
      const { success, orderId, error } = await createRazorpayOrderId(
        orderAmount
      );

      if (!success) {
        return next(
          appError(`Error in creating Razorpay order: ${error}`, 500)
        );
      }

      res.status(200).json({ success: true, orderId, amount: orderAmount });
      return;
    } else {
      return next(appError("Invalid payment mode", 400));
    }
  } catch (err) {
    next(appError(err.message));
  }
};

// Verify online payment
const verifyOnlinePaymentController = async (req, res, next) => {
  try {
    const { paymentDetails } = req.body;
    const customerId = req.userAuth;

    if (!customerId) {
      return next(appError("Customer is not authenticated", 401));
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return next(appError("Customer not found", 404));
    }

    const cart = await CustomerCart.findOne({ customerId })
      .populate({
        path: "items.productId",
        select: "productName productImageURL description variants",
      })
      .exec();

    if (!cart) {
      return next(appError("Cart not found", 404));
    }

    const isPaymentValid = await verifyPayment(paymentDetails);
    if (!isPaymentValid) {
      return next(appError("Invalid payment", 400));
    }

    const merchant = await Merchant.findById(cart.merchantId);

    if (!merchant) {
      return next(appError("Merchant not found", 404));
    }

    const populatedCartWithVariantNames = cart.toObject();
    populatedCartWithVariantNames.items =
      populatedCartWithVariantNames.items.map((item) => {
        const product = item.productId;
        let variantTypeName = null;
        let variantTypeData = null;
        if (item.variantTypeId && product.variants) {
          const variantType = product.variants
            .flatMap((variant) => variant.variantTypes)
            .find((type) => type._id.equals(item.variantTypeId));
          if (variantType) {
            variantTypeName = variantType.typeName;
            variantTypeData = {
              id: variantType._id,
              variantTypeName: variantTypeName,
            };
          }
        }
        return {
          ...item,
          productId: {
            _id: product._id,
            productName: product.productName,
            description: product.description,
            productImageURL: product.productImageURL,
          },
          variantTypeId: variantTypeData,
        };
      });

    const purchasedItems = await filterProductIdAndQuantity(
      populatedCartWithVariantNames.items
    );

    let formattedItems = populatedCartWithVariantNames.items.map((items) => {
      return {
        itemName: items?.productId?.productName,
        description: items?.productId?.description,
        itemImageURL: items?.productId?.productImageURL,
        quantity: items?.quantity,
        price: items?.price,
        variantTypeName: items?.variantTypeId?.variantTypeName,
      };
    });

    const orderAmount =
      cart.billDetail.discountedGrandTotal ||
      cart.billDetail.originalGrandTotal;

    let startDate, endDate;
    if (cart.cartDetail.deliveryOption === "Scheduled") {
      startDate = new Date(cart.cartDetail.startDate);
      startDate.setHours(18, 30, 0, 0);

      endDate = new Date(cart.cartDetail.startDate);
      endDate.setHours(18, 29, 59, 999);
    }

    let orderBill = {
      deliveryChargePerDay: cart.billDetail.deliveryChargePerDay,
      deliveryCharge:
        cart.billDetail.discountedDeliveryCharge ||
        cart.billDetail.originalDeliveryCharge,
      taxAmount: cart.billDetail.taxAmount,
      discountedAmount: cart.billDetail.discountedAmount,
      promoCodeUsed: cart.billDetail.promoCodeUsed,
      grandTotal:
        cart.billDetail.discountedGrandTotal ||
        cart.billDetail.originalGrandTotal,
      itemTotal: cart.billDetail.itemTotal,
      addedTip: cart.billDetail.addedTip,
      subTotal: cart.billDetail.subTotal,
      surgePrice: cart.billDetail.surgePrice,
    };

    let customerTransaction = {
      customerId,
      madeOn: new Date(),
      transactionType: "Bill",
      transactionAmount: orderAmount,
      type: "Debit",
    };

    const deliveryTimeMinutes = parseInt(
      merchant.merchantDetail.deliveryTime,
      10
    );


     const pickups = [
      {
        location: cart.cartDetail.pickupLocation,
        address: cart.cartDetail.pickupAddress,
        instructionInPickup: cart.cartDetail.instructionToMerchant,
        voiceInstructionInPickup: cart.cartDetail.voiceInstructionToMerchant,
        items: [],
      },
    ];
    const drops = [
      {
        location: cart.cartDetail.deliveryLocation,
        address: cart.cartDetail.deliveryAddress,
        instructionInDrop: cart.cartDetail.instructionToDeliveryAgent,
        voiceInstructionInDrop:
          cart.cartDetail.voiceInstructionToDeliveryAgent,
        items: cart.items?.map((item) => ({
          itemName: item.productId.productName,
          quantity: item.quantity,
          price: item.price,
          variantTypeId: item.variantTypeId,
        })),
      },
    ];

    const deliveryTime = new Date();
    deliveryTime.setMinutes(deliveryTime.getMinutes() + deliveryTimeMinutes);

    let newOrder;
    // Check if the order is scheduled
    if (cart.cartDetail.deliveryOption === "Scheduled") {
      // Create a scheduled order
      const newOrderCreated = await ScheduledOrder.create({
        customerId,
        merchantId: cart.merchantId,
        items: formattedItems,
        orderDetail: cart.cartDetail,
        billDetail: orderBill,
        deliveryMode: cart.cartDetail.deliveryMode,
        deliveryOption: cart.cartDetail.deliveryOption,
        totalAmount: orderAmount,
        status: "Pending",
        paymentMode: "Online-payment",
        paymentStatus: "Completed",
        startDate, //cart.cartDetail.startDate,
        endDate, //: cart.cartDetails.endDate,
        time: cart.cartDetail.time,
        paymentId: paymentDetails.razorpay_payment_id,
        purchasedItems,
      });

      await Promise.all([
        PromoCode.findOneAndUpdate(
          { promoCode: newOrderCreated.billDetail.promoCodeUsed },
          { $inc: { noOfUserUsed: 1 } }
        ),
        CustomerCart.deleteOne({ customerId }),
        customer.save(),
        CustomerTransaction.create(customerTransaction),
        ActivityLog.create({
          userId: req.userAuth,
          userType: req.userRole,
          description: `Scheduled order (#${newOrderCreated._id
            }) from customer app by ${req?.userName || "N/A"} ( ${req.userAuth
            } )`,
        }),
      ]);

      newOrder = await ScheduledOrder.findById(newOrderCreated._id).populate(
        "merchantId"
      );

      const eventName = "newOrderCreated";

      // Fetch notification settings to determine roles
      const { rolesToNotify, data } = await findRolesToNotify(eventName);

      const notificationData = {
        fcm: {
          orderId: newOrder._id,
          customerId: newOrder.customerId,
        },
      };

      const socketData = {
        ...data,

        orderId: newOrder._id,
        orderDetail: newOrder.orderDetail,
        billDetail: newOrder.billDetail,

        //? Data for displaying detail in all orders table
        _id: newOrder._id,
        orderStatus: newOrder.status,
        merchantName: newOrder?.merchantId?.merchantDetail?.merchantName || "-",
        customerName:
          newOrder?.orderDetail?.deliveryAddress?.fullName ||
          newOrder?.customerId?.fullName ||
          "-",
        deliveryMode: newOrder?.orderDetail?.deliveryMode,
        orderDate: formatDate(newOrder.createdAt),
        orderTime: formatTime(newOrder.createdAt),
        deliveryDate: newOrder?.orderDetail?.deliveryTime
          ? formatDate(newOrder.orderDetail.deliveryTime)
          : "-",
        deliveryTime: newOrder?.orderDetail?.deliveryTime
          ? formatTime(newOrder.orderDetail.deliveryTime)
          : "-",
        paymentMethod: newOrder.paymentMode,
        deliveryOption: newOrder.orderDetail.deliveryOption,
        amount: newOrder.billDetail.grandTotal,
      };

      const userIds = {
        admin: process.env.ADMIN_ID,
        merchant: newOrder?.merchantId._id,
        agent: newOrder?.agentId,
        customer: newOrder?.customerId,
      };

      res.status(200).json({
        success: true,
        orderId: newOrder._id,
        createdAt: null,
        merchantName: null,
        deliveryMode: newOrder.orderDetail.deliveryMode,
      });

      await sendSocketDataAndNotification({
        rolesToNotify,
        userIds,
        eventName,
        notificationData,
        socketData,
      });

      return;
    } else {
      // Generate a unique order ID
      const orderId = new mongoose.Types.ObjectId();

      console.log("Initalizing temporary cart");

      // Store order details temporarily in the database
      const tempOrder = await TemporaryOrder.create({
        orderId,
        customerId,
        merchantId: cart.merchantId,
        deliveryMode: cart.cartDetail.deliveryMode,
        deliveryOption: cart.cartDetail.deliveryOption,
        pickups,
        drops,
        billDetail: orderBill,
        distance: cart.cartDetail.distance,
        deliveryTime,
        startDate: cart.cartDetail.startDate,
        endDate: cart.cartDetail.endDate,
        time: cart.cartDetail.time,
        numOfDays: cart.cartDetail.numOfDays,
        totalAmount: orderAmount,
        paymentMode: "Online-payment",
        paymentStatus: "Pending",
        purchasedItems,
      });

      if (!tempOrder) {
        console.log("Error in creating temporary order");
        return next(appError("Error in creating temporary order"));
      }

      await Promise.all([
        customer.save(),
        CustomerCart.deleteOne({ customerId }),
        CustomerTransaction.create(customerTransaction),
        PromoCode.findOneAndUpdate(
          { promoCode: tempOrder.billDetail.promoCodeUsed },
          { $inc: { noOfUserUsed: 1 } }
        ),
      ]);

      res.status(200).json({
        success: true,
        orderId,
        createdAt: tempOrder.createdAt,
        merchantName: merchant.merchantDetail.merchantName,
        deliveryMode: tempOrder.deliveryMode,
      });

      console.log("Temporay Order Created");

      // After 60 seconds, create the order if not canceled
      setTimeout(async () => {
        const storedOrderData = await TemporaryOrder.findOne({ orderId });

        console.log("Stored order data",storedOrderData);

        if (storedOrderData) {
          const existingOrder = await Order.findOne({
            _id: storedOrderData.orderId,
          });

          console.log("Temporary order fetched",existingOrder);

          if (existingOrder) return;

          let newOrderCreated = await Order.create({
            customerId: storedOrderData.customerId,
            merchantId: storedOrderData.merchantId,
            pickups: storedOrderData.pickups,
            drops: storedOrderData.drops,
            billDetail: storedOrderData.billDetail,
            distance: storedOrderData.distance,
            deliveryTime: storedOrderData.deliveryTime,
            startDate: storedOrderData.startDate,
            endDate: storedOrderData.endDate,
            deliveryMode: storedOrderData.deliveryMode,
            deliveryOption : storedOrderData.deliveryOption,
            time: storedOrderData.time,
            numOfDays: storedOrderData.numOfDays,
            totalAmount: storedOrderData.totalAmount,
            status: storedOrderData.status,
            paymentMode: storedOrderData.paymentMode,
            paymentStatus: storedOrderData.paymentStatus,
            "orderDetailStepper.created": {
              by: "Customer",
              userId: storedOrderData.customerId,
              date: new Date(),
            },
            purchasedItems: storedOrderData.purchasedItems,
          });

          if (!newOrderCreated) {
            console.log("Error in creating new Order",newOrderCreated);
            return next(appError("Error in creating order"));
          }

          const newOrder = await Order.findById(newOrderCreated._id).populate(
            "merchantId"
          );

          // Check if population was successful
          if (!newOrder.merchantId) {
            return next(
              appError("Error in populating order's merchant information")
            );
          }

          // Remove the temporary order data from the database
          await Promise.all([
            TemporaryOrder.deleteOne({ orderId }),
            ActivityLog.create({
              userId: req.userAuth,
              userType: req.userRole,
              description: `Order (#${newOrderCreated._id
                }) from customer app by ${req?.userName || "N/A"} ( ${req.userAuth
                } )`,
            }),
          ]);

          const eventName = "newOrderCreated";

          const { rolesToNotify, data } = await findRolesToNotify(eventName);

          // Send notifications to each role dynamically
          const notificationData = {
            fcm: {
              orderId: newOrder._id,
              customerId: newOrder.customerId,
            },
          };

          const socketData = {
            ...data,

            orderId: newOrder._id,
            billDetail: newOrder.billDetail,
            orderDetailStepper: newOrder.orderDetailStepper.created,

            //? Data for displaying detail in all orders table
            _id: newOrder._id,
            orderStatus: newOrder.status,
            merchantName:
              newOrder?.merchantId?.merchantDetail?.merchantName || "-",
            customerName:
              newOrder?.drops[0]?.deliveryAddress
                ?.fullName ||
              newOrder?.customerId?.fullName ||
              "-",
            deliveryMode: newOrder?.deliveryMode,
            orderDate: formatDate(newOrder.createdAt),
            orderTime: formatTime(newOrder.createdAt),
            deliveryDate: newOrder?.deliveryTime
              ? formatDate(newOrder.deliveryTime)
              : "-",
            deliveryTime: newOrder?.deliveryTime
              ? formatTime(newOrder.deliveryTime)
              : "-",
            paymentMethod: newOrder.paymentMode,
            deliveryOption: newOrder.deliveryOption,
            amount: newOrder.billDetail.grandTotal,
          };

          const userIds = {
            admin: process.env.ADMIN_ID,
            merchant: newOrder?.merchantId._id,
            agent: newOrder?.agentId,
            customer: newOrder?.customerId,
          };

          // Send notifications to each role dynamically
          await sendSocketDataAndNotification({
            rolesToNotify,
            userIds,
            eventName,
            notificationData,
            socketData,
          });
        }
      }, 60000);
    }
  } catch (err) {
    next(appError(err.message));
  }
};

// Cancel order before getting created
const cancelOrderBeforeCreationController = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    const orderFound = await TemporaryOrder.findOne({
      orderId: mongoose.Types.ObjectId.createFromHexString(orderId),
    });

    if (!orderFound) {
      res.status(200).json({
        success: false,
        message: "Order creation already processed or not found",
      });

      return;
    }

    const customerFound = await Customer.findById(orderFound.customerId);

    let updatedTransactionDetail = {
      customerId: customerFound._id,
      transactionType: "Refund",
      madeOn: new Date(),
      type: "Credit",
    };

    if (orderFound.paymentMode === "Famto-cash") {
      const orderAmount = orderFound.billDetail.grandTotal;
      if (orderFound.deliveryOption === "On-demand") {
        customerFound.customerDetails.walletBalance += orderAmount;
        updatedTransactionDetail.transactionAmount = orderAmount;
      }

      await Promise.all([
        TemporaryOrder.deleteOne({ orderId }),
        customerFound.save(),
        CustomerTransaction.create(updatedTransactionDetail),
      ]);

      res.status(200).json({
        success: true,
        message: "Order cancelled",
      });
      return;
    } else if (orderFound.paymentMode === "Cash-on-delivery") {
      // Remove the temporary order data from the database
      await TemporaryOrder.deleteOne({ orderId });

      res.status(200).json({ success: true, message: "Order cancelled" });
      return;
    } else if (orderFound.paymentMode === "Online-payment") {
      const paymentId = orderFound.paymentId;

      let refundAmount;
      if (orderFound.deliveryOption === "On-demand") {
        refundAmount = orderFound.billDetail.grandTotal;
        updatedTransactionDetail.transactionAmount = refundAmount;
      } else if (orderFound.deliveryOption === "Scheduled") {
        refundAmount =
          orderFound.billDetail.grandTotal / orderFound.numOfDays;
        updatedTransactionDetail.transactionAmount = refundAmount;
      }

      const refundResponse = await razorpayRefund(paymentId, refundAmount);

      if (!refundResponse.success) {
        return next(appError("Refund failed: " + refundResponse.error, 500));
      }

      await Promise.all([
        TemporaryOrder.deleteOne({ orderId }),
        customerFound.save(),
        CustomerTransaction.create(updatedTransactionDetail),
      ]);

      res.status(200).json({
        success: true,
        message: "Order cancelled",
      });
      return;
    }
  } catch (err) {
    next(appError(err.message));
  }
};

// Clear cart
const clearCartController = async (req, res, next) => {
  try {
    const { cartId } = req.params;

    const deleteResult = await CustomerCart.deleteOne({
      _id: cartId,
      customerId: req.userAuth,
    });

    if (deleteResult.deletedCount === 0) {
      return next(appError("Cart not found", 404));
    }

    res.status(200).json({ message: "Cart cleared" });
  } catch (err) {
    next(appError(err.message));
  }
};

const getOrderTrackingDetail = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const [order, task] = await Promise.all([
      Order.findById(orderId).populate("merchantId"),
      Task.findOne({ orderId }).populate("agentId"),
    ]);

    const lastUpdatedShop = order?.detailAddedByAgent?.shopUpdate?.splice(-1);

    const formattedResponse = {
      pickupLocation:
        lastUpdatedShop?.location || order?.orderDetail?.pickupLocation || [],
      deliveryLocation: order?.orderDetail?.deliveryLocation,
      deliveryMode: order?.orderDetail?.deliveryMode,
      agentId: task?.agentId?._id || null,
      agentName: task?.agentId?.fullName || null,
      agentImage: task?.agentId?.agentImageURL || null,
      agentPhone: task?.agentId?.phoneNumber || null,
      merchantId: order?.merchantId?._id || null,
      merchantName: order?.merchantId?.merchantDetail?.merchantName || null,
      merchantPhone: order?.merchantId?.phoneNumber || null,
      deliveryTime: formatTime(order?.orderDetail?.deliveryTime),
      orderCreatedStatus: {
        status: true,
        time: formatTime(order.createdAt),
      },
      inTransit:
        task.pickupDetail.pickupStatus === "Started" ||
          task.pickupDetail.pickupStatus === "Completed" ||
          task.deliveryDetail.deliveryStatus === "Started" ||
          task.deliveryDetail.deliveryStatus === "Completed"
          ? true
          : false,
      completeStatus: order.status === "Completed" ? true : false,
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const getOrderTrackingStepper = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const [order, task] = await Promise.all([
      Order.findById(orderId).populate("merchantId"),
      Task.findOne({ orderId }).populate("agentId"),
    ]);

    const formattedResponse = {
      deliveryTime: formatTime(order.orderDetail.deliveryTime),
      createdAt: true,
      createAt: formatTime(order.createdAt),
      acceptedByAgent: task.taskStatus === "Assigned" ? true : false,
      acceptedAt: formatTime(order.orderDetail.agentAcceptedAt),
      reachedPickupLocation:
        task.pickupDetail.pickupStatus === "Completed" ? true : false,
      reachedPickupLocationAt: formatTime(task?.pickupDetail?.completedTime),
      pickedByAgent:
        task.deliveryDetail.deliveryStatus !== "Accepted" ? true : false,
      pickedByAgentAt: formatTime(task?.deliveryDetail?.startTime),
      noteStatus: order?.detailAddedByAgent?.notes ? true : false,
      note: order?.detailAddedByAgent?.notes || null,
      signatureStatus: order?.detailAddedByAgent?.signatureImageURL
        ? true
        : false,
      signature: order?.detailAddedByAgent?.signatureImageURL || null,
      imageURLStatus: order?.detailAddedByAgent?.imageURL ? true : false,
      imageURL: order?.detailAddedByAgent?.imageURL || null,
      billStatus: true,
      billDetail: order?.billDetail,
      orderCompletedStatus: order.status === "Completed" ? true : false,
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const getSuperMarketMerchant = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    const [merchant, customer] = await Promise.all([
      Merchant.findOne({
        fullName: "Supermarket",
        isBlocked: false,
        isApproved: "Approved",
      }).select("status merchantDetail"),
      Customer.findById(customerId)
        .select("customerDetails.favoriteMerchants")
        .lean(),
    ]);

    const formattedResponse = {
      id: merchant._id,
      merchantName: merchant?.merchantDetail?.merchantName || null,
      description: merchant?.merchantDetail?.description || null,
      averageRating: merchant?.merchantDetail?.averageRating,
      status: merchant?.status,
      restaurantType: merchant?.merchantDetail?.merchantFoodType || null,
      merchantImageURL:
        merchant?.merchantDetail?.merchantImageURL ||
        "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FMerchantDefaultImage.png?alt=media&token=a7a11e18-047c-43d9-89e3-8e35d0a4e231",
      displayAddress: merchant?.merchantDetail?.displayAddress || null,
      preOrderStatus: merchant?.merchantDetail?.preOrderStatus,
      isFavorite:
        customer?.customerDetails?.favoriteMerchants?.includes(merchant._id) ??
        false,
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const fetchTemporaryOrderOfCustomer = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    // Find the latest order for the given customerId
    const latestOrder = await TemporaryOrder.find({ customerId })
      .select("createdAt orderDetail.deliveryMode orderId")
      .sort({ createdAt: -1 });

    const formattedResponse = latestOrder?.map((order) => ({
      _id: order._id,
      orderId: order.orderId,
      deliveryMode: order.deliveryMode,
      createdAt: order.createdAt,
    }));

    res.status(200).json(formattedResponse);
  } catch (err) {
    console.log(err.message);
    next(appError(err.message));
  }
};

const getFiltersFromBusinessCategory = async (req, res, next) => {
  try {
    const { businessCategoryId, filterType } = req.query;

    const businessCategory = await BusinessCategory.findById(
      businessCategoryId
    ).select(filterType);

    if (!businessCategory) {
      return res.status(200).json([]);
    }

    const data = businessCategory[filterType]?.map((filter) => filter);

    res.status(200).json(data);
  } catch (err) {
    next(appError(err.message));
  }
};

const getMerchantTodayAvailability = async (req, res) => {
  try {
    const { merchantId } = req.query;

    const merchant = await Merchant.findById(merchantId, {
      "merchantDetail.availability": 1,
    });

    if (!merchant) {
      return res.status(404).json({ message: "Merchant not found" });
    }

    const availability = merchant.merchantDetail?.availability;

    if (!availability || !availability.type) {
      return res.status(400).json({ message: "Availability data not found" });
    }

    // Convert current time to IST
    const nowUTC = new Date();
    const nowIST = new Date(
      nowUTC.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    );
    const dayIndex = nowIST.getDay(); // 0 = Sunday, 6 = Saturday
    const days = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const today = days[dayIndex];

    // If full-time availability
    if (availability.type === "Full-time") {
      return res.status(200).json({
        type: "Full-time",
        day: today,
        status: "Open all day",
        nextDay: {
          day: days[(dayIndex + 1) % 7],
          startTime: "Anytime",
        },
      });
    }

    // Specific-time availability
    const todayAvailability = availability.specificDays?.[today];

    const nextDayIndex = (dayIndex + 1) % 7;
    const nextDayName = days[nextDayIndex];
    const nextDayAvailability = availability.specificDays?.[nextDayName];

    let nextDayStartTime = "Unavailable";

    if (nextDayAvailability) {
      if (nextDayAvailability.openAllDay) {
        nextDayStartTime = "Anytime";
      } else if (
        nextDayAvailability.specificTime &&
        nextDayAvailability.startTime
      ) {
        const [hours, minutes] = nextDayAvailability.startTime
          .split(":")
          .map(Number);

        // Convert 24-hour to 12-hour format manually
        const hour12 = hours % 12 || 12;
        const ampm = hours >= 12 ? "PM" : "AM";
        const formattedMinutes = minutes.toString().padStart(2, "0");

        nextDayStartTime = `${hour12}:${formattedMinutes} ${ampm}`;
      }
    }

    return res.status(200).json({
      type: "Specific-time",
      day: today,
      todayAvailability,
      nextDay: {
        day: nextDayName,
        startTime: nextDayStartTime,
      },
    });
  } catch (error) {
    console.error("Error fetching merchant availability:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const getImageDisplayType = async (req, res, next) => {
  try {
    const { businessCategoryId } = req.query;

    const category = await BusinessCategory.findById(businessCategoryId).select(
      "imageDisplayType"
    );

    const displayType = category?.imageDisplayType ?? "cover";

    return res.status(200).json({ displayType });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  getAllBusinessCategoryController,
  homeSearchController,
  listRestaurantsController,
  getAllCategoriesOfMerchants,
  getAllProductsOfMerchantController,
  getProductVariantsByProductIdController,
  filterAndSearchMerchantController,
  filterAndSortAndSearchProductsController,
  toggleProductFavoriteController,
  toggleMerchantFavoriteController,
  addRatingToMerchantController,
  getTotalRatingOfMerchantController,
  addOrUpdateCartItemController,
  getDeliveryOptionOfMerchantController,
  // applyPromoCodeController,
  orderPaymentController,
  verifyOnlinePaymentController,
  cancelOrderBeforeCreationController,
  clearCartController,
  // applyTipController,
  confirmOrderDetailController,
  getCartBillController,
  getOrderTrackingDetail,
  getOrderTrackingStepper,
  searchProductsInMerchantToOrderController,
  getSuperMarketMerchant,
  getMerchantData,
  fetchTemporaryOrderOfCustomer,
  getProductsWithVariantsInCart,
  addItemsToCart,
  getFiltersFromBusinessCategory,
  getMerchantTodayAvailability,
  distanceCache,
  getImageDisplayType,
};
