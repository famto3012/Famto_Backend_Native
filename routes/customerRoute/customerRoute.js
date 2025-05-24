const express = require("express");
const isAuthenticated = require("../../middlewares/isAuthenticated");
const { upload } = require("../../utils/imageOperation");
const {
  customerAuthenticateValidations,
  ratingValidations,
  updateCartProductValidations,
} = require("../../middlewares/validators/customerAppValidations/customerAppValidations");

const {
  registerAndLoginController,
  getCustomerProfileController,
  updateCustomerProfileController,
  updateCustomerAddressController,
  getCustomerAddressController,
  addWalletBalanceController,
  verifyWalletRechargeController,
  rateDeliveryAgentController,
  getFavoriteMerchantsController,
  getCustomerOrdersController,
  getSingleOrderDetailController,
  searchOrderController,
  getTransactionOfCustomerController,
  getCustomerSubscriptionDetailController,
  getWalletAndLoyaltyController,
  getCustomerCartController,
  getCustomerAppBannerController,
  getSplashScreenImageController,
  getPickAndDropBannersController,
  getCustomOrderBannersController,
  getAvailableServiceController,
  generateReferralCode,
  getSelectedOngoingOrderDetailController,
  getAllNotificationsOfCustomerController,
  setSelectedGeofence,
  getCurrentOngoingOrders,
  getAllScheduledOrdersOfCustomer,
  getScheduledOrderDetailController,
  getFavoriteProductsController,
  getVisibilityOfReferralAndLoyaltyPoint,
  getMerchantAppBannerController,
  fetchPromoCodesController,
  removeAppliedPromoCode,
  haveValidCart,
  searchProductAndMerchantController,
  verifyCustomerAddressLocation,
  updateOrderTipController,
  applyPromoCode,
} = require("../../controllers/customer/customerController");
const {
  getAllBusinessCategoryController,
  homeSearchController,
  filterAndSearchMerchantController,
  toggleProductFavoriteController,
  toggleMerchantFavoriteController,
  addRatingToMerchantController,
  getTotalRatingOfMerchantController,
  addOrUpdateCartItemController,
  // applyPromoCodeController,
  orderPaymentController,
  verifyOnlinePaymentController,
  listRestaurantsController,
  cancelOrderBeforeCreationController,
  getAllCategoriesOfMerchants,
  getAllProductsOfMerchantController,
  getProductVariantsByProductIdController,
  getDeliveryOptionOfMerchantController,
  clearCartController,
  // applyTipController,
  confirmOrderDetailController,
  getCartBillController,
  getOrderTrackingDetail,
  getOrderTrackingStepper,
  filterAndSortAndSearchProductsController,
  searchProductsInMerchantToOrderController,
  getSuperMarketMerchant,
  getMerchantData,
  fetchTemporaryOrderOfCustomer,
  getProductsWithVariantsInCart,
  addItemsToCart,
  getFiltersFromBusinessCategory,
  getMerchantTodayAvailability,
} = require("../../controllers/customer/universalOrderController");
const {
  addPickUpAddressController,
  addPickAndDropItemsController,
  // addTipAndApplyPromoCodeInPickAndDropController,
  confirmPickAndDropController,
  verifyPickAndDropPaymentController,
  cancelPickBeforeOrderCreationController,
  getVehiclePricingDetailsController,
  initializePickAndDrop,
  getPickAndDropBill,
} = require("../../controllers/customer/pickAndDropController");
const {
  addShopController,
  addItemsToCartController,
  editItemInCartController,
  deleteItemInCartController,
  addDeliveryAddressController,
  // addTipAndApplyPromoCodeInCustomOrderController,
  confirmCustomOrderController,
  cancelCustomBeforeOrderCreationController,
  getSingleItemController,
  getCustomOrderItems,
  getCustomCartBill,
} = require("../../controllers/customer/customOrderController");
const {
  getTimingsForCustomerApp,
} = require("../../controllers/admin/appCustomization/customerAppCustomization");
const isLooselyAuthenticated = require("../../middlewares/isLooselyAuthenticated");

const customerRoute = express.Router();

// Authenticate route
customerRoute.post(
  "/authenticate",
  customerAuthenticateValidations,
  registerAndLoginController
);

// Set selected geofence
customerRoute.post("/set-geofence", isAuthenticated, setSelectedGeofence);

customerRoute.post(
  "/verify-geofence",
  isAuthenticated,
  verifyCustomerAddressLocation
);

// Get customer profile route
customerRoute.get("/profile", isAuthenticated, getCustomerProfileController);

// Edit customer profile route
customerRoute.put(
  "/edit-profile",
  upload.single("image"),
  isAuthenticated,
  updateCustomerProfileController
);

// Update customer address route
customerRoute.patch(
  "/update-address",
  isAuthenticated,
  updateCustomerAddressController
);

// Get customer address route
customerRoute.get(
  "/customer-address",
  isAuthenticated,
  getCustomerAddressController
);

// Get all business categories route
customerRoute.post(
  "/all-business-categories",
  getAllBusinessCategoryController
);

// Search in home
customerRoute.get("/search-home", homeSearchController);

// Business category filters
customerRoute.get("/business-filters", getFiltersFromBusinessCategory);

// List all restaurants in customers geofence
customerRoute.get(
  "/list-restaurants",
  isLooselyAuthenticated,
  listRestaurantsController
);

// Get all categories a merchant
customerRoute.get(
  "/category",
  isLooselyAuthenticated,
  getAllCategoriesOfMerchants
);

// Get all products a merchant
customerRoute.get(
  "/products",
  isLooselyAuthenticated,
  getAllProductsOfMerchantController
);

// Get products with variants in cart
customerRoute.get(
  "/products-with-variants",
  isAuthenticated,
  getProductsWithVariantsInCart
);

// Get all merchant card data
customerRoute.get("/merchant-data", isLooselyAuthenticated, getMerchantData);

// Get variants of a product
customerRoute.get(
  "/merchant/product/:productId/variants",
  isLooselyAuthenticated,
  getProductVariantsByProductIdController
);

// Filter ans search merchants by criteria (Pure veg, Rating, Nearby)
customerRoute.get(
  "/filter-and-search-merchants",
  isLooselyAuthenticated,
  filterAndSearchMerchantController
);

customerRoute.get(
  "/search-products/:merchantId/:businessCategoryId",
  isLooselyAuthenticated,
  searchProductsInMerchantToOrderController
);

customerRoute.get(
  "/products/filter-and-sort/:merchantId",
  isLooselyAuthenticated,
  filterAndSortAndSearchProductsController
);

// Toggle Product favorite
customerRoute.patch(
  "/toggle-product-favorite/:productId",
  isAuthenticated,
  toggleProductFavoriteController
);

// Toggle Merchant favorite
customerRoute.patch(
  "/toggle-merchant-favorite/:merchantId/:businessCategoryId",
  isAuthenticated,
  toggleMerchantFavoriteController
);

// Add ratings to merchant
customerRoute.post(
  "/rate-merchant",
  ratingValidations,
  isAuthenticated,
  addRatingToMerchantController
);

// Get rating details of customer
customerRoute.get(
  "/merchant-rating-details/:merchantId",
  getTotalRatingOfMerchantController
);

// // Update cart items
customerRoute.put(
  "/update-cart",
  updateCartProductValidations,
  isAuthenticated,
  addOrUpdateCartItemController
);

// Update cart items
customerRoute.post("/add-items", isAuthenticated, addItemsToCart);

// Get merchant delivery option
customerRoute.get(
  "/merchant/:merchantId/delivery-option",
  isAuthenticated,
  getDeliveryOptionOfMerchantController
);

// Update cart address details
customerRoute.post(
  "/cart/add-details",
  upload.fields([
    { name: "voiceInstructionToMerchant", maxCount: 1 },
    { name: "voiceInstructionToAgent", maxCount: 1 },
  ]),
  isAuthenticated,
  confirmOrderDetailController
);

// customerRoute.post(
//   "/apply-promocode",
//   isAuthenticated,
//   applyPromoCodeController
// );

// customerRoute.post("/add-tip", isAuthenticated, applyTipController);

customerRoute.post("/confirm-order", isAuthenticated, orderPaymentController);

customerRoute.post(
  "/verify-payment",
  isAuthenticated,
  verifyOnlinePaymentController
);

customerRoute.post(
  "/cancel-universal-order",
  isAuthenticated,
  cancelOrderBeforeCreationController
);

customerRoute.delete(
  "/clear-cart/:cartId",
  isAuthenticated,
  clearCartController
);

customerRoute.post(
  "/wallet-recharge",
  isAuthenticated,
  addWalletBalanceController
);

customerRoute.post(
  "/verify-wallet-recharge",
  isAuthenticated,
  verifyWalletRechargeController
);

customerRoute.post(
  "/rate-agent/:orderId",
  isAuthenticated,
  rateDeliveryAgentController
);

customerRoute.get(
  "/favorite-merchants",
  isAuthenticated,
  getFavoriteMerchantsController
);

customerRoute.get(
  "/favorite-products",
  isAuthenticated,
  getFavoriteProductsController
);

customerRoute.get("/orders", isAuthenticated, getCustomerOrdersController);

customerRoute.get(
  "/scheduled-orders",
  isAuthenticated,
  getAllScheduledOrdersOfCustomer
);

customerRoute.get(
  "/orders/:orderId",
  isAuthenticated,
  getSingleOrderDetailController
);

customerRoute.get(
  "/scheduled-orders-detail",
  isAuthenticated,
  getScheduledOrderDetailController
);

customerRoute.get("/search-orders", isAuthenticated, searchOrderController);

customerRoute.get(
  "/transaction-details",
  isAuthenticated,
  getTransactionOfCustomerController
);

customerRoute.get(
  "/subscription-details",
  isAuthenticated,
  getCustomerSubscriptionDetailController
);

customerRoute.get(
  "/get-promocodes",
  isAuthenticated,
  fetchPromoCodesController
);

customerRoute.get(
  "/get-wallet-and-loyalty",
  isAuthenticated,
  getWalletAndLoyaltyController
);

customerRoute.get("/get-cart", isAuthenticated, getCustomerCartController);

customerRoute.get("/get-cart-bill", isAuthenticated, getCartBillController);

customerRoute.get("/have-cart", isAuthenticated, haveValidCart);

// -------------------------------------
// PICK AND DROP
// -------------------------------------

customerRoute.delete(
  "/initialize-cart",
  isAuthenticated,
  initializePickAndDrop
);

customerRoute.post(
  "/add-pick-and-drop-address",
  upload.fields([
    { name: "voiceInstructionInPickup", maxCount: 1 },
    { name: "voiceInstructionInDelivery", maxCount: 1 },
  ]),
  isAuthenticated,
  addPickUpAddressController
);

customerRoute.get(
  "/get-vehicle-charges",
  isAuthenticated,
  getVehiclePricingDetailsController
);

customerRoute.get(
  "/get-pick-and-drop-bill",
  isAuthenticated,
  getPickAndDropBill
);

customerRoute.post(
  "/add-pick-and-drop-items",
  isAuthenticated,
  addPickAndDropItemsController
);

// customerRoute.post(
//   "/add-tip-and-promocode",
//   isAuthenticated,
//   addTipAndApplyPromoCodeInPickAndDropController
// );

customerRoute.post(
  "/confirm-pick-and-drop",
  isAuthenticated,
  confirmPickAndDropController
);

customerRoute.post(
  "/verify-pick-and-drop",
  isAuthenticated,
  verifyPickAndDropPaymentController
);

customerRoute.post(
  "/cancel-pick-and-drop-order",
  isAuthenticated,
  cancelPickBeforeOrderCreationController
);

// -------------------------------------
// CUSTOM ORDER
// -------------------------------------

customerRoute.post("/add-shop", isAuthenticated, addShopController);

customerRoute.post(
  "/add-item",
  upload.single("itemImage"),
  isAuthenticated,
  addItemsToCartController
);

customerRoute.get("/custom-order-item", isAuthenticated, getCustomOrderItems);

customerRoute.get("/custom-cart-bill", isAuthenticated, getCustomCartBill);

customerRoute.get(
  "/get-item/:itemId",
  isAuthenticated,
  getSingleItemController
);

customerRoute.patch(
  "/edit-item/:itemId",
  upload.single("itemImage"),
  isAuthenticated,
  editItemInCartController
);

customerRoute.delete(
  "/delete-item/:itemId",
  isAuthenticated,
  deleteItemInCartController
);

customerRoute.post(
  "/add-delivery-address",
  upload.single("voiceInstructionToDeliveryAgent"),
  isAuthenticated,
  addDeliveryAddressController
);

// customerRoute.post(
//   "/add-custom-tip-and-promocode",
//   isAuthenticated,
//   addTipAndApplyPromoCodeInCustomOrderController
// );

customerRoute.post(
  "/confirm-custom-order",
  isAuthenticated,
  confirmCustomOrderController
);

customerRoute.post(
  "/cancel-custom-order",
  isAuthenticated,
  cancelCustomBeforeOrderCreationController
);

// Current orders

customerRoute.get(
  "/current-ongoing-orders",
  isAuthenticated,
  getCurrentOngoingOrders
);

customerRoute.get(
  "/get-current-order/:orderId",
  isAuthenticated,
  getSelectedOngoingOrderDetailController
);

// ============================================
// App Banners
// ============================================

customerRoute.get(
  "/app-banners",
  isLooselyAuthenticated,
  getCustomerAppBannerController
);

customerRoute.get("/app-splash-screen", getSplashScreenImageController);

customerRoute.get("/pick-and-drop-banners", getPickAndDropBannersController);

customerRoute.get("/custom-order-banners", getCustomOrderBannersController);

customerRoute.get(
  "/merchant-banner/:merchantId",
  isLooselyAuthenticated,
  getMerchantAppBannerController
);

customerRoute.get("/available-services", getAvailableServiceController);

customerRoute.get("/generate-referral", isAuthenticated, generateReferralCode);

customerRoute.get(
  "/visibility-status",
  isLooselyAuthenticated,
  getVisibilityOfReferralAndLoyaltyPoint
);

customerRoute.get(
  "/all-notifications",
  isAuthenticated,
  getAllNotificationsOfCustomerController
);

customerRoute.get(
  "/customization/timings",
  isLooselyAuthenticated,
  getTimingsForCustomerApp
);

customerRoute.get(
  "/order-tracking/:orderId/detail",
  isAuthenticated,
  getOrderTrackingDetail
);

customerRoute.get(
  "/order-tracking/:orderId/stepper",
  isAuthenticated,
  getOrderTrackingStepper
);

customerRoute.put(
  "/remove-promo-code",
  isAuthenticated,
  removeAppliedPromoCode
);

customerRoute.get("/get-super-market", isAuthenticated, getSuperMarketMerchant);

customerRoute.get(
  "/get-temporary-order",
  isAuthenticated,
  fetchTemporaryOrderOfCustomer
);

customerRoute.get(
  "/get-merchant-product",
  // isAuthenticated,
  searchProductAndMerchantController
);

customerRoute.post("/update-tip", isAuthenticated, updateOrderTipController);

customerRoute.post("/apply-promo", isAuthenticated, applyPromoCode);

customerRoute.get("/merchant-availability", isAuthenticated, getMerchantTodayAvailability);

module.exports = customerRoute;
