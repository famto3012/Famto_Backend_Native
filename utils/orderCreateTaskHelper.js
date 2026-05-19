const turf = require("@turf/turf");

const Task = require("../models/Task");
const Order = require("../models/Order");
const Agent = require("../models/Agent");
const Merchant = require("../models/Merchant");
const AgentPricing = require("../models/AgentPricing");
const AutoAllocation = require("../models/AutoAllocation");
const BusinessCategory = require("../models/BusinessCategory");

const {
  sendNotification,
  sendSocketData,
  getUserLocationFromSocket,
} = require("../socket/socket");

const { formatDate, formatTime } = require("./formatters");

const BatchOrder = require("../models/BatchOrder");

// ─────────────────────────────────────────────────────────────────────────────
// Main helpers
// ─────────────────────────────────────────────────────────────────────────────

const orderCreateTaskHelper = async (orderId) => {
  try {
    const [order, task] = await Promise.all([
      Order.findById(orderId),
      Task.exists({ orderId }),
    ]);

    if (!order) {
      throw new Error("Order not found");
    }

    if (task) return true;



    let pickups = (order.pickups || []).map((pick, index) => ({
      status: "Pending",
      stepIndex: index,
      location: pick.location,
      address: pick.address,
      items: pick.items || [],
    }));

    let drops = (order.drops || []).map((drop, index) => ({
      status: "Pending",
      stepIndex: index,
      location: drop.location,
      address: drop.address,
      items: drop.items || [],
    }));

    await Task.create({
      orderId,
      deliveryMode: order.deliveryMode,
      pickupDropDetails: [
        {
          pickups,
          drops,
        },
      ],
    });

    // ── Auto allocation ──────────────────────────────────────────────────────
    const autoAllocation = await AutoAllocation.findOne().lean();

    if (!autoAllocation) {
      console.log(`[AutoAlloc] ⚠️  No AutoAllocation config found in DB — skipping`);
    } else if (!autoAllocation.isActive) {
      console.log(`[AutoAlloc] 🔴 Auto allocation is DISABLED — manual assignment required`);
    } else {
      console.log(`[AutoAlloc] ✅ Auto allocation is ACTIVE`);
      console.log(`[AutoAlloc]    Type      : ${autoAllocation.autoAllocationType}`);
      console.log(`[AutoAlloc]    Priority  : ${autoAllocation.priorityType}`);
      console.log(`[AutoAlloc]    MaxRadius : ${autoAllocation.maxRadius} km`);
      console.log(`[AutoAlloc]    ExpireTime: ${autoAllocation.expireTime} sec`);
      console.log(`[AutoAlloc]    OrderId   : ${orderId}`);

      if (autoAllocation.autoAllocationType === "All") {
        console.log(`[AutoAlloc] → Notifying ALL eligible agents`);
        await notifyAgents(order, autoAllocation);
      } else {
        console.log(`[AutoAlloc] → Notifying NEAREST agents within ${autoAllocation.maxRadius} km`);
        await notifyNearestAgents(order, autoAllocation);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    return true;
  } catch (err) {
    throw new Error(`Error in creating order task: ${err.message}`);
  }
};

const batchOrderCreateTaskHelper = async (batchOrderId) => {
  try {
    const [batchOrder, task] = await Promise.all([
      BatchOrder.findById(batchOrderId),
      Task.exists({ orderId: batchOrderId }),
    ]);

    if (!batchOrder) {
      throw new Error("Batch Order not found");
    }

    if (task) return true;

    let pickups = batchOrder.pickupAddress
      ? [
        {
          status: "Pending",
          location: batchOrder.pickupAddress.location,
          address: batchOrder.pickupAddress,
        },
      ]
      : [];

    let drops = batchOrder.dropDetails.map((drop) => ({
      status: "Pending",
      location: drop.drops.location,
      address: drop.drops.address,
    }));

    await Task.create({
      orderId: batchOrderId,
      deliveryMode: batchOrder.deliveryMode,
      pickupDropDetails: [
        {
          pickups,
          drops,
        },
      ],
    });

    return true;
  } catch (err) {
    throw new Error(`Error in creating batch order task: ${err}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Notify helpers — build FCM + socket payloads matching taskController pattern
// ─────────────────────────────────────────────────────────────────────────────

const notifyAgents = async (order, autoAllocation) => {
  try {
    const { priorityType } = autoAllocation;
    console.log(`[AutoAlloc] fetchAgents — priorityType: ${priorityType}, merchantId: ${order.merchantId}`);

    const agents =
      priorityType === "Monthly-salaried"
        ? await fetchMonthlySalaryAgents(order.merchantId)
        : await fetchAgents(order.merchantId);

    console.log(`[AutoAlloc] Found ${agents.length} eligible agent(s)`);
    if (agents.length === 0) {
      console.log(`[AutoAlloc] ⚠️  No free/approved agents found — no one notified`);
    }

    for (const agent of agents) {
      await _sendAgentNotification(agent, order, autoAllocation);
    }
  } catch (err) {
    throw new Error(`Error in notifying agents: ${err}`);
  }
};

const notifyNearestAgents = async (order, autoAllocation) => {
  try {
    const { priorityType, maxRadius } = autoAllocation;
    console.log(`[AutoAlloc] fetchNearestAgents — priorityType: ${priorityType}, radius: ${maxRadius} km, merchantId: ${order.merchantId}`);

    const agents =
      priorityType === "Monthly-salaried"
        ? await fetchNearestMonthlySalaryAgents(maxRadius, order.merchantId)
        : await fetchNearestAgents(maxRadius, order.merchantId);

    console.log(`[AutoAlloc] Found ${agents.length} nearby eligible agent(s) within ${maxRadius} km`);
    if (agents.length === 0) {
      console.log(`[AutoAlloc] ⚠️  No agents within radius — no one notified`);
    }

    for (const agent of agents) {
      await _sendAgentNotification(agent, order, autoAllocation);
    }
  } catch (err) {
    throw new Error(`Error in notifying nearest agents: ${err}`);
  }
};

/**
 * Sends FCM push + socket "newOrder" event to a single agent and increments
 * their pendingOrders counter — mirrors assignAgentToTaskController exactly.
 */
const _sendAgentNotification = async (agent, order, autoAllocation) => {
  try {
    const agentId = agent._id.toString();
    console.log(`[AutoAlloc] ── Agent: ${agentId} (${agent.fullName || "unknown"})`);
    console.log(`[AutoAlloc]    Status: ${agent.status} | Approved: ${agent.isApproved}`);

    // Increment pending orders counter
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
    console.log(`[AutoAlloc]    pendingOrders incremented → ${agent.appDetail.pendingOrders}`);

    const pickupAddress = order.pickups?.[0]?.address || null;
    const dropAddress = order.drops?.[0]?.address || null;
    const timer = autoAllocation?.expireTime || 60;

    console.log(`[AutoAlloc]    Pickup : ${pickupAddress?.fullName || "N/A"}`);
    console.log(`[AutoAlloc]    Drop   : ${dropAddress?.fullName || "N/A"}`);
    console.log(`[AutoAlloc]    Timer  : ${timer}s`);

    // ── FCM notification (also creates AgentNotificationLog via socket) ──────
    console.log(`[AutoAlloc]    → Sending FCM push to agent ${agentId}...`);
    const fcmData = {
      title: "New Order",
      body: "You have a new order to pickup",
      image: "",
      agentId,
      orderId: [order._id],
      merchantName: pickupAddress?.fullName || null,
      pickAddress: pickupAddress,
      customerName: dropAddress?.fullName || null,
      customerAddress: dropAddress,
      orderType: order.deliveryMode || null,
      taskDate: formatDate(order.deliveryTime),
      taskTime: formatTime(order.deliveryTime),
      timer,
      isBatchOrder: false,
    };

    await sendNotification(agentId, "newOrder", { fcm: fcmData }, "Driver");
    console.log(`[AutoAlloc]    ✅ FCM sent to agent ${agentId}`);

    // ── Socket push (real-time popup in agent app) ───────────────────────────
    console.log(`[AutoAlloc]    → Sending socket "newOrder" to agent ${agentId}...`);
    const socketData = {
      orderId: order._id,
      taskId: null,
      merchantName: pickupAddress?.fullName || null,
      pickAddress: pickupAddress,
      customerName: dropAddress?.fullName || null,
      customerAddress: dropAddress,
      agentId,
      orderType: order.deliveryMode || null,
      taskDate: formatDate(order.deliveryTime),
      taskTime: formatTime(order.deliveryTime),
      timer,
      batchOrder: false,
    };

    sendSocketData(agentId, "newOrder", socketData);
    console.log(`[AutoAlloc]    ✅ Socket pushed to agent ${agentId}`);
  } catch (err) {
    // Log per-agent failure but don't abort the rest of the loop
    console.error(`[AutoAlloc] ❌ Notify failed for agent ${agent._id} (${agent.fullName || "unknown"}): ${err.message}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Agent fetch helpers
// ─────────────────────────────────────────────────────────────────────────────

const fetchAgents = async (merchantId) => {
  let merchant;
  let merchantBusinessCategory;

  if (merchantId) {
    merchant = await Merchant.findById(merchantId);
    if (merchant) {
      merchantBusinessCategory = await BusinessCategory.findById(
        merchant.merchantDetail.businessCategoryId
      );
    }
  }

  if (merchant) {
    if (
      merchantBusinessCategory?.title === "Fish" ||
      merchantBusinessCategory?.title === "Meat"
    ) {
      return Agent.find({
        status: "Free",
        "workStructure.tag": "Fish & Meat",
        isApproved: "Approved",
      });
    } else {
      return Agent.find({ status: "Free", isApproved: "Approved" });
    }
  } else {
    return Agent.find({
      status: "Free",
      "workStructure.tag": { $ne: "Fish & Meat" },
      isApproved: "Approved",
    });
  }
};

/**
 * @param {number} radius  - max radius in km from the merchant location
 * @param {string} merchantId
 */
const fetchNearestAgents = async (radius, merchantId) => {
  let merchant;
  let merchantBusinessCategory;

  if (merchantId) {
    merchant = await Merchant.findById(merchantId);
    if (merchant) {
      merchantBusinessCategory = await BusinessCategory.findById(
        merchant.merchantDetail.businessCategoryId
      );
    }
  }

  let agents;
  if (merchant) {
    if (
      merchantBusinessCategory?.title === "Fish" ||
      merchantBusinessCategory?.title === "Meat"
    ) {
      agents = await Agent.find({
        status: "Free",
        "workStructure.tag": "Fish & Meat",
        isApproved: "Approved",
      });
    } else {
      agents = await Agent.find({ status: "Free", isApproved: "Approved" });
    }
  } else {
    agents = await Agent.find({
      status: "Free",
      "workStructure.tag": { $ne: "Fish & Meat" },
      isApproved: "Approved",
    });
  }

  if (!radius || radius <= 0 || !merchant) return agents;

  const merchantLocation = merchant.merchantDetail.location;

  return agents.filter((agent) => {
    const agentLocation = getUserLocationFromSocket(agent._id);
    if (!agentLocation) return false;
    const distance = turf.distance(
      turf.point(merchantLocation),
      turf.point(agentLocation),
      { units: "kilometers" }
    );
    return distance <= radius;
  });
};

const fetchMonthlySalaryAgents = async (merchantId) => {
  try {
    let merchant;
    let merchantBusinessCategory;

    if (merchantId) {
      merchant = await Merchant.findById(merchantId);
      if (merchant) {
        merchantBusinessCategory = await BusinessCategory.findById(
          merchant.merchantDetail.businessCategoryId
        );
      }
    }

    const monthlySalaryPricing = await AgentPricing.findOne({
      ruleName: "Monthly-salaried",
    });

    let agents;
    if (merchant) {
      if (
        merchantBusinessCategory?.title === "Fish" ||
        merchantBusinessCategory?.title === "Meat"
      ) {
        agents = await Agent.find({
          status: "Free",
          "workStructure.tag": "Fish & Meat",
          isApproved: "Approved",
        });
      } else {
        agents = await Agent.find({ status: "Free", isApproved: "Approved" });
      }
    } else {
      agents = await Agent.find({
        status: "Free",
        "workStructure.tag": { $ne: "Fish & Meat" },
        isApproved: "Approved",
      });
    }

    // If no Monthly-salaried pricing rule exists, fall back to all free agents
    if (!monthlySalaryPricing) {
      console.warn('[AutoAlloc] No "Monthly-salaried" AgentPricing rule found — falling back to all free agents');
      return agents;
    }

    return agents.filter(
      (agent) =>
        agent.workStructure?.salaryStructureId?.toString() ===
        monthlySalaryPricing._id.toString()
    );
  } catch (error) {
    throw new Error(`Error fetching monthly salary agents: ${error}`);
  }
};

/**
 * @param {number} radius  - max radius in km from the merchant location
 * @param {string} merchantId
 */
const fetchNearestMonthlySalaryAgents = async (radius, merchantId) => {
  try {
    const monthlySalaryPricing = await AgentPricing.findOne({
      ruleName: "Monthly-salaried",
    });

    let merchant;
    let merchantBusinessCategory;

    if (merchantId) {
      merchant = await Merchant.findById(merchantId);
      if (merchant) {
        merchantBusinessCategory = await BusinessCategory.findById(
          merchant.merchantDetail.businessCategoryId
        );
      }
    }

    let agents;
    if (merchant) {
      if (
        merchantBusinessCategory?.title === "Fish" ||
        merchantBusinessCategory?.title === "Meat"
      ) {
        agents = await Agent.find({
          status: "Free",
          "workStructure.tag": "Fish & Meat",
          isApproved: "Approved",
        });
      } else {
        agents = await Agent.find({ status: "Free", isApproved: "Approved" });
      }
    } else {
      agents = await Agent.find({
        status: "Free",
        "workStructure.tag": { $ne: "Fish & Meat" },
        isApproved: "Approved",
      });
    }

    // Filter by distance if radius + merchant location are available
    const distanceFiltered =
      radius > 0 && merchant
        ? agents.filter((agent) => {
          const merchantLocation = merchant.merchantDetail.location;
          const agentLocation = getUserLocationFromSocket(agent._id);
          if (!agentLocation) return false;
          const distance = turf.distance(
            turf.point(merchantLocation),
            turf.point(agentLocation),
            { units: "kilometers" }
          );
          return distance <= radius;
        })
        : agents;

    // If no Monthly-salaried pricing rule exists, fall back to distance-filtered agents
    if (!monthlySalaryPricing) {
      console.warn('[AutoAlloc] No "Monthly-salaried" AgentPricing rule found — falling back to all nearby free agents');
      return distanceFiltered;
    }

    // Then filter by monthly salary structure
    return distanceFiltered.filter(
      (agent) =>
        agent.workStructure?.salaryStructureId?.toString() ===
        monthlySalaryPricing._id.toString()
    );
  } catch (error) {
    throw new Error(`Error fetching nearest monthly salary agents: ${error}`);
  }
};

module.exports = { orderCreateTaskHelper, batchOrderCreateTaskHelper };
