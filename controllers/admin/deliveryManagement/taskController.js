const turf = require("@turf/turf");
const moment = require("moment-timezone");

const Agent = require("../../../models/Agent");
const Order = require("../../../models/Order");
const Task = require("../../../models/Task");
const AutoAllocation = require("../../../models/AutoAllocation");
const Manager = require("../../../models/Manager");
const ManagerRoles = require("../../../models/ManagerRoles");

const {
  sendNotification,
  findRolesToNotify,
  sendSocketData,
  getUserLocationFromSocket,
} = require("../../../socket/socket");

const appError = require("../../../utils/appError");
const {
  getDistanceFromPickupToDelivery,
} = require("../../../utils/customerAppHelpers");
const { formatDate, formatTime } = require("../../../utils/formatters");

const getTaskByIdController = async (req, res, next) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findById(taskId)
      .populate("agentId")
      .populate("orderId");

    res.status(201).json({
      message: "Task fetched successfully",
      data: task,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const assignAgentToTaskController = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { agentId } = req.body;

    const task = await Task.findById(taskId);
    const order = await Order.findById(task.orderId);
    const agent = await Agent.findById(agentId);
    const autoAllocation = await AutoAllocation.findOne();
    if (!agent.appDetail) {
      agent.appDetail = {
        totalEarning: 0,
        orders: 0,
        pendingOrders: 0,
        totalDistance: 0,
        cancelledOrders: 0,
        loginDuration: 0,
      };
    }

    agent.appDetail.pendingOrders += 1;

    await agent.save();

    let deliveryAddress = order.orderDetail.deliveryAddress;

    const eventName = "newOrder";

    const { rolesToNotify, data } = await findRolesToNotify(eventName);

    // Send notifications to each role dynamically
    for (const role of rolesToNotify) {
      let roleId;

      if (role === "admin") {
        roleId = process.env.ADMIN_ID;
      } else if (role === "merchant") {
        roleId = order?.merchantId;
      } else if (role === "driver") {
        roleId = agentId;
      } else if (role === "customer") {
        roleId = order?.customerId;
      } else {
        const roleValue = await ManagerRoles.findOne({ roleName: role });
        let manager;
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
            orderId: order._id,
            merchantName: order?.orderDetail?.pickupAddress?.fullName || null,
            pickAddress: order?.orderDetail?.pickupAddress || null,
            customerName: deliveryAddress?.fullName || null,
            customerAddress: deliveryAddress,
            orderType: order?.orderDetail?.deliveryMode || null,
            taskDate: formatDate(order?.orderDetail?.deliveryTime),
            taskTime: formatTime(order?.orderDetail?.deliveryTime),
            timer: autoAllocation?.expireTime || null,
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
      orderId: order._id,
      merchantName: order?.orderDetail?.pickupAddress?.fullName || null,
      pickAddress: order?.orderDetail?.pickupAddress || null,
      customerName: deliveryAddress?.fullName || null,
      customerAddress: deliveryAddress,
      agentId,
      orderType: order?.orderDetail?.deliveryMode || null,
      taskDate: formatDate(order?.orderDetail?.deliveryTime),
      taskTime: formatTime(order?.orderDetail?.deliveryTime),
      timer: autoAllocation?.expireTime || null,
    };

    sendSocketData(agentId, eventName, socketData);

    res.status(200).json({
      message: "Notification send to the agent",
      data: socketData,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getAgentsAccordingToGeofenceController = async (req, res, next) => {
  try {
    const { taskId, geofenceStatus, name } = req.query;
    const isGeofenceEnabled = geofenceStatus === "true";

    const task = await Task.findById(taskId).populate({
      path: "orderId",
      populate: {
        path: "merchantId",
        populate: {
          path: "merchantDetail.geofenceId",
        },
      },
    });

    const deliveryMode = task?.orderId?.orderDetail?.deliveryMode;
    // const deliveryLocation = task?.orderId?.orderDetail?.pickupLocation;
    const merchant = task?.orderId?.merchantId;
    // const merchantLocation = merchant?.merchantDetail?.location;
    const geofence = merchant?.merchantDetail?.geofenceId;

    // Match Criteria
    const matchCriteria = {
      isApproved: "Approved",
      isBlocked: false,
    };

    if (name?.trim()) {
      matchCriteria.fullName = { $regex: name.trim(), $options: "i" };
    }

    const agents = await Agent.find(matchCriteria).select(
      "fullName workStructure.tag status location"
    );

    let filteredAgents = agents;

    // Filter by geofence if required
    if (
      deliveryMode !== "Custom Order" &&
      isGeofenceEnabled &&
      geofence?.coordinates?.length
    ) {
      const coordinates = [...geofence.coordinates];

      // Ensure polygon is closed
      if (
        coordinates.length &&
        (coordinates[0][0] !== coordinates[coordinates.length - 1][0] ||
          coordinates[0][1] !== coordinates[coordinates.length - 1][1])
      ) {
        coordinates.push(coordinates[0]);
      }

      const geofencePolygon = turf.polygon([coordinates]);

      filteredAgents = agents.filter((agent) =>
        turf.booleanPointInPolygon(turf.point(agent.location), geofencePolygon)
      );
    }

    const responseData = await Promise.all(
      filteredAgents.map(async (agent) => {
        let agentLocation =
          getUserLocationFromSocket(agent._id) || agent.location;

        if (!Array.isArray(agentLocation) || agentLocation.length !== 2) {
          return null;
        }

        let distance = 0;

        // TODO: When uncommenting the condition make sure to exclude the distance calculation of Inactive agents (make it default to 0)
        // if (deliveryMode === "Pick and Drop") {
        //   const { distanceInKM } = await getDistanceFromPickupToDelivery(
        //     agentLocation,
        //     deliveryLocation
        //   );
        //   distance = distanceInKM;
        // } else if (deliveryMode !== "Custom Order") {
        //   const { distanceInKM } = await getDistanceFromPickupToDelivery(
        //     agentLocation,
        //     merchantLocation
        //   );
        //   distance = distanceInKM;
        // }

        return {
          _id: agent._id,
          name: agent.fullName,
          workStructure: agent?.workStructure?.tag,
          status: agent.status,
          distance,
        };
      })
    );

    const validAgents = responseData.filter(Boolean);

    res.status(200).json({
      success: true,
      data: validAgents,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getTasksController = async (req, res, next) => {
  try {
    let { startDate, endDate, orderId, filter } = req.query;

    // Build the query object dynamically
    const query = {};

    // Add date range filter if provided
    if (startDate && endDate) {
      const start = moment.tz(startDate, "Asia/Kolkata");
      const end = moment.tz(endDate, "Asia/Kolkata");

      startDate = start.startOf("day").toDate();
      endDate = end.endOf("day").toDate();

      query.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    // Add orderId filter if provided
    if (orderId) {
      query.orderId = { $regex: orderId, $options: "i" };
    }

    // Add taskStatus filter if provided
    if (filter) {
      query.taskStatus = filter;
    }

    // Execute the query with optional population
    const tasks = await Task.find(query)
      .populate("agentId") // Populate specific fields for efficiency
      .populate("orderId");

    // Send the response
    res.status(201).json({
      success: true,
      message: "Tasks fetched successfully",
      data: tasks,
    });
  } catch (err) {
    next(appError(err.message || "Failed to fetch tasks"));
  }
};

const getAgentsController = async (req, res, next) => {
  try {
    const { fullName, filter } = req.query;

    // Define the base query with common conditions
    const query = { isApproved: "Approved" };

    // Add conditions based on query parameters
    if (fullName) {
      query.fullName = new RegExp(fullName, "i"); // Case-insensitive search for fullName
    }

    if (filter) {
      if (filter === "Free") {
        query.status = "Free";
      } else if (filter === "Busy") {
        query.status = "Busy";
      } else {
        query.status = "Inactive";
      }
    }

    // Fetch agents based on the constructed query
    const agents = await Agent.find(query);

    const formattedResponse = agents?.map((agent) => ({
      ...agent.toObject(),
      location: getUserLocationFromSocket(agent._id),
    }));

    // Respond with the fetched agents
    res.status(200).json({
      message: "Agents fetched successfully",
      data: formattedResponse,
    });
  } catch (error) {
    next(appError(error.message));
  }
};

module.exports = {
  getTaskByIdController,
  assignAgentToTaskController,
  getAgentsAccordingToGeofenceController,
  getTasksController,
  getAgentsController,
};
