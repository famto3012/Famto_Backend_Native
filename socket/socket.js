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
} = require("../libs/automatic");

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
  const notificationSettings = await NotificationSetting.findOne({
    event: eventName || "",
    status: true,
  });

  const mes = {
    notification: {
      title: notificationSettings?.title || message?.title,
      body: notificationSettings?.description || message?.body,
      image: message?.image,
    },
    data: {
      orderId: message?.orderId || "",
      merchantName: message?.merchantName || "",
      pickAddress: JSON.stringify(message?.pickAddress || {}),
      customerName: message?.customerName || "",
      customerAddress: JSON.stringify(message?.customerAddress || {}),
      orderType: message?.orderType || "",
      taskDate: message?.taskDate || "",
      taskTime: message?.taskTime || "",
      timer: JSON.stringify(message?.timer || ""),
    },
    webpush: {
      fcm_options: {
        link: "https://dashboard.famto.in/home",
      },
      notification: {
        icon: "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/admin_panel_assets%2FGroup%20427320384.svg?alt=media&token=0be47a53-43f3-4887-9822-3baad0edd31e",
      },
    },
    token: fcmToken,
  };

  try {
    // Try sending with the first project
    await admin1.messaging(app1).send(mes);
    // console.log(
    //   `Successfully sent message with project1 for token: ${fcmToken}`
    // );
    return true;
  } catch (error1) {
    // console.error(
    //   `Error sending message with project1 for token: ${fcmToken}`,
    //   error1
    // );

    try {
      // Try sending with the second project
      await admin2.messaging(app2).send(mes);
      // console.log(
      //   `Successfully sent message with project2 for token: ${fcmToken}`
      // );
      return true;
    } catch (error2) {
      // console.error(
      //   `Error sending message with project2 for token: ${fcmToken}`,
      //   error2
      // );
      return false;
    }
  }
};

const createNotificationLog = async (notificationSettings, message) => {
  const logData = {
    imageUrl: message?.image,
    title: notificationSettings?.title || message?.title,
    description: notificationSettings?.description || message?.body,
    ...(!notificationSettings?.customer && { orderId: message?.orderId }),
  };

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
        const notificationFound = await AgentNotificationLogs.findOne({
          agentId: message?.agentId,
          orderId: message?.orderId,
          status: "Pending",
        });

        if (notificationFound)
          await AgentNotificationLogs.findByIdAndDelete(notificationFound._id);

        await AgentNotificationLogs.create({
          ...logData,
          agentId: message?.agentId,
          orderId: message?.orderId,
          pickupDetail: {
            name: message?.pickAddress?.fullName,
            address: {
              fullName: message?.pickAddress?.fullName,
              phoneNumber: message?.pickAddress?.phoneNumber,
              flat: message?.pickAddress?.flat,
              area: message?.pickAddress?.area,
              landmark: message?.pickAddress?.landmark,
            },
          },
          deliveryDetail: {
            name: message?.customerAddress?.fullName,
            address: {
              fullName: message?.customerAddress?.fullName,
              phoneNumber: message?.customerAddress?.phoneNumber,
              flat: message?.customerAddress?.flat,
              area: message?.customerAddress?.area,
              landmark: message?.customerAddress?.landmark,
            },
          },
          orderType: message?.orderType,
          expiresIn: message?.timer || 60,
        });

        console.log("Log created");
      } catch (err) {
        console.log(`Error in creating agent notification log: ${err.message}`);
      }
    }

    if (notificationSettings?.admin) {
      await AdminNotificationLogs.create({
        ...logData,
        orderId: message?.orderId,
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

  let notificationSent = false;

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
    console.log("Creating notification log: ", notificationSettings);
    await createNotificationLog(notificationSettings, data.fcm);
  } else {
    console.log(`Failed to send notification for userId: ${userId}`);
  }
};

const sendSocketData = (userId, eventName, data) => {
  const socketId = userSocketMap[userId]?.socketId;

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
  return userSocketMap[recipientId].socketId;
};

const getRecipientFcmToken = (recipientId) => {
  return userSocketMap[recipientId].fcmToken;
};

const findRolesToNotify = async (eventName) => {
  try {
    // Fetch notification settings to determine roles
    const notificationSettings = await NotificationSetting.findOne({
      event: eventName,
    });

    if (!notificationSettings) {
      throw new Error("Notification settings not found for the given event.");
    }

    // Find roles to notify based on boolean fields
    const rolesToNotify = ["admin", "merchant", "driver", "customer"].filter(
      (role) => notificationSettings[role]
    );

    // Include roles from the `manager` array
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

    return { rolesToNotify, data };
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

      const { socketId } = userSocketMap[data.id];
      io.to(socketId).emit("realTimeDataCount", realTimeData);
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

      //console.log("Emitting real-time data:", realTimeData);
      const admins = await Admin.find();
      admins.map((admin) => {
        const { socketId } = userSocketMap[admin._id];
        io.to(socketId).emit("realTimeDataCount", realTimeData);
      });
      // Emit data globally for admin
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

const getPendingNotificationsWithTimers = async (agentId) => {
  try {
    const pendingNotifications = await AgentNotificationLogs.find({
      agentId,
      status: "Pending",
    })
      .populate("orderId", "orderDetail")
      .sort({ createdAt: -1 })
      .lean();

    const notificationsWithTimers = pendingNotifications.map((notification) => {
      return {
        notificationId: notification._id || null,
        orderId: notification.orderId._id || null,
        pickAddress: notification.pickupDetail?.address || null,
        customerAddress: notification.deliveryDetail?.address || null,
        orderType: notification.orderType || null,
        status: notification.status || null,
        taskDate: formatDate(notification.orderId.orderDetail.deliveryTime),
        taskTime: formatTime(notification.orderId.orderDetail.deliveryTime),
      };
    });

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
  socket.on("agentOrderAccepted", async ({ orderId, agentId }) => {
    try {
      const [agent, task, order, agentNotification, sameCancelledOrders] =
        await Promise.all([
          Agent.findById(agentId),
          Task.findOne({ orderId }).populate("orderId"),
          Order.findById(orderId),
          AgentNotificationLogs.findOne({
            orderId,
            agentId,
            status: "Pending",
          }),
          AgentNotificationLogs.countDocuments({
            orderId,
            agentId,
            status: "Rejected",
          }),
        ]);

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
        return socket.emit("error", {
          message: "Notification log of agent is not found",
          success: false,
        });
      }

      // Update agentNotification status
      agentNotification.status = "Accepted";
      await agentNotification.save();

      const stepperDetail = {
        by: agent.fullName,
        userId: agent._id,
        date: new Date(),
        location: getUserLocationFromSocket(agentId),
      };

      // Update order and task status
      await Promise.all([
        Order.findByIdAndUpdate(
          orderId,
          {
            agentId,
            "orderDetail.agentAcceptedAt": new Date(),
            "orderDetailStepper.assigned": stepperDetail,
            "detailAddedByAgent.distanceCoveredByAgent": null,
          },
          { new: true }
        ),
        Task.findByIdAndUpdate(task._id, {
          agentId,
          taskStatus: "Assigned",
          "pickupDetail.pickupStatus": "Accepted",
          "deliveryDetail.deliveryStatus": "Accepted",
        }),
      ]);

      // Update agent status
      agent.status = "Busy";
      agent.appDetail.pendingOrders = Math.max(
        0,
        agent.appDetail.pendingOrders - 1
      );
      agent.appDetail.cancelledOrders = Math.max(
        0,
        agent.appDetail.cancelledOrders - sameCancelledOrders
      );
      await agent.save();

      const eventName = "agentOrderAccepted";

      // Send dynamic notifications
      const { rolesToNotify, data } = await findRolesToNotify(eventName);
      let manager;
      const notifications = rolesToNotify.map(async (role) => {
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
          const roleValue = await ManagerRoles.findOne({ roleName: role });
          if (roleValue) {
            manager = await Manager.findOne({ role: roleValue._id });
          } // Assuming `role` is the role field to match in Manager model
          if (manager) {
            roleId = manager._id; // Set roleId to the Manager's ID
          }
        }

        if (roleId) {
          const notificationData = { fcm: { customerId: order.customerId } };
          return sendNotification(
            roleId,
            eventName,
            notificationData,
            role.charAt(0).toUpperCase() + role.slice(1)
          );
        }
      });

      await Promise.all(notifications);

      const socketData = {
        ...data,
        agentName: agent.fullName,
        agentImgURL: agent.agentImageURL,
        customerId: task?.orderId?.customerId,
        orderDetailStepper: stepperDetail,
        success: true,
      };

      // Send socket updates
      sendSocketData(order.customerId, eventName, socketData);
      sendSocketData(process.env.ADMIN_ID, eventName, socketData);
      if (task?.orderId?.merchantId) {
        sendSocketData(task.orderId.merchantId, eventName, socketData);
      }
      if (manager?._id) {
        sendSocketData(manager._id, eventName, socketData);
      }

      // console.log("Order accepted successfully");
    } catch (err) {
      console.error("Error in accepting order:", err.message);

      socket.emit("error", {
        message: err.message,
        success: false,
      });
    }
  });

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

      sendSocketData(agentId, parameters.eventName, agentFound.appDetail);
      if (manager?._id) {
        sendSocketData(manager._id, parameters.eventName, agentFound.appDetail);
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
  socket.on("agentPickupStarted", async ({ taskId, agentId, location }) => {
    try {
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

      if (taskFound.pickupDetail.pickupStatus === "Started") {
        const agentSocketId = userSocketMap[agentId]?.socketId;
        if (agentSocketId) {
          io.to(agentSocketId).emit(eventName, {
            data: "Pickup successfully started",
            success: true,
          });
        }

        return;
      }

      if (taskFound.pickupDetail.pickupStatus === "Completed") {
        return socket.emit("error", {
          message: "Pickup is already completed",
          success: false,
        });
      }

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

      // Initialize orderDetailStepper if it does not exist
      if (!orderFound.orderDetailStepper) orderFound.orderDetailStepper = {};

      orderFound.orderDetailStepper.pickupStarted = stepperDetail;
      taskFound.pickupDetail.pickupStatus = "Started";
      taskFound.pickupDetail.startTime = new Date();

      const pickupLocation = orderFound?.orderDetail?.pickupLocation;

      if (
        pickupLocation?.length === 2 &&
        !orderFound?.detailAddedByAgent?.distanceCoveredByAgent &&
        orderFound?.detailAddedByAgent?.distanceCoveredByAgent !== 0
      ) {
        const { distanceInKM } = await getDistanceFromPickupToDelivery(
          agentLocation,
          pickupLocation
        );

        if (!orderFound.detailAddedByAgent) orderFound.detailAddedByAgent = {};

        orderFound.detailAddedByAgent.distanceCoveredByAgent = distanceInKM;
        orderFound.detailAddedByAgent.startToPickDistance = distanceInKM;
      }

      if (orderFound.orderDetail.deliveryMode === "Custom Order") {
        const data = {
          location: agentLocation,
          status: "Initial location",
          description: null,
        };

        // Initialize detailAddedByAgent and shopUpdates if not present
        if (!orderFound.detailAddedByAgent) {
          orderFound.detailAddedByAgent = { shopUpdates: [] };
        }

        orderFound.detailAddedByAgent.shopUpdates.push(data);
      }

      await Promise.all([orderFound.save(), taskFound.save()]);

      const data = {
        orderDetailStepper: stepperDetail,
        success: true,
      };

      sendSocketData(process.env.ADMIN_ID, eventName, data);
      sendSocketData(orderFound.customerId, eventName, data);
      if (orderFound?.merchantId) {
        sendSocketData(orderFound.merchantId, eventName, data);
      }
    } catch (err) {
      console.log("Agent failed to start pick up: " + err);

      return socket.emit("error", {
        message: `Error in starting pickup: ${err}`,
        success: false,
      });
    }
  });

  // Reached pickup location
  socket.on("reachedPickupLocation", async ({ taskId, agentId, location }) => {
    try {
      // Fetch agent and task data in parallel
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

      const orderFound = await Order.findById(taskFound.orderId);
      if (!orderFound) {
        return socket.emit("error", {
          message: "Order not found",
          success: false,
        });
      }

      const eventName = "reachedPickupLocation";
      const { rolesToNotify, data } = await findRolesToNotify(eventName);

      const maxRadius = 0.5; // 500 meters in kilometers
      const pickupLocation = orderFound?.orderDetail?.pickupLocation;
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

      if (
        orderFound.orderDetail.deliveryMode === "Custom Order" &&
        pickupLocation.length !== 2
      ) {
        const stepperDetail = {
          by: agentFound.fullName,
          userId: agentId,
          date: new Date(),
          location: agentLocation,
        };

        orderFound.orderDetailStepper.reachedPickupLocation = stepperDetail;
        taskFound.pickupDetail.pickupStatus = "Completed";
        taskFound.pickupDetail.completedTime = new Date();

        await Promise.all([taskFound.save(), orderFound.save()]);

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
          ...data,
          orderId: taskFound.orderId,
          agentId: agentId,
          agentName: agentFound.fullName,
          orderDetailStepper: stepperDetail,
          success: true,
        };

        const event = "agentReachedPickupLocation";

        const socketDataForAgent = {
          message: "Agent reached pickup location",
          success: true,
        };

        sendSocketData(orderFound.customerId, eventName, socketData);
        sendSocketData(process.env.ADMIN_ID, eventName, socketData);
        if (orderFound?.merchantId) {
          sendSocketData(orderFound.merchantId, eventName, socketData);
        }
        if (manager?._id) {
          sendSocketData(manager._id, eventName, socketData);
        }
        sendSocketData(agentId, event, socketDataForAgent);

        return;
      }

      if (
        !agentLocation ||
        !Array.isArray(agentLocation) ||
        agentLocation.length !== 2
      ) {
        return socket.emit("error", {
          message: "Invalid agent location data",
          success: false,
        });
      }

      const distance = turf.distance(
        turf.point(pickupLocation),
        turf.point(agentLocation),
        { units: "kilometers" }
      );

      if (distance < maxRadius) {
        const stepperDetail = {
          by: agentFound.fullName,
          userId: agentId,
          date: new Date(),
          location: agentLocation,
        };

        orderFound.orderDetailStepper.reachedPickupLocation = stepperDetail;
        taskFound.pickupDetail.pickupStatus = "Completed";
        taskFound.pickupDetail.completedTime = new Date();

        await Promise.all([taskFound.save(), orderFound.save()]);

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
          }

          if (roleId) {
            const notificationData = {
              fcm: {
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
          ...data,
          orderId: taskFound.orderId,
          agentId: agentId,
          agentName: agentFound.fullName,
          orderDetailStepper: stepperDetail,
          success: true,
        };

        const event = "agentReachedPickupLocation";

        const socketDataForAgent = {
          message: "Agent reached pickup location",
          success: true,
        };

        sendSocketData(orderFound.customerId, eventName, socketData);
        sendSocketData(process.env.ADMIN_ID, eventName, socketData);
        if (orderFound?.merchantId) {
          sendSocketData(orderFound.merchantId, eventName, socketData);
        }
        sendSocketData(agentId, event, socketDataForAgent);
      } else {
        const event = "agentNotReachedPickupLocation";

        const { data } = await findRolesToNotify(event);

        const dataToSend = {
          ...data,
          orderId: taskFound.orderId,
          agentId,
        };

        await sendNotification(agentId, event, dataToSend, "Agent");

        return socket.emit("error", {
          message: "Agent is far from pickup point",
          success: false,
        });
      }
    } catch (err) {
      return socket.emit("error", {
        message: `Error in reaching pickup location: ${err.message || err}`,
        success: false,
      });
    }
  });

  // Started Delivery
  socket.on("agentDeliveryStarted", async ({ taskId, agentId, location }) => {
    try {
      const [agentFound, taskFound] = await Promise.all([
        Agent.findById(agentId),
        Task.findById(taskId),
      ]);

      const eventName = "agentDeliveryStarted";

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

      if (
        taskFound.pickupDetail.pickupStatus === "Completed" &&
        taskFound.deliveryDetail.deliveryStatus === "Started"
      ) {
        const agentSocketId = userSocketMap[agentId]?.socketId;
        if (agentSocketId) {
          io.to(agentSocketId).emit(eventName, {
            data: "Delivery successfully started",
            success: true,
          });
        }

        return;
      }

      const orderFound = await Order.findById(taskFound.orderId).populate(
        "customerId",
        "customerDetails.geofenceId"
      );

      if (!orderFound) {
        return socket.emit("error", {
          message: "Order not found",
          success: false,
        });
      }

      let distanceCoveredByAgent = 0;

      if (orderFound.orderDetail.deliveryMode === "Custom Order") {
        const { distanceInKM } = await getDistanceFromPickupToDelivery(
          location,
          orderFound.orderDetail.deliveryLocation
        );

        distanceCoveredByAgent =
          (orderFound?.detailAddedByAgent?.distanceCoveredByAgent || 0) +
          distanceInKM;
      } else {
        distanceCoveredByAgent =
          (orderFound?.detailAddedByAgent?.distanceCoveredByAgent || 0) +
          (orderFound?.orderDetail?.distance || 0);
      }

      taskFound.pickupDetail.pickupStatus = "Completed";
      taskFound.deliveryDetail.deliveryStatus = "Started";
      taskFound.deliveryDetail.startTime = new Date();

      // Update order stepper details
      const stepperDetail = {
        by: agentFound.fullName,
        userId: agentId,
        date: new Date(),
        location,
      };

      orderFound.detailAddedByAgent.distanceCoveredByAgent = Number(
        distanceCoveredByAgent.toFixed(2)
      );
      orderFound.orderDetailStepper.deliveryStarted = stepperDetail;

      if (orderFound.orderDetail.deliveryMode === "Custom Order") {
        await updateBillOfCustomOrderInDelivery(orderFound, taskFound, socket);
      }

      await Promise.all([orderFound.save(), taskFound.save()]);

      // Notify roles
      const { rolesToNotify } = await findRolesToNotify(eventName);

      for (const role of rolesToNotify) {
        const roleId = {
          admin: process.env.ADMIN_ID,
          merchant: orderFound?.merchantId,
          driver: orderFound?.agentId,
          customer: orderFound?.customerId._id,
        }[role];

        if (roleId) {
          const notificationData = {
            fcm: {
              customerId: orderFound.customerId,
              orderId: taskFound.orderId,
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

      // Emit socket events to relevant users
      const socketData = { orderDetailStepper: stepperDetail };
      sendSocketData(process.env.ADMIN_ID, eventName, socketData);
      sendSocketData(orderFound?.customerId._id, eventName, socketData);

      if (orderFound?.merchantId)
        sendSocketData(orderFound.merchantId, eventName, socketData);

      const agentSocketId = userSocketMap[agentId]?.socketId;
      if (agentSocketId) {
        io.to(agentSocketId).emit(eventName, {
          data: "Delivery successfully started",
          success: true,
        });
      }
    } catch (err) {
      console.log("Agent failed to start delivery", err);

      return socket.emit("error", {
        message: `Error in starting delivery trip: ${err}`,
        success: false,
      });
    }
  });

  // Agent reached drop location socket
  socket.on(
    "reachedDeliveryLocation",
    async ({ taskId, agentId, location }) => {
      try {
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

        const orderFound = await Order.findById(taskFound.orderId).populate(
          "customerId",
          "customerDetails.geofenceId"
        );

        if (!orderFound) {
          return socket.emit("error", {
            message: "Order not found",
            success: false,
          });
        }

        const eventName = "reachedDeliveryLocation";

        const { rolesToNotify } = await findRolesToNotify(eventName);

        const maxRadius = 0.5;

        const deliveryLocation = taskFound.deliveryDetail.deliveryLocation;
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

        const distance = turf.distance(
          turf.point(deliveryLocation),
          turf.point(agentLocation),
          { units: "kilometers" }
        );

        if (distance < maxRadius) {
          const pickupStartAt = taskFound?.pickupDetail?.startTime;

          const stepperDetail = {
            by: agentFound.fullName,
            userId: agentId,
            date: new Date(),
            location: agentLocation,
          };

          const timeTaken = new Date() - new Date(pickupStartAt);

          orderFound.orderDetailStepper.reachedDeliveryLocation = stepperDetail;
          orderFound.orderDetail.deliveryTime = new Date();
          orderFound.orderDetail.timeTaken = timeTaken;

          taskFound.deliveryDetail.deliveryStatus = "Completed";
          taskFound.deliveryDetail.completedTime = new Date();
          taskFound.taskStatus = "Completed";

          await Promise.all([orderFound.save(), taskFound.save()]);

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
              roleId = orderFound?.customerId._id;
            }

            if (roleId) {
              const notificationData = {
                fcm: {
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
            orderDetailStepper: stepperDetail,
            success: true,
          };

          const event = "agentReachedDeliveryLocation";

          const socketDataForAgent = {
            message: "Agent reached delivery location",
            success: true,
          };

          sendSocketData(process.env.ADMIN_ID, eventName, socketData);
          sendSocketData(orderFound.customerId._id, eventName, socketData);
          sendSocketData(agentId, event, socketDataForAgent);
        } else {
          const event = "agentNotReachedDeliveryLocation";

          const { data } = await findRolesToNotify(event);

          const dataToSend = {
            ...data,
            orderId: taskFound.orderId,
            agentId,
          };

          await sendNotification(agentId, event, dataToSend, "Agent");

          return socket.emit("error", {
            message: "Agent is far from delivery point",
            success: false,
          });
        }
      } catch (err) {
        console.log("Agent failed to reach delivery", err);
        return socket.emit("error", {
          message: `Error in reaching delivery location`,
          success: false,
        });
      }
    }
  );

  // Mark message as seen in customer agent message chat
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

        if (currentTime > new Date(orderFound.orderDetail.deliveryTime)) {
          delayedBy =
            currentTime - new Date(orderFound.orderDetail.deliveryTime);
        }

        orderFound.orderDetail.deliveryTime = currentTime;
        orderFound.orderDetail.timeTaken =
          currentTime - new Date(orderFound.orderDetail.agentAcceptedAt);
        orderFound.orderDetail.delayedBy = delayedBy;

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
