const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const morgan = require("morgan");
const moment = require("moment-timezone");
const TemporaryOrder = require("./models/TemporaryOrder");
const Order = require("./models/Order");
const CustomerCart = require("./models/CustomerCart");
const Customer = require("./models/Customer");
const Merchant = require("./models/Merchant");
const globalErrorHandler = require("./middlewares/globalErrorHandler");
const { sendCartReminderMessage } = require("./utils/interaktHelper");

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
const { app, server, populateUserSocketMap, findRolesToNotify } = require("./socket/socket.js");
const ActivityLog = require("./models/ActivityLog");
const CustomerWalletTransaction = require("./models/CustomerWalletTransaction");
const { sendSocketDataAndNotification } = require("./utils/socketHelper");
const { formatDate, formatTime } = require("./utils/formatters");
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
const processOrderService = require("./utils/ProcessOrderService.js");
const { fetchRazorpayOrderPayments } = require("./utils/razorpayPayment.js");


app.use(
  "/api/v1/customers/razorpay-webhook",
  express.raw({ type: "application/json" })
);

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
    deleteOldTasks(),
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


cron.schedule("*/5 * * * * *", async () => {
  try {

    while (true) {
      const tempOrder = await TemporaryOrder.findOneAndUpdate(
        {
          processingStatus: "PENDING",

          $or: [
            {
              paymentMode: "Famto-cash",
              paymentStatus: "PAYMENT_COMPLETED",
              expiresAt: {
                $lte: new Date(),
              },
            },

            {
              paymentMode: "Cash-on-delivery",
              expiresAt: {
                $lte: new Date(),
              },
            },

            {
              paymentMode: "Online-payment",
              paymentStatus: "PAYMENT_COMPLETED",
              createdAt: {
                $lte: new Date(Date.now() - 60 * 1000),
              },
            },
          ],
        },
        {
          $set: {
            processingStatus: "PROCESSING",
          },
        },
        {
          new: true,
          sort: {
            createdAt: 1,
          },
        }
      );

      if (!tempOrder) {
        break;
      }

      try {
        const createdOrder = await processOrderService(tempOrder);

        console.log(
          `✅ Order created successfully for ${tempOrder._id}`
        );

        // Send notifications for the newly created order
        try {
          const isScheduled = tempOrder.deliveryOption === "Scheduled";
          const populatedOrder = isScheduled
            ? await ScheduledOrder.findById(createdOrder._id).populate("merchantId")
            : await Order.findById(createdOrder._id).populate("merchantId");

          const eventName = "newOrderCreated";
          const { rolesToNotify, data } = await findRolesToNotify(eventName);

          const notificationData = {
            fcm: {
              orderId: createdOrder._id,
              customerId: createdOrder.customerId,
            },
          };

          const socketData = {
            ...data,
            orderId: createdOrder._id,
            billDetail: createdOrder.billDetail,
            _id: createdOrder._id,
            orderStatus: createdOrder.status,
            merchantName:
              populatedOrder?.merchantId?.merchantDetail?.merchantName || "-",
            customerName:
              populatedOrder?.drops?.[0]?.address?.fullName || "-",
            deliveryMode: createdOrder?.deliveryMode,
            orderDate: formatDate(createdOrder.createdAt),
            orderTime: formatTime(createdOrder.createdAt),
            deliveryDate: createdOrder?.deliveryTime
              ? formatDate(createdOrder.deliveryTime)
              : "-",
            deliveryTime: createdOrder?.deliveryTime
              ? formatTime(createdOrder.deliveryTime)
              : "-",
            paymentMethod: createdOrder.paymentMode,
            deliveryOption: createdOrder.deliveryOption,
            amount: createdOrder.billDetail?.grandTotal,
          };

          const userIds = {
            admin: process.env.ADMIN_ID,
            merchant: populatedOrder?.merchantId?._id,
            agent: createdOrder?.agentId,
            customer: createdOrder?.customerId,
          };

          await sendSocketDataAndNotification({
            rolesToNotify,
            userIds,
            eventName,
            notificationData,
            socketData,
          });
        } catch (notifErr) {
          console.error(
            `⚠️ Order created but notification failed for ${tempOrder._id}:`,
            notifErr.message
          );
        }
      } catch (err) {
        const retryCount =
          (tempOrder.retryCount || 0) + 1;

        if (retryCount >= 5) {
          await TemporaryOrder.findByIdAndUpdate(
            tempOrder._id,
            {
              processingStatus: "FAILED",
              retryCount,
              lastError: err.message,
            }
          );

          console.error(
            `💀 Order permanently failed ${tempOrder._id}`
          );
        } else {
          await TemporaryOrder.findByIdAndUpdate(
            tempOrder._id,
            {
              processingStatus: "PENDING",
              retryCount,
              lastError: err.message,
            }
          );

          console.error(
            `⚠️ Retry ${retryCount} for ${tempOrder._id}`
          );
        }
      }
    }
  } catch (err) {
    console.error(
      "🔥 ORDER PROCESSOR CRON ERROR:",
      err.message
    );
  }
});


cron.schedule("*/5 * * * *", () => {
  Object.keys(distanceCache).forEach((key) => delete distanceCache[key]);
});

// ─── Reconciliation Job (every 5-10 min) — Check Razorpay API for missed webhooks
cron.schedule("*/5 * * * *", async () => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Find Pending TemporaryOrders — webhook hasn't arrived yet
    const stuckOrders = await TemporaryOrder.find({
      paymentMode: "Online-payment",
      paymentStatus: "PENDING_PAYMENT",
      processingStatus: "PENDING",
      createdAt: { $lte: fiveMinutesAgo },
      razorpayOrderId: { $ne: null },
    }).lean();

    if (!stuckOrders.length) return;

    console.log(`[Reconciliation] Found ${stuckOrders.length} pending online payment(s)`);

    for (const tempOrder of stuckOrders) {
      try {
        // Check Razorpay API directly
        const { captured, paymentId } = await fetchRazorpayOrderPayments(
          tempOrder.razorpayOrderId
        );

        if (captured) {
          // Fix Missed Webhook — Update Status so cron worker picks it up
          await TemporaryOrder.findOneAndUpdate(
            { _id: tempOrder._id, paymentStatus: "PENDING_PAYMENT" },
            { paymentStatus: "PAYMENT_COMPLETED", paymentId }
          );
          console.log(
            `[Reconciliation] ✅ Fixed missed webhook for ${tempOrder.razorpayOrderId}`
          );
        } else {
          const ageHours =
            (Date.now() - new Date(tempOrder.createdAt).getTime()) /
            (1000 * 60 * 60);

          if (ageHours > 2) {
            // Abandoned payment — mark as failed
            await TemporaryOrder.findByIdAndUpdate(tempOrder._id, {
              paymentStatus: "PAYMENT_FAILED",
            });
            console.error(
              `[Reconciliation] ❌ Abandoned payment after ${ageHours.toFixed(1)}h: ${tempOrder.razorpayOrderId}`
            );
          }
        }
      } catch (err) {
        console.error(
          `[Reconciliation] Error checking ${tempOrder.razorpayOrderId}:`,
          err.message
        );
      }
    }

    // ── Fix stuck "processing" orders (server crashed mid-processing) ────────
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const stuckProcessing = await TemporaryOrder.updateMany(
      {
        processingStatus: "PROCESSING",
        updatedAt: { $lte: twoMinutesAgo },
      },
      { $set: { processingStatus: "PENDING" } }
    );

    if (stuckProcessing.modifiedCount > 0) {
      console.log(
        `[Reconciliation] 🔄 Reset ${stuckProcessing.modifiedCount} stuck "processing" order(s)`
      );
    }

    // ── Dead-letter items (failed processingStatus with maxRetries reached) ──
    const deadLetters = await TemporaryOrder.find({
      processingStatus: "FAILED",
    }).lean();

    if (deadLetters.length) {
      console.error(
        `[Reconciliation] 💀 ${deadLetters.length} dead-letter order(s) need manual review:`,
        deadLetters.map((d) => ({
          id: d._id,
          razorpayOrderId: d.razorpayOrderId,
          retryCount: d.retryCount,
          lastError: d.lastError,
        }))
      );
    }
  } catch (err) {
    console.error("[Reconciliation] Cron error:", err.message);
  }
});


cron.schedule(
  "30 18 * * *",
  async () => {
    try {
      console.log("[CartReminder] Running daily cart reminder cron...");

      // START OF TODAY (IST)
      const startOfDay = moment()
        .tz("Asia/Kolkata")
        .startOf("day")
        .toDate();

      // END OF TODAY (IST)
      const endOfDay = moment()
        .tz("Asia/Kolkata")
        .endOf("day")
        .toDate();

      const carts = await CustomerCart.find({
        "items.0": { $exists: true },

        // ONLY TODAY'S CARTS
        updatedAt: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      })
        .populate("customerId", "phoneNumber fullName")
        .populate("merchantId", "merchantName")
        .populate("items.productId", "productName")
        .lean();

      if (!carts.length) {
        console.log("[CartReminder] No carts found.");
        return;
      }

      for (const cart of carts) {
        try {
          const customer = cart.customerId;

          if (!customer?.phoneNumber) continue;

          const merchantName =
            cart.merchantId?.merchantName || "your favourite store";

          const productNames = (cart.items || [])
            .map(
              (item) =>
                item.productId?.productName ||
                item.itemName ||
                "item"
            )
            .filter(Boolean)
            .join(", ");

          if (!productNames) continue;

          await sendCartReminderMessage(
            customer.phoneNumber,
            merchantName,
            productNames
          );
        } catch (innerErr) {
          console.error(
            "[CartReminder] Error sending reminder:",
            innerErr.message
          );
        }
      }

      console.log(
        `[CartReminder] Sent reminders for ${carts.length} cart(s).`
      );
    } catch (err) {
      console.error("[CartReminder] Cron job failed:", err.message);
    }
  },

  // IMPORTANT
  {
    timezone: "Asia/Kolkata",
  }
);

// ─── WhatsApp Scheduled Campaign Processor (every minute) ───────────────────
const { processCampaignSend } = require("./controllers/whatsapp/campaignController");
const WhatsappCampaign = require("./models/WhatsappCampaign");

cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const dueCampaigns = await WhatsappCampaign.find({
      status: "scheduled",
      scheduledAt: { $lte: now },
    });

    if (!dueCampaigns.length) return;

    console.log(`[CampaignCron] ${dueCampaigns.length} scheduled campaign(s) due`);

    for (const campaign of dueCampaigns) {
      // Mark as sending immediately to prevent double-fire
      campaign.status = "sending";
      campaign.sentAt = now;
      await campaign.save();

      processCampaignSend(campaign, null).catch((err) =>
        console.error(`[CampaignCron] Campaign ${campaign._id} failed:`, err.message)
      );
    }
  } catch (err) {
    console.error("[CampaignCron] Error:", err.message);
  }
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
