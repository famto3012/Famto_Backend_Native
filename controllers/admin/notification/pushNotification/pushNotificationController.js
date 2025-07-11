const { validationResult } = require("express-validator");

const Customer = require("../../../../models/Customer");
const Merchant = require("../../../../models/Merchant");
const Agent = require("../../../../models/Agent");
const PushNotification = require("../../../../models/PushNotification");
const AgentAnnouncementLogs = require("../../../../models/AgentAnnouncementLog");
const CustomerNotificationLogs = require("../../../../models/CustomerNotificationLog");
const MerchantNotificationLogs = require("../../../../models/MerchantNotificationLog");
const AdminNotificationLogs = require("../../../../models/AdminNotificationLog");

const appError = require("../../../../utils/appError");
const {
  uploadToFirebase,
  deleteFromFirebase,
} = require("../../../../utils/imageOperation");

const {
  sendNotification,
  sendSocketData,
} = require("../../../../socket/socket");
const { errorLogger } = require("../../../../middlewares/errorLogger");

const addPushNotificationController = async (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    let formattedErrors = {};
    errors.array().forEach((error) => {
      formattedErrors[error.param] = error.msg;
    });
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    const { title, description, geofenceId, merchant, driver, customer } =
      req.body;

    if (merchant === "false" && driver === "false" && customer === "false") {
      return res.status(400).json({
        message: "Please choose a value for merchant, driver, and customer.",
      });
    }
    let imageUrl = "";
    if (req.file) {
      imageUrl = await uploadToFirebase(req.file, "PushNotificationImages");
    }

    const newPushNotification = new PushNotification({
      title,
      description,
      geofenceId,
      imageUrl,
      merchant,
      driver,
      customer,
    });

    const savedPushNotification = await newPushNotification.save();

    res.status(201).json({
      success: "Push Notification created successfully",
      data: savedPushNotification,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const deletePushNotificationController = async (req, res, next) => {
  try {
    const { id } = req.params;

    const deletedPushNotification = await PushNotification.findOne({ _id: id });

    if (!deletedPushNotification) {
      return res.status(404).json({ error: "Push Notification not found" });
    } else {
      await deleteFromFirebase(deletedPushNotification.imageUrl);
      await PushNotification.findByIdAndDelete(id);
    }

    res.status(200).json({
      success: "Push Notification deleted successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

//TODO: Remove after panel V2
const searchPushNotificationController = async (req, res, next) => {
  try {
    const { query } = req.query;

    const searchTerm = query.trim();

    const searchResults = await PushNotification.find({
      title: { $regex: searchTerm, $options: "i" },
    });

    res.status(200).json({
      message: "Searched push notification results",
      data: searchResults,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

//TODO: Remove after panel V2
const getAllPushNotificationController = async (req, res) => {
  try {
    const pushNotification = await PushNotification.find();
    res.status(200).json({
      success: "Push Notification found",
      data: pushNotification,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

//TODO: Remove after panel V2
const fetchPushNotificationController = async (req, res, next) => {
  try {
    const { type } = req.query;

    if (!["merchant", "driver", "customer"].includes(type)) {
      return res.status(400).json({ error: "Invalid type parameter" });
    }

    const query = {};
    query[type] = true;

    const pushNotifications = await PushNotification.find(query);

    res.status(200).json({
      success: "Push Notifications fetched successfully",
      data: pushNotifications,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// const sendPushNotificationController = async (req, res, next) => {
//   try {
//     const { notificationId } = req.params;

//     // Fetch the push notification by ID
//     const pushNotification = await PushNotification.findById(notificationId);
//     if (!pushNotification) {
//       return res.status(404).json({ error: "Push Notification not found" });
//     }

//     let userIds = [];

//     // Fetch and filter customers, merchants, and drivers based on their location
//     if (pushNotification.customer) {
//       const customers = await Customer.find({
//         "customerDetails.geofenceId": pushNotification.geofenceId,
//       });
//       for (const customer of customers) {
//         await CustomerNotificationLogs.create({
//           customerId: customer._id,
//           title: pushNotification.title,
//           description: pushNotification.description,
//           imageUrl: pushNotification.imageUrl,
//         });
//       }

//       userIds = userIds.concat(customers.map((customer) => customer._id));
//     }
//     if (pushNotification.merchant) {
//       const merchants = await Merchant.find({
//         "merchantDetail.geofenceId": pushNotification.geofenceId,
//       });
//       for (const merchant of merchants) {
//         await MerchantNotificationLogs.create({
//           merchantId: merchant._id,
//           title: pushNotification.title,
//           description: pushNotification.description,
//           imageUrl: pushNotification.imageUrl,
//         });
//       }
//       userIds = userIds.concat(merchants.map((merchant) => merchant._id));
//     }
//     if (pushNotification.driver) {
//       const drivers = await Agent.find({
//         geofenceId: pushNotification.geofenceId,
//       });
//       for (const driver of drivers) {
//         await AgentAnnouncementLogs.create({
//           agentId: driver._id,
//           title: pushNotification.title,
//           description: pushNotification.description,
//           imageUrl: pushNotification.imageUrl,
//         });
//       }
//       userIds = userIds.concat(drivers.map((driver) => driver._id));
//     }

//     const data = {
//       socket: {
//         title: pushNotification.title,
//         description: pushNotification.description,
//         imageUrl: pushNotification.imageUrl,
//         createdAt: pushNotification.createdAt,
//       },
//       fcm: {
//         title: pushNotification.title,
//         body: pushNotification.description,
//         image: pushNotification.imageUrl,
//       },
//     };

//     for (const userId of userIds) {
//       await sendNotification(userId, "pushNotification", data);
//       const event = "pushNotification";
//       sendSocketData(userId, event, data.socket);
//       sendSocketData(process.env.ADMIN_ID, event, data.socket);
//     }

//     await AdminNotificationLogs.create({
//       title: pushNotification.title,
//       description: pushNotification.description,
//       imageUrl: pushNotification.imageUrl,
//     });

//     // Respond with the userIds
//     res.status(200).json({
//       message: "Push notification send successfully",
//       data: userIds,
//     });
//   } catch (err) {
//     next(appError(err.message));
//   }
// };

const sendPushNotificationController = async (req, res, next) => {
  try {
    const { notificationId } = req.params;

    const pushNotification = await PushNotification.findById(notificationId);
    if (!pushNotification) {
      return res.status(404).json({ error: "Push Notification not found" });
    }

    // Send response immediately
    res.status(200).json({
      success: true,
      message: "Push notification processing started",
    });

    // Now process notifications in background
    (async () => {
      let userIds = [];

      if (pushNotification.customer) {
        const customers = await Customer.find({
          "customerDetails.geofenceId": pushNotification.geofenceId,
        });
        for (const customer of customers) {
          await CustomerNotificationLogs.create({
            customerId: customer._id,
            title: pushNotification.title,
            description: pushNotification.description,
            imageUrl: pushNotification.imageUrl,
          });
        }
        userIds = userIds.concat(customers.map((customer) => customer._id));
      }

      if (pushNotification.merchant) {
        const merchants = await Merchant.find({
          "merchantDetail.geofenceId": pushNotification.geofenceId,
        });
        for (const merchant of merchants) {
          await MerchantNotificationLogs.create({
            merchantId: merchant._id,
            title: pushNotification.title,
            description: pushNotification.description,
            imageUrl: pushNotification.imageUrl,
          });
        }
        userIds = userIds.concat(merchants.map((merchant) => merchant._id));
      }

      if (pushNotification.driver) {
        const drivers = await Agent.find({
          geofenceId: pushNotification.geofenceId,
        });
        for (const driver of drivers) {
          await AgentAnnouncementLogs.create({
            agentId: driver._id,
            title: pushNotification.title,
            description: pushNotification.description,
            imageUrl: pushNotification.imageUrl,
          });
        }
        userIds = userIds.concat(drivers.map((driver) => driver._id));
      }

      const data = {
        socket: {
          title: pushNotification.title,
          description: pushNotification.description,
          imageUrl: pushNotification.imageUrl,
          createdAt: pushNotification.createdAt,
        },
        fcm: {
          title: pushNotification.title,
          body: pushNotification.description,
          image: pushNotification.imageUrl,
        },
      };

      for (const userId of userIds) {
        await sendNotification(userId, "pushNotification", data);
        const event = "pushNotification";
        sendSocketData(userId, event, data.socket);
        sendSocketData(process.env.ADMIN_ID, event, data.socket);
      }

      await AdminNotificationLogs.create({
        title: pushNotification.title,
        description: pushNotification.description,
        imageUrl: pushNotification.imageUrl,
      });
    })().catch((err) => {
      errorLogger(
        `Error in sending push notifications: ${JSON.stringify(err)}`
      );
      console.error("Error in background notification processing:", err);
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const filterPushNotificationController = async (req, res, next) => {
  try {
    const { query: searchQuery, type } = req.query;

    // Initialize a base query object
    let query = {};

    // If `type` is provided, validate it and add to the query
    if (type) {
      if (!["merchant", "driver", "customer"].includes(type)) {
        return res.status(400).json({ error: "Invalid type parameter" });
      }
      query[type] = true;
    }

    // If `searchQuery` is provided, add search condition to the query
    if (searchQuery) {
      const searchTerm = searchQuery.trim();
      query.title = { $regex: searchTerm, $options: "i" };
    }

    // Fetch push notifications based on the constructed query
    const pushNotifications = await PushNotification.find(query);

    res.status(200).json({
      success: "Push Notifications fetched successfully",
      data: pushNotifications,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  addPushNotificationController,
  deletePushNotificationController,
  searchPushNotificationController,
  getAllPushNotificationController,
  fetchPushNotificationController,
  sendPushNotificationController,
  filterPushNotificationController,
};
