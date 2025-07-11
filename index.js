const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const morgan = require("morgan");

const globalErrorHandler = require("./middlewares/globalErrorHandler");

const categoryRoute = require("./routes/adminRoute/merchantRoute/categoryRoute/categoryRoute");
const authRoute = require("./routes/adminRoute/authRoute");
const merchantRoute = require("./routes/adminRoute/merchantRoute/merchantRoute");
const productRoute = require("./routes/adminRoute/merchantRoute/productRoute/productRoute");
const customerRoute = require("./routes/customerRoute/customerRoute");
const agentRoute = require("./routes/agentRoute/agentRoute");
const adminAgentRoute = require("./routes/adminRoute/agentRoute/agentRoute");
const geofenceRoute = require("./routes/adminRoute/geofenceRoute/geofenceRoute");
const adminNotificationRoute = require("./routes/adminRoute/notificationRoute/notificationRoute");
const bannerRoute = require("./routes/adminRoute/bannerRoute/bannerRoute");
const loyaltyPointRoute = require("./routes/adminRoute/loyaltyPointRoute/loyaltyPointRoute");
const managerRoute = require("./routes/adminRoute/managerRoute/managerRoute");
const taxRoute = require("./routes/adminRoute/taxRoute/taxRoute");
const promoCodeRoute = require("./routes/adminRoute/promoCodeRoute/promoCodeRoute");
const businessCategoryRoute = require("./routes/adminRoute/businessCategoryRoute/businessCategoryRoute");
const merchantPricingRoute = require("./routes/adminRoute/pricingRoute/merchantPricingRoute");
const merchantSurgeRoute = require("./routes/adminRoute/pricingRoute/merchantSurgeRoute");
const customerPricingRoute = require("./routes/adminRoute/pricingRoute/customerPricingRoute");
const customerSurgeRoute = require("./routes/adminRoute/pricingRoute/customerSurgeRoute");
const agentPricingRoute = require("./routes/adminRoute/pricingRoute/agentPricingRoute");
const agentSurgeRoute = require("./routes/adminRoute/pricingRoute/agentSurgeRoute");
const merchantDiscountRoute = require("./routes/adminRoute/discountRoute/merchantDiscountRoute");
const productDiscountRoute = require("./routes/adminRoute/discountRoute/productDiscountRoute");
const appBannerRoute = require("./routes/adminRoute/bannerRoute/appBannerRoute");
const appCustomizationRoute = require("./routes/adminRoute/appCustomizationRoute/appCustomizationRoute");
const { deleteExpiredSponsorshipPlans } = require("./utils/sponsorshipHelpers");
const settingsRoute = require("./routes/adminRoute/settingsRoute/settingsRoute");
const referralRoute = require("./routes/adminRoute/referralRoute/referralRoute");
const adminCustomerRoute = require("./routes/adminRoute/customerRoute/customerRoute");
const serviceCategoryRoute = require("./routes/adminRoute/serviceCategoryRoute/serviceCategoryRoute");
const pickAndDropBannerRoute = require("./routes/adminRoute/bannerRoute/pickAndDropBannerRoute");
const customOrderBannerRoute = require("./routes/adminRoute/bannerRoute/customOrderBannerRoute");
const accountLogRoute = require("./routes/adminRoute/accountLogRoute/accountLogRoute");
const commissionRoute = require("./routes/adminRoute/commissionAndSubscriptionRoute/commissionRoute");
const subscriptionRoute = require("./routes/adminRoute/commissionAndSubscriptionRoute/subscriptionRoute");
const subscriptionLogRoute = require("./routes/adminRoute/subscriptionLogRoute/subscriptionLogRoute");
const {
  deleteExpiredSubscriptionPlans,
} = require("./utils/subscriptionHelpers");
const orderRoute = require("./routes/adminRoute/orderRoute/orderRoute");
const autoAllocationRoute = require("./routes/adminRoute/deliveryManagementRoute/autoAllocationRoute");

require("dotenv").config();
require("./config/dbConnect");
require("./DBSeeder/adminSeeder");
require("./automation");

const {
  createOrdersFromScheduled,
  updateOneDayLoyaltyPointEarning,
  createOrdersFromScheduledPickAndDrop,
  deleteOldLoyaltyPoints,
} = require("./utils/customerAppHelpers");
const { app, server, populateUserSocketMap } = require("./socket/socket.js");
const ScheduledOrder = require("./models/ScheduledOrder.js");
const taskRoute = require("./routes/adminRoute/deliveryManagementRoute/taskRoute.js");
const {
  moveAppDetailToWorkHistoryAndResetForAllAgents,
} = require("./utils/agentAppHelpers.js");
const tokenRoute = require("./routes/tokenRoute/tokenRoute.js");
const {
  generateMapplsAuthToken,
} = require("./controllers/Token/tokenOperation.js");
const messageRoute = require("./routes/customerRoute/messageRoute.js");
const deleteExpiredConversationsAndMessages = require("./utils/deleteChatDataHelper.js");
const scheduledPickAndCustom = require("./models/ScheduledPickAndCustom.js");
const homeRoute = require("./routes/adminRoute/homeRoute/homeRoute.js");
const mapRoute = require("./routes/adminRoute/mapRoute/mapRoute.js");
const {
  fetchPerDayRevenue,
  fetchMerchantDailyRevenue,
} = require("./utils/createPerDayRevenueHelper.js");
const activityLogRoute = require("./routes/adminRoute/activityLogRoute/activityLogRoute.js");
const {
  preparePayoutForMerchant,
  resetStatusManualToggleForAllMerchants,
} = require("./utils/merchantHelpers.js");
const {
  deleteOldActivityLogs,
} = require("./controllers/admin/activityLogs/activityLogController.js");
const whatsappRoute = require("./routes/whatsappRoute/whatsappRoute.js");
const { deleteOldLogs, deleteOldTasks } = require("./libs/automatic.js");
const {
  distanceCache,
} = require("./controllers/customer/universalOrderController.js");

//middlewares
app.use(express.json({ limit: "10mb" }));
app.use(morgan("tiny"));
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: [
      "https://dashboard.famto.in",
      "http://localhost:5173",
      "http://localhost:5174",
      "https://famto.in",
      "https://www.famto.in",
      "https://order.famto.in",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  })
);

// =====================================================
// ------------------Routers----------------------------
// =====================================================

// ===================================
// ---------------Admin---------------
// ===================================

app.use("/api/v1/auth", authRoute); //Login is same for both Admin & Merchant
app.use("/api/v1/merchants", merchantRoute); //can be used by both admin and merchant
app.use("/api/v1/admin/agents", adminAgentRoute);
app.use("/api/v1/admin/geofence", geofenceRoute);
app.use("/api/v1/admin/home", homeRoute);
app.use("/api/v1/categories", categoryRoute); //can be used by both admin and merchant
app.use("/api/v1/products", productRoute); //can be used by both admin and merchant
app.use("/api/v1/admin/notification", adminNotificationRoute);
app.use("/api/v1/admin/banner", bannerRoute);
app.use("/api/v1/admin/app-banner", appBannerRoute);
app.use("/api/v1/admin/pick-and-drop-banner", pickAndDropBannerRoute);
app.use("/api/v1/admin/custom-order-banner", customOrderBannerRoute);
app.use("/api/v1/admin/loyalty-point", loyaltyPointRoute);
app.use("/api/v1/admin/promocode", promoCodeRoute);
app.use("/api/v1/merchant/shop-discount", merchantDiscountRoute);
app.use("/api/v1/admin/shop-discount", merchantDiscountRoute);
app.use("/api/v1/admin/product-discount", productDiscountRoute);
app.use("/api/v1/merchant/product-discount", productDiscountRoute);
app.use("/api/v1/admin/managers", managerRoute);
app.use("/api/v1/admin/app-customization", appCustomizationRoute);
app.use("/api/v1/admin/taxes", taxRoute);
app.use("/api/v1/admin/business-categories", businessCategoryRoute);
app.use("/api/v1/admin/service-categories", serviceCategoryRoute);
app.use("/api/v1/admin/merchant-pricing", merchantPricingRoute);
app.use("/api/v1/admin/merchant-surge", merchantSurgeRoute);
app.use("/api/v1/admin/customer-pricing", customerPricingRoute);
app.use("/api/v1/admin/customer-surge", customerSurgeRoute);
app.use("/api/v1/admin/agent-pricing", agentPricingRoute);
app.use("/api/v1/admin/agent-surge", agentSurgeRoute);
app.use("/api/v1/settings", settingsRoute);
app.use("/api/v1/referrals", referralRoute);
app.use("/api/v1/admin/customers", adminCustomerRoute);
app.use("/api/v1/admin/account-log", accountLogRoute);
app.use("/api/v1/admin/commission", commissionRoute);
app.use("/api/v1/admin/subscription", subscriptionRoute);
app.use("/api/v1/admin/subscription-payment", subscriptionLogRoute);
app.use("/api/v1/merchant/subscription-payment", subscriptionLogRoute);
app.use("/api/v1/orders", orderRoute);
app.use("/api/v1/admin/auto-allocation", autoAllocationRoute);
app.use("/api/v1/admin/delivery-management", taskRoute);
app.use("/api/v1/admin/map", mapRoute);
app.use("/api/v1/admin/activity-log", activityLogRoute);

// =====================
// --------Agent--------
// =====================
app.use("/api/v1/agents", agentRoute);

// ========================
// --------Customer--------
// ========================
app.use("/api/v1/customers", customerRoute);
app.use("/api/v1/customers/chat", messageRoute);
app.use("/api/v1/customers/subscription-payment", subscriptionLogRoute);

// =====================
// --------Token--------
// =====================
app.use("/api/v1/token", tokenRoute);
// =====================
// --------Whatsapp--------
// =====================
app.use("/api/v1/whatsapp", whatsappRoute);

// Schedule the task to run four times daily for deleting expired plans of Merchants and customer
cron.schedule("0 6,12,18,0 * * *", async () => {
  await Promise.all([
    deleteExpiredSponsorshipPlans(),
    deleteExpiredSubscriptionPlans(),
  ]);
});

// Mid night cron jobs
cron.schedule("30 18 * * *", async () => {
  const now = new Date();

  await Promise.all([
    moveAppDetailToWorkHistoryAndResetForAllAgents(),
    preparePayoutForMerchant(),
    updateOneDayLoyaltyPointEarning(),
    fetchPerDayRevenue(now),
    fetchMerchantDailyRevenue(now),
    generateMapplsAuthToken(),
    resetStatusManualToggleForAllMerchants(),
    deleteOldLoyaltyPoints(),
    deleteOldActivityLogs(),
    removeOldNotifications(),
    removeExpiredMerchantDiscounts(),
    removeExpiredProductDiscount(),
    removeExpiredPromoCode(),
    deleteOldLogs(),
    deleteOldTasks()
  ]);
});

// Cron jobs for every minutes
cron.schedule("* * * * *", async () => {
  deleteExpiredConversationsAndMessages();
  populateUserSocketMap();

  const now = new Date();

  const fiveMinutesBefore = new Date(now.getTime() - 5 * 60 * 1000);
  const fiveMinutesAfter = new Date(now.getTime() + 5 * 60 * 1000);

  // Universal Order
  const universalScheduledOrders = await ScheduledOrder.find({
    status: "Pending",
    startDate: { $lte: now },
    endDate: { $gte: now },
    time: { $gte: fiveMinutesBefore, $lte: fiveMinutesAfter },
  });

  if (universalScheduledOrders.length) {
    for (const scheduledOrder of universalScheduledOrders) {
      await createOrdersFromScheduled(scheduledOrder);
    }
  }

  // Pick and Drop order
  const pickAndDropScheduledOrders = await scheduledPickAndCustom.find({
    status: "Pending",
    startDate: { $lte: now },
    endDate: { $gte: now },
    time: { $gte: fiveMinutesBefore, $lte: fiveMinutesAfter },
  });

  if (pickAndDropScheduledOrders.length) {
    for (const scheduledOrder of pickAndDropScheduledOrders) {
      await createOrdersFromScheduledPickAndDrop(scheduledOrder);
    }
  }
});

cron.schedule("*/5 * * * *", () => {
  Object.keys(distanceCache).forEach((key) => delete distanceCache[key]);
});

// Global errors
app.use(globalErrorHandler);

// 404 Error
app.use("*", (req, res) => {
  res.status(404).json({
    message: `${req.originalUrl} - Path not found`,
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`Server is running`);
});
