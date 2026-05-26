const socketio = require("socket.io");
const http = require("http");
const express = require("express");
const Task = require("../models/Task");
const Agent = require("../models/Agent");
const Merchant = require("../models/Merchant");
const turf = require("@turf/turf");
const Order = require("../models/Order");
const FcmToken = require("../models/fcmToken");
const AgentNotificationLogs = require("../models/AgentNotificationLog");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const CustomerNotificationLogs = require("../models/CustomerNotificationLog");
const AdminNotificationLogs = require("../models/AdminNotificationLog");
const MerchantNotificationLogs = require("../models/MerchantNotificationLog");
const {
  getDistanceFromPickupToDelivery,
  getDeliveryAndSurgeCharge,
  calculateDeliveryCharges,
} = require("../utils/customerAppHelpers");
const {
  calculateAgentEarnings,
  updateAgentDetails,
  updateBillOfCustomOrderInDelivery,
} = require("../utils/agentAppHelpers");
const NotificationSetting = require("../models/NotificationSetting");
const admin1 = require("firebase-admin");
const admin2 = require("firebase-admin");
const CustomerPricing = require("../models/CustomerPricing");
const AutoAllocation = require("../models/AutoAllocation");
const { formatDate, formatTime } = require("../utils/formatters");
const Admin = require("../models/Admin");
const ManagerRoles = require("../models/ManagerRoles");
const Manager = require("../models/Manager");
const mongoose = require("mongoose");
const AgentAppCustomization = require("../models/AgentAppCustomization");
const cron = require("node-cron");
const {
  automaticStatusOfflineForAgent,
  automaticStatusToggleForMerchant,
  checkOrdersNearDelivery,
} = require("../libs/automatic");
const BatchOrder = require("../models/BatchOrder");

const serviceAccount1 = {
  type: process.env.TYPE_1,
  project_id: process.env.PROJECT_ID_1,
  private_key_id: process.env.PRIVATE_KEY_ID_1,
  private_key: process.env.PRIVATE_KEY_1,
  client_email: process.env.CLIENT_EMAIL_1,
  client_id: process.env.CLIENT_ID_1,
  auth_uri: process.env.AUTH_URI_1,
  token_uri: process.env.TOKEN_URI_1,
  auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL_1,
  client_x509_cert_url: process.env.CLIENT_X509_CERT_URL_1,
  universe_domain: process.env.UNIVERSE_DOMAIN_1,
};

const serviceAccount2 = {
  type: process.env.TYPE_2,
  project_id: process.env.PROJECT_ID_2,
  private_key_id: process.env.PRIVATE_KEY_ID_2,
  private_key: process.env.PRIVATE_KEY_2,
  client_email: process.env.CLIENT_EMAIL_2,
  client_id: process.env.CLIENT_ID_2,
  auth_uri: process.env.AUTH_URI_2,
  token_uri: process.env.TOKEN_URI_2,
  auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL_2,
  client_x509_cert_url: process.env.CLIENT_X509_CERT_URL_2,
  universe_domain: process.env.UNIVERSE_DOMAIN_2,
};

const app1 = admin1.initializeApp(
  {
    credential: admin1.credential.cert(serviceAccount1),
  },
  "project1"
);

const app2 = admin2.initializeApp(
  {
    credential: admin2.credential.cert(serviceAccount2),
  },
  "project2"
);

const app = express();
const server = http.createServer(app);
console.log("server", server);
const io = socketio(server, {
  transports: ["websocket"],
  cors: {
    origin: ["https://dashboard.famto.in", "http://localhost:8080"], // Replace with the correct URL of your React app
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  },
  pingInterval: 10000, // 10 seconds
  pingTimeout: 5000, // 5 seconds
  reconnection: true,
  reconnectionAttempts: Infinity, // Unlimited attempts
});

const userSocketMap = {};

const sendPushNotificationToUser = async (fcmToken, message, eventName) => {
  console.log("=========== PUSH DEBUG ===========");
  console.log("Event:", eventName);
  console.log("Token:", fcmToken);
  console.log("Order:", message?.orderId);
  console.log("==================================");

  const notificationSettings = await NotificationSetting.findOne({
    event: eventName || "",
    status: true,
  });

  const payload = {
    notification: {
      title: notificationSettings?.title || message?.title || "New Notification",
      body: notificationSettings?.description || message?.body || "",
      image: message?.image || "",
    },
    data: {
      orderId: String(message?.orderId || ""),
      merchantName: String(message?.merchantName || ""),
      pickAddress: JSON.stringify(message?.pickAddress || {}),
      customerName: String(message?.customerName || ""),
      customerAddress: JSON.stringify(message?.customerAddress || {}),
      orderType: String(message?.orderType || ""),
      taskDate: String(message?.taskDate || ""),
      taskTime: String(message?.taskTime || ""),
      timer: String(message?.timer || ""),
    },
    webpush: {
      fcm_options: {
        link: "https://dashboard.famto.in/home",
      },
      notification: {
        icon: "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/admin_panel_assets%2FGroup%20427320384.svg?alt=media",
      },
    },
    token: fcmToken,
  };

  // ✅ Try Project 1 first
  try {
    console.log("Sending push using Firebase Project 1...");
    const response = await admin1.messaging(app1).send(payload);
    console.log("Push Success (Project1):", response);
    return true;
  } catch (error1) {
    console.error("Project1 failed:", error1.message);

    // ✅ Fall back to Project 2
    try {
      console.log("Retrying push using Firebase Project 2...");
      const response = await admin2.messaging(app2).send(payload);
      console.log("Push Success (Project2):", response);
      return true;
    } catch (error2) {
      console.error("Project2 failed:", error2.message);

      // ✅ Auto-clean invalid tokens from DB
      const invalidErrors = [
        "registration-token-not-registered",
        "invalid-registration-token",
        "Requested entity was not found",
        "SenderId mismatch",
      ];

      const shouldClean = invalidErrors.some((e) =>
        error2.message?.includes(e)
      );

      if (shouldClean) {
        try {
          await FcmToken.updateMany(
            { token: fcmToken },
            { $pull: { token: fcmToken } }
          );
          console.log("Cleaned invalid FCM token:", fcmToken);
        } catch (cleanErr) {
          console.error("Failed to clean FCM token:", cleanErr.message);
        }
      }

      return false;
    }
  }
};

// const sendPushNotificationToUser = async (fcmToken, message, eventName) => {
//   const notificationSettings = await NotificationSetting.findOne({
//     event: eventName || "",
//     status: true,
//   });

//  const mes = {
//   notification: {
//     title: notificationSettings?.title || message?.title,
//     body: notificationSettings?.description || message?.body,
//     image: message?.image,
//   },
//   data: {
//     orderId: String(message?.orderId || ""),
//     merchantName: String(message?.merchantName || ""),
//     pickAddress: JSON.stringify(message?.pickAddress || {}),
//     customerName: String(message?.customerName || ""),
//     customerAddress: JSON.stringify(message?.customerAddress || {}),
//     orderType: String(message?.orderType || ""),
//     taskDate: String(message?.taskDate || ""),
//     taskTime: String(message?.taskTime || ""),
//     timer: String(message?.timer || ""),
//   },
//   webpush: {
//     fcm_options: {
//       link: "https://dashboard.famto.in/home",
//     },
//     notification: {
//       icon: "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/admin_panel_assets%2FGroup%20427320384.svg?alt=media&token=0be47a53-43f3-4887-9822-3baad0edd31e",
//     },
//   },
//   token: fcmToken,
// };
//   try {
//     // Try sending with the first project
//     await admin1.messaging(app1).send(mes);
//     console.log(
//       `Successfully sent message with project1 for token: ${fcmToken}`
//     );
//     return true;
//   } catch (error1) {
//     console.error(
//       `Error sending message with project1 for token: ${fcmToken}`,
//       error1
//     );

//     try {
//       // Try sending with the second project
//       await admin2.messaging(app2).send(mes);
//       console.log(
//         `Successfully sent message with project2 for token: ${fcmToken}`
//       );
//       return true;
//     } catch (error2) {
//       console.error(
//         `Error sending message with project2 for token: ${fcmToken}`,
//         error2
//       );
//       return false;
//     }
//   }
// };

const createNotificationLog = async (notificationSettings, message) => {
  const baseDescription = notificationSettings?.description || message?.body || "";
  const description = message?.agentName
    ? `${message.agentName} ${baseDescription}`
    : baseDescription;

  const logData = {
    imageUrl: message?.image,
    title: notificationSettings?.title || message?.title,
    description,
    ...(!notificationSettings?.customer && { orderId: message?.orderId }),
  };

  console.log("Log data to be created:", message);
  console.log("Message payload for log:", JSON.stringify(message, null, 2));

  try {
    if (notificationSettings?.customer) {
      try {
        await CustomerNotificationLogs.create({
          ...logData,
          customerId: message?.customerId,
        });
      } catch (err) {
        console.log(`Error in creating Customer notification log: ${err}`);
      }
    } else if (message?.sendToCustomer) {
      try {
        await CustomerNotificationLogs.create({
          ...logData,
          customerId: message?.customerId,
        });
      } catch (err) {
        console.log(`Error in creating Customer notification log: ${err}`);
      }
    }

    if (notificationSettings?.merchant) {
      try {
        // console.log("Data", logData);
        await MerchantNotificationLogs.create({
          ...logData,
          merchantId: message?.merchantId,
          orderId: message?.orderId,
        });
      } catch (err) {
        console.log(`Error in creating Merchant notification log: ${err}`);
      }
    }

    if (notificationSettings?.driver) {
      try {
        // Normalise orderId to an array for consistent querying
        const orderIdArray = Array.isArray(message?.orderId)
          ? message.orderId
          : message?.orderId
            ? [message.orderId]
            : [];

        // ── Guard: never create a new "Pending" log when the order already
        // has an Accepted / Completed log (prevents duplicates on events like
        // agentOrderAccepted or orderCompleted that also have driver:true).
        if (orderIdArray.length > 0) {
          const settledLog = await AgentNotificationLogs.findOne({
            orderId: { $in: orderIdArray },
            status: { $in: ["Accepted", "Completed"] },
          });

          if (settledLog) {
            console.log(
              `[NotifLog] Order ${orderIdArray} already ${settledLog.status} — skipping duplicate AgentNotificationLog`
            );
            // Still fall through to admin/other log creation below
            return;
          }
        }

        // Delete any stale "Pending" log for the same agent + order
        const pendingLog = await AgentNotificationLogs.findOne({
          agentId: message?.agentId,
          orderId: message?.orderId,
          status: "Pending",
        });

        if (pendingLog)
          await AgentNotificationLogs.findByIdAndDelete(pendingLog._id);

        console.log("Message Data", message);

        const pickupDetail =
          message?.pickups?.length > 0
            ? {
              name: message.pickups[0]?.address?.fullName,
              address: {
                fullName: message.pickups[0]?.address?.fullName,
                phoneNumber: message.pickups[0]?.address?.phoneNumber,
                flat: message.pickups[0]?.address?.flat,
                area: message.pickups[0]?.address?.area,
                landmark: message.pickups[0]?.address?.landmark,
              },
            }
            : message?.pickAddress
              ? {
                name: message.pickAddress?.fullName,
                address: {
                  fullName: message.pickAddress?.fullName,
                  phoneNumber: message.pickAddress?.phoneNumber,
                  flat: message.pickAddress?.flat,
                  area: message.pickAddress?.area,
                  landmark: message.pickAddress?.landmark,
                },
              }
              : {};

        const deliveryDetails =
          Array.isArray(message?.drops) && message.drops.length > 0
            ? message.drops.map((drop) => ({
              name: drop?.address?.fullName,
              address: {
                fullName: drop?.address?.fullName,
                phoneNumber: drop?.address?.phoneNumber,
                flat: drop?.address?.flat,
                area: drop?.address?.area,
                landmark: drop?.address?.landmark,
              },
            }))
            : message?.customerAddress
              ? [
                {
                  name: message.customerAddress?.fullName,
                  address: {
                    fullName: message.customerAddress?.fullName,
                    phoneNumber: message.customerAddress?.phoneNumber,
                    flat: message.customerAddress?.flat,
                    area: message.customerAddress?.area,
                    landmark: message.customerAddress?.landmark,
                  },
                },
              ]
              : [];

        await AgentNotificationLogs.create({
          ...logData,
          agentId: message?.agentId,
          orderId: message?.orderId,
          isBatchOrder: message?.isBatchOrder,
          pickupDetail,
          deliveryDetail: deliveryDetails,
          orderType: message?.orderType,
          expiresIn: message?.timer || 60,
        });

        console.log("[NotifLog] AgentNotificationLog created");
      } catch (err) {
        console.log(`Error in creating agent notification log: ${err.message}`);
      }
    }

    if (notificationSettings?.admin) {
      await AdminNotificationLogs.create({
        ...logData,
        orderId: message?.orderId,
        merchantId: message?.merchantId || null,
      });
    }
  } catch (err) {
    console.error(`Error in creating logs: ${err}`);
  }
};

const sendNotification = async (userId, eventName, data, role) => {
  const { fcmToken } = userSocketMap[userId] || {};

  if (!fcmToken || fcmToken.length === 0) {
    console.log(`No fcmToken found for userId: ${userId}`);
    return;
  }

  let notificationSent = true;

  const notificationSettings = await NotificationSetting.findOne({
    event: eventName || "",
    status: true,
  });

  // Loop through all FCM tokens and send the notification to each one
  for (let token of fcmToken) {
    if (token) {
      const sent = await sendPushNotificationToUser(token, data.fcm, eventName);
      if (sent) notificationSent = true; // Mark as sent if at least one succeeds
    }
  }

  // Log notification if at least one was sent successfully
  if (notificationSent) {
    // console.log("Creating notification log: ", notificationSettings);
    console.log("Creating notification logss: ", data.fcm);
    await createNotificationLog(notificationSettings, data.fcm);
  } else {
    console.log(`Failed to send notification for userId: ${userId}`);
  }
};

const sendSocketData = (userId, eventName, data) => {
  const socketId = userSocketMap[userId]?.socketId;
  // console.log("userSocketMap", userSocketMap);s
  if (socketId) io.to(socketId).emit(eventName, data);
};

const getUserLocationFromSocket = (userId) => {
  if (userSocketMap[userId] && userSocketMap[userId]?.location) {
    console.log(`Location of ${userId} is ${userSocketMap[userId].location}`);
    return userSocketMap[userId].location;
  }

  return null;
};

const populateUserSocketMap = async () => {
  try {
    const tokens = await FcmToken.find({});
    tokens.forEach((token) => {
      if (userSocketMap[token.userId]) {
        userSocketMap[token.userId].fcmToken = token.token;
      } else {
        userSocketMap[token.userId] = { socketId: null, fcmToken: token.token };
      }
    });

    // console.log("User socket map", userSocketMap.M24083);
  } catch (error) {
    console.error("Error populating User Socket Map:", error);
  }
};

const getRecipientSocketId = (recipientId) => {
  return userSocketMap[recipientId]?.socketId || null;
};

const getRecipientFcmToken = (recipientId) => {
  return userSocketMap[recipientId].fcmToken;
};

// Cache notification settings for 60 seconds to avoid DB hits on every socket event
const _notifyCache = new Map();
const NOTIFY_CACHE_TTL = 60_000;

const findRolesToNotify = async (eventName) => {
  try {
    const cached = _notifyCache.get(eventName);
    if (cached && Date.now() - cached.ts < NOTIFY_CACHE_TTL) {
      return cached.value;
    }

    const notificationSettings = await NotificationSetting.findOne({
      event: eventName,
    }).lean();

    if (!notificationSettings) {
      throw new Error("Notification settings not found for the given event.");
    }

    const rolesToNotify = ["admin", "merchant", "driver", "customer"].filter(
      (role) => notificationSettings[role]
    );

    if (
      notificationSettings.manager &&
      Array.isArray(notificationSettings.manager)
    ) {
      rolesToNotify.push(...notificationSettings.manager);
    }

    const data = {
      title: notificationSettings.title,
      description: notificationSettings.description,
    };

    const result = { rolesToNotify, data };
    _notifyCache.set(eventName, { value: result, ts: Date.now() });

    return result;
  } catch (err) {
    throw new Error(err.message);
  }
};

const getRealTimeDataCountMerchant = async (data) => {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCDate(startOfDay.getUTCDate() - 1);
    startOfDay.setUTCHours(18, 30, 0, 0);
    const endOfDay = new Date();
    endOfDay.setUTCHours(18, 29, 59, 999);
    let pending, ongoing, completed, cancelled;

    if (data.id && data.role === "Merchant") {
      [pending, ongoing, completed, cancelled] = await Promise.all([
        Order.countDocuments({
          status: "Pending",
          createdAt: { $gte: startOfDay, $lte: endOfDay },
          merchantId: data.id,
        }),
        Order.countDocuments({
          status: "On-going",
          createdAt: { $gte: startOfDay, $lte: endOfDay },
          merchantId: data.id,
        }),
        Order.countDocuments({
          status: "Completed",
          createdAt: { $gte: startOfDay, $lte: endOfDay },
          merchantId: data.id,
        }),
        Order.countDocuments({
          status: "Cancelled",
          createdAt: { $gte: startOfDay, $lte: endOfDay },
          merchantId: data.id,
        }),
      ]);

      const realTimeData = {
        type: "Merchant",
        orderCount: {
          pending,
          ongoing,
          completed,
          cancelled,
        },
      };

      const entry = userSocketMap[data.id];
      if (entry?.socketId) {
        io.to(entry.socketId).emit("realTimeDataCount", realTimeData);
      }
    } else {
      [pending, ongoing, completed, cancelled] = await Promise.all([
        Order.countDocuments({
          status: "Pending",
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        }),
        Order.countDocuments({
          status: "On-going",
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        }),
        Order.countDocuments({
          status: "Completed",
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        }),
        Order.countDocuments({
          status: "Cancelled",
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        }),
      ]);

      const [free, inActive, busy] = await Promise.all([
        Agent.countDocuments({ status: "Free" }),
        Agent.countDocuments({ status: "Inactive" }),
        Agent.countDocuments({ status: "Busy" }),
      ]);

      const today = new Date()
        .toLocaleString("en-IN", { weekday: "short" })
        .toLowerCase();

      // Counting active and not active merchants
      const [open, closed] = await Promise.all([
        Merchant.countDocuments({
          status: true,
        }),

        Merchant.countDocuments({
          status: false,
        }),
      ]);

      const [active, notActive] = await Promise.all([
        Merchant.countDocuments({
          "merchantDetail.pricing": { $ne: [], $exists: true }, // Ensures pricing is not empty
          "merchantDetail.pricing.modelType": { $exists: true },
          "merchantDetail.pricing.modelId": { $exists: true },
        }), // Active merchants

        Merchant.countDocuments({
          "merchantDetail.pricing.0": { $exists: false },
        }), // inactive merchants
      ]);

      const realTimeData = {
        type: "Admin",
        orderCount: {
          pending,
          ongoing,
          completed,
          cancelled,
        },
        agentCount: {
          free,
          inActive,
          busy,
        },
        merchantCount: {
          open,
          closed,
          active,
          notActive,
        },
      };

      const [admins, managers] = await Promise.all([
        Admin.find(),
        Manager.find(),
      ]);
      [...admins, ...managers].forEach((user) => {
        const entry = userSocketMap[user._id];
        if (entry?.socketId) {
          io.to(entry.socketId).emit("realTimeDataCount", realTimeData);
        }
      });
    }
  } catch (err) {
    console.error("Error updating real-time data:", err);
  }
};

const getRealTimeDataCount = async () => {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCDate(startOfDay.getUTCDate() - 1);
    startOfDay.setUTCHours(18, 30, 0, 0);
    const endOfDay = new Date();
    endOfDay.setUTCHours(18, 29, 59, 999);

    const [pending, ongoing, completed, cancelled] = await Promise.all([
      Order.countDocuments({
        status: "Pending",
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      }),
      Order.countDocuments({
        status: "On-going",
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      }),
      Order.countDocuments({
        status: "Completed",
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      }),
      Order.countDocuments({
        status: "Cancelled",
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      }),
    ]);

    const [free, inActive, busy] = await Promise.all([
      Agent.countDocuments({ status: "Free" }),
      Agent.countDocuments({ status: "Inactive" }),
      Agent.countDocuments({ status: "Busy" }),
    ]);

    const today = new Date()
      .toLocaleString("en-IN", { weekday: "short" })
      .toLowerCase();

    // Counting active and not active merchants
    const [open, closed] = await Promise.all([
      Merchant.countDocuments({
        status: true,
      }),

      Merchant.countDocuments({
        status: false,
      }),
    ]);

    const [active, notActive] = await Promise.all([
      Merchant.countDocuments({
        "merchantDetail.pricing.0": { $exists: true },
        "merchantDetail.pricing.modelType": { $exists: true }, // Ensures modelType exists
        "merchantDetail.pricing.modelId": { $exists: true },
      }), // active merchants
      Merchant.countDocuments({
        "merchantDetail.pricing.0": { $exists: false },
      }), // inactive merchants
    ]);

    const realTimeData = {
      orderCount: {
        pending,
        ongoing,
        completed,
        cancelled,
      },
      agentCount: {
        free,
        inActive,
        busy,
      },
      merchantCount: {
        open,
        closed,
        active,
        notActive,
      },
    };

    const admins = await Admin.find();
    // console.log("Emitting real-time data:", realTimeData);
    const managers = await Manager.find(); // Assuming you have a `Manager` model

    // Function to emit data to a specific user group
    const emitRealTimeData = (users) => {
      for (let user of users) {
        if (userSocketMap[user._id]) {
          const { socketId } = userSocketMap[user._id];
          if (socketId) {
            io.to(socketId).emit("realTimeDataCount", realTimeData);
          }
        }
      }
    };

    // Emit data to admins
    emitRealTimeData(admins);

    // Emit data to managers
    emitRealTimeData(managers);
  } catch (err) {
    console.error("Error updating real-time data:", err);
  }
};

// Example of listening for changes
Order.watch().on("change", async (change) => {
  getRealTimeDataCount();
});

// Example of listening for changes
Merchant.watch().on("change", async (change) => {
  getRealTimeDataCount();
});

// Example of listening for changes
Agent.watch().on("change", async (change) => {
  getRealTimeDataCount();
});

const handleAgentNotificationLogs = async () => {
  try {
    const AllocationTimeFound = await AutoAllocation.findOne({});

    const STATUS_UPDATE_THRESHOLD = AllocationTimeFound?.expireTime
      ? AllocationTimeFound.expireTime * 1000
      : 60000;

    // Watch for changes in AgentNotificationLogs
    const changeStream = AgentNotificationLogs.watch();

    changeStream.on("change", async (change) => {
      if (change.operationType === "insert") {
        const { _id, status } = change.fullDocument;

        // Check if status is "Pending" and exceeds the threshold
        if (status === "Pending") {
          setTimeout(async () => {
            const log = await AgentNotificationLogs.findById(_id);
            if (log && log.status === "Pending") {
              const agent = await Agent.findById(log.agentId);

              // Update status to "Rejected"
              log.status = "Rejected";

              agent.appDetail.cancelledOrders += 1;
              agent.appDetail.pendingOrders = Math.max(
                0,
                agent.appDetail.pendingOrders - 1
              );

              await Promise.all([log.save(), agent.save()]);
            }
          }, STATUS_UPDATE_THRESHOLD);
        }
      }
    });
  } catch (error) {
    console.error("Error in handling AgentNotificationLogs:", error.message);
  }
};

handleAgentNotificationLogs();

// **Trigger this function when work timings change**
const watchAgentAndTaskChanges = () => {
  const agentChangeStream = Agent.watch();
  const taskChangeStream = Task.watch();

  const handleChange = async (change, source) => {
    // console.log(`Change detected in ${source}:`, change);
    if (["insert", "update", "replace"].includes(change.operationType)) {
      await automaticStatusOfflineForAgent();
    }
  };

  agentChangeStream.on("change", (change) => handleChange(change, "Agent"));
  taskChangeStream.on("change", (change) => handleChange(change, "Task"));
};

// **Run on server start and schedule periodic runs as a backup**
mongoose.connection.once("open", () => {
  // Initial run
  automaticStatusOfflineForAgent();

  watchAgentAndTaskChanges();

  cron.schedule("* * * * *", async () => {
    await automaticStatusOfflineForAgent();
  });
});

// **Run on server start and schedule periodic runs as a backup**
mongoose.connection.once("open", () => {
  // Initial run
  automaticStatusToggleForMerchant();

  // Backup check every 10 minutes (in case Mongo Change Streams miss anything)
  cron.schedule("* * * * *", async () => {
    await automaticStatusToggleForMerchant();
  });
});

// **Check for orders approaching delivery time every minute**
mongoose.connection.once("open", async () => {
  // Ensure the notification setting exists (upsert)
  await NotificationSetting.findOneAndUpdate(
    { event: "order-delay-alert" },
    {
      $setOnInsert: {
        event: "order-delay-alert",
        title: "Order Delay Alert",
        description: "An order is approaching its scheduled delivery time.",
        admin: true,
        manager: [],
        merchant: false,
        driver: false,
        customer: false,
        whatsapp: false,
        sms: false,
        email: false,
        status: true,
      },
    },
    { upsert: true }
  );

  cron.schedule("* * * * *", async () => {
    await checkOrdersNearDelivery(io, userSocketMap);
  });
});

const getPendingNotificationsWithTimers = async (agentId) => {
  try {
    const pendingNotifications = await AgentNotificationLogs.find({
      agentId,
      status: "Pending",
    })
      .populate("orderId", "orderDetail")
      .sort({ createdAt: -1 })
      .lean();

    console.log("Pending Notifications:", pendingNotifications);
    const notificationsWithTimers = pendingNotifications.map((notification) => {
      const order = notification.orderId?.[0] || {};

      return {
        notificationId: notification._id || null,

        orderId: order?._id || null,

        pickAddress:
          order?.pickups?.[0]?.address?.area || null,

        customerAddress:
          order?.drops?.[0]?.address?.area || null,

        orderType: notification.orderType || null,

        status: notification.status || null,

        taskDate: formatDate(order?.deliveryTime),

        taskTime: formatTime(order?.deliveryTime),
      };
    });

    console.log("Notifications with Timers:", notificationsWithTimers);

    return notificationsWithTimers;
  } catch (error) {
    console.error("Error fetching pending notifications:", error.message);
    throw error;
  }
};

// Connection socket
io.on("connection", async (socket) => {
  const userId = socket?.handshake?.query?.userId;
  const fcmToken = socket?.handshake?.query?.fcmToken;
  socket.userId = userId;

  if (!userId || !fcmToken || ["null", "undefined"].includes(fcmToken)) {
    console.error("Invalid userId or fcmToken provided");
    socket.disconnect();
    return;
  }

  console.log("UserId", userId);
  console.log("fcmToken", fcmToken);

  try {
    const user = await FcmToken.findOne({ userId });

    if (!user) {
      // Create a new user entry with the `fcmToken`
      await FcmToken.create({
        userId,
        token: [fcmToken],
      });
      console.log("New user created with fcmToken:", fcmToken);
    } else {
      // Check if `fcmToken` is already in the user's token array
      if (!Array.isArray(user.token)) {
        user.token = []; // Initialize if not an array
      }

      if (!user.token.includes(fcmToken)) {
        if (user.token.length === 3) user.token.shift();

        user.token.push(fcmToken);
        await user.save();
        console.log("fcmToken added for user:", userId);
      } else {
        console.log("fcmToken already exists for user:", userId);
      }
    }

    // Map socket ID to user
    if (!userSocketMap[userId]) {
      userSocketMap[userId] = {
        socketId: socket.id,
        fcmToken: user?.token || [],
        location: [],
      };
    } else {
      userSocketMap[userId].socketId = socket.id;
    }
  } catch (error) {
    console.log("Error handling socket connection:", error);
  }

  // Get realtime data count for Home page
  socket.on("getRealTimeDataOnRefresh", () => {
    console.log("Getting real-time data count for Home page");
    getRealTimeDataCount();
  });

  socket.on("getRealTimeDataOnRefreshMerchant", (data) => {
    getRealTimeDataCountMerchant(data);
  });

  // User location update socket
  socket.on("locationUpdated", async ({ latitude, longitude, userId }) => {
    console.log("Updating agent location", userId);
    console.log("location", { latitude, longitude });

    if (!latitude || !longitude) return;

    const location = [latitude, longitude];

    if (userSocketMap[userId]) {
      userSocketMap[userId].location = location;
    }
  });

  // Order accepted by agent socket
  // socket.on("agentOrderAccepted", async ({ orderIds, agentId }) => {
  //   console.log("Agent accepting order:", { orderIds, agentId });
  //   try {
  //     // Ensure orderIds is always an array
  //     const orderIdList = Array.isArray(orderIds) ? orderIds : [orderIds];

  //     const [agent, tasks, orders, sameCancelledOrders] = await Promise.all([
  //       Agent.findById(agentId),
  //       Task.find({ orderId: { $in: orderIdList } }).populate("orderId"),
  //       Order.find({ _id: { $in: orderIdList } }),
  //       AgentNotificationLogs.countDocuments({
  //         orderId: { $in: orderIdList },
  //         agentId,
  //         status: "Rejected",
  //       }),
  //     ]);

  //     // ✅ Update all notification logs in one go
  //     const updatedNotifications = await AgentNotificationLogs.updateMany(
  //       {
  //         orderId: { $in: orderIdList },
  //         agentId,
  //         status: "Pending",
  //       },
  //       { $set: { status: "Accepted" } }
  //     );

  //     if (updatedNotifications.modifiedCount === 0) {
  //       console.log("Agent Notification Logs not found for given orderIds");
  //       return socket.emit("error", {
  //         message: "Notification logs of agent not found",
  //         success: false,
  //       });
  //     }

  //     if (!agent) {
  //       return socket.emit("error", {
  //         message: "Agent not found",
  //         success: false,
  //       });
  //     }

  //     if (agent.status === "Inactive") {
  //       return socket.emit("error", {
  //         message: "Agent should be online to accept new order",
  //         success: false,
  //       });
  //     }

  //     // if (!agentNotification) {
  //     //   console.log("Agent Notification Log not found");
  //     //   return socket.emit("error", {
  //     //     message: "Notification log of agent is not found",
  //     //     success: false,
  //     //   });
  //     // }

  //     // ✅ Update notification log
  //     AgentNotificationLogs.status = "Accepted";
  //     await AgentNotificationLogs.save();

  //     const stepperDetail = {
  //       by: agent.fullName,
  //       userId: agent._id,
  //       date: new Date(),
  //       location: getUserLocationFromSocket(agentId),
  //     };

  //     // ✅ Update all orders
  //     await Promise.all(
  //       orderIdList.map((orderId) =>
  //         Order.findByIdAndUpdate(
  //           orderId,
  //           {
  //             agentId,
  //             "orderDetail.agentAcceptedAt": new Date(),
  //             "orderDetailStepper.assigned": stepperDetail,
  //             "detailAddedByAgent.distanceCoveredByAgent": null,
  //           },
  //           { new: true }
  //         )
  //       )
  //     );

  //     // ✅ Update all tasks
  //     await Promise.all(
  //       tasks.map((task) =>
  //         Task.findByIdAndUpdate(task._id, {
  //           agentId,
  //           taskStatus: "Assigned",
  //           "pickupDropDetails.$[].pickups.$[].status": "Accepted",
  //           "pickupDropDetails.$[].drops.$[].status": "Accepted",
  //         })
  //       )
  //     );

  //     // ✅ Update agent status
  //     agent.status = "Busy";
  //     agent.appDetail.pendingOrders = Math.max(
  //       0,
  //       agent.appDetail.pendingOrders - 1
  //     );
  //     agent.appDetail.cancelledOrders = Math.max(
  //       0,
  //       agent.appDetail.cancelledOrders - sameCancelledOrders
  //     );
  //     await agent.save();

  //     const eventName = "agentOrderAccepted";

  //     // 🔔 Send notifications for each order
  //     for (const order of orders) {
  //       const { rolesToNotify, data } = await findRolesToNotify(eventName);
  //       let manager;

  //       const notifications = rolesToNotify.map(async (role) => {
  //         let roleId;

  //         if (role === "admin") {
  //           roleId = process.env.ADMIN_ID;
  //         } else if (role === "merchant") {
  //           roleId = order?.merchantId;
  //         } else if (role === "driver") {
  //           roleId = order?.agentId;
  //         } else if (role === "customer") {
  //           roleId = order?.customerId;
  //         } else {
  //           const roleValue = await ManagerRoles.findOne({ roleName: role });
  //           if (roleValue) {
  //             manager = await Manager.findOne({ role: roleValue._id });
  //           }
  //           if (manager) {
  //             roleId = manager._id;
  //           }
  //         }

  //         if (roleId) {
  //           const notificationData = { fcm: { customerId: order.customerId } };
  //           return sendNotification(
  //             roleId,
  //             eventName,
  //             notificationData,
  //             role.charAt(0).toUpperCase() + role.slice(1)
  //           );
  //         }
  //       });

  //       await Promise.all(notifications);

  //       const socketData = {
  //         ...data,
  //         agentName: agent.fullName,
  //         agentImgURL: agent.agentImageURL,
  //         customerId: order.customerId,
  //         orderDetailStepper: stepperDetail,
  //         success: true,
  //       };

  //       // ✅ Emit socket events
  //       sendSocketData(order.customerId, eventName, socketData);
  //       sendSocketData(process.env.ADMIN_ID, eventName, socketData);
  //       if (order?.merchantId) {
  //         sendSocketData(order.merchantId, eventName, socketData);
  //       }
  //       if (manager?._id) {
  //         sendSocketData(manager._id, eventName, socketData);
  //       }
  //     }
  //   } catch (err) {
  //     console.error("Error in accepting order:", err.message);

  //     socket.emit("error", {
  //       message: err.message,
  //       success: false,
  //     });
  //   }
  // });

  socket.on(
    "agentOrderAccepted",
    async ({ orderId, batchOrder, agentId }) => {
      try {
        console.log("orderId", orderId);
        console.log("batchOrder", batchOrder);
        console.log("agentId", agentId);

        const [
          agent,
          task,
          order,
          agentNotification,
          sameCancelledOrders,
        ] = await Promise.all([
          Agent.findById(agentId),
          Task.findOne({ orderId }).populate("orderId"),
          batchOrder
            ? BatchOrder.findById(orderId)
            : Order.findById(orderId),
          AgentNotificationLogs.findOne({
            orderId: { $in: [orderId] },
            agentId,
            status: "Pending",
          }),
          AgentNotificationLogs.countDocuments({
            orderId: { $in: [orderId] },
            agentId,
            status: "Rejected",
          }),
        ]);

        // =========================
        // VALIDATIONS
        // =========================

        if (!agent) {
          return socket.emit("error", {
            message: "Agent not found",
            success: false,
          });
        }

        if (agent.status === "Inactive") {
          return socket.emit("error", {
            message: "Agent should be online to accept new order",
            success: false,
          });
        }

        if (!agentNotification) {
          console.log("Agent Notification Log not found");

          return socket.emit("error", {
            message: "Notification log of agent is not found",
            success: false,
          });
        }

        const stepperDetail = {
          by: agent.fullName,
          userId: agent._id,
          date: new Date(),
          location: getUserLocationFromSocket(agentId),
        };

        // =========================
        // BATCH ORDER FLOW
        // =========================

        if (batchOrder) {
          // =====================================
          // GET BATCH ORDER
          // =====================================

          const batchOrderDoc = await BatchOrder.findById(orderId);

          if (!batchOrderDoc) {
            return socket.emit("error", {
              message: "Batch order not found",
              success: false,
            });
          }

          const taskIds = batchOrderDoc.dropDetails.map(
            (e) => e.taskId
          );

          // =====================================
          // CHECK IF ALL TASKS ARE UNASSIGNED
          // =====================================

          const unassignedTasksCount =
            await Task.countDocuments({
              _id: { $in: taskIds },
              taskStatus: "Unassigned",
            });

          if (unassignedTasksCount !== taskIds.length) {
            return socket.emit("orderAlreadyAccepted", {
              message:
                "This batch order has already been accepted by another agent",
              success: false,
            });
          }

          // =====================================
          // ASSIGN ALL TASKS
          // =====================================

          const tasks = await Task.find({
            _id: { $in: taskIds },
          });

          for (const taskItem of tasks) {
            taskItem.agentId = agentId;
            taskItem.taskStatus = "Assigned";

            taskItem.pickupDropDetails?.forEach((pd) => {
              pd.pickups?.forEach((pickup) => {
                pickup.status = "Accepted";
              });

              pd.drops?.forEach((drop) => {
                drop.status = "Accepted";
              });
            });

            await taskItem.save();
          }

          // =====================================
          // UPDATE CURRENT AGENT NOTIFICATION
          // =====================================

          agentNotification.status = "Accepted";

          await agentNotification.save();

          // =====================================
          // UPDATE ALL ORDERS
          // =====================================

          if (batchOrderDoc?.dropDetails?.length) {
            for (const e of batchOrderDoc.dropDetails) {
              console.log(
                "batchOrderDoc.dropDetails",
                e
              );

              await Order.findByIdAndUpdate(
                e.orderId,
                {
                  agentId,
                  agentAcceptedAt: new Date(),
                  "orderDetailStepper.assigned":
                    stepperDetail,
                  "detailAddedByAgent.distanceCoveredByAgent":
                    null,
                },
                { new: true }
              );
            }

            // =====================================
            // UPDATE BATCH ORDER
            // =====================================

            batchOrderDoc.pickupAddress.status =
              "Accepted";

            batchOrderDoc.dropDetails.forEach((drop) => {
              if (drop?.drops) {
                drop.drops.status = "Accepted";
              }
            });

            await batchOrderDoc.save();
          }
        }

        // =========================
        // NORMAL ORDER FLOW
        // =========================

        else {
          // =====================================
          // ATOMIC LOCK
          // =====================================

          const lockedTask =
            await Task.findOneAndUpdate(
              {
                orderId,
                taskStatus: "Unassigned",
              },
              {
                agentId,
                taskStatus: "Assigned",
                "pickupDropDetails.$[].pickups.$[].status":
                  "Accepted",
                "pickupDropDetails.$[].drops.$[].status":
                  "Accepted",
              },
              { new: true }
            );

          if (!lockedTask) {
            return socket.emit(
              "orderAlreadyAccepted",
              {
                message:
                  "This order has already been accepted by another agent",
                success: false,
              }
            );
          }

          // =====================================
          // UPDATE CURRENT AGENT NOTIFICATION
          // =====================================

          agentNotification.status = "Accepted";

          await agentNotification.save();

          // =====================================
          // UPDATE ORDER
          // =====================================

          await Order.findByIdAndUpdate(
            orderId,
            {
              agentId,
              agentAcceptedAt: new Date(),
              "orderDetailStepper.assigned":
                stepperDetail,
              "detailAddedByAgent.distanceCoveredByAgent":
                null,
            },
            { new: true }
          );
        }

        // =========================
        // CANCEL OTHER NOTIFICATIONS
        // =========================

        await AgentNotificationLogs.updateMany(
          {
            orderId: { $in: [orderId] },
            agentId: { $ne: agentId },
            status: "Pending",
          },
          {
            status: "Cancelled",
          }
        );

        // =========================
        // REDUCE OTHER AGENT PENDING COUNT
        // =========================

        const otherAgentIds =
          await AgentNotificationLogs.distinct(
            "agentId",
            {
              orderId: { $in: [orderId] },
              agentId: { $ne: agentId },
              status: {
                $in: ["Cancelled", "Pending"],
              },
            }
          );

        if (otherAgentIds.length > 0) {
          await Agent.updateMany(
            {
              _id: { $in: otherAgentIds },
              "appDetail.pendingOrders": { $gt: 0 },
            },
            {
              $inc: {
                "appDetail.pendingOrders": -1,
              },
            }
          );

          // Notify other agents
          for (const otherId of otherAgentIds) {
            sendSocketData(
              otherId,
              "orderAlreadyAccepted",
              {
                orderId,
                message:
                  "This order has been accepted by another agent",
              }
            );
          }
        }

        // =========================
        // UPDATE CURRENT AGENT STATUS
        // =========================

        agent.status = "Busy";

        agent.appDetail.pendingOrders = Math.max(
          0,
          agent.appDetail.pendingOrders - 1
        );

        agent.appDetail.cancelledOrders = Math.max(
          0,
          agent.appDetail.cancelledOrders -
          sameCancelledOrders
        );

        await agent.save();

        // =========================
        // SEND NOTIFICATIONS
        // =========================

        const eventName = "agentOrderAccepted";

        const { rolesToNotify, data } =
          await findRolesToNotify(eventName);

        let manager;

        const notifications = rolesToNotify.map(
          async (role) => {
            let roleId;

            if (role === "admin") {
              roleId = process.env.ADMIN_ID;
            } else if (role === "merchant") {
              roleId = order?.merchantId;
            } else if (role === "driver") {
              roleId = order?.agentId;
            } else if (role === "customer") {
              roleId = order?.customerId;
            } else {
              const roleValue =
                await ManagerRoles.findOne({
                  roleName: role,
                });

              if (roleValue) {
                manager = await Manager.findOne({
                  role: roleValue._id,
                });
              }

              if (manager) {
                roleId = manager._id;
              }
            }

            if (roleId) {
              const notificationData = {
                fcm: {
                  customerId: order?.customerId,
                },
              };

              return sendNotification(
                roleId,
                eventName,
                notificationData,
                role.charAt(0).toUpperCase() +
                role.slice(1)
              );
            }
          }
        );

        await Promise.all(notifications);

        // =========================
        // SOCKET DATA
        // =========================

        const socketData = {
          ...data,
          agentName: agent.fullName,
          agentImgURL: agent.agentImageURL,
          customerId: task?.orderId?.customerId,
          orderDetailStepper: stepperDetail,
          success: true,
        };

        // =========================
        // SEND SOCKET EVENTS
        // =========================

        sendSocketData(
          order?.customerId,
          eventName,
          socketData
        );

        sendSocketData(
          process.env.ADMIN_ID,
          eventName,
          socketData
        );

        if (task?.orderId?.merchantId) {
          sendSocketData(
            task.orderId.merchantId,
            eventName,
            socketData
          );
        }

        if (manager?._id) {
          sendSocketData(
            manager._id,
            eventName,
            socketData
          );
        }

        console.log(
          "Order accepted successfully"
        );
      } catch (err) {
        console.error(
          "Error in accepting order:",
          err.message
        );

        socket.emit("error", {
          message: err.message,
          success: false,
        });
      }
    }
  );

  // Order rejected socket

  socket.on("agentOrderRejected", async ({ orderId, agentId }) => {
    try {
      const [agentFound, orderFound, agentNotification] = await Promise.all([
        Agent.findById(agentId),
        Order.findById(orderId),
        AgentNotificationLogs.findOne({
          orderId,
          agentId,
        }),
      ]);

      if (!agentFound)
        return socket.emit("error", {
          message: "Agent not found",
          success: false,
        });

      if (!orderFound)
        return socket.emit("error", {
          message: "Order not found",
          success: false,
        });

      if (!agentNotification) {
        return socket.emit("error", {
          message: "Agent notification not found",
        });
      }

      // Update the agentNotification
      agentNotification.status = "Rejected";
      await agentNotification.save();

      // console.log("Rejected Order");

      agentFound.appDetail.pendingOrders = Math.max(
        0,
        agentFound.appDetail.pendingOrders - 1
      );

      agentFound.appDetail.cancelledOrders += 1;

      await agentFound.save();

      const eventName = "agentOrderRejected";

      const { rolesToNotify, data } = await findRolesToNotify(eventName);

      let manager;
      // Send notifications to each role dynamically
      for (const role of rolesToNotify) {
        let roleId;

        if (role === "admin") {
          roleId = process.env.ADMIN_ID;
        } else if (role === "merchant") {
          roleId = orderFound?.merchantId;
        } else if (role === "driver") {
          roleId = orderFound?.agentId;
        } else if (role === "customer") {
          roleId = orderFound?.customerId;
        } else {
          const roleValue = await ManagerRoles.findOne({ roleName: role });
          if (roleValue) {
            manager = await Manager.findOne({ role: roleValue._id });
          } // Assuming `role` is the role field to match in Manager model
          if (manager) {
            roleId = manager._id; // Set roleId to the Manager's ID
          }
        }

        if (roleId) {
          const notificationData = {
            fcm: {
              ...data,
              agentId,
              orderId,
            },
          };

          await sendNotification(
            roleId,
            eventName,
            notificationData,
            role.charAt(0).toUpperCase() + role.slice(1)
          );
        }
      }

      sendSocketData(agentId, eventName, agentFound.appDetail);
      if (manager?._id) {
        sendSocketData(manager._id, eventName, agentFound.appDetail);
      }
    } catch (err) {
      console.log("Failed to reject order :" + err);

      return socket.emit("error", {
        message: `Error in rejecting order by agent: ${err}`,
        success: false,
      });
    }
  });

  // Update agent location to customer app and admin panel
  socket.on("agentLocationUpdateForUser", async ({ orderId }) => {
    const order = await Order.findById(orderId);
    if (order?.status !== "Completed" && order?.status !== "Cancelled") {
      const agent = await Agent.findById(order?.agentId);
      if (agent) {
        const data = {
          agentLocation:
            getUserLocationFromSocket(order?.agentId) || agent?.location,
        };
        sendSocketData(order?.customerId, "agentCurrentLocation", data);
      } else {
        const data = {
          message: "Agent not assigned to this order",
        };
        sendSocketData(order?.customerId, "agentCurrentLocation", data);
      }
    } else {
      const data = {
        message: "Order is already completed or cancelled",
      };
      sendSocketData(order?.customerId, "agentCurrentLocation", data);
    }
  });

  // Update started stepper in order detail
  socket.on(
    "agentPickupStarted",
    async ({
      taskId,
      agentId,
      location,
      pickupIndex = 0,
      dropIndex = null,
      batchOrder,
    }) => {
      console.log("agentPickupStarted called with:", {
        taskId,
        agentId,
        location,
        pickupIndex,
        dropIndex,
        batchOrder,
      });

      try {
        console.log("testSocket worked in socket listener");
        const handlePickupStart = async (
          taskId,
          agentId,
          location,
          pickupIndex
        ) => {
          const [taskFound, agentFound] = await Promise.all([
            Task.findById(taskId),
            Agent.findById(agentId),
          ]);

          if (!taskFound) {
            return socket.emit("error", {
              message: "Task not found",
              success: false,
            });
          }
          if (!agentFound) {
            return socket.emit("error", {
              message: "Agent not found",
              success: false,
            });
          }

          const eventName = "agentPickupStarted";

          // ✅ Check if pickup already started
          const pickupDetail =
            taskFound.pickupDropDetails?.[0]?.pickups?.[pickupIndex];
          if (!pickupDetail) {
            return socket.emit("error", {
              message: "Pickup not found at this index",
              success: false,
            });
          }

          if (pickupDetail.status === "Started") {
            sendSocketData(agentId, eventName, {
              data: "Pickup already started",
              success: true,
            });
            return;
          }

          if (pickupDetail.status === "Completed") {
            return socket.emit("error", {
              message: "Pickup already completed",
              success: false,
            });
          }

          // ✅ Update pickup status
          pickupDetail.status = "Started";
          pickupDetail.startTime = new Date();
          // pickupDetail.location = location;

          // Mark modified since nested
          taskFound.markModified("pickupDropDetails");

          const orderFound = await Order.findById(taskFound.orderId);
          if (!orderFound) {
            return socket.emit("error", {
              message: "Order not found",
              success: false,
            });
          }

          const agentLocation =
            location && location?.length === 2
              ? location
              : getUserLocationFromSocket(agentId);

          if (!agentLocation || agentLocation?.length !== 2) {
            return socket.emit("error", {
              message: "Invalid location",
              success: false,
            });
          }

          const stepperDetail = {
            by: agentFound.fullName,
            userId: agentId,
            date: new Date(),
            location: agentLocation,
          };

          if (!orderFound.orderDetailStepper)
            orderFound.orderDetailStepper = {};
          orderFound.orderDetailStepper.pickupStarted = stepperDetail;

          await Promise.all([orderFound.save(), taskFound.save()]);

          const data = {
            orderDetailStepper: stepperDetail,
            success: true,
            pickupDetail,
          };

          sendSocketData(process.env.ADMIN_ID, eventName, data);
          sendSocketData(orderFound.customerId, eventName, data);
          if (orderFound?.merchantId) {
            sendSocketData(orderFound.merchantId, eventName, data);
          }
        };

        if (batchOrder) {
          const batchOrderById = await BatchOrder.findById(taskId);
          if (!batchOrderById) {
            return socket.emit("error", {
              message: "Batch order not found",
              success: false,
            });
          }

          // Update main batch status
          // batchOrderById.taskStatus = "Started";

          // Update batch pickup if you store pickups in schema
          if (batchOrderById.pickupAddress) {
            batchOrderById.pickupAddress.status = "Started";
            batchOrderById.pickupAddress.startTime = new Date();
            // batchOrderById.pickupAddress.location = location;
          }

          // Update each drop’s pickup status
          for (const drop of batchOrderById.dropDetails) {
            // drop.drops.status = "Started";
            // drop.drops.startTime = new Date();
            // drop.drops.location = location;

            // Also update individual Task + Order like before
            await handlePickupStart(
              drop.taskId,
              agentId,
              location,
              pickupIndex
            );
          }

          // batchOrderById.markModified("dropDetails");
          await batchOrderById.save();
        } else {
          await handlePickupStart(taskId, agentId, location, pickupIndex);
        }
      } catch (err) {
        console.log("Agent failed to start pick up: " + err);

        return socket.emit("error", {
          message: `Error in starting pickup: ${err}`,
          success: false,
        });
      }
    }
  );

  socket.on(
    "reachedPickupLocation",
    async ({ taskId, agentId, location, pickupIndex = 0, batchOrder }) => {
      try {
        const agentLocation =
          location && location.length === 2
            ? location
            : getUserLocationFromSocket(agentId);

        if (!agentLocation || agentLocation.length !== 2) {
          return socket.emit("error", {
            message: "Invalid location",
            success: false,
          });
        }

        if (batchOrder) {
          const batchOrderDoc = await BatchOrder.findById(taskId);
          if (!batchOrderDoc) {
            return socket.emit("error", {
              message: "BatchOrder not found",
              success: false,
            });
          }

          const taskIds = batchOrderDoc.dropDetails.map((d) => d.taskId);
          const [agentFound, tasks] = await Promise.all([
            Agent.findById(agentId),
            Task.find({ _id: { $in: taskIds }, agentId }),
          ]);

          if (!agentFound) {
            return socket.emit("error", { message: "Agent not found", success: false });
          }

          const orderIds = tasks.map((t) => t.orderId);
          const orders = await Order.find({ _id: { $in: orderIds } });
          const orderMap = new Map(orders.map((o) => [o._id, o]));

          const stepperDetail = {
            by: agentFound.fullName,
            userId: agentId,
            date: new Date(),
            location: agentLocation,
          };

          const saveOps = [];
          for (const task of tasks) {
            const pickup = task.pickupDropDetails?.[0]?.pickups?.[pickupIndex];
            if (pickup && pickup.status !== "Completed") {
              pickup.status = "Completed";
              pickup.completedTime = new Date();
              task.markModified("pickupDropDetails");
              saveOps.push(task.save());
            }

            const order = orderMap.get(task.orderId);
            if (order) {
              order.orderDetailStepper = order.orderDetailStepper || {};
              order.orderDetailStepper.reachedPickupLocation = stepperDetail;

              // ADD: Calculate start-to-pick distance for batch order
              const pickupStartedLoc = order.orderDetailStepper?.pickupStarted?.location;
              if (pickupStartedLoc?.length === 2 && agentLocation?.length === 2) {
                const { distanceInKM } = await getDistanceFromPickupToDelivery(
                  pickupStartedLoc,
                  agentLocation
                );
                if (!order.detailAddedByAgent) order.detailAddedByAgent = {};
                order.detailAddedByAgent.startToPickDistance = distanceInKM;
                order.detailAddedByAgent.distanceCoveredByAgent = distanceInKM;
              }

              saveOps.push(order.save());
            }
          }

          if (batchOrderDoc.pickupAddress) {
            batchOrderDoc.pickupAddress.status = "Completed";
            batchOrderDoc.markModified("pickupAddress");
            saveOps.push(batchOrderDoc.save());
          }

          await Promise.all(saveOps);

          const eventName = "reachedPickupLocation";
          const { rolesToNotify, data } = await findRolesToNotify(eventName);

          const notifyPromises = [];
          for (const role of rolesToNotify) {
            const roleId = {
              admin: process.env.ADMIN_ID,
              merchant: orders[0]?.merchantId,
              driver: agentId,
              customer: orders[0]?.customerId,
            }[role];
            if (roleId) {
              notifyPromises.push(
                sendNotification(
                  roleId,
                  eventName,
                  { fcm: { customerId: orders[0]?.customerId, agentName: agentFound.fullName } },
                  role.charAt(0).toUpperCase() + role.slice(1)
                )
              );
            }
          }
          await Promise.all(notifyPromises);

          const socketPayload = {
            ...data,
            orderId: orders[0]?._id,
            agentId,
            agentName: agentFound.fullName,
            orderDetailStepper: stepperDetail,
            success: true,
          };

          sendSocketData(process.env.ADMIN_ID, eventName, socketPayload);
          if (orders[0]?.customerId) sendSocketData(orders[0].customerId, eventName, socketPayload);
          if (orders[0]?.merchantId) sendSocketData(orders[0].merchantId, eventName, socketPayload);
          sendSocketData(agentId, "agentReachedPickupLocation", {
            message: "Agent reached pickup location",
            success: true,
          });
        } else {
          const [agentFound, taskFound] = await Promise.all([
            Agent.findById(agentId),
            Task.findOne({ _id: taskId, agentId }),
          ]);

          if (!agentFound) {
            return socket.emit("error", { message: "Agent not found", success: false });
          }
          if (!taskFound) {
            return socket.emit("error", { message: "Task not found", success: false });
          }

          const orderFound = await Order.findById(taskFound.orderId);
          if (!orderFound) {
            return socket.emit("error", { message: "Order not found", success: false });
          }

          const pickupDetail = taskFound.pickupDropDetails?.[0]?.pickups?.[pickupIndex];
          if (!pickupDetail) {
            return socket.emit("error", { message: "Pickup detail not found", success: false });
          }

          if (pickupDetail.status === "Completed") {
            return sendSocketData(agentId, "agentReachedPickupLocation", {
              message: "Agent reached pickup location",
              success: true,
            });
          }

          const normalizeLocation = (location) => {
            if (
              !Array.isArray(location) ||
              location.length !== 2
            ) {
              return null;
            }

            const lat = Number(location[0]);
            const lng = Number(location[1]);

            if (
              Number.isNaN(lat) ||
              Number.isNaN(lng)
            ) {
              return null;
            }

            return [lat, lng];
          };

          const pickupLocation = normalizeLocation(pickupDetail.location);
          const parsedAgentLocation = normalizeLocation(agentLocation);

          // Only validate distance if pickup location exists
          if (pickupLocation && parsedAgentLocation) {
            const distance = turf.distance(
              turf.point([pickupLocation[1], pickupLocation[0]]),
              turf.point([parsedAgentLocation[1], parsedAgentLocation[0]]),
              { units: "kilometers" }
            );

            if (distance >= 0.5) {
              return socket.emit("error", {
                message: "Agent is far from pickup point",
                success: false,
              });
            }
          }
          pickupDetail.status = "Completed";
          pickupDetail.completedTime = new Date();
          taskFound.markModified("pickupDropDetails");

          const stepperDetail = {
            by: agentFound.fullName,
            userId: agentId,
            date: new Date(),
            location: agentLocation,
          };

          orderFound.orderDetailStepper = orderFound.orderDetailStepper || {};
          orderFound.orderDetailStepper.reachedPickupLocation = stepperDetail;

          // Calculate start-to-pick distance (agent's travel from start to merchant)
          const pickupStartLocation = orderFound.orderDetailStepper?.pickupStarted?.location;
          if (pickupStartLocation?.length === 2 && agentLocation?.length === 2) {
            const { distanceInKM } = await getDistanceFromPickupToDelivery(
              pickupStartLocation,   // where agent was when they tapped "Start Pickup"
              agentLocation          // where agent is now (at the merchant)
            );
            if (!orderFound.detailAddedByAgent) orderFound.detailAddedByAgent = {};
            orderFound.detailAddedByAgent.startToPickDistance = distanceInKM;
            orderFound.detailAddedByAgent.distanceCoveredByAgent = distanceInKM;
          }

          await Promise.all([taskFound.save(), orderFound.save()]);

          const eventName = "reachedPickupLocation";
          const { rolesToNotify, data } = await findRolesToNotify(eventName);

          const notifyPromises = [];
          for (const role of rolesToNotify) {
            const roleId = {
              admin: process.env.ADMIN_ID,
              merchant: orderFound?.merchantId,
              driver: orderFound?.agentId,
              customer: orderFound?.customerId,
            }[role];
            if (roleId) {
              notifyPromises.push(
                sendNotification(
                  roleId,
                  eventName,
                  { fcm: { customerId: orderFound.customerId, agentName: agentFound.fullName } },
                  role.charAt(0).toUpperCase() + role.slice(1)
                )
              );
            }
          }
          await Promise.all(notifyPromises);

          const socketPayload = {
            ...data,
            orderId: taskFound.orderId,
            agentId,
            agentName: agentFound.fullName,
            orderDetailStepper: stepperDetail,
            success: true,
          };

          sendSocketData(orderFound.customerId, eventName, socketPayload);
          sendSocketData(process.env.ADMIN_ID, eventName, socketPayload);
          if (orderFound?.merchantId) sendSocketData(orderFound.merchantId, eventName, socketPayload);
          sendSocketData(agentId, "agentReachedPickupLocation", {
            message: "Agent reached pickup location",
            success: true,
          });
        }
      } catch (err) {
        console.error("[reachedPickupLocation] Error:", err.message);
        return socket.emit("error", {
          message: `Error in reaching pickup location: ${err.message || err}`,
          success: false,
        });
      }
    }
  );

  // socket.on("agentPickupStarted", async ({ taskId, agentId, location }) => {
  //   console.log("agentPickupStarted called with:", {
  //     taskId,
  //     agentId,
  //     location,
  //   });
  //   try {
  //     const [taskFound, agentFound] = await Promise.all([
  //       Task.findById(taskId),
  //       Agent.findById(agentId),
  //     ]);

  //     if (!taskFound) {
  //       return socket.emit("error", {
  //         message: "Task not found",
  //         success: false,
  //       });
  //     }
  //     if (!agentFound) {
  //       return socket.emit("error", {
  //         message: "Agent not found",
  //         success: false,
  //       });
  //     }

  //     const eventName = "agentPickupStarted";

  //     if (
  //       taskFound.pickupsDropsDetails?.[0]?.pickups?.[0]?.status === "Started"
  //     ) {
  //       const agentSocketId = userSocketMap[agentId]?.socketId;
  //       if (agentSocketId) {
  //         io.to(agentSocketId).emit(eventName, {
  //           data: "Pickup successfully started",
  //           success: true,
  //         });
  //       }

  //       return;
  //     }

  //     if (taskFound.pickupDetail.pickupStatus === "Completed") {
  //       return socket.emit("error", {
  //         message: "Pickup is already completed",
  //         success: false,
  //       });
  //     }

  //     const orderFound = await Order.findById(taskFound.orderId);
  //     if (!orderFound) {
  //       return socket.emit("error", {
  //         message: "Order not found",
  //         success: false,
  //       });
  //     }

  //     const agentLocation =
  //       location && location?.length === 2
  //         ? location
  //         : getUserLocationFromSocket(agentId);

  //     if (!agentLocation || agentLocation?.length !== 2) {
  //       return socket.emit("error", {
  //         message: "Invalid location",
  //         success: false,
  //       });
  //     }

  //     const stepperDetail = {
  //       by: agentFound.fullName,
  //       userId: agentId,
  //       date: new Date(),
  //       location: agentLocation,
  //     };

  //     // Initialize orderDetailStepper if it does not exist
  //     if (!orderFound.orderDetailStepper) orderFound.orderDetailStepper = {};

  //     orderFound.orderDetailStepper.pickupStarted = stepperDetail;
  //     taskFound.pickupDetail.pickupStatus = "Started";
  //     taskFound.pickupDetail.startTime = new Date();

  //     const pickupLocation = orderFound?.orderDetail?.pickupLocation;

  //     if (
  //       pickupLocation?.length === 2 &&
  //       !orderFound?.detailAddedByAgent?.distanceCoveredByAgent &&
  //       orderFound?.detailAddedByAgent?.distanceCoveredByAgent !== 0
  //     ) {
  //       const { distanceInKM } = await getDistanceFromPickupToDelivery(
  //         agentLocation,
  //         pickupLocation
  //       );

  //       if (!orderFound.detailAddedByAgent) orderFound.detailAddedByAgent = {};

  //       orderFound.detailAddedByAgent.distanceCoveredByAgent = distanceInKM;
  //       orderFound.detailAddedByAgent.startToPickDistance = distanceInKM;
  //     }

  //     if (orderFound.orderDetail.deliveryMode === "Custom Order") {
  //       const data = {
  //         location: agentLocation,
  //         status: "Initial location",
  //         description: null,
  //       };

  //       // Initialize detailAddedByAgent and shopUpdates if not present
  //       if (!orderFound.detailAddedByAgent) {
  //         orderFound.detailAddedByAgent = { shopUpdates: [] };
  //       }

  //       orderFound.detailAddedByAgent.shopUpdates.push(data);
  //     }

  //     await Promise.all([orderFound.save(), taskFound.save()]);

  //     const data = {
  //       orderDetailStepper: stepperDetail,
  //       success: true,
  //     };

  //     sendSocketData(process.env.ADMIN_ID, eventName, data);
  //     sendSocketData(orderFound.customerId, eventName, data);
  //     if (orderFound?.merchantId) {
  //       sendSocketData(orderFound.merchantId, eventName, data);
  //     }
  //   } catch (err) {
  //     console.log("Agent failed to start pick up: " + err);

  //     return socket.emit("error", {
  //       message: `Error in starting pickup: ${err}`,
  //       success: false,
  //     });
  //   }
  // });

  // Reached pickup location

  // socket.on(
  //   "reachedPickupLocation",
  //   async ({ taskId, agentId, location, pickupIndex = 0, batchOrder }) => {
  //     try {
  //       const handleReachedPickupLocation = async (
  //         taskId,
  //         agentId,
  //         location,
  //         pickupIndex,
  //         forceComplete = false
  //       ) => {
  //         const [agentFound, taskFound] = await Promise.all([
  //           Agent.findById(agentId),
  //           Task.findOne({ _id: taskId, agentId }),
  //         ]);

  //         if (!agentFound) {
  //           return socket.emit("error", {
  //             message: "Agent not found",
  //             success: false,
  //           });
  //         }

  //         if (!taskFound) {
  //           return socket.emit("error", {
  //             message: "Task not found",
  //             success: false,
  //           });
  //         }

  //         const orderFound = await Order.findById(taskFound.orderId);
  //         if (!orderFound) {
  //           return socket.emit("error", {
  //             message: "Order not found",
  //             success: false,
  //           });
  //         }

  //         const eventName = "reachedPickupLocation";
  //         const { rolesToNotify, data } = await findRolesToNotify(eventName);

  //         const pickupDetail =
  //           taskFound.pickupDropDetails?.[0]?.pickups?.[pickupIndex];

  //         if (!pickupDetail) {
  //           return socket.emit("error", {
  //             message: "Pickup detail not found",
  //             success: false,
  //           });
  //         }

  //         const agentLocation =
  //           location && location?.length === 2
  //             ? location
  //             : getUserLocationFromSocket(agentId);

  //         if (!agentLocation || agentLocation?.length !== 2) {
  //           return socket.emit("error", {
  //             message: "Invalid location",
  //             success: false,
  //           });
  //         }

  //         // ✅ Mark as completed if forced (batchOrder) OR distance check passes
  //         let canComplete = false;

  //         if (forceComplete) {
  //           canComplete = true;
  //         } else {
  //           const pickupLocation = pickupDetail.location;
  //           const maxRadius = 0.5; // 500 meters (km)

  //           const distance = turf.distance(
  //             turf.point(pickupLocation),
  //             turf.point(agentLocation),
  //             { units: "kilometers" }
  //           );

  //           if (distance < maxRadius) {
  //             canComplete = true;
  //           }
  //         }

  //         if (canComplete) {
  //           pickupDetail.status = "Completed";
  //           pickupDetail.completedTime = new Date();

  //           const stepperDetail = {
  //             by: agentFound.fullName,
  //             userId: agentId,
  //             date: new Date(),
  //             location: agentLocation,
  //           };

  //           orderFound.orderDetailStepper.reachedPickupLocation = stepperDetail;

  //           taskFound.markModified("pickupDropDetails");
  //           await Promise.all([taskFound.save(), orderFound.save()]);

  //           // 🔔 Notify roles
  //           for (const role of rolesToNotify) {
  //             const roleId = {
  //               admin: process.env.ADMIN_ID,
  //               merchant: orderFound?.merchantId,
  //               driver: orderFound?.agentId,
  //               customer: orderFound?.customerId,
  //             }[role];

  //             if (roleId) {
  //               await sendNotification(
  //                 roleId,
  //                 eventName,
  //                 { fcm: { customerId: orderFound.customerId } },
  //                 role.charAt(0).toUpperCase() + role.slice(1)
  //               );
  //             }
  //           }

  //           const socketData = {
  //             ...data,
  //             orderId: taskFound.orderId,
  //             agentId,
  //             agentName: agentFound.fullName,
  //             orderDetailStepper: stepperDetail,
  //             success: true,
  //           };

  //           sendSocketData(orderFound.customerId, eventName, socketData);
  //           sendSocketData(process.env.ADMIN_ID, eventName, socketData);
  //           if (orderFound?.merchantId) {
  //             sendSocketData(orderFound.merchantId, eventName, socketData);
  //           }

  //           sendSocketData(agentId, "agentReachedPickupLocation", {
  //             message: "Agent reached pickup location",
  //             success: true,
  //           });
  //         } else {
  //           return socket.emit("error", {
  //             message: "Agent is far from pickup point",
  //             success: false,
  //           });
  //         }
  //       };

  //       if (batchOrder) {
  //         const batchOrderById = await BatchOrder.findById(taskId);
  //         for (const drop of batchOrderById.dropDetails) {
  //           await handleReachedPickupLocation(
  //             drop.taskId,
  //             agentId,
  //             location,
  //             pickupIndex,
  //             true // ✅ forceComplete for batch order
  //           );
  //         }
  //       } else {
  //         await handleReachedPickupLocation(
  //           taskId,
  //           agentId,
  //           location,
  //           pickupIndex
  //         );
  //       }
  //     } catch (err) {
  //       return socket.emit("error", {
  //         message: `Error in reaching pickup location: ${err.message || err}`,
  //         success: false,
  //       });
  //     }
  //   }
  // );

  // socket.on(
  //   "reachedPickupLocation",
  //   async ({ taskId, agentId, location, pickupIndex = 0, batchOrder }) => {
  //     try {
  //       const handleReachedPickupLocation = async (
  //         taskId,
  //         agentId,
  //         location,
  //         pickupIndex
  //       ) => {
  //         // Fetch agent and task data in parallel
  //         const [agentFound, taskFound] = await Promise.all([
  //           Agent.findById(agentId),
  //           Task.findOne({ _id: taskId, agentId }),
  //         ]);

  //         if (!agentFound) {
  //           return socket.emit("error", {
  //             message: "Agent not found",
  //             success: false,
  //           });
  //         }

  //         if (!taskFound) {
  //           return socket.emit("error", {
  //             message: "Task not found",
  //             success: false,
  //           });
  //         }

  //         const orderFound = await Order.findById(taskFound.orderId);
  //         if (!orderFound) {
  //           return socket.emit("error", {
  //             message: "Order not found",
  //             success: false,
  //           });
  //         }

  //         const eventName = "reachedPickupLocation";
  //         const { rolesToNotify, data } = await findRolesToNotify(eventName);

  //         const maxRadius = 100.5; // 500 meters
  //         const pickupDetail =
  //           taskFound.pickupDropDetails?.[0]?.pickups?.[pickupIndex];

  //         if (!pickupDetail) {
  //           return socket.emit("error", {
  //             message: "Pickup detail not found",
  //             success: false,
  //           });
  //         }

  //         const pickupLocation = pickupDetail.location;
  //         const agentLocation =
  //           location && location?.length === 2
  //             ? location
  //             : getUserLocationFromSocket(agentId);

  //         if (!agentLocation || agentLocation?.length !== 2) {
  //           return socket.emit("error", {
  //             message: "Invalid location",
  //             success: false,
  //           });
  //         }

  //         // Calculate distance
  //         const distance = turf.distance(
  //           turf.point(pickupLocation),
  //           turf.point(agentLocation),
  //           { units: "kilometers" }
  //         );

  //         if (distance < maxRadius) {
  //           // ✅ Mark pickup as completed
  //           pickupDetail.status = "Completed";
  //           pickupDetail.completedTime = new Date();

  //           const stepperDetail = {
  //             by: agentFound.fullName,
  //             userId: agentId,
  //             date: new Date(),
  //             location: agentLocation,
  //           };

  //           orderFound.orderDetailStepper.reachedPickupLocation = stepperDetail;

  //           taskFound.markModified("pickupDropDetails");
  //           await Promise.all([taskFound.save(), orderFound.save()]);

  //           // 🔔 Send notifications to each role dynamically
  //           for (const role of rolesToNotify) {
  //             const roleId = {
  //               admin: process.env.ADMIN_ID,
  //               merchant: orderFound?.merchantId,
  //               driver: orderFound?.agentId,
  //               customer: orderFound?.customerId,
  //             }[role];

  //             if (roleId) {
  //               const notificationData = {
  //                 fcm: {
  //                   customerId: orderFound.customerId,
  //                 },
  //               };

  //               await sendNotification(
  //                 roleId,
  //                 eventName,
  //                 notificationData,
  //                 role.charAt(0).toUpperCase() + role.slice(1)
  //               );
  //             }
  //           }

  //           const socketData = {
  //             ...data,
  //             orderId: taskFound.orderId,
  //             agentId,
  //             agentName: agentFound.fullName,
  //             orderDetailStepper: stepperDetail,
  //             success: true,
  //           };

  //           const event = "agentReachedPickupLocation";

  //           sendSocketData(orderFound.customerId, eventName, socketData);
  //           sendSocketData(process.env.ADMIN_ID, eventName, socketData);
  //           if (orderFound?.merchantId) {
  //             sendSocketData(orderFound.merchantId, eventName, socketData);
  //           }

  //           sendSocketData(agentId, event, {
  //             message: "Agent reached pickup location",
  //             success: true,
  //           });
  //         } else {
  //           // ❌ Agent too far
  //           const event = "agentNotReachedPickupLocation";
  //           const { data } = await findRolesToNotify(event);

  //           const dataToSend = {
  //             ...data,
  //             orderId: taskFound.orderId,
  //             agentId,
  //           };

  //           await sendNotification(agentId, event, dataToSend, "Agent");

  //           return socket.emit("error", {
  //             message: "Agent is far from pickup point",
  //             success: false,
  //           });
  //         }
  //       };
  //       if (batchOrder) {
  //         const batchOrderById = await BatchOrder.findById(taskId);
  //         for (const drop of batchOrderById.dropDetails) {
  //           await handleReachedPickupLocation(
  //             drop.taskId,
  //             agentId,
  //             location,
  //             pickupIndex
  //           );
  //         }
  //       } else {
  //         await handleReachedPickupLocation(
  //           taskId,
  //           agentId,
  //           location,
  //           pickupIndex
  //         );
  //       }
  //     } catch (err) {
  //       return socket.emit("error", {
  //         message: `Error in reaching pickup location: ${err.message || err}`,
  //         success: false,
  //       });
  //     }
  //   }
  // );

  // Started Delivery
  socket.on(
    "agentDeliveryStarted",
    async ({
      taskId,
      agentId,
      location,
      dropIndex,
      batchOrder,
      batchOrderId,
    }) => {
      const TAG = "[agentDeliveryStarted]";
      console.log(TAG, "called with:", {
        taskId,
        agentId,
        location,
        dropIndex,
        batchOrder,
      });
      console.time(`${TAG} ${taskId}`);

      const safeLogObj = (obj, max = 1000) => {
        try {
          const s = JSON.stringify(obj);
          return s.length > max ? s.slice(0, max) + "...(truncated)" : s;
        } catch (e) {
          return String(obj).slice(0, 1000);
        }
      };

      try {
        // ---------- BatchOrder flow ----------
        const handleBatchDropStart = async (
          batchOrderId,
          agentId,
          location,
          dropIndex
        ) => {
          console.log(TAG, "[BATCH] Starting batch flow:", {
            batchOrderId,
            agentId,
            dropIndex,
          });

          // 1) fetch batchOrder
          let batchOrderDoc;
          try {
            batchOrderDoc = await BatchOrder.findById(batchOrderId);
            console.log(
              TAG,
              "[BATCH] BatchOrder found:",
              !!batchOrderDoc,
              batchOrderDoc
                ? {
                  id: batchOrderDoc._id,
                  dropCount: (batchOrderDoc.dropDetails || []).length,
                }
                : null
            );
          } catch (err) {
            console.error(TAG, "[BATCH] Error fetching BatchOrder:", err);
            return socket.emit("error", {
              message: "Error fetching BatchOrder",
              success: false,
              details: err.message || err,
            });
          }

          if (!batchOrderDoc) {
            return socket.emit("error", {
              message: "BatchOrder not found",
              success: false,
            });
          }

          // 2) validate dropIndex
          const ddLen = batchOrderDoc.dropDetails?.length || 0;
          console.log(
            TAG,
            `[BATCH] dropDetails length: ${ddLen}, requested dropIndex: ${dropIndex}`
          );
          dropIndex = Number(dropIndex);
          if (Number.isNaN(dropIndex) || dropIndex < 0 || dropIndex >= ddLen) {
            console.error(TAG, "[BATCH] Invalid drop index:", dropIndex);
            return socket.emit("error", {
              message: "Invalid drop index (batch)",
              success: false,
            });
          }

          const drop = batchOrderDoc.dropDetails[dropIndex];
          console.log(TAG, "[BATCH] drop (preview):", safeLogObj(drop, 800));

          // 3) status checks
          const curStatus = drop?.drops?.status;
          console.log(TAG, `[BATCH] current drop.status = ${curStatus}`);
          if (curStatus === "Started") {
            console.log(TAG, "[BATCH] Drop already started - notifying agent");
            sendSocketData(agentId, "agentDeliveryStarted", {
              data: "Delivery already started (batch)",
              success: true,
            });
            return;
          }
          if (curStatus === "Completed") {
            console.error(TAG, "[BATCH] Drop already completed");
            return socket.emit("error", {
              message: "Delivery already completed",
              success: false,
            });
          }

          // 4) update drop
          const before = JSON.parse(JSON.stringify(drop.drops || {}));
          drop.drops.status = "Started";
          drop.drops.startTime = new Date();
          console.log(TAG, "[BATCH] Updating drop.drops (before / after):", {
            before: safeLogObj(before, 300),
            after: safeLogObj(drop.drops, 300),
          });

          // 5) save
          try {
            await batchOrderDoc.save();
            console.log(
              TAG,
              "[BATCH] BatchOrder saved successfully:",
              batchOrderDoc._id
            );
          } catch (saveErr) {
            console.error(TAG, "[BATCH] Failed to save BatchOrder:", saveErr);
            return socket.emit("error", {
              message: "Failed to save BatchOrder",
              success: false,
              details: saveErr.message || saveErr,
            });
          }

          // 6) fetch agent and order for notifications / order-stepper update
          let agentFound = null;
          let orderFound = null;
          try {
            [agentFound, orderFound] = await Promise.allSettled([
              Agent.findById(agentId),
              Order.findById(drop.orderId).populate(
                "customerId",
                "customerDetails.geofenceId"
              ),
            ]).then((results) =>
              results.map((r) => (r.status === "fulfilled" ? r.value : null))
            );
            console.log(
              TAG,
              "[BATCH] agentFound:",
              !!agentFound,
              "orderFound:",
              !!orderFound
            );
          } catch (fetchErr) {
            console.error(TAG, "[BATCH] error fetching Agent/Order:", fetchErr);
          }

          // 7) optional: update order stepper similar to task flow (if order exists)
          let stepperDetail = null;
          if (orderFound) {
            stepperDetail = {
              by: (agentFound && agentFound.fullName) || "Unknown",
              userId: agentId,
              date: new Date(),
              location,
            };

            try {
              orderFound.orderDetailStepper =
                orderFound.orderDetailStepper || {};
              orderFound.orderDetailStepper.deliveryStarted = stepperDetail;
              await orderFound.save();
              console.log(
                TAG,
                "[BATCH] Order updated with deliveryStarted stepper:",
                orderFound._id
              );
            } catch (orderSaveErr) {
              console.error(
                TAG,
                "[BATCH] Failed to update Order:",
                orderSaveErr
              );
            }
          } else {
            console.warn(
              TAG,
              "[BATCH] Order not found for drop.orderId:",
              drop.orderId
            );
          }

          // 8) notify roles (log everything)
          try {
            const eventName = "agentDeliveryStarted";
            const { rolesToNotify } = await findRolesToNotify(eventName);
            console.log(TAG, "[BATCH] rolesToNotify:", rolesToNotify);

            for (const role of rolesToNotify) {
              const roleId = {
                admin: process.env.ADMIN_ID,
                merchant: orderFound?.merchantId,
                driver: orderFound?.agentId,
                customer: orderFound?.customerId?._id,
              }[role];

              console.log(TAG, `[BATCH] role=${role} roleId=${roleId}`);
              if (roleId) {
                const notificationData = {
                  fcm: {
                    customerId: orderFound?.customerId?._id,
                    orderId: drop.orderId,
                  },
                };
                try {
                  await sendNotification(
                    roleId,
                    eventName,
                    notificationData,
                    role.charAt(0).toUpperCase() + role.slice(1)
                  );
                  console.log(
                    TAG,
                    `[BATCH] sendNotification success for role ${role}`
                  );
                } catch (notifErr) {
                  console.error(
                    TAG,
                    `[BATCH] sendNotification failed for role ${role}:`,
                    notifErr
                  );
                }
              }
            }
          } catch (notifyErr) {
            console.error(
              TAG,
              "[BATCH] Error in rolesToNotify/sendNotification:",
              notifyErr
            );
          }

          // 9) socket emits
          try {
            const emitPayload = {
              orderId: drop.orderId,
              orderDetailStepper: stepperDetail,
            };
            sendSocketData(
              process.env.ADMIN_ID,
              "agentDeliveryStarted",
              emitPayload
            );
            if (orderFound?.customerId?._id)
              sendSocketData(
                orderFound.customerId._id,
                "agentDeliveryStarted",
                emitPayload
              );

            sendSocketData(agentId, "agentDeliveryStarted", {
              data: "Delivery successfully started (BatchOrder)",
              success: true,
            });
            console.log(TAG, "[BATCH] Socket emits done");
          } catch (emitErr) {
            console.error(TAG, "[BATCH] Error during socket emits:", emitErr);
          }

          console.log(TAG, "[BATCH] Flow complete for dropIndex:", dropIndex);
        }; // end handleBatchDropStart

        // ---------- Task flow (existing logic but instrumented) ----------
        const handleTaskDropStart = async (
          taskId,
          agentId,
          location,
          dropIndex
        ) => {
          console.log(TAG, "[TASK] Starting task flow:", {
            taskId,
            agentId,
            dropIndex,
          });

          // 1) fetch Task + Agent
          let taskFound = null,
            agentFound = null;
          try {
            [taskFound, agentFound] = await Promise.all([
              Task.findById(taskId),
              Agent.findById(agentId),
            ]);
            console.log(
              TAG,
              "[TASK] taskFound:",
              !!taskFound,
              "agentFound:",
              !!agentFound
            );
          } catch (err) {
            console.error(TAG, "[TASK] Error fetching Task/Agent:", err);
            return socket.emit("error", {
              message: "Error fetching Task/Agent",
              success: false,
              details: err.message || err,
            });
          }

          if (!agentFound)
            return socket.emit("error", {
              message: "Agent not found",
              success: false,
            });
          if (!taskFound)
            return socket.emit("error", {
              message: "Task not found",
              success: false,
            });

          // 2) validate pickupDropDetails and dropIndex
          if (!taskFound.pickupDropDetails?.length) {
            console.error(TAG, "[TASK] No pickupDropDetails on task");
            return socket.emit("error", {
              message: "No pickup/drop details found",
              success: false,
            });
          }
          const dropsArr = taskFound.pickupDropDetails[0].drops || [];
          console.log(
            TAG,
            "[TASK] drops length:",
            dropsArr.length,
            "requested dropIndex:",
            dropIndex
          );
          dropIndex = Number(dropIndex);
          const delivery = dropsArr[dropIndex];
          if (!delivery) {
            console.error(
              TAG,
              "[TASK] Invalid drop index for Task:",
              dropIndex
            );
            return socket.emit("error", {
              message: "Invalid drop index",
              success: false,
            });
          }

          console.log(
            TAG,
            "[TASK] delivery before:",
            safeLogObj(delivery, 800)
          );
          if (delivery.status === "Started") {
            console.log(TAG, "[TASK] Delivery already started for this drop");
            sendSocketData(agentId, "agentDeliveryStarted", {
              data: "Delivery already started",
              success: true,
            });
            return;
          }
          if (delivery.status === "Completed") {
            console.error(
              TAG,
              "[TASK] Delivery already completed for this drop"
            );
            return socket.emit("error", {
              message: "Delivery already completed",
              success: false,
            });
          }

          // 3) fetch order
          let orderFound;
          try {
            orderFound = await Order.findById(taskFound.orderId).populate(
              "customerId",
              "customerDetails.geofenceId"
            );
            console.log(TAG, "[TASK] orderFound:", !!orderFound);
          } catch (err) {
            console.error(TAG, "[TASK] Error fetching Order:", err);
            return socket.emit("error", {
              message: "Error fetching Order",
              success: false,
            });
          }
          if (!orderFound)
            return socket.emit("error", {
              message: "Order not found",
              success: false,
            });

          // 4) compute distanceCoveredByAgent (log intermediate)
          let distanceCoveredByAgent = 0;
          try {
            if (orderFound?.deliveryMode === "Custom Order") {
              const { distanceInKM } = await getDistanceFromPickupToDelivery(
                location,
                delivery.location
              );
              console.log(
                TAG,
                "[TASK] Custom Order: distanceInKM:",
                distanceInKM
              );
              distanceCoveredByAgent =
                (orderFound?.detailAddedByAgent?.distanceCoveredByAgent || 0) +
                distanceInKM;
            } else {
              const base = orderFound?.distance || 0;
              console.log(
                TAG,
                "[TASK] Non-custom: orderDetail.distance:",
                base
              );
              distanceCoveredByAgent =
                (orderFound?.detailAddedByAgent?.distanceCoveredByAgent || 0) +
                base;
            }
            console.log(
              TAG,
              "[TASK] distanceCoveredByAgent computed:",
              distanceCoveredByAgent
            );
          } catch (distErr) {
            console.error(TAG, "[TASK] Error computing distance:", distErr);
          }

          // 5) update delivery and order stepper
          delivery.status = "Started";
          delivery.startTime = new Date();
          const stepperDetail = {
            by: agentFound.fullName,
            userId: agentId,
            date: new Date(),
            location,
          };
          orderFound.detailAddedByAgent = orderFound.detailAddedByAgent || {};
          // orderFound.detailAddedByAgent.distanceCoveredByAgent = Number(
          //   (distanceCoveredByAgent || 0).toFixed(2)
          // );
          orderFound.orderDetailStepper = orderFound.orderDetailStepper || {};
          orderFound.orderDetailStepper.deliveryStarted = stepperDetail;

          // 6) special: custom order update
          if (orderFound?.deliveryMode === "Custom Order") {
            try {
              console.log(TAG, "[TASK] Updating bill for Custom Order");
              await updateBillOfCustomOrderInDelivery(
                orderFound,
                taskFound,
                socket
              );
            } catch (uErr) {
              console.error(
                TAG,
                "[TASK] updateBillOfCustomOrderInDelivery failed:",
                uErr
              );
            }
          }

          // 7) save both
          try {
            await Promise.all([orderFound.save(), taskFound.save()]);
            console.log(TAG, "[TASK] Saved order and task successfully:", {
              orderId: orderFound._id,
              taskId: taskFound._id,
            });
          } catch (saveErr) {
            console.error(TAG, "[TASK] Error saving order/task:", saveErr);
            return socket.emit("error", {
              message: "Failed to save order/task",
              success: false,
              details: saveErr.message || saveErr,
            });
          }

          // 8) notify roles (instrumented)
          try {
            const eventName = "agentDeliveryStarted";
            const { rolesToNotify } = await findRolesToNotify(eventName);
            console.log(TAG, "[TASK] rolesToNotify:", rolesToNotify);
            for (const role of rolesToNotify) {
              const roleId = {
                admin: process.env.ADMIN_ID,
                merchant: orderFound?.merchantId,
                driver: orderFound?.agentId,
                customer: orderFound?.customerId?._id,
              }[role];
              console.log(
                TAG,
                `[TASK] sending notification for role=${role} roleId=${roleId}`
              );
              if (roleId) {
                const notificationData = {
                  fcm: {
                    customerId: orderFound.customerId?._id,
                    orderId: taskFound.orderId,
                  },
                };
                try {
                  await sendNotification(
                    roleId,
                    eventName,
                    notificationData,
                    role.charAt(0).toUpperCase() + role.slice(1)
                  );
                  console.log(
                    TAG,
                    `[TASK] sendNotification success for ${role}`
                  );
                } catch (notifErr) {
                  console.error(
                    TAG,
                    `[TASK] sendNotification failed for ${role}:`,
                    notifErr
                  );
                }
              }
            }
          } catch (notifyErr) {
            console.error(
              TAG,
              "[TASK] Error in notification block:",
              notifyErr
            );
          }

          // 9) socket emits
          try {
            const socketData = { orderDetailStepper: stepperDetail };
            sendSocketData(
              process.env.ADMIN_ID,
              "agentDeliveryStarted",
              socketData
            );
            sendSocketData(
              orderFound?.customerId?._id,
              "agentDeliveryStarted",
              socketData
            );
            if (orderFound?.merchantId)
              sendSocketData(
                orderFound.merchantId,
                "agentDeliveryStarted",
                socketData
              );
            sendSocketData(agentId, "agentDeliveryStarted", {
              data: "Delivery successfully started",
              success: true,
            });
            console.log(TAG, "[TASK] emits done");
          } catch (emitErr) {
            console.error(TAG, "[TASK] Error during emits:", emitErr);
          }

          console.log(
            TAG,
            "[TASK] Flow complete for taskId:",
            taskId,
            "dropIndex:",
            dropIndex
          );
        }; // end handleTaskDropStart

        // ---------- Choose flow and run ----------
        if (batchOrder) {
          await handleBatchDropStart(
            batchOrderId,
            agentId,
            location,
            dropIndex
          );
        } else {
          await handleTaskDropStart(taskId, agentId, location, dropIndex);
        }
      } catch (err) {
        console.error(TAG, "Top-level error:", err);
        return socket.emit("error", {
          message: `Error in starting delivery trip: ${err.message || err}`,
          success: false,
        });
      } finally {
        console.timeEnd(`${TAG} ${taskId}`);
      }
    }
  );

  socket.on(
    "reachedDeliveryLocation",
    async ({ taskId, agentId, location, deliveryIndex, batchOrder }) => {
      try {
        const agentLocation =
          location && location.length === 2
            ? location
            : getUserLocationFromSocket(agentId);

        if (!agentLocation || agentLocation.length !== 2) {
          return socket.emit("error", {
            message: "Invalid location",
            success: false,
          });
        }

        if (batchOrder) {
          // ---------- BatchOrder flow ----------
          const batchOrderDoc = await BatchOrder.findById(taskId);

          if (!batchOrderDoc) {
            return socket.emit("error", {
              message: "BatchOrder not found",
              success: false,
            });
          }

          const dropIndex = Number(deliveryIndex);
          const ddLen = batchOrderDoc.dropDetails?.length || 0;

          if (
            Number.isNaN(dropIndex) ||
            dropIndex < 0 ||
            dropIndex >= ddLen
          ) {
            return socket.emit("error", {
              message: "Invalid drop index (batch)",
              success: false,
            });
          }

          const drop = batchOrderDoc.dropDetails[dropIndex];

          if (!drop?.drops) {
            return socket.emit("error", {
              message: "Drop detail not found",
              success: false,
            });
          }

          if (drop.drops.status === "Completed") {
            sendSocketData(agentId, "reachedDeliveryLocation", {
              data: "Delivery completed (BatchOrder)",
              success: true,
            });

            return;
          }

          // Distance check for delivery location
          const dropLocation = drop.drops.location;

          if (dropLocation && dropLocation.length === 2) {
            const distance = turf.distance(
              turf.point([dropLocation[1], dropLocation[0]]),
              turf.point([agentLocation[1], agentLocation[0]]),
              { units: "kilometers" }
            );

            if (distance >= 0.5) {
              return socket.emit("error", {
                message: "Agent is far from delivery point",
                success: false,
              });
            }
          }

          drop.drops.status = "Completed";
          drop.drops.completedTime = new Date();

          batchOrderDoc.markModified(`dropDetails.${dropIndex}.drops`);

          const [agentFound, orderFound] = await Promise.all([
            Agent.findById(agentId),
            Order.findById(drop.orderId).populate(
              "customerId",
              "customerDetails.geofenceId"
            ),
          ]);

          const stepperDetail = {
            by: agentFound?.fullName || "Unknown",
            userId: agentId,
            date: new Date(),
            location: agentLocation,
          };

          const saveOps = [batchOrderDoc.save()];

          if (orderFound) {
            orderFound.orderDetailStepper =
              orderFound.orderDetailStepper || {};

            orderFound.orderDetailStepper.reachedDeliveryLocation =
              stepperDetail;

            orderFound.deliveryTime = new Date();

            // ---------------- DISTANCE CALCULATION ----------------
            const deliveryStartedLocation =
              orderFound.orderDetailStepper?.deliveryStarted?.location;

            if (
              deliveryStartedLocation?.length === 2 &&
              agentLocation?.length === 2
            ) {
              const { distanceInKM } =
                await getDistanceFromPickupToDelivery(
                  deliveryStartedLocation,
                  agentLocation
                );

              if (!orderFound.detailAddedByAgent) {
                orderFound.detailAddedByAgent = {};
              }

              const startToPick =
                orderFound.detailAddedByAgent
                  ?.startToPickDistance || 0;

              const totalDistance = Number(
                (startToPick + distanceInKM).toFixed(2)
              );

              orderFound.detailAddedByAgent.distanceCoveredByAgent =
                totalDistance;

              // ---------------- CUSTOM ORDER PRICING ----------------
              if (orderFound.deliveryMode === "Custom Order") {
                const geofenceId =
                  orderFound?.customerId?.customerDetails?.geofenceId;

                const customerPricing = await CustomerPricing.findOne({
                  deliveryMode: "Custom Order",
                  geofenceId,
                  status: true,
                });

                if (customerPricing) {
                  const baseFare = Number(customerPricing.baseFare || 0);
                  const baseDistance = Number(customerPricing.baseDistance || 0);
                  const fareAfterBaseDistance = Number(
                    customerPricing.fareAfterBaseDistance || 0
                  );

                  const deliveryCharge = calculateDeliveryCharges(
                    totalDistance,
                    baseFare,
                    baseDistance,
                    fareAfterBaseDistance
                  );

                  const itemTotal = Number(
                    orderFound.billDetail?.itemTotal || 0
                  );

                  orderFound.billDetail = orderFound.billDetail || {};
                  orderFound.billDetail.deliveryCharge = parseFloat(
                    deliveryCharge.toFixed(2)
                  );
                  orderFound.billDetail.subTotal = parseFloat(
                    (itemTotal + deliveryCharge).toFixed(2)
                  );
                  orderFound.billDetail.grandTotal = parseFloat(
                    (
                      itemTotal +
                      deliveryCharge -
                      Number(orderFound.billDetail?.discountedAmount || 0)
                    ).toFixed(2)
                  );

                  orderFound.markModified("billDetail");
                }
              }
            }

            saveOps.push(orderFound.save());
          }

          await Promise.all(saveOps);

          const eventName = "reachedDeliveryLocation";

          const { rolesToNotify } =
            await findRolesToNotify(eventName);

          const notifyPromises = [];

          for (const role of rolesToNotify) {
            const roleId = {
              admin: process.env.ADMIN_ID,
              merchant: orderFound?.merchantId,
              driver: orderFound?.agentId,
              customer: orderFound?.customerId?._id,
            }[role];

            if (roleId) {
              notifyPromises.push(
                sendNotification(
                  roleId,
                  eventName,
                  {
                    fcm: {
                      customerId:
                        orderFound?.customerId?._id,
                      orderId: drop.orderId,
                      agentName: agentFound?.fullName,
                    },
                  },
                  role.charAt(0).toUpperCase() +
                  role.slice(1)
                )
              );
            }
          }

          await Promise.all(notifyPromises);

          const emitPayload = {
            orderId: drop.orderId,
            orderDetailStepper: stepperDetail,
          };

          sendSocketData(
            process.env.ADMIN_ID,
            eventName,
            emitPayload
          );

          if (orderFound?.customerId?._id) {
            sendSocketData(
              orderFound.customerId._id,
              eventName,
              emitPayload
            );
          }

          sendSocketData(agentId, "reachedDeliveryLocation", {
            data: "Delivery completed (BatchOrder)",
            success: true,
          });
        } else {
          // ---------- Task flow ----------
          const [agentFound, taskFound] = await Promise.all([
            Agent.findById(agentId),
            Task.findOne({ _id: taskId, agentId }),
          ]);

          if (!agentFound) {
            return socket.emit("error", {
              message: "Agent not found",
              success: false,
            });
          }

          if (!taskFound) {
            return socket.emit("error", {
              message: "Task not found",
              success: false,
            });
          }

          const deliveryDetail =
            taskFound.pickupDropDetails?.[0]?.drops?.[
            deliveryIndex
            ];

          if (!deliveryDetail) {
            return socket.emit("error", {
              message: "Delivery detail not found",
              success: false,
            });
          }

          if (deliveryDetail.status === "Completed") {
            sendSocketData(agentId, "reachedDeliveryLocation", {
              data: "Delivery completed",
              success: true,
            });

            return;
          }

          // Distance check
          const dropLocation = deliveryDetail.location;

          if (dropLocation && dropLocation.length === 2) {
            const distance = turf.distance(
              turf.point([dropLocation[1], dropLocation[0]]),
              turf.point([agentLocation[1], agentLocation[0]]),
              { units: "kilometers" }
            );

            if (distance >= 0.5) {
              return socket.emit("error", {
                message: "Agent is far from delivery point",
                success: false,
              });
            }
          }

          const orderFound = await Order.findById(
            taskFound.orderId
          ).populate(
            "customerId",
            "customerDetails.geofenceId"
          );

          if (!orderFound) {
            return socket.emit("error", {
              message: "Order not found",
              success: false,
            });
          }

          deliveryDetail.status = "Completed";
          deliveryDetail.completedTime = new Date();

          taskFound.markModified(
            `pickupDropDetails.0.drops.${deliveryIndex}`
          );

          const stepperDetail = {
            by: agentFound.fullName,
            userId: agentId,
            date: new Date(),
            location: agentLocation,
          };

          orderFound.orderDetailStepper =
            orderFound.orderDetailStepper || {};

          orderFound.orderDetailStepper.reachedDeliveryLocation =
            stepperDetail;

          orderFound.deliveryTime = new Date();

          // ---------------- DISTANCE CALCULATION ----------------
          const deliveryStartedLocation =
            orderFound.orderDetailStepper?.deliveryStarted
              ?.location;

          if (
            deliveryStartedLocation?.length === 2 &&
            agentLocation?.length === 2
          ) {
            const { distanceInKM } =
              await getDistanceFromPickupToDelivery(
                deliveryStartedLocation,
                agentLocation
              );

            if (!orderFound.detailAddedByAgent) {
              orderFound.detailAddedByAgent = {};
            }

            const startToPick =
              orderFound.detailAddedByAgent
                ?.startToPickDistance || 0;

            const totalDistance = Number(
              (startToPick + distanceInKM).toFixed(2)
            );

            orderFound.detailAddedByAgent.distanceCoveredByAgent =
              totalDistance;

            // ---------------- CUSTOM ORDER PRICING ----------------
            if (orderFound.deliveryMode === "Custom Order") {
              const geofenceId =
                orderFound?.customerId?.customerDetails?.geofenceId;

              const customerPricing = await CustomerPricing.findOne({
                deliveryMode: "Custom Order",
                geofenceId,
                status: true,
              });

              if (customerPricing) {
                const baseFare = Number(customerPricing.baseFare || 0);
                const baseDistance = Number(customerPricing.baseDistance || 0);
                const fareAfterBaseDistance = Number(
                  customerPricing.fareAfterBaseDistance || 0
                );

                const deliveryCharge = calculateDeliveryCharges(
                  totalDistance,
                  baseFare,
                  baseDistance,
                  fareAfterBaseDistance
                );

                const itemTotal = Number(
                  orderFound.billDetail?.itemTotal || 0
                );

                orderFound.billDetail = orderFound.billDetail || {};
                orderFound.billDetail.deliveryCharge = parseFloat(
                  deliveryCharge.toFixed(2)
                );
                orderFound.billDetail.subTotal = parseFloat(
                  (itemTotal + deliveryCharge).toFixed(2)
                );
                orderFound.billDetail.grandTotal = parseFloat(
                  (
                    itemTotal +
                    deliveryCharge -
                    Number(orderFound.billDetail?.discountedAmount || 0)
                  ).toFixed(2)
                );

                orderFound.markModified("billDetail");
              }
            }
          }

          const allDone =
            taskFound.pickupDropDetails?.[0]?.drops?.every(
              (d) => d.status === "Completed"
            );

          if (allDone) {
            taskFound.taskStatus = "Completed";
          }

          await Promise.all([
            orderFound.save(),
            taskFound.save(),
          ]);

          const eventName = "reachedDeliveryLocation";

          const { rolesToNotify } =
            await findRolesToNotify(eventName);

          const notifyPromises = [];

          for (const role of rolesToNotify) {
            const roleId = {
              admin: process.env.ADMIN_ID,
              merchant: orderFound?.merchantId,
              driver: orderFound?.agentId,
              customer: orderFound?.customerId?._id,
            }[role];

            if (roleId) {
              notifyPromises.push(
                sendNotification(
                  roleId,
                  eventName,
                  {
                    fcm: {
                      customerId:
                        orderFound.customerId?._id,
                      orderId: taskFound.orderId,
                      agentName: agentFound.fullName,
                    },
                  },
                  role.charAt(0).toUpperCase() +
                  role.slice(1)
                )
              );
            }
          }

          await Promise.all(notifyPromises);

          const socketPayload = {
            orderId: taskFound.orderId,
            orderDetailStepper: stepperDetail,
          };

          sendSocketData(
            process.env.ADMIN_ID,
            eventName,
            socketPayload
          );

          if (orderFound?.customerId?._id) {
            sendSocketData(
              orderFound.customerId._id,
              eventName,
              socketPayload
            );
          }

          sendSocketData(agentId, "reachedDeliveryLocation", {
            data: "Delivery completed",
            success: true,
          });
        }
      } catch (err) {
        console.error(
          "[reachedDeliveryLocation] Error:",
          err.message
        );

        return socket.emit("error", {
          message: `Error in reachedDeliveryLocation: ${err.message || err
            }`,
          success: false,
        });
      }
    }
  );

  // socket.on(
  //   "reachedDeliveryLocation",
  //   async ({ taskId, agentId, location, deliveryIndex, batchOrder }) => {
  //     try {
  //       const agentLocation =
  //         location && location.length === 2
  //           ? location
  //           : getUserLocationFromSocket(agentId);

  //       if (!agentLocation || agentLocation.length !== 2) {
  //         return socket.emit("error", {
  //           message: "Invalid location",
  //           success: false,
  //         });
  //       }

  //       if (batchOrder) {
  //         // ---------- BatchOrder flow ----------
  //         const batchOrderDoc = await BatchOrder.findById(taskId);
  //         if (!batchOrderDoc) {
  //           return socket.emit("error", { message: "BatchOrder not found", success: false });
  //         }

  //         const dropIndex = Number(deliveryIndex);
  //         const ddLen = batchOrderDoc.dropDetails?.length || 0;
  //         if (Number.isNaN(dropIndex) || dropIndex < 0 || dropIndex >= ddLen) {
  //           return socket.emit("error", { message: "Invalid drop index (batch)", success: false });
  //         }

  //         const drop = batchOrderDoc.dropDetails[dropIndex];
  //         if (!drop?.drops) {
  //           return socket.emit("error", { message: "Drop detail not found", success: false });
  //         }

  //         if (drop.drops.status === "Completed") {
  //           // Use sendSocketData so it always does a fresh socketId lookup
  //           sendSocketData(agentId, "reachedDeliveryLocation", {
  //             data: "Delivery completed (BatchOrder)",
  //             success: true,
  //           });
  //           return;
  //         }

  //         // Distance check for delivery location (fixed tolerance: 0.5 km)
  //         const dropLocation = drop.drops.location;
  //         if (dropLocation && dropLocation.length === 2) {
  //           const distance = turf.distance(
  //             turf.point([dropLocation[1], dropLocation[0]]),
  //             turf.point([agentLocation[1], agentLocation[0]]),
  //             { units: "kilometers" }
  //           );
  //           if (distance >= 0.5) {
  //             return socket.emit("error", {
  //               message: "Agent is far from delivery point",
  //               success: false,
  //             });
  //           }
  //         }

  //         drop.drops.status = "Completed";
  //         drop.drops.completedTime = new Date();
  //         batchOrderDoc.markModified(`dropDetails.${dropIndex}.drops`);

  //         const [agentFound, orderFound] = await Promise.all([
  //           Agent.findById(agentId),
  //           Order.findById(drop.orderId).populate("customerId", "customerDetails.geofenceId"),
  //         ]);

  //         const stepperDetail = {
  //           by: agentFound?.fullName || "Unknown",
  //           userId: agentId,
  //           date: new Date(),
  //           location: agentLocation,
  //         };

  //         const saveOps = [batchOrderDoc.save()];
  //         if (orderFound) {
  //           orderFound.orderDetailStepper = orderFound.orderDetailStepper || {};
  //           orderFound.orderDetailStepper.reachedDeliveryLocation = stepperDetail;
  //           orderFound.deliveryTime = new Date();

  //           // ADD: Calculate pick-to-delivery distance for batch order
  //           const delivStartLoc = orderFound.orderDetailStepper?.deliveryStarted?.location;
  //           if (delivStartLoc?.length === 2 && agentLocation?.length === 2) {
  //             const { distanceInKM } = await getDistanceFromPickupToDelivery(
  //               delivStartLoc,
  //               agentLocation
  //             );
  //             if (!orderFound.detailAddedByAgent) orderFound.detailAddedByAgent = {};
  //             const startToPick = orderFound.detailAddedByAgent.startToPickDistance || 0;
  //             orderFound.detailAddedByAgent.distanceCoveredByAgent = Number(
  //               (startToPick + distanceInKM).toFixed(2)
  //             );
  //           }

  //           saveOps.push(orderFound.save());
  //         }
  //         await Promise.all(saveOps);

  //         const eventName = "reachedDeliveryLocation";
  //         const { rolesToNotify } = await findRolesToNotify(eventName);

  //         const notifyPromises = [];
  //         for (const role of rolesToNotify) {
  //           const roleId = {
  //             admin: process.env.ADMIN_ID,
  //             merchant: orderFound?.merchantId,
  //             driver: orderFound?.agentId,
  //             customer: orderFound?.customerId?._id,
  //           }[role];
  //           if (roleId) {
  //             notifyPromises.push(
  //               sendNotification(
  //                 roleId,
  //                 eventName,
  //                 { fcm: { customerId: orderFound?.customerId?._id, orderId: drop.orderId, agentName: agentFound?.fullName } },
  //                 role.charAt(0).toUpperCase() + role.slice(1)
  //               )
  //             );
  //           }
  //         }
  //         await Promise.all(notifyPromises);

  //         const emitPayload = { orderId: drop.orderId, orderDetailStepper: stepperDetail };
  //         sendSocketData(process.env.ADMIN_ID, eventName, emitPayload);
  //         if (orderFound?.customerId?._id) sendSocketData(orderFound.customerId._id, eventName, emitPayload);
  //         sendSocketData(agentId, "reachedDeliveryLocation", {
  //           data: "Delivery completed (BatchOrder)",
  //           success: true,
  //         });
  //       } else {
  //         // ---------- Task flow ----------
  //         const [agentFound, taskFound] = await Promise.all([
  //           Agent.findById(agentId),
  //           Task.findOne({ _id: taskId, agentId }),
  //         ]);

  //         if (!agentFound) {
  //           return socket.emit("error", { message: "Agent not found", success: false });
  //         }
  //         if (!taskFound) {
  //           return socket.emit("error", { message: "Task not found", success: false });
  //         }

  //         const deliveryDetail = taskFound.pickupDropDetails?.[0]?.drops?.[deliveryIndex];
  //         if (!deliveryDetail) {
  //           return socket.emit("error", { message: "Delivery detail not found", success: false });
  //         }

  //         if (deliveryDetail.status === "Completed") {
  //           sendSocketData(agentId, "reachedDeliveryLocation", {
  //             data: "Delivery completed",
  //             success: true,
  //           });
  //           return;
  //         }

  //         // Distance check for delivery location
  //         const dropLocation = deliveryDetail.location;
  //         if (dropLocation && dropLocation.length === 2) {
  //           const distance = turf.distance(
  //             turf.point([dropLocation[1], dropLocation[0]]),
  //             turf.point([agentLocation[1], agentLocation[0]]),
  //             { units: "kilometers" }
  //           );
  //           if (distance >= 0.5) {
  //             return socket.emit("error", {
  //               message: "Agent is far from delivery point",
  //               success: false,
  //             });
  //           }
  //         }

  //         const orderFound = await Order.findById(taskFound.orderId).populate(
  //           "customerId",
  //           "customerDetails.geofenceId"
  //         );
  //         if (!orderFound) {
  //           return socket.emit("error", { message: "Order not found", success: false });
  //         }

  //         deliveryDetail.status = "Completed";
  //         deliveryDetail.completedTime = new Date();
  //         taskFound.markModified(`pickupDropDetails.0.drops.${deliveryIndex}`);

  //         const stepperDetail = {
  //           by: agentFound.fullName,
  //           userId: agentId,
  //           date: new Date(),
  //           location: agentLocation,
  //         };
  //         orderFound.orderDetailStepper = orderFound.orderDetailStepper || {};
  //         orderFound.orderDetailStepper.reachedDeliveryLocation = stepperDetail;
  //         orderFound.deliveryTime = new Date();

  //         // Calculate pick-to-delivery distance (agent's actual travel from merchant to customer)
  //         const deliveryStartedLocation = orderFound.orderDetailStepper?.deliveryStarted?.location;
  //         if (deliveryStartedLocation?.length === 2 && agentLocation?.length === 2) {
  //           const { distanceInKM } = await getDistanceFromPickupToDelivery(
  //             deliveryStartedLocation,  // where agent was when they left the merchant
  //             agentLocation             // where agent is now (at customer)
  //           );
  //           if (!orderFound.detailAddedByAgent) orderFound.detailAddedByAgent = {};
  //           const startToPick = orderFound.detailAddedByAgent.startToPickDistance || 0;
  //           orderFound.detailAddedByAgent.distanceCoveredByAgent = Number(
  //             (startToPick + distanceInKM).toFixed(2)
  //           );
  //         }

  //         const allDone = taskFound.pickupDropDetails?.[0]?.drops?.every(
  //           (d) => d.status === "Completed"
  //         );
  //         if (allDone) taskFound.taskStatus = "Completed";

  //         await Promise.all([orderFound.save(), taskFound.save()]);

  //         const eventName = "reachedDeliveryLocation";
  //         const { rolesToNotify } = await findRolesToNotify(eventName);

  //         const notifyPromises = [];
  //         for (const role of rolesToNotify) {
  //           const roleId = {
  //             admin: process.env.ADMIN_ID,
  //             merchant: orderFound?.merchantId,
  //             driver: orderFound?.agentId,
  //             customer: orderFound?.customerId?._id,
  //           }[role];
  //           if (roleId) {
  //             notifyPromises.push(
  //               sendNotification(
  //                 roleId,
  //                 eventName,
  //                 { fcm: { customerId: orderFound.customerId?._id, orderId: taskFound.orderId, agentName: agentFound.fullName } },
  //                 role.charAt(0).toUpperCase() + role.slice(1)
  //               )
  //             );
  //           }
  //         }
  //         await Promise.all(notifyPromises);

  //         const socketPayload = { orderId: taskFound.orderId, orderDetailStepper: stepperDetail };
  //         sendSocketData(process.env.ADMIN_ID, eventName, socketPayload);
  //         if (orderFound?.customerId?._id) sendSocketData(orderFound.customerId._id, eventName, socketPayload);
  //         sendSocketData(agentId, "reachedDeliveryLocation", {
  //           data: "Delivery completed",
  //           success: true,
  //         });
  //       }
  //     } catch (err) {
  //       console.error("[reachedDeliveryLocation] Error:", err.message);
  //       return socket.emit("error", {
  //         message: `Error in reachedDeliveryLocation: ${err.message || err}`,
  //         success: false,
  //       });
  //     }
  //   }
  // );

  // socket.on(
  //   "agentDeliveryStarted",

  //   async ({ taskId, agentId, location, dropIndex, batchOrder }) => {
  //     console.log("agentDeliveryStarted called with:", {
  //       taskId,
  //       agentId,
  //       location,
  //       dropIndex,
  //       batchOrder,
  //     });
  //     try {
  //       const handleDropStart = async (
  //         taskId,
  //         agentId,
  //         location,
  //         dropIndex
  //       ) => {
  //         const [taskFound, agentFound] = await Promise.all([
  //           Task.findById(taskId),
  //           Agent.findById(agentId),
  //         ]);

  //         const eventName = "agentDeliveryStarted";

  //         if (!agentFound) {
  //           return socket.emit("error", {
  //             message: "Agent not found",
  //             success: false,
  //           });
  //         }

  //         if (!taskFound) {
  //           return socket.emit("error", {
  //             message: "Task not found",
  //             success: false,
  //           });
  //         }

  //         // ✅ Check if pickupDropDetails exists
  //         if (!taskFound.pickupDropDetails?.length) {
  //           return socket.emit("error", {
  //             message: "No pickup/drop details found",
  //             success: false,
  //           });
  //         }

  //         const delivery = taskFound.pickupDropDetails[0].drops?.[dropIndex];

  //         if (!delivery) {
  //           return socket.emit("error", {
  //             message: "Invalid drop index",
  //             success: false,
  //           });
  //         }

  //         // ✅ Prevent duplicate start
  //         if (delivery.status === "Started") {
  //           const agentSocketId = userSocketMap[agentId]?.socketId;
  //           if (agentSocketId) {
  //             io.to(agentSocketId).emit(eventName, {
  //               data: "Delivery already started",
  //               success: true,
  //             });
  //           }
  //           return;
  //         }

  //         if (delivery.status === "Completed") {
  //           return socket.emit("error", {
  //             message: "Delivery already completed",
  //             success: false,
  //           });
  //         }

  //         const orderFound = await Order.findById(taskFound.orderId).populate(
  //           "customerId",
  //           "customerDetails.geofenceId"
  //         );

  //         if (!orderFound) {
  //           return socket.emit("error", {
  //             message: "Order not found",
  //             success: false,
  //           });
  //         }

  //         let distanceCoveredByAgent = 0;

  //         if (orderFound?.deliveryMode === "Custom Order") {
  //           const { distanceInKM } = await getDistanceFromPickupToDelivery(
  //             location,
  //             delivery.location
  //           );

  //           distanceCoveredByAgent =
  //             (orderFound?.detailAddedByAgent?.distanceCoveredByAgent || 0) +
  //             distanceInKM;
  //         } else {
  //           distanceCoveredByAgent =
  //             (orderFound?.detailAddedByAgent?.distanceCoveredByAgent || 0) +
  //             (orderFound?.orderDetail?.distance || 0);
  //         }

  //         // ✅ Update task drop
  //         delivery.status = "Started";
  //         delivery.startTime = new Date();

  //         // ✅ Order stepper
  //         const stepperDetail = {
  //           by: agentFound.fullName,
  //           userId: agentId,
  //           date: new Date(),
  //           location,
  //         };

  //         if (!orderFound.detailAddedByAgent)
  //           orderFound.detailAddedByAgent = {};
  //         orderFound.detailAddedByAgent.distanceCoveredByAgent = Number(
  //           distanceCoveredByAgent.toFixed(2)
  //         );

  //         if (!orderFound.orderDetailStepper)
  //           orderFound.orderDetailStepper = {};
  //         orderFound.orderDetailStepper.deliveryStarted = stepperDetail;

  //         if (orderFound?.deliveryMode === "Custom Order") {
  //           await updateBillOfCustomOrderInDelivery(
  //             orderFound,
  //             taskFound,
  //             socket
  //           );
  //         }

  //         await Promise.all([orderFound.save(), taskFound.save()]);

  //         // 🔔 Notify roles
  //         const { rolesToNotify } = await findRolesToNotify(eventName);

  //         for (const role of rolesToNotify) {
  //           const roleId = {
  //             admin: process.env.ADMIN_ID,
  //             merchant: orderFound?.merchantId,
  //             driver: orderFound?.agentId,
  //             customer: orderFound?.customerId._id,
  //           }[role];

  //           if (roleId) {
  //             const notificationData = {
  //               fcm: {
  //                 customerId: orderFound.customerId._id,
  //                 orderId: taskFound.orderId,
  //               },
  //             };

  //             await sendNotification(
  //               roleId,
  //               eventName,
  //               notificationData,
  //               role.charAt(0).toUpperCase() + role.slice(1)
  //             );
  //           }
  //         }

  //         // 🔔 Emit socket events
  //         const socketData = { orderDetailStepper: stepperDetail };
  //         sendSocketData(process.env.ADMIN_ID, eventName, socketData);
  //         sendSocketData(orderFound?.customerId._id, eventName, socketData);

  //         if (orderFound?.merchantId)
  //           sendSocketData(orderFound.merchantId, eventName, socketData);

  //         const agentSocketId = userSocketMap[agentId]?.socketId;
  //         if (agentSocketId) {
  //           io.to(agentSocketId).emit(eventName, {
  //             data: "Delivery successfully started",
  //             success: true,
  //           });
  //         }

  //         if (batchOrder) {
  //           // 🟢 Handle BatchOrder case
  //           const batchOrderById = await BatchOrder.findById(taskId); // here taskId is actually the batchOrderId
  //           if (!batchOrderById) {
  //             return socket.emit("error", {
  //               message: "BatchOrder not found",
  //               success: false,
  //             });
  //           }

  //           const drop = batchOrderById.dropDetails[dropIndex];
  //           if (!drop) {
  //             return socket.emit("error", {
  //               message: "Invalid drop index",
  //               success: false,
  //             });
  //           }

  //           drop.drops.status = "Started";
  //           drop.drops.startTime = new Date();

  //           await batchOrderById.save();

  //           // 🔔 Send notifications + socket emits here (like your Task logic)
  //         } else {
  //           // 🟢 Handle normal Task case
  //           await handleDropStart(taskId, agentId, location, dropIndex);
  //         }
  //       };
  //     } catch (err) {
  //       console.log("Agent failed to start delivery", err);

  //       return socket.emit("error", {
  //         message: `Error in starting delivery trip: ${err}`,
  //         success: false,
  //       });
  //     }
  //   }
  // );

  // socket.on("agentDeliveryStarted", async ({ taskId, agentId, location }) => {
  //   try {
  //     const [agentFound, taskFound] = await Promise.all([
  //       Agent.findById(agentId),
  //       Task.findById(taskId),
  //     ]);

  //     const eventName = "agentDeliveryStarted";

  //     if (!agentFound) {
  //       return socket.emit("error", {
  //         message: "Agent not found",
  //         success: false,
  //       });
  //     }

  //     if (!taskFound) {
  //       return socket.emit("error", {
  //         message: "Task not found",
  //         success: false,
  //       });
  //     }

  //     if (
  //       taskFound.pickupDetail.pickupStatus === "Completed" &&
  //       taskFound.deliveryDetail.deliveryStatus === "Started"
  //     ) {
  //       const agentSocketId = userSocketMap[agentId]?.socketId;
  //       if (agentSocketId) {
  //         io.to(agentSocketId).emit(eventName, {
  //           data: "Delivery successfully started",
  //           success: true,
  //         });
  //       }

  //       return;
  //     }

  //     const orderFound = await Order.findById(taskFound.orderId).populate(
  //       "customerId",
  //       "customerDetails.geofenceId"
  //     );

  //     if (!orderFound) {
  //       return socket.emit("error", {
  //         message: "Order not found",
  //         success: false,
  //       });
  //     }

  //     let distanceCoveredByAgent = 0;

  //     if (orderFound.orderDetail.deliveryMode === "Custom Order") {
  //       const { distanceInKM } = await getDistanceFromPickupToDelivery(
  //         location,
  //         orderFound.orderDetail.deliveryLocation
  //       );

  //       distanceCoveredByAgent =
  //         (orderFound?.detailAddedByAgent?.distanceCoveredByAgent || 0) +
  //         distanceInKM;
  //     } else {
  //       distanceCoveredByAgent =
  //         (orderFound?.detailAddedByAgent?.distanceCoveredByAgent || 0) +
  //         (orderFound?.orderDetail?.distance || 0);
  //     }

  //     taskFound.pickupDetail.pickupStatus = "Completed";
  //     taskFound.deliveryDetail.deliveryStatus = "Started";
  //     taskFound.deliveryDetail.startTime = new Date();

  //     // Update order stepper details
  //     const stepperDetail = {
  //       by: agentFound.fullName,
  //       userId: agentId,
  //       date: new Date(),
  //       location,
  //     };

  //     orderFound.detailAddedByAgent.distanceCoveredByAgent = Number(
  //       distanceCoveredByAgent.toFixed(2)
  //     );
  //     orderFound.orderDetailStepper.deliveryStarted = stepperDetail;

  //     if (orderFound.orderDetail.deliveryMode === "Custom Order") {
  //       await updateBillOfCustomOrderInDelivery(orderFound, taskFound, socket);
  //     }

  //     await Promise.all([orderFound.save(), taskFound.save()]);

  //     // Notify roles
  //     const { rolesToNotify } = await findRolesToNotify(eventName);

  //     for (const role of rolesToNotify) {
  //       const roleId = {
  //         admin: process.env.ADMIN_ID,
  //         merchant: orderFound?.merchantId,
  //         driver: orderFound?.agentId,
  //         customer: orderFound?.customerId._id,
  //       }[role];

  //       if (roleId) {
  //         const notificationData = {
  //           fcm: {
  //             customerId: orderFound.customerId,
  //             orderId: taskFound.orderId,
  //           },
  //         };

  //         await sendNotification(
  //           roleId,
  //           eventName,
  //           notificationData,
  //           role.charAt(0).toUpperCase() + role.slice(1)
  //         );
  //       }
  //     }

  //     // Emit socket events to relevant users
  //     const socketData = { orderDetailStepper: stepperDetail };
  //     sendSocketData(process.env.ADMIN_ID, eventName, socketData);
  //     sendSocketData(orderFound?.customerId._id, eventName, socketData);

  //     if (orderFound?.merchantId)
  //       sendSocketData(orderFound.merchantId, eventName, socketData);

  //     const agentSocketId = userSocketMap[agentId]?.socketId;
  //     if (agentSocketId) {
  //       io.to(agentSocketId).emit(eventName, {
  //         data: "Delivery successfully started",
  //         success: true,
  //       });
  //     }
  //   } catch (err) {
  //     console.log("Agent failed to start delivery", err);

  //     return socket.emit("error", {
  //       message: `Error in starting delivery trip: ${err}`,
  //       success: false,
  //     });
  //   }
  // });

  // Agent reached drop location socket

  // Mark message as seen in customer agent message chat

  // socket.on(
  //   "reachedDeliveryLocation",
  //   async ({ taskId, agentId, location, deliveryIndex = 0, batchOrder }) => {
  //     const TAG = "[reachedDeliveryLocation]";
  //     console.log(TAG, "called with:", {
  //       taskId,
  //       agentId,
  //       location,
  //       deliveryIndex,
  //       batchOrder,
  //     });

  //     const agentSocketId = userSocketMap[agentId]?.socketId;
  //     const safeLogObj = (obj, max = 800) => {
  //       try {
  //         const s = JSON.stringify(obj);
  //         return s.length > max ? s.slice(0, max) + "...(truncated)" : s;
  //       } catch {
  //         return String(obj).slice(0, max);
  //       }
  //     };

  //     try {
  //       // ---------- BatchOrder flow ----------
  //       const handleBatchDropComplete = async (
  //         batchOrderId,
  //         agentId,
  //         location,
  //         dropIndex
  //       ) => {
  //         console.log(TAG, "[BATCH] Completing batch flow:", {
  //           batchOrderId,
  //           agentId,
  //           dropIndex,
  //         });

  //         // 1) fetch batchOrder
  //         const batchOrderDoc = await BatchOrder.findById(batchOrderId);
  //         if (!batchOrderDoc) {
  //           return socket.emit("error", {
  //             message: "BatchOrder not found",
  //             success: false,
  //           });
  //         }

  //         // 2) validate dropIndex
  //         dropIndex = Number(dropIndex);
  //         const ddLen = batchOrderDoc.dropDetails?.length || 0;
  //         if (Number.isNaN(dropIndex) || dropIndex < 0 || dropIndex >= ddLen) {
  //           return socket.emit("error", {
  //             message: "Invalid drop index (batch)",
  //             success: false,
  //           });
  //         }

  //         const drop = batchOrderDoc.dropDetails[dropIndex];
  //         if (!drop?.drops) {
  //           return socket.emit("error", {
  //             message: "Drop detail not found",
  //             success: false,
  //           });
  //         }

  //         // 3) status check
  //         if (drop.drops.status === "Completed") {
  //           return socket.emit("error", {
  //             message: "Drop already completed",
  //             success: false,
  //           });
  //         }

  //         // 4) update drop
  //         const before = JSON.parse(JSON.stringify(drop.drops));
  //         drop.drops.status = "Completed";
  //         drop.drops.completedTime = new Date();
  //         console.log(TAG, "[BATCH] Updating drop.drops:", {
  //           before: safeLogObj(before),
  //           after: safeLogObj(drop.drops),
  //         });

  //         await batchOrderDoc.save();

  //         // 5) fetch agent + order
  //         const [agentFound, orderFound] = await Promise.all([
  //           Agent.findById(agentId),
  //           Order.findById(drop.orderId).populate(
  //             "customerId",
  //             "customerDetails.geofenceId"
  //           ),
  //         ]);

  //         const stepperDetail = {
  //           by: agentFound?.fullName || "Unknown",
  //           userId: agentId,
  //           date: new Date(),
  //           location,
  //         };
  //         if (orderFound) {
  //           orderFound.orderDetailStepper = orderFound.orderDetailStepper || {};
  //           orderFound.orderDetailStepper.reachedDeliveryLocation =
  //             stepperDetail;
  //           orderFound.deliveryTime = new Date();
  //           await orderFound.save();
  //         }

  //         // 6) notify roles
  //         const eventName = "reachedDeliveryLocation";
  //         const { rolesToNotify } = await findRolesToNotify(eventName);
  //         for (const role of rolesToNotify) {
  //           const roleId = {
  //             admin: process.env.ADMIN_ID,
  //             merchant: orderFound?.merchantId,
  //             driver: orderFound?.agentId,
  //             customer: orderFound?.customerId?._id,
  //           }[role];
  //           if (roleId) {
  //             const notificationData = {
  //               fcm: {
  //                 customerId: orderFound?.customerId?._id,
  //                 orderId: drop.orderId,
  //               },
  //             };
  //             await sendNotification(
  //               roleId,
  //               eventName,
  //               notificationData,
  //               role.charAt(0).toUpperCase() + role.slice(1)
  //             );
  //           }
  //         }

  //         // 7) socket emits
  //         const emitPayload = {
  //           orderId: drop.orderId,
  //           orderDetailStepper: stepperDetail,
  //         };
  //         sendSocketData(process.env.ADMIN_ID, eventName, emitPayload);
  //         if (orderFound?.customerId?._id)
  //           sendSocketData(orderFound.customerId._id, eventName, emitPayload);
  //         if (agentSocketId) {
  //           io.to(agentSocketId).emit("reachedDeliveryLocation", {
  //             data: "Delivery completed (BatchOrder)",
  //             success: true,
  //           });
  //         }
  //       };

  //       // ---------- Task flow ----------
  //       const handleTaskDropComplete = async (
  //         taskId,
  //         agentId,
  //         location,
  //         deliveryIndex
  //       ) => {
  //         console.log(TAG, "[TASK] Completing task flow:", {
  //           taskId,
  //           agentId,
  //           deliveryIndex,
  //         });

  //         const [agentFound, taskFound] = await Promise.all([
  //           Agent.findById(agentId),
  //           Task.findOne({ _id: taskId, agentId }),
  //         ]);
  //         if (!agentFound)
  //           return socket.emit("error", {
  //             message: "Agent not found",
  //             success: false,
  //           });
  //         if (!taskFound)
  //           return socket.emit("error", {
  //             message: "Task not found",
  //             success: false,
  //           });

  //         const deliveryDetail =
  //           taskFound.pickupDropDetails?.[0]?.drops?.[deliveryIndex];
  //         if (!deliveryDetail) {
  //           return socket.emit("error", {
  //             message: "Delivery detail not found",
  //             success: false,
  //           });
  //         }

  //         if (deliveryDetail.status === "Completed") {
  //           return socket.emit("error", {
  //             message: "Delivery already completed",
  //             success: false,
  //           });
  //         }

  //         const orderFound = await Order.findById(taskFound.orderId).populate(
  //           "customerId",
  //           "customerDetails.geofenceId"
  //         );
  //         if (!orderFound) {
  //           return socket.emit("error", {
  //             message: "Order not found",
  //             success: false,
  //           });
  //         }

  //         deliveryDetail.status = "Completed";
  //         deliveryDetail.completedTime = new Date();
  //         taskFound.markModified("pickupDropDetails");

  //         const stepperDetail = {
  //           by: agentFound.fullName,
  //           userId: agentId,
  //           date: new Date(),
  //           location,
  //         };
  //         orderFound.orderDetailStepper = orderFound.orderDetailStepper || {};
  //         orderFound.orderDetailStepper.reachedDeliveryLocation = stepperDetail;
  //         orderFound.deliveryTime = new Date();

  //         // If all deliveries done, mark task completed
  //         const allDone = taskFound.pickupDropDetails?.[0]?.drops?.every(
  //           (d) => d.status === "Completed"
  //         );
  //         if (allDone) taskFound.taskStatus = "Completed";

  //         await Promise.all([orderFound.save(), taskFound.save()]);

  //         // notify roles
  //         const eventName = "reachedDeliveryLocation";
  //         const { rolesToNotify } = await findRolesToNotify(eventName);
  //         for (const role of rolesToNotify) {
  //           const roleId = {
  //             admin: process.env.ADMIN_ID,
  //             merchant: orderFound?.merchantId,
  //             driver: orderFound?.agentId,
  //             customer: orderFound?.customerId?._id,
  //           }[role];
  //           if (roleId) {
  //             const notificationData = {
  //               fcm: {
  //                 customerId: orderFound.customerId,
  //                 orderId: taskFound.orderId,
  //               },
  //             };
  //             await sendNotification(
  //               roleId,
  //               eventName,
  //               notificationData,
  //               role.charAt(0).toUpperCase() + role.slice(1)
  //             );
  //           }
  //         }

  //         // socket emits
  //         const socketData = { orderDetailStepper: stepperDetail };
  //         sendSocketData(process.env.ADMIN_ID, eventName, socketData);
  //         sendSocketData(orderFound.customerId._id, eventName, socketData);
  //         if (agentSocketId) {
  //           io.to(agentSocketId).emit("reachedDeliveryLocation", {
  //             data: "Delivery completed",
  //             success: true,
  //           });
  //         }
  //       };

  //       // ---------- Choose flow ----------
  //       if (batchOrder) {
  //         await handleBatchDropComplete(
  //           batchOrder,
  //           agentId,
  //           location,
  //           deliveryIndex
  //         );
  //       } else {
  //         await handleTaskDropComplete(
  //           taskId,
  //           agentId,
  //           location,
  //           deliveryIndex
  //         );
  //       }
  //     } catch (err) {
  //       console.error(TAG, "Error:", err);
  //       return socket.emit("error", {
  //         message: `Error in reachedDeliveryLocation: ${err.message || err}`,
  //         success: false,
  //       });
  //     }
  //   }
  // );

  socket.on("markMessagesAsSeen", async ({ conversationId, userId }) => {
    try {
      await Message.updateMany(
        { conversationId: conversationId, seen: false },
        { $set: { seen: true } }
      );

      await Conversation.updateOne(
        { _id: conversationId },
        { $set: { "lastMessage.seen": true } }
      );

      io.to(userSocketMap[userId].socketId).emit("messagesSeen", {
        conversationId,
      });
    } catch (error) {
      return socket.emit("error", {
        message: `Error in marking message as seen: ${err}`,
      });
    }
  });

  // Cancel Custom order
  socket.on(
    "cancelCustomOrderByAgent",
    async ({ status, description, orderId, latitude, longitude }) => {
      try {
        const [orderFound, taskFound] = await Promise.all([
          Order.findById(orderId),
          Task.findOne({ orderId }),
        ]);

        if (!orderFound) {
          return socket.emit("error", { message: "Order not found" });
        }

        if (!taskFound) {
          return socket.emit("error", { message: "Task not found" });
        }

        const agentFound = await Agent.findById(orderFound.agentId);
        if (!agentFound) {
          return socket.emit("error", { message: "Agent not found" });
        }

        const notificationFound = await AgentNotificationLogs.findOne({
          orderId,
          agentId: agentFound._id,
          status: "Accepted",
        });

        const remainingTasks = await Task.find({
          agentId: agentFound._id,
          taskStatus: "Assigned",
        });

        const dataByAgent = {
          location: [latitude, longitude],
          status,
          description,
        };

        let oldDistance = orderFound.orderDetail?.distance || 0;

        const lastLocation =
          orderFound.detailAddedByAgent?.shopUpdates?.slice(-1)?.[0]
            ?.location || null;

        const { distanceInKM } = await getDistanceFromPickupToDelivery(
          dataByAgent.location,
          lastLocation
        );

        const newDistance = parseFloat(distanceInKM);

        orderFound.orderDetail.distance = oldDistance + newDistance;
        orderFound.detailAddedByAgent.distanceCoveredByAgent =
          orderFound.detailAddedByAgent.distanceCoveredByAgent + newDistance;

        // Calculate delivery charges
        const { deliveryCharges } = await getDeliveryAndSurgeCharge(
          orderFound.customerId,
          orderFound.orderDetail.deliveryMode,
          distanceInKM
        );

        let oldDeliveryCharge = orderFound.billDetail?.deliveryCharge || 0;
        let oldGrandTotal = orderFound.billDetail?.grandTotal || 0;

        orderFound.billDetail.deliveryCharge =
          oldDeliveryCharge + parseFloat(deliveryCharges);

        orderFound.billDetail.grandTotal =
          oldGrandTotal + parseFloat(deliveryCharges);

        // Initialize pickupLocation if needed
        if (
          !orderFound.orderDetail.pickupLocation &&
          (shopUpdates.length === 0 || shopUpdates === null)
        ) {
          orderFound.orderDetail.pickupLocation =
            orderFound.detailAddedByAgent.shopUpdates[
              orderFound.detailAddedByAgent.shopUpdates.length - 1
            ].location;
        }

        const currentTime = new Date();
        let delayedBy = null;

        if (currentTime > new Date(orderFound.deliveryTime)) {
          delayedBy =
            currentTime - new Date(orderFound.deliveryTime);
        }

        orderFound.deliveryTime = currentTime;
        orderFound.timeTaken =
          currentTime - new Date(orderFound.agentAcceptedAt);
        orderFound.delayedBy = delayedBy;

        orderFound.detailAddedByAgent.shopUpdates.push(dataByAgent);
        orderFound.status = "Cancelled";

        taskFound.taskStatus = "Cancelled";
        taskFound.pickupDetail.pickupStatus = "Cancelled";
        taskFound.deliveryDetail.deliveryStatus = "Cancelled";

        // Calculate earnings for agent
        const { calculatedSalary, calculatedSurge } =
          await calculateAgentEarnings(agentFound, orderFound);

        const isOrderCompleted = false;
        // Update agent details
        await updateAgentDetails(
          agentFound,
          orderFound,
          calculatedSalary,
          calculatedSurge,
          isOrderCompleted
        );

        const stepperDetail = {
          by: agentFound.fullName,
          userId: agentFound._id,
          date: new Date(),
          location: agentFound.location,
        };

        orderFound.orderDetailStepper.cancelled = stepperDetail;
        notificationFound.status = "Cancelled";

        remainingTasks.length >= 1
          ? (agentFound.status = "Busy")
          : (agentFound.status = "Free");

        await Promise.all([
          orderFound.save(),
          taskFound.save(),
          agentFound.save(),
          notificationFound.save(),
        ]);

        const eventName = "cancelCustomOrderByAgent";

        const { rolesToNotify, data } = await findRolesToNotify(eventName);

        let manager;
        // Send notifications to each role dynamically
        for (const role of rolesToNotify) {
          let roleId;

          if (role === "admin") {
            roleId = process.env.ADMIN_ID;
          } else if (role === "merchant") {
            roleId = orderFound?.merchantId;
          } else if (role === "driver") {
            roleId = orderFound?.agentId;
          } else if (role === "customer") {
            roleId = orderFound?.customerId;
          } else {
            const roleValue = await ManagerRoles.findOne({ roleName: role });
            if (roleValue) {
              manager = await Manager.findOne({ role: roleValue._id });
            } // Assuming `role` is the role field to match in Manager model
            if (manager) {
              roleId = manager._id; // Set roleId to the Manager's ID
            }
          }

          if (roleId) {
            const notificationData = {
              fcm: {
                ...data,
                orderId: orderFound._id,
                customerId: orderFound.customerId,
              },
            };

            await sendNotification(
              roleId,
              eventName,
              notificationData,
              role.charAt(0).toUpperCase() + role.slice(1)
            );
          }
        }

        const socketData = {
          stepperDetail,
        };

        sendSocketData(orderFound.customerId, eventName, socketData);
        sendSocketData(process.env.ADMIN_ID, eventName, socketData);
        if (manager?._id) {
          sendSocketData(manager._id, eventName, socketData);
        }
      } catch (err) {
        return socket.emit("error", {
          message: `Error in cancelling custom order by agent: ${err}`,
        });
      }
    }
  );

  socket.on("pendingNotificationsUpdate", async ({ agentId }) => {
    try {
      // Fetch the current pending notifications
      const currentNotifications = await getPendingNotificationsWithTimers(
        agentId
      );

      io.to(userSocketMap[agentId].socketId).emit(
        "pendingNotificationsUpdate",
        currentNotifications
      );
    } catch (err) {
      return socket.emit("error", {
        message: "Error in getting pending tasks of agent",
        success: false,
      });
    }
  });

  // User disconnected socket
  socket.on("disconnect", async () => {
    const { userId, role, location } = socket || {};

    try {
      // If it's an agent, update location
      const isAgent = userId && userId.charAt(0) === "A";
      if (isAgent) {
        const agent = await Agent.findById(userId);
        if (agent) {
          agent.location = getUserLocationFromSocket(userId);
          await agent.save();
        }
      }

      // Disconnect logic for all users (including agents)
      if (userId && userSocketMap[userId]) {
        delete userSocketMap[userId].socketId;
      }
    } catch (error) {
      console.error("Error handling disconnect:", error);
    }
  });
});

module.exports = {
  io,
  server,
  app,
  getRecipientSocketId,
  getRecipientFcmToken,
  sendNotification,
  userSocketMap,
  populateUserSocketMap,
  sendPushNotificationToUser,
  sendSocketData,
  findRolesToNotify,
  getRealTimeDataCount,
  getUserLocationFromSocket,
};
