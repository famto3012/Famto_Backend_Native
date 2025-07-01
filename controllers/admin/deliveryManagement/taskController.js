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
const BatchOrder = require("../../../models/BatchOrder");

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

    const [task, order, agent, autoAllocation] = await Promise.all([
      Task.findById(taskId),
      Order.findById(task.orderId),
      Agent.findById(agentId),
      AutoAllocation.findOne(),
    ]);

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

    res.status(200).json({
      message: "Notification send to the agent",
      data: socketData,
    });

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
        }
        if (manager) {
          roleId = manager._id;
        }
      }

      if (roleId) {
        const notificationData = {
          fcm: {
            ...data,
            agentId,
            orderId: [order._id],
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
      taskId: null,
      merchantName: order?.orderDetail?.pickupAddress?.fullName || null,
      pickAddress: order?.orderDetail?.pickupAddress || null,
      customerName: deliveryAddress?.fullName || null,
      customerAddress: deliveryAddress,
      agentId,
      orderType: order?.orderDetail?.deliveryMode || null,
      taskDate: formatDate(order?.orderDetail?.deliveryTime),
      taskTime: formatTime(order?.orderDetail?.deliveryTime),
      timer: autoAllocation?.expireTime || null,
      batchOrder: false,
    };

    sendSocketData(agentId, eventName, socketData);
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

const batchOrder = async (req, res, next) => {
  try {
    const { taskIds, agentId } = req.body;

    const [agent, tasks, autoAllocation] = await Promise.all([
      Agent.findById(agentId),
      Task.find({ _id: { $in: taskIds } }).populate(
        "orderId",
        "merchantId customerId createdAt deliveryTime"
      ),
      AutoAllocation.findOne(),
    ]);

    if (!agent) return next(appError("Agent not found", 404));

    if (!tasks.length) return next(appError("No tasks found", 404));

    const firstMode = tasks[0].deliveryMode;
    const allSameMode = tasks.every((task) => task.deliveryMode === firstMode);

    if (!allSameMode) {
      return next(appError("All tasks must have the same delivery mode", 400));
    }

    const merchantId = tasks[0]?.orderId?.merchantId || null;

    const refLocation =
      tasks[0]?.pickupDropDetails?.[0]?.pickups?.[0]?.location?.join(",");
    const refAddress = tasks[0]?.pickupDropDetails?.[0]?.pickups?.[0]?.address;
    const allSameFirstPickupLocation = tasks.every((task) => {
      const loc =
        task?.pickupDropDetails?.[0]?.pickups?.[0]?.location?.join(",");
      return loc === refLocation;
    });

    if (!allSameFirstPickupLocation) {
      return next(
        appError("All tasks must have the same first pickup location", 400)
      );
    }

    const option = {
      agentId,
      taskStatus: "Unassigned",
      deliveryMode: firstMode,
      pickupAddress: refAddress,
      dropDetails: tasks?.map((task) => ({
        orderId: task.orderId._id,
        taskId: task._id,
        drops: {
          status: "Pending",
          location: task?.pickupDropDetails?.[0]?.drops[0].location,
          address: task?.pickupDropDetails?.[0]?.drops[0].address,
        },
      })),
    };

    const newBatchOrderTask = await BatchOrder.create(option);

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

    res.status(200).json({ success: true });

    let deliveryAddress = tasks[0]?.pickupDropDetails?.[0]?.drops?.[0]?.address;

    const eventName = "newOrder";

    const { rolesToNotify, data } = await findRolesToNotify(eventName);

    // Send notifications to each role dynamically
    for (const role of rolesToNotify) {
      let roleId;

      if (role === "admin") {
        roleId = process.env.ADMIN_ID;
      } else if (role === "merchant") {
        roleId = merchantId;
      } else if (role === "driver") {
        roleId = agentId;
      } else if (role === "customer") {
        roleId = customerId;
      } else {
        const roleValue = await ManagerRoles.findOne({ roleName: role });
        let manager;
        if (roleValue) {
          manager = await Manager.findOne({ role: roleValue._id });
        }
        if (manager) {
          roleId = manager._id;
        }
      }

      if (roleId) {
        const notificationData = {
          fcm: {
            ...data,
            agentId,
            orderId: tasks?.map((task) => task.orderId._id),
            merchantName: refAddress?.fullName || null,
            pickAddress: refAddress || null,
            customerName: deliveryAddress?.fullName || null,
            customerAddress: deliveryAddress,
            orderType: firstMode || null,
            taskDate: formatDate(tasks[0]?.orderId?.deliveryTime),
            taskTime: formatTime(tasks[0]?.orderId?.deliveryTime),
            timer: autoAllocation?.expireTime || 60,
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
      orderId: null,
      taskId: newBatchOrderTask._id,
      merchantName: refAddress?.fullName || null,
      pickAddress: refAddress || null,
      customerName: deliveryAddress?.fullName || null,
      customerAddress: deliveryAddress,
      agentId,
      orderType: firstMode || null,
      taskDate: formatDate(tasks[0]?.orderId?.deliveryTime),
      taskTime: formatTime(tasks[0]?.orderId?.deliveryTime),
      timer: autoAllocation?.expireTime || null,
      batchOrder: true,
    };

    sendSocketData(agentId, eventName, socketData);
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  getTaskByIdController,
  assignAgentToTaskController,
  getAgentsAccordingToGeofenceController,
  getTasksController,
  getAgentsController,
  batchOrder,
};
