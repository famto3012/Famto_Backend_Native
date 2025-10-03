const { validationResult } = require("express-validator");
const mongoose = require("mongoose");

const Task = require("../../models/Task");
const Agent = require("../../models/Agent");
const Order = require("../../models/Order");
const Manager = require("../../models/Manager");
const Customer = require("../../models/Customer");
const FcmToken = require("../../models/fcmToken");
const Merchant = require("../../models/Merchant");
const LoyaltyPoint = require("../../models/LoyaltyPoint");
const ManagerRoles = require("../../models/ManagerRoles");
const AutoAllocation = require("../../models/AutoAllocation");
const AgentActivityLog = require("../../models/AgentActivityLog");
const AgentTransaction = require("../../models/AgentTransaction");
const AgentWorkHistory = require("../../models/AgentWorkHistory");
const NotificationSetting = require("../../models/NotificationSetting");
const AgentNotificationLogs = require("../../models/AgentNotificationLog");
const AgentAnnouncementLogs = require("../../models/AgentAnnouncementLog");
const AgentAppCustomization = require("../../models/AgentAppCustomization");

const {
  sendSocketData,
  sendNotification,
  findRolesToNotify,
  getUserLocationFromSocket,
} = require("../../socket/socket");

const verifyToken = require("../../utils/verifyToken");
const { geoLocation } = require("../../utils/getGeoLocation");
const {
  uploadToFirebase,
  deleteFromFirebase,
} = require("../../utils/imageOperation");
const generateToken = require("../../utils/generateToken");
const appError = require("../../utils/appError");
const {
  formatToHours,
  updateLoyaltyPoints,
  processReferralRewards,
  calculateAgentEarnings,
  updateOrderDetails,
  updateAgentDetails,
  updateNotificationStatus,
  updateCustomerSubscriptionCount,
  updateAgentDetailsForBatch,
} = require("../../utils/agentAppHelpers");
const { formatDate, formatTime } = require("../../utils/formatters");
const {
  getDistanceFromPickupToDelivery,
} = require("../../utils/customerAppHelpers");
const {
  createRazorpayOrderId,
  verifyPayment,
  createRazorpayQrCode,
} = require("../../utils/razorpayPayment");
const AgentPricing = require("../../models/AgentPricing");
const BatchOrder = require("../../models/BatchOrder");

// Update location on entering APP
const updateLocationController = async (req, res, next) => {
  try {
    const currentAgentId = req.userAuth;
    const { latitude, longitude } = req.body;

    // Retrieve agent data and geolocation concurrently
    const [agentFound, geofence] = await Promise.all([
      Agent.findById(currentAgentId),
      geoLocation(latitude, longitude),
    ]);

    // Early return if agent is not found
    if (!agentFound) return next(appError("Agent not found", 404));

    // Update agent's location and geofence
    agentFound.location = [latitude, longitude];
    agentFound.geofenceId = geofence.id;

    await agentFound.save();

    res.status(200).json({
      message: "Location and geofence updated successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Agent register Controller
const registerAgentController = async (req, res, next) => {
  const { fullName, email, phoneNumber, latitude, longitude } = req.body;

  // Consolidate validation and return errors if any
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc, error) => {
      acc[error.path] = error.msg;
      return acc;
    }, {});
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    // Normalize and prepare data
    const normalizedEmail = email.toLowerCase();
    const location = [latitude, longitude];

    // Check if email or phone already exists in a single call
    const [existingAgent, geofence] = await Promise.all([
      Agent.findOne({ $or: [{ email: normalizedEmail }, { phoneNumber }] }),
      geoLocation(latitude, longitude),
    ]);

    // Return early if email or phone already exists
    if (existingAgent) {
      const conflictErrors = {};
      if (existingAgent.email === normalizedEmail) {
        conflictErrors.email = "Email already exists";
      }
      if (existingAgent.phoneNumber === phoneNumber) {
        conflictErrors.phoneNumber = "Phone number already exists";
      }
      return res.status(409).json({ errors: conflictErrors });
    }

    // Handling profile image upload
    const agentImageURL = req.file
      ? await uploadToFirebase(req.file, "AgentImages")
      : "";

    // Create new agent and notification simultaneously
    const newAgent = await Agent.create({
      fullName,
      email: normalizedEmail,
      phoneNumber,
      location,
      geofenceId: geofence._id,
      agentImageURL,
    });

    if (!newAgent) return next(appError("Error in registering new agent"));

    const notification = await NotificationSetting.findOne({
      event: "newAgent",
    });
    const data = {
      title: notification.title,
      description: notification.description,
    };
    const event = "newAgent";
    const role = "Agent";

    // Send notification and socket data
    sendNotification(process.env.ADMIN_ID, event, data, role);
    sendSocketData(process.env.ADMIN_ID, event, data);

    let refreshToken = newAgent?.refreshToken;
    try {
      // Verify if the refresh token is still valid
      if (refreshToken) {
        verifyToken(refreshToken);
      } else {
        refreshToken = generateToken(
          newAgent._id,
          newAgent.role,
          newAgent?.fullName,
          "30d"
        );
        newAgent.refreshToken = refreshToken;
        await newAgent.save();
      }
    } catch {
      // Generate a new refresh token if expired/invalid
      refreshToken = generateToken(
        newAgent._id,
        newAgent.role,
        newAgent?.fullName,
        "30d"
      );
      newAgent.refreshToken = refreshToken;
      await newAgent.save();
    }

    // Send success response
    res.status(200).json({
      message: "Agent registered successfully",
      _id: newAgent._id,
      fullName: newAgent.fullName,
      token: generateToken(newAgent._id, newAgent.role, newAgent?.fullName),
      refreshToken: refreshToken,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Agent login Controller
const agentLoginController = async (req, res, next) => {
  const { phoneNumber, fcmToken } = req.body;

  // Early validation check and error response
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc, error) => {
      acc[error.path] = error.msg;
      return acc;
    }, {});
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    // Check if agent exists
    const agentFound = await Agent.findOne({ phoneNumber });
    if (!agentFound) {
      return res.status(404).json({
        errors: { phoneNumber: "Phone number not registered" },
      });
    }

    // Check for approval status

    if (agentFound.isApproved === "Pending") {
      return res.status(403).json({
        errors: { general: "Pending registration approval" },
      });
    }

    if (agentFound.isBlocked) {
      return res.status(403).json({
        errors: { general: "Login is restricted" },
      });
    }

    const refreshToken = generateToken(
      agentFound._id,
      agentFound.role,
      agentFound?.fullName,
      "30d"
    );
    const token = generateToken(
      agentFound._id,
      agentFound.role,
      agentFound?.fullName,
      "2hr"
    );

    agentFound.refreshToken = refreshToken;

    await Promise.all([
      FcmToken.findOneAndUpdate(
        { userId: agentFound._id },
        { token: fcmToken },
        { upsert: true, new: true }
      ),
      agentFound.save(),
    ]);

    res.status(200).json({
      message: "Agent Login successful",
      token,
      refreshToken,
      _id: agentFound._id,
      fullName: agentFound.fullName,
      agentImageURL: agentFound.agentImageURL,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get agent drawer detail
const getAppDrawerDetailsController = async (req, res, next) => {
  try {
    const agentFound = await Agent.findById(req.userAuth);

    if (!agentFound) return next(appError("Agent not found", 400));

    let status;
    let statusTitle;
    if (agentFound.status === "Free" || agentFound.status === "Busy") {
      statusTitle = "Online";
      status = true;
    } else {
      statusTitle = "Offline";
      status = false;
    }

    const formattedResponse = {
      agentId: req.userAuth,
      agentImageURL: agentFound.agentImageURL,
      agentName: agentFound.fullName,
      status,
      statusTitle,
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

// Get Agent's profile
const getAgentProfileDetailsController = async (req, res, next) => {
  try {
    // Use lean query with selected fields for efficiency
    const currentAgent = await Agent.findById(req.userAuth)
      .select(
        "fullName phoneNumber email agentImageURL governmentCertificateDetail workStructure.workTimings"
      )
      .lean();

    if (!currentAgent) return next(appError("Agent not found", 404));

    const customization = await AgentAppCustomization.findOne({}).lean();
    if (!customization || !customization.workingTime) {
      return next(appError("Customization data not found", 404));
    }

    // Convert agent timings to string for easy comparison
    const selectedTimingIds = (
      currentAgent.workStructure?.workTimings || []
    ).map((id) => id.toString());

    // Filter customization timings that match agent's selected timings
    const selectedTimings = customization.workingTime.filter((time) =>
      selectedTimingIds.includes(time._id.toString())
    );

    const formattedResponse = {
      _id: currentAgent._id,
      fullName: currentAgent.fullName,
      email: currentAgent.email,
      phoneNumber: currentAgent.phoneNumber,
      agentImageURL: currentAgent.agentImageURL,
      governmentCertificateDetail: currentAgent.governmentCertificateDetail,
      selectedTimings: selectedTimings?.map((time) => ({
        startTime: time.startTime,
        endTime: time.endTime,
      })),
    };

    // Send agent profile data in response
    res.status(200).json({
      message: "Agent profile data",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Edit Agent's profile
const editAgentProfileController = async (req, res, next) => {
  const { email, fullName } = req.body;

  // Early validation check
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc, error) => {
      acc[error.path] = error.msg;
      return acc;
    }, {});
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    const agentToUpdate = await Agent.findById(req.userAuth);
    if (!agentToUpdate) return next(appError("Agent not found", 404));

    // Handle profile image update concurrently
    let agentImageURL = agentToUpdate.agentImageURL;
    if (req.file) {
      const [_, newAgentImageURL] = await Promise.all([
        deleteFromFirebase(agentImageURL),
        uploadToFirebase(req.file, "AgentImages"),
      ]);
      agentImageURL = newAgentImageURL;
    }

    // Update agent profile details
    agentToUpdate.set({ email, fullName, agentImageURL });
    await agentToUpdate.save();

    res.status(200).json({ message: "Agent updated successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

// Delete agent profile
const deleteAgentProfileController = async (req, res, next) => {
  try {
    const agentId = req.userAuth;

    // Find agent document to access image URLs
    const agentFound = await Agent.findById(agentId);
    if (!agentFound) return next(appError("Agent not found", 404));

    // Gather all image URLs to delete
    const imagesToDelete = [
      agentFound.agentImageURL,
      agentFound.governmentCertificateDetail?.aadharFrontImageURL,
      agentFound.governmentCertificateDetail?.aadharBackImageURL,
      agentFound.governmentCertificateDetail?.drivingLicenseFrontImageURL,
      agentFound.governmentCertificateDetail?.drivingLicenseBackImageURL,
      ...agentFound.vehicleDetail.map((vehicle) => vehicle.rcFrontImageURL),
      ...agentFound.vehicleDetail.map((vehicle) => vehicle.rcBackImageURL),
    ].filter(Boolean); // Filter out undefined or null URLs

    // Concurrently delete images
    await Promise.all(imagesToDelete.map((url) => deleteFromFirebase(url)));

    // Delete agent profile after images are deleted
    await Agent.findByIdAndDelete(agentId);

    res.status(200).json({
      message: "Agent profile and associated images deleted successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Update Bank account details controller
const updateAgentBankDetailController = async (req, res, next) => {
  const { accountHolderName, accountNumber, IFSCCode, UPIId } = req.body;

  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(500).json({ errors: formattedErrors });
  }

  try {
    const currentAgent = await Agent.findById(req.userAuth);

    if (!currentAgent) return next(appError("Agent not found", 404));

    const bankDetails = {
      accountHolderName,
      accountNumber,
      IFSCCode,
      UPIId,
    };

    currentAgent.bankDetail = bankDetails;

    await currentAgent.save();

    res.status(200).json({
      message: "Agent's bank details added successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get Bank account details controller
const getBankDetailController = async (req, res, next) => {
  try {
    const currentAgent = await Agent.findById(req.userAuth);

    if (!currentAgent) return next(appError("Agent not found", 404));

    // Check if bankDetail exists and set default values if not
    const bankDetails = currentAgent.bankDetail || {
      accountHolderName: "",
      accountNumber: "",
      IFSCCode: "",
      UPIId: "",
    };

    res.status(200).json({
      message: "Bank Details",
      accountHolderName: bankDetails.accountHolderName,
      accountNumber: bankDetails.accountNumber,
      IFSCCode: bankDetails.IFSCCode,
      UPIId: bankDetails.UPIId,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Add agent's vehicle details
const addVehicleDetailsController = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc, error) => {
      acc[error.path] = error.msg;
      return acc;
    }, {});
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    const agentFound = await Agent.findById(req.userAuth);
    if (!agentFound) return next(appError("Agent not found", 404));

    const { model, type, licensePlate } = req.body;
    const { rcFrontImage, rcBackImage } = req.files;

    // Upload images concurrently
    const [rcFrontImageURL, rcBackImageURL] = await Promise.all([
      uploadToFirebase(rcFrontImage[0], "RCImages"),
      uploadToFirebase(rcBackImage[0], "RCImages"),
    ]);

    // Add vehicle details to agent
    const newVehicle = {
      _id: new mongoose.Types.ObjectId(),
      model,
      type,
      licensePlate,
      rcFrontImageURL,
      rcBackImageURL,
    };
    agentFound.vehicleDetail.push(newVehicle);
    await agentFound.save();

    res.status(200).json({
      message: "Agent's vehicle details added successfully",
      data: newVehicle,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Edit agent's vehicle details
const editAgentVehicleController = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc, error) => {
      acc[error.path] = error.msg;
      return acc;
    }, {});
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    const currentAgent = await Agent.findById(req.userAuth);
    if (!currentAgent) return next(appError("Agent not found", 404));

    const { vehicleId } = req.params;
    const vehicle = currentAgent.vehicleDetail.id(vehicleId);
    if (!vehicle) return next(appError("Vehicle not found", 404));

    // Parallel image upload handling
    const { rcFrontImage, rcBackImage } = req.files;
    const [newRcFrontImageURL, newRcBackImageURL] = await Promise.all([
      rcFrontImage
        ? uploadToFirebase(rcFrontImage[0], "RCImages")
        : vehicle.rcFrontImageURL,
      rcBackImage
        ? uploadToFirebase(rcBackImage[0], "RCImages")
        : vehicle.rcBackImageURL,
    ]);

    // Update vehicle details
    Object.assign(vehicle, {
      model: req.body.model || vehicle.model,
      type: req.body.type || vehicle.type,
      licensePlate: req.body.licensePlate || vehicle.licensePlate,
      rcFrontImageURL: newRcFrontImageURL,
      rcBackImageURL: newRcBackImageURL,
      vehicleStatus:
        req.body.vehicleStatus !== undefined
          ? req.body.vehicleStatus
          : vehicle.vehicleStatus,
    });

    await currentAgent.save();

    res.status(200).json({
      message: "Vehicle details updated successfully",
      data: vehicle,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get all vehicle details
const getAllVehicleDetailsController = async (req, res, next) => {
  try {
    const currentAgent = await Agent.findById(req.userAuth).select(
      "vehicleDetail"
    );

    if (!currentAgent) return next(appError("Agent not found", 404));

    res.status(200).json({
      message: "Agent vehicle details",
      data: currentAgent,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get single vehicle detail
const getSingleVehicleDetailController = async (req, res, next) => {
  try {
    const currentAgent = await Agent.findById(req.userAuth);

    if (!currentAgent) return next(appError("Agent not found", 404));

    const { vehicleId } = req.params;
    const vehicle = currentAgent.vehicleDetail.id(vehicleId);

    if (!vehicle) return next(appError("Vehicle not found", 404));

    res.status(200).json({
      message: "Vehicle details fetched successfully",
      data: vehicle,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Add agent's government certificates
const addGovernmentCertificatesController = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc, error) => {
      acc[error.path] = error.msg;
      return acc;
    }, {});
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    const agentFound = await Agent.findById(req.userAuth);
    if (!agentFound) return next(appError("Agent not found", 404));

    const { aadharNumber, drivingLicenseNumber } = req.body;
    const {
      aadharFrontImage,
      aadharBackImage,
      drivingLicenseFrontImage,
      drivingLicenseBackImage,
    } = req.files || {};

    // Concurrently upload images if provided
    const [
      aadharFrontImageURL,
      aadharBackImageURL,
      drivingLicenseFrontImageURL,
      drivingLicenseBackImageURL,
    ] = await Promise.all([
      aadharFrontImage
        ? uploadToFirebase(aadharFrontImage[0], "AadharImages")
        : "",
      aadharBackImage
        ? uploadToFirebase(aadharBackImage[0], "AadharImages")
        : "",
      drivingLicenseFrontImage
        ? uploadToFirebase(drivingLicenseFrontImage[0], "DrivingLicenseImages")
        : "",
      drivingLicenseBackImage
        ? uploadToFirebase(drivingLicenseBackImage[0], "DrivingLicenseImages")
        : "",
    ]);

    // Set government certificate details
    agentFound.governmentCertificateDetail = {
      aadharNumber,
      aadharFrontImageURL,
      aadharBackImageURL,
      drivingLicenseNumber,
      drivingLicenseFrontImageURL,
      drivingLicenseBackImageURL,
    };
    await agentFound.save();

    res.status(200).json({
      message: "Agent government certificates added successfully",
      data: agentFound.governmentCertificateDetail,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Change agent's status to Free
const toggleOnlineController = async (req, res, next) => {
  try {
    const currentAgent = await Agent.findById(req.userAuth);

    if (!currentAgent) return next(appError("Agent not found", 404));

    if (currentAgent.status === "Busy") {
      res.status(400).json({
        message: "Cant go offline during an ongoing delivery",
      });
      return;
    }

    if (!currentAgent.appDetail) {
      currentAgent.appDetail = {
        orders: 0,
        pendingOrders: 0,
        totalDistance: 0,
        cancelledOrders: 0,
        loginHours: 0,
      };
    }

    const eventName = "updatedAgentStatusToggle";

    let description = "";

    if (currentAgent.status === "Free") {
      currentAgent.status = "Inactive";
      const data = { status: "Offline" };
      const eventName = "updatedAgentStatusToggle";

      // Set the end time when the agent goes offline
      currentAgent.loginEndTime = new Date();

      if (currentAgent.loginStartTime) {
        const loginDuration =
          new Date() - new Date(currentAgent.loginStartTime); // in milliseconds
        currentAgent.appDetail.loginDuration += loginDuration;
      }

      description = "Agent gone OFFLINE";

      currentAgent.loginStartTime = null;

      sendSocketData(currentAgent._id, eventName, data);
    } else {
      const agentWorkTimings = currentAgent.workStructure.workTimings || [];
      const nowUTC = new Date();
      const nowIST = new Date(
        nowUTC.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
      );

      const objectIds = agentWorkTimings.map((id) =>
        mongoose.Types.ObjectId.createFromHexString(id)
      );

      const workTimings = await AgentAppCustomization.aggregate([
        { $unwind: "$workingTime" },
        { $match: { "workingTime._id": { $in: objectIds } } },
        {
          $project: {
            _id: "$workingTime._id",
            startTime: "$workingTime.startTime",
            endTime: "$workingTime.endTime",
          },
        },
      ]);

      const isWithInWorkingHours = workTimings.some((workTime) => {
        const { startTime, endTime } = workTime;

        const [startHour, startMinute] = startTime.split(":").map(Number);
        const [endHour, endMinute] = endTime.split(":").map(Number);

        const start = new Date(nowIST);
        const end = new Date(nowIST);

        if (process.env.NODE_ENV === "production") {
          start.setUTCHours(startHour, startMinute, 0, 0);
          end.setUTCHours(endHour, endMinute, 0, 0);
        } else {
          start.setHours(startHour, startMinute, 0, 0);
          end.setHours(endHour, endMinute, 0, 0);
        }

        return nowIST >= start && nowIST <= end;
      });

      if (!isWithInWorkingHours) {
        res.status(400).json({
          message: `You can go online during your working time only!`,
        });

        return;
      }

      currentAgent.status = "Free";

      const data = {
        status: "Online",
      };

      // Set the start time when the agent goes online
      currentAgent.loginStartTime = new Date();

      description = "Agent gone ONLINE";

      sendSocketData(currentAgent._id, eventName, data);
    }

    await Promise.all([
      currentAgent.save(),
      AgentActivityLog.create({
        agentId: currentAgent,
        date: new Date(),
        description,
      }),
    ]);

    res.status(200).json({
      message: `Agent status changed to ${currentAgent.status}`,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Delete vehicle
const deleteAgentVehicleController = async (req, res, next) => {
  try {
    const agentFound = await Agent.findById(req.userAuth);

    if (!agentFound) return next(appError("Agent not found", 404));

    const { vehicleId } = req.params;

    const vehicleIndex = agentFound.vehicleDetail.findIndex(
      (vehicle) => vehicle._id.toString() === vehicleId
    );

    if (vehicleIndex === -1) return next(appError("Vehicle not found", 404));

    // Remove the vehicle from the array
    agentFound.vehicleDetail.splice(vehicleIndex, 1);

    await agentFound.save();

    res.status(200).json({
      message: "Vehicle detail deleted successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Change status of vehicle
const changeVehicleStatusController = async (req, res, next) => {
  try {
    const agentFound = await Agent.findById(req.userAuth);

    if (!agentFound) return next(appError("Agent not found", 404));

    const { vehicleId } = req.params;

    let vehicleFound = false;

    // Update the status of each vehicle
    agentFound.vehicleDetail.forEach((vehicle) => {
      if (vehicle._id.toString() === vehicleId) {
        vehicle.vehicleStatus = !vehicle.vehicleStatus;
        vehicleFound = true;
      } else {
        vehicle.vehicleStatus = false;
      }
    });

    if (!vehicleFound) return next(appError("Vehicle not found", 404));

    await agentFound.save();

    res.status(200).json({
      message: "Vehicle status updated successfully",
      data: agentFound.vehicleDetail,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Rate customer by order
const rateCustomerController = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { rating, review } = req.body;

    const orderFound = await Order.findById(orderId);

    if (!orderFound) return next(appError("Order not found", 404));

    const customerFound = await Customer.findById(orderFound.customerId);

    if (!customerFound) return next(appError("Customer not found", 404));

    orderFound.orderRating.ratingByDeliveryAgent.review = review;
    orderFound.orderRating.ratingByDeliveryAgent.rating = rating;

    let updatedCustomerRating = {
      agentId: req.userAuth,
      review,
      rating,
    };

    customerFound.ratingsByAgents.push(updatedCustomerRating);

    await Promise.all([orderFound.save(), customerFound.save()]);

    res.status(200).json({ message: "Customer rated successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get agent's current day statistics
const getCurrentDayAppDetailController = async (req, res, next) => {
  try {
    const agentId = req.userAuth;

    const agentFound = await Agent.findById(agentId)
      .select("appDetail ratingsByCustomers workStructure.salaryStructureId")
      .lean({ virtuals: true })
      .exec();

    if (!agentFound) return next(appError("Agent not found", 404));

    const agentPricing = await AgentPricing.findById(
      agentFound.workStructure.salaryStructureId
    );

    const pricePerOrder = agentPricing.baseFare / agentPricing.minOrderNumber;
    const incentives = (agentFound?.appDetail?.orders || 0) * pricePerOrder;

    const formattedResponse = {
      totalEarning: agentFound?.appDetail?.totalEarning || 0,
      incentives,
      orders: agentFound?.appDetail?.orders || 0,
      pendingOrders: agentFound?.appDetail?.pendingOrders || 0,
      totalDistance: agentFound?.appDetail?.totalDistance || 0.0,
      averageRating: agentFound.averageRating || 0.0,
    };

    res.status(200).json({
      message: "Current day statistic of agent",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get agent's history of app details
const getHistoryOfAppDetailsController = async (req, res, next) => {
  try {
    const agentId = req.userAuth;

    const [agent, history] = await Promise.all([
      Agent.findById(agentId).lean({ virtuals: true }).exec(),
      AgentWorkHistory.find({ agentId }),
    ]);

    if (!agent) return next(appError("Agent not found", 404));

    history.unshift(agent.appDetail);

    // Sort the appDetailHistory by date in descending order (latest date first)
    const sortedAppDetailHistory = history?.sort(
      (a, b) => new Date(b.workDate) - new Date(a.workDate)
    );

    const formattedResponse = sortedAppDetailHistory.map((history) => ({
      date: formatDate(history.workDate),
      details: {
        totalEarnings: (history.totalEarning || 0).toFixed(2),
        orders: history.orders || 0,
        cancelledOrders: history.cancelledOrders || 0,
        totalDistance: `${(history.totalDistance || 0).toFixed(2)} km`,
        totalSurge: Number(history.totalSurge?.toFixed(2)) || 0,
        deduction: Number(history.deduction?.toFixed(2)) || 0,
        loginHours: formatToHours(history.loginDuration) || "0:00 hr",
        orderDetail:
          history?.orderDetail?.map((order) => ({
            orderId: order.orderId,
            deliveryMode: order.deliveryMode,
            customerName: order.customerName,
            grandTotal: order.grandTotal,
            date: formatDate(order.completedOn),
            time: formatTime(order.completedOn),
          })) || [],
      },
    }));

    res.status(200).json({
      message: "App Detail history",
      data: formattedResponse || [],
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get ratings of agent
const getRatingsOfAgentController = async (req, res, next) => {
  try {
    const agentId = req.userAuth;

    const agentFound = await Agent.findById(agentId)
      .populate({
        path: "ratingsByCustomers.customerId",
        select: "fullName _id",
      })
      .select("ratingsByCustomers averageRating");

    if (!agentFound) return next(appError("Agent not found", 404));

    const ratingsOfAgent = agentFound.ratingsByCustomers.reverse();

    const formattedRatingAndReviews = ratingsOfAgent.map((rating) => ({
      review: rating?.review,
      rating: rating?.rating,
      customerId: {
        id: rating?.customerId?._id,
        fullName: rating?.customerId?.fullName || "-",
      },
    }));

    res.status(200).json({
      message: "Ratings of agent",
      averageRating: agentFound.averageRating.toFixed(1) || "0.0",
      data: formattedRatingAndReviews,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get task previews
const getTaskPreviewController = async (req, res, next) => {
  console.log("Preview", req.body);
  try {
    const agentId = req.userAuth;
    const { orderId, batchOrder } = req.body;
    const agentFound = await Agent.findById(agentId);
    if (!agentFound) return next(appError("Agent not found", 404));

    let currentTasks = [];
    let nextTasks = [];

    const groupedTasks = {};

    const taskFound = await Task.find({
      agentId,
      taskStatus: "Assigned",
    })
      .populate("orderId")
      .sort({ createdAt: 1 });
    console.log("task found", taskFound);
    //###########################################
    if (batchOrder) {
      const batchOrder = await BatchOrder.findById(orderId);

      // const rawIds = (batchOrder.dropDetails || [])
      //   .map((d) => d?.taskId)
      //   .filter(Boolean);

      // const uniqueIds = [...new Set(rawIds.map(String))] // dedupe
      //   .map((id) => new mongoose.Types.ObjectId(id)); // ensure ObjectId

      // if (uniqueIds.length === 0) return [];

      // // Fetch only Assigned tasks
      // const taskFound = await Task.find({
      //   _id: { $in: uniqueIds },
      //   status: "Assigned",
      // }).lean();

      console.log("batchOrder", batchOrder);
      const pickupValue = {
        type: "Pickup",
        // taskId: task._id,
        taskStatus: batchOrder.pickupAddress.status,
        // date: formatDate(task?.orderId?.deliveryTime),
        // time: formatTime(task.createdAt),
        address: {
          fullName: batchOrder.pickupAddress?.fullName || null,
          // flat: batchOrder.pickupAddress?.flat || null,
          area: batchOrder.pickupAddress?.area || null,
          phoneNumber: batchOrder.pickupAddress?.phoneNumber || null,
          location: batchOrder.pickupAddress?.location || null,
        },
        agentLocation: getUserLocationFromSocket(agentId),
      };
      const response = {
        orderId: batchOrder._id,
        orderType: batchOrder.deliveryMode,
        tasks: {
          pickups: pickupValue,
          deliveries: [],
        },
      };
      console.log("response value 1", response);
      batchOrder?.dropDetails?.forEach((dropDetails) => {
        console.log("dropDetails value", dropDetails);
        const taskFound = Task.findById(dropDetails.taskId)
          .populate("orderId")
          .lean();
        response?.tasks?.deliveries.push({
          type: "Delivery",
          taskId: dropDetails.taskId,
          taskStatus: dropDetails?.drops.status,
          date: formatDate(taskFound.createdAt),
          time: formatTime(taskFound?.orderId?.orderDetail?.deliveryTime),
          address: {
            fullName: dropDetails?.drops?.address.fullName || null,
            flat: dropDetails?.drops?.address.flat || null,
            area: dropDetails?.drops?.address.area || null,
            phoneNumber: dropDetails?.drops?.address.phoneNumber || null,
            location: dropDetails?.drops.location || null,
          },
          agentLocation: getUserLocationFromSocket(agentId),
        });
      });
      console.log("response value", response);

      //   Object.values(response).forEach((order) => {
      //   currentTasks.push(order);
      // });

      res.status(200).json({
        message: "Task preview",
        data: {
          response,
          //nextTasks, // keep empty for now until we add scheduling logic
        },
      });
    } else {
      taskFound.forEach((task) => {
        const orderId = task.orderId?._id;
        // const orderId = task.orderId;

        if (!groupedTasks[orderId]) {
          groupedTasks[orderId] = {
            orderId,
            orderType: task?.orderId?.deliveryMode || null,
            tasks: {
              pickups: [],
              deliveries: [],
            },
          };
        }

        // Loop through each pickup
        task?.pickupDropDetails?.forEach((detailBlock) => {
          detailBlock?.pickups?.forEach((pickup) => {
            groupedTasks[orderId].tasks.pickups.push({
              type: "Pickup",
              taskId: task._id,
              taskStatus: pickup.status,
              date: formatDate(task?.orderId?.deliveryTime),
              time: formatTime(task.createdAt),
              address: {
                fullName: pickup.address?.fullName || null,
                flat: pickup.address?.flat || null,
                area: pickup.address?.area || null,
                phoneNumber: pickup.address?.phoneNumber || null,
                location: pickup.location || null,
              },
              agentLocation: getUserLocationFromSocket(agentId),
            });
          });

          // Loop through each drop
          detailBlock?.drops?.forEach((drop) => {
            groupedTasks[orderId].tasks.deliveries.push({
              type: "Delivery",
              taskId: task._id,
              taskStatus: drop.status,
              date: formatDate(task.createdAt),
              time: formatTime(task?.orderId?.orderDetail?.deliveryTime),
              address: {
                fullName: drop.address?.fullName || null,
                flat: drop.address?.flat || null,
                area: drop.address?.area || null,
                phoneNumber: drop.address?.phoneNumber || null,
                location: drop.location || null,
              },
              agentLocation: getUserLocationFromSocket(agentId),
            });
          });
        });
      });

      // Push into currentTasks
      Object.values(groupedTasks).forEach((order) => {
        currentTasks.push(order);
      });

      res.status(200).json({
        message: "Task preview",
        data: {
          currentTasks,
          nextTasks, // keep empty for now until we add scheduling logic
        },
      });
    }

    //###########################################
  } catch (err) {
    next(appError(err.message));
  }
};

// const getTaskPreviewController = async (req, res, next) => {
//   try {
//     const agentId = req.userAuth;

//     const agentFound = await Agent.findById(agentId);

//     if (!agentFound) return next(appError("Agent not found", 404));

//     const taskFound = await Task.find({
//       agentId,
//       taskStatus: "Assigned",
//     })
//       .populate("orderId")
//       .sort({ createdAt: 1 });

//     let currentTasks = [];
//     let nextTasks = [];

//     const groupedTasks = {};

//     taskFound.forEach((task) => {
//       const orderId = task.orderId?._id;

//       // Initialize grouped task for the order if it doesn't exist
//       if (!groupedTasks[orderId]) {
//         groupedTasks[orderId] = {
//           orderId: orderId,
//           orderType: task?.orderId?.deliveryMode || null,
//           tasks: {
//             pickup: null,
//             delivery: null,
//           },
//         };
//       }

//       // Construct pickup task
//       const pickupTask = {
//         type: "Pickup",
//         taskId: task._id,
//         taskStatus: task.pickupDropDetails?.pickups?.[0].status,
//         date: formatDate(task?.orderId?.deliveryTime),
//         time: formatTime(task.createdAt),
//         address: {
//           fullName:
//             task?.pickupDropDetails?.[0]?.pickups?.[0].address.fullName || null,
//           flat: task?.pickupDropDetails?.pickups?.[0].address.flat || null,
//           area: task?.pickupDropDetails?.pickups?.[0].address.area || null,
//           phoneNumber:
//             task?.pickupDropDetails?.pickups?.[0].address.phoneNumber || null,
//           location: task.pickupDropDetails?.pikcups?.[0]?.location || null,
//         },
//         agentLocation: getUserLocationFromSocket(agentId),
//       };

//       // Construct delivery task
//       const deliveryTask = {
//         type: "Delivery",
//         taskId: task._id,
//         taskStatus: task.pickupDropDetails?.drops?.[0].status,
//         date: formatDate(task.createdAt),
//         time: formatTime(task?.orderId?.orderDetail?.deliveryTime),
//         name: task.pickupDropDetails?.drops?.[0]?.address.fullName,
//         address: {
//           fullName: task.pickupDropDetails?.drops?.[0]?.address.fullName,
//           flat: task?.deliveryDetail?.deliveryAddress?.flat,
//           area: task.pickupDropDetails?.drops?.[0]?.address.area,
//           phoneNumber: task.pickupDropDetails?.drops?.[0]?.address.phoneNumber,
//           location: task.pickupDropDetails?.drops?.[0]?.location || null,
//         },
//         agentLocation: getUserLocationFromSocket(agentId),
//       };

//       // Add tasks to grouped object based on type
//       groupedTasks[orderId].tasks.pickup = pickupTask;
//       groupedTasks[orderId].tasks.delivery = deliveryTask;
//     });

//     // Separate tasks into currentTasks and nextTasks
//     Object.values(groupedTasks).forEach((order) => {
//       currentTasks.push(order);
//     });

//     res.status(200).json({
//       message: "Task preview",
//       data: {
//         currentTasks,
//         nextTasks,
//       },
//     });
//   } catch (err) {
//     next(appError(err.message));
//   }
// };

// Get pickup details

// const getPickUpDetailController = async (req, res, next) => {
//   try {
//     const { taskId, stepIndex } = req.params;

//     const taskFound = await Task.findById(taskId).populate("orderId");
//     if (!taskFound) {
//       return next(appError("Task not found", 404));
//     }

//     let merchantFound;
//     if (taskFound?.orderId?.merchantId) {
//       merchantFound = await Merchant.findById(taskFound.orderId.merchantId); // Update here if needed
//     }

//     const formattedResponse = {
//       taskId: taskFound._id,
//       orderId: taskFound.orderId._id,
//       merchantId: merchantFound?._id || null,
//       merchantName: merchantFound?.merchantDetail?.merchantName || null,
//       customerId: taskFound?.orderId?.customerId || null,
//       customerName:
//         taskFound?.orderId?.orderDetail?.deliveryAddress?.fullName || null,
//       customerPhoneNumber:
//         taskFound?.orderId?.orderDetail?.deliveryAddress?.phoneNumber || null,
//       type: "Pickup",
//       date: formatDate(taskFound?.orderId?.createdAt) || null,
//       time: formatTime(taskFound?.orderId?.createdAt) || null,
//       taskStatus: taskFound.pickupDetail?.pickupStatus || null,
//       pickupName: taskFound?.pickupDetail?.pickupAddress?.fullName || null,
//       pickupAddress: taskFound?.pickupDetail?.pickupAddress?.area || null,
//       pickupPhoneNumber:
//         taskFound?.pickupDetail?.pickupAddress?.phoneNumber || null,
//       instructions:
//         taskFound?.orderId?.orderDetail?.instructionToMerchant ||
//         taskFound?.orderId?.orderDetail?.instructionInPickup ||
//         null,
//       voiceInstructions:
//         taskFound?.orderId?.orderDetail?.voiceInstructionToMerchant ||
//         taskFound?.orderId?.orderDetail?.voiceInstructionInPickup ||
//         taskFound?.orderId?.orderDetail?.voiceInstructionToDeliveryAgent ||
//         null,
//       pickupLocation: taskFound?.pickupDetail?.pickupLocation,
//       deliveryMode: taskFound?.orderId?.orderDetail?.deliveryMode || null,
//       orderItems: taskFound?.orderId?.items || [],
//       billDetail: taskFound?.orderId?.billDetail || {},
//       paymentMode: taskFound?.orderId?.paymentMode || null,
//       paymentStatus: taskFound?.orderId?.paymentStatus || null,
//     };

//     res.status(200).json({
//       message: "Pick up details.",
//       data: formattedResponse,
//     });
//   } catch (err) {
//     next(appError(err.message));
//   }
// };

const getPickUpDetailController = async (req, res, next) => {
  console.log("DATa", req.body);
  try {
    const { taskId, stepIndex } = req.params; // stepIndex from route param
    // If you prefer query: const { stepIndex } = req.query;
    const { batchOrderId, batchOrder } = req.body;

    if (batchOrder) {
      const batchOrderFound = await BatchOrder.findById(batchOrderId);
      const taskIds = batchOrderFound.dropDetails.map(
        (detail) => detail.taskId
      );
      const taskFound = await Task.find({
        _id: { $in: taskIds },
      }).populate("orderId");
      if (!taskFound) {
        return next(appError("Task not found", 404));
      }
      console.log("taskFound", taskFound);

      let merchantFound;
      if (taskFound[0]?.orderId?.merchantId) {
        merchantFound = await Merchant.findById(
          taskFound[0].orderId.merchantId
        );
      }
      console.log("merchantFound", merchantFound);
      console.log(
        "taskFound.pickupDropDetails",
        taskFound[0].pickupDropDetails[0]?.pickups
      );

      // ✅ Find the pickup matching the stepIndex
      const pickupDetail = taskFound[0].pickupDropDetails[0]?.pickups?.find(
        (p) => p.stepIndex === parseInt(0)
      );

      if (!pickupDetail) {
        return next(
          appError("Pickup detail not found for this stepIndex", 404)
        );
      }

      const formattedResponse = {
        taskId: taskFound[0]._id,
        orderId: taskFound[0].orderId?._id || taskFound.orderId, // handle string ID
        merchantId: merchantFound?._id || null,
        merchantName: merchantFound?.merchantDetail?.merchantName || null,
        customerId: taskFound[0]?.orderId?.customerId || null,
        customerName:
          taskFound[0]?.orderId?.orderDetail?.deliveryAddress?.fullName || null,
        customerPhoneNumber:
          taskFound[0]?.orderId?.orderDetail?.deliveryAddress?.phoneNumber ||
          null,
        type: "Pickup",
        date: formatDate(taskFound[0]?.orderId?.createdAt) || null,
        time: formatTime(taskFound[0]?.orderId?.createdAt) || null,
        taskStatus: pickupDetail?.status || null,
        pickupName: pickupDetail?.address?.fullName || null,
        items: pickupDetail?.items || [],
        pickupAddress: pickupDetail?.address?.area || null,
        pickupPhoneNumber: pickupDetail?.address?.phoneNumber || null,
        instructions:
          taskFound[0]?.orderId?.orderDetail?.instructionToMerchant ||
          taskFound[0]?.orderId?.orderDetail?.instructionInPickup ||
          null,
        voiceInstructions:
          taskFound?.orderId?.orderDetail?.voiceInstructionToMerchant ||
          taskFound?.orderId?.orderDetail?.voiceInstructionInPickup ||
          taskFound?.orderId?.orderDetail?.voiceInstructionToDeliveryAgent ||
          null,
        pickupLocation: pickupDetail?.location || null,
        deliveryMode: taskFound[0]?.deliveryMode || null,
        orderItems: taskFound.flatMap(
          (task) => task?.orderId?.purchasedItems || []
        ),
        billDetail: taskFound?.orderId?.billDetail || {},
        paymentMode: taskFound[0]?.orderId?.paymentMode || null,
        paymentStatus: taskFound[0]?.orderId?.paymentStatus || null,
      };

      res.status(200).json({
        message: "Pickup detail fetched successfully.",
        data: formattedResponse,
      });
    } else {
      const taskFound = await Task.findById(taskId).populate("orderId");
      if (!taskFound) {
        return next(appError("Task not found", 404));
      }

      let merchantFound;
      if (taskFound?.orderId?.merchantId) {
        merchantFound = await Merchant.findById(taskFound.orderId.merchantId);
      }

      // ✅ Find the pickup matching the stepIndex
      const pickupDetail = taskFound.pickupDropDetails?.[0]?.pickups?.find(
        (p) => p.stepIndex === parseInt(stepIndex)
      );

      if (!pickupDetail) {
        return next(
          appError("Pickup detail not found for this stepIndex", 404)
        );
      }

      const formattedResponse = {
        taskId: taskFound._id,
        orderId: taskFound.orderId?._id || taskFound.orderId, // handle string ID
        merchantId: merchantFound?._id || null,
        merchantName: merchantFound?.merchantDetail?.merchantName || null,
        customerId: taskFound?.orderId?.customerId || null,
        customerName:
          taskFound?.orderId?.orderDetail?.deliveryAddress?.fullName || null,
        customerPhoneNumber:
          taskFound?.orderId?.orderDetail?.deliveryAddress?.phoneNumber || null,
        type: "Pickup",
        date: formatDate(taskFound?.orderId?.createdAt) || null,
        time: formatTime(taskFound?.orderId?.createdAt) || null,
        taskStatus: pickupDetail?.status || null,
        pickupName: pickupDetail?.address?.fullName || null,
        items: pickupDetail?.items || [],
        pickupAddress: pickupDetail?.address?.area || null,
        pickupPhoneNumber: pickupDetail?.address?.phoneNumber || null,
        instructions:
          taskFound?.orderId?.orderDetail?.instructionToMerchant ||
          taskFound?.orderId?.orderDetail?.instructionInPickup ||
          null,
        voiceInstructions:
          taskFound?.orderId?.orderDetail?.voiceInstructionToMerchant ||
          taskFound?.orderId?.orderDetail?.voiceInstructionInPickup ||
          taskFound?.orderId?.orderDetail?.voiceInstructionToDeliveryAgent ||
          null,
        pickupLocation: pickupDetail?.location || null,
        deliveryMode: taskFound?.deliveryMode || null,
        orderItems: taskFound?.orderId?.purchasedItems || [],
        billDetail: taskFound?.orderId?.billDetail || {},
        paymentMode: taskFound?.orderId?.paymentMode || null,
        paymentStatus: taskFound?.orderId?.paymentStatus || null,
      };

      res.status(200).json({
        message: "Pickup detail fetched successfully.",
        data: formattedResponse,
      });
    }
  } catch (err) {
    next(appError(err.message));
  }
};

// Get delivery details
const getDeliveryDetailController = async (req, res, next) => {
  try {
    const { taskId, stepIndex } = req.params; // ✅ get stepIndex
    // If you prefer query: const { stepIndex } = req.query;

    const taskFound = await Task.findById(taskId).populate("orderId");
    if (!taskFound) {
      return next(appError("Task not found", 404));
    }

    // ✅ Find drop by stepIndex
    const deliveryDetail = taskFound.pickupDropDetails?.[0]?.drops?.find(
      (d) => d.stepIndex === parseInt(stepIndex)
    );

    if (!deliveryDetail) {
      return next(
        appError("Delivery detail not found for this stepIndex", 404)
      );
    }

    const formattedResponse = {
      taskId: taskFound._id,
      orderId: taskFound.orderId?._id || taskFound.orderId,
      messageReceiverId: taskFound?.orderId?.customerId || null,
      type: "Delivery",
      date: formatDate(taskFound.orderId.orderDetail?.deliveryTime),
      time: formatTime(taskFound.orderId.orderDetail?.deliveryTime),
      taskStatus: deliveryDetail?.status || null,
      customerName: deliveryDetail?.address?.fullName || null,
      deliveryAddress: deliveryDetail?.address || null,
      customerPhoneNumber: deliveryDetail?.address?.phoneNumber || null,
      instructions:
        taskFound?.orderId?.orderDetail?.instructionInDelivery ||
        taskFound?.orderId?.orderDetail?.instructionToDeliveryAgent ||
        null,
      voiceInstructions:
        taskFound?.orderId?.orderDetail?.voiceInstructionInDelivery ||
        taskFound?.orderId?.orderDetail?.voiceInstructionToDeliveryAgent ||
        null,
      deliveryLocation: deliveryDetail?.location || null,
      deliveryMode: taskFound?.deliveryMode || null,
      orderItems: taskFound?.orderId?.purchasedItems || [],
      billDetail: taskFound?.orderId?.billDetail || {},
      paymentMode: taskFound?.orderId?.paymentMode || null,
      paymentStatus: taskFound?.orderId?.paymentStatus || null,
      isnoteAdded: taskFound?.orderId?.detailAddedByAgent?.notes ? true : false,
      isSignatureAdded: taskFound?.orderId?.detailAddedByAgent
        ?.signatureImageURL
        ? true
        : false,
      isImageAdded: taskFound?.orderId?.detailAddedByAgent?.imageURL
        ? true
        : false,
    };

    res.status(200).json({
      message: "Delivery detail fetched successfully.",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Add item price in Custom order
const addCustomOrderItemPriceController = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;
    const { price } = req.body;
    const agentId = req.userAuth;

    // Validate price input
    const newPrice = parseFloat(price);
    if (isNaN(newPrice) || newPrice <= 0) {
      return next(
        appError("Invalid price. It must be a positive number.", 400)
      );
    }

    const orderFound = await Order.findById(orderId);
    if (!orderFound) return next(appError("Order not found", 404));

    if (orderFound.agentId.toString() !== agentId.toString()) {
      return next(appError("Agent access denied", 403));
    }

    const itemFound = orderFound.items.find(
      (item) => item.itemId.toString() === itemId.toString()
    );
    if (!itemFound) return next(appError("Item not found in order", 404));

    // Check if the new price is equal to the existing price
    const existingPrice = itemFound.price || 0;
    if (existingPrice === newPrice) {
      return res.status(200).json({
        message:
          "No changes made. The new price is the same as the existing price.",
        data: existingPrice,
      });
    }

    // Update the item's price
    itemFound.price = newPrice;

    // Adjust totals by subtracting the existing price and adding the new price
    const updatedItemTotal =
      orderFound.billDetail.itemTotal - existingPrice + newPrice;

    const deliveryCharge = orderFound.billDetail.deliveryCharge || 0;
    const surgePrice = orderFound.billDetail.surgePrice || 0;

    const updatedSubTotal = updatedItemTotal + deliveryCharge + surgePrice;

    // Grand total is recalculated based on adjusted totals
    const updatedGrandTotal = updatedSubTotal;

    // Update the order's billing details
    orderFound.billDetail.itemTotal = parseFloat(updatedItemTotal.toFixed(2));
    orderFound.billDetail.subTotal = parseFloat(updatedSubTotal.toFixed(2));
    orderFound.billDetail.grandTotal = parseFloat(updatedGrandTotal.toFixed(2));

    await orderFound.save();

    if (orderFound?.customerId) {
      const notificationData = {
        fcm: {
          title: "Custom order status update.",
          body: `The price of item ${itemFound?.itemName} is ${price}.`,
          sendToCustomer: true,
        },
      };

      const eventName = "";

      await sendNotification(
        orderFound?.customerId,
        eventName,
        notificationData
      );
    }

    res.status(200).json({
      message: "Item price updated successfully",
      data: newPrice,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Add details by agent
const addOrderDetailsController = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { notes } = req.body;

    const [orderFound, agentFound] = await Promise.all([
      Order.findById(orderId),
      Agent.findById(req.userAuth),
    ]);

    if (!orderFound) return next(appError("Order not found", 404));
    if (!agentFound) return next(appError("Agent not found", 404));

    const [signatureImageURL, imageURL] = await Promise.all([
      req.files?.signatureImage
        ? uploadToFirebase(req.files.signatureImage[0], "OrderDetailImages")
        : "",
      req.files?.image
        ? uploadToFirebase(req.files.image[0], "OrderDetailImages")
        : "",
    ]);

    // Update only the provided fields in detailAddedByAgent
    if (!orderFound.detailAddedByAgent) {
      orderFound.detailAddedByAgent = {};
    }

    if (notes) orderFound.detailAddedByAgent.notes = notes;
    if (signatureImageURL)
      orderFound.detailAddedByAgent.signatureImageURL = signatureImageURL;
    if (imageURL) orderFound.detailAddedByAgent.imageURL = imageURL;

    await orderFound.save();

    const stepperDetail = {
      by: agentFound.fullName,
      userId: agentFound._id,
      date: new Date(),
      detailURL: notes || signatureImageURL || imageURL,
    };

    // Send notification to Customer and Admin
    const data = {
      orderDetailStepper: stepperDetail,
    };

    const parameters = {
      eventName: "agentOrderDetailUpdated",
      user: "Customer",
      role: "Admin",
    };

    sendSocketData(
      orderFound.customerId,
      parameters.eventName,
      data,
      parameters.user
    );

    sendSocketData(
      process.env.ADMIN_ID,
      parameters.eventName,
      data,
      parameters.role
    );

    res.status(200).json({
      message: "Order details updated successfully",
      order: orderFound.detailAddedByAgent,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get checkout details
const getCheckoutDetailController = async (req, res, next) => {
  try {
    const { taskId } = req.params;

    const taskFound = await Task.findOne({
      _id: taskId,
      agentId: req.userAuth,
    }).populate("orderId");

    if (!taskFound) {
      return next(appError("Task not found", 404));
    }

    const formattedData = {
      orderId: taskFound.orderId,
      distance:
        taskFound?.orderId?.detailAddedByAgent?.distanceCoveredByAgent || 0,
      timeTaken: taskFound?.orderId?.orderDetail?.timeTaken
        ? formatToHours(taskFound.orderId.orderDetail.timeTaken)
        : "0 h 0 min",
      delayedBy: taskFound?.orderId?.orderDetail?.delayedBy
        ? formatToHours(taskFound.orderId.orderDetail.delayedBy)
        : "0 h 0 min",
      paymentType: taskFound.orderId.paymentMode,
      paymentStatus: taskFound.orderId.paymentStatus,
      grandTotal: taskFound?.orderId?.billDetail?.grandTotal || 0,
    };

    res.status(200).json({
      message: "Checkout detail",
      data: formattedData,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Confirm money received in cash on delivery
const confirmCashReceivedController = async (req, res, next) => {
  try {
    const { amount, orderId } = req.body;
    const agentId = req.userAuth;
    if (!amount && isNaN(amount))
      return next(appError("Amount must be a number"));

    const [agent, order] = await Promise.all([
      Agent.findById(agentId),
      Order.findById(orderId),
    ]);

    if (!agent) return next(appError("Agent not found", 404));
    if (!order) return next(appError("Order not found", 404));
    if (amount < order.billDetail.grandTotal)
      return next(appError("Enter the correct bill amount"));

    agent.workStructure.cashInHand += parseInt(amount);

    await agent.save();

    res.status(200).json({ message: "Order completed successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

// // Complete order after confirming the cash
// const completeOrderController = async (req, res, next) => {
//   try {
//     const { orderId } = req.body;
//     const agentId = req.userAuth;

//     console.log("orderId", orderId);

//     const [agentFound, orderFound] = await Promise.all([
//       Agent.findById(agentId),
//       Order.findById(orderId),
//     ]);

//     console.log("✅ Agent found:", agentFound?._id);
//     console.log("✅ Order found:", orderFound?._id);

//     if (!agentFound) return next(appError("Agent not found", 404));
//     if (!orderFound) return next(appError("Order not found", 404));

//     if (orderFound.status === "Completed")
//       return next(appError("Order already completed", 400));

//     const customerFound = await Customer.findById(orderFound.customerId);

//     if (!customerFound) return next(appError("Customer not found", 404));

//     const { itemTotal } = orderFound.billDetail;

//     // Calculate loyalty points for customer
//     const loyaltyPointCriteria = await LoyaltyPoint.findOne({ status: true });
//     if (
//       loyaltyPointCriteria &&
//       itemTotal >= loyaltyPointCriteria.minOrderAmountForEarning
//     ) {
//       updateLoyaltyPoints(
//         customerFound,
//         loyaltyPointCriteria,
//         orderFound.billDetail.grandTotal
//       );
//     }

//     // Calculate referral rewards for customer
//     if (!customerFound?.referralDetail?.processed) {
//       await processReferralRewards(customerFound, itemTotal);
//     }

//     // Calculate earnings for agent
//     const { calculatedSalary, calculatedSurge } = await calculateAgentEarnings(
//       agentFound,
//       orderFound
//     );

//     console.log("✅ Calculated Salary:", calculatedSalary);
//     console.log("✅ Calculated Surge:", calculatedSurge);

//     // Update order details
//     updateOrderDetails(orderFound, calculatedSalary);

//     const isOrderCompleted = true;

//     console.log("✅ Order details updated.");

//     await Promise.all([
//       updateCustomerSubscriptionCount(customerFound._id),
//       updateNotificationStatus(orderId),
//       updateAgentDetails(
//         agentFound,
//         orderFound,
//         calculatedSalary,
//         calculatedSurge,
//         isOrderCompleted
//       ),
//     ]);

//     console.log("✅ Order, Customer, and Agent details updated.");

//     const stepperDetail = {
//       by: agentFound.fullName,
//       date: new Date(),
//     };

//     console.log("✅ Stepper Detail:", stepperDetail);

//     orderFound.orderDetailStepper.completed = stepperDetail;
//     agentFound.taskCompleted += 1;
//     agentFound.markModified("appDetail");

//     await Promise.all([
//       orderFound.save(),
//       customerFound.save(),
//       agentFound.save(),
//       // Agent.findByIdAndUpdate(agentId, {
//       //   $inc: { taskCompleted: 1 },
//       // }),
//     ]);

//     const eventName = "orderCompleted";

//     const { rolesToNotify, data } = await findRolesToNotify(eventName);

//     let manager;
//     // Send notifications to each role dynamically
//     for (const role of rolesToNotify) {
//       let roleId;

//       if (role === "admin") {
//         roleId = process.env.ADMIN_ID;
//       } else if (role === "merchant") {
//         roleId = orderFound?.merchantId;
//       } else if (role === "driver") {
//         roleId = orderFound?.agentId;
//       } else if (role === "customer") {
//         roleId = orderFound?.customerId;
//       } else {
//         const roleValue = await ManagerRoles.findOne({ roleName: role });
//         if (roleValue) {
//           manager = await Manager.findOne({ role: roleValue._id });
//         } // Assuming `role` is the role field to match in Manager model
//         if (manager) {
//           roleId = manager._id; // Set roleId to the Manager's ID
//         }
//       }

//       if (roleId) {
//         const notificationData = {
//           fcm: {
//             orderId: orderFound._id,
//             customerId: customerFound._id,
//             merchantId: orderFound?.merchantId,
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

//     const socketData = {
//       ...data,
//       orderDetailStepper: stepperDetail,
//     };

//     sendSocketData(process.env.ADMIN_ID, eventName, socketData);
//     sendSocketData(orderFound.customerId, eventName, socketData);
//     if (orderFound?.merchantId) {
//       sendSocketData(orderFound.merchantId, eventName, socketData);
//     }
//     if (manager?._id) {
//       sendSocketData(manager._id, eventName, socketData);
//     }

//     res.status(200).json({
//       message: "Order completed successfully",
//       data: calculatedSalary,
//     });
//   } catch (err) {
//     next(appError(err.message));
//   }
// };

const completeOrderController = async (req, res, next) => {
  try {
    const { orderId, isBatchOrder, batchOrderId } = req.body;
    const agentId = req.userAuth;

    console.log("👉 Incoming request:", {
      orderId,
      agentId,
      isBatchOrder,
      batchOrderId,
    });

    const [agentFound, orderFound] = await Promise.all([
      Agent.findById(agentId),
      Order.findById(orderId),
      // BatchOrder.findById(batchOrderId),
    ]);

    if (isBatchOrder) {
      const [batchOrderFound] = await Promise.all([
        BatchOrder.findById(batchOrderId),
      ]);
    }

    console.log("✅ Agent found:", agentFound?._id);
    console.log("✅ Order found:", orderFound?._id);

    if (!agentFound) return next(appError("Agent not found", 404));
    if (!orderFound) return next(appError("Order not found", 404));

    if (orderFound.status === "Completed")
      return next(appError("Order already completed", 400));

    const customerFound = await Customer.findById(orderFound.customerId);
    if (!customerFound) return next(appError("Customer not found", 404));

    console.log("✅ Customer found:", customerFound._id);

    const { itemTotal } = orderFound.billDetail;

    // Loyalty points
    const loyaltyPointCriteria = await LoyaltyPoint.findOne({ status: true });
    if (
      loyaltyPointCriteria &&
      itemTotal >= loyaltyPointCriteria.minOrderAmountForEarning
    ) {
      console.log("📌 Updating loyalty points...");
      updateLoyaltyPoints(
        customerFound,
        loyaltyPointCriteria,
        orderFound.billDetail.grandTotal
      );
    }

    // Referral rewards
    if (!customerFound?.referralDetail?.processed) {
      console.log("📌 Processing referral rewards...");
      await processReferralRewards(customerFound, itemTotal);
    }

    // Agent earnings
    const { calculatedSalary, calculatedSurge } = await calculateAgentEarnings(
      agentFound,
      orderFound
    );

    console.log("✅ Calculated Salary:", calculatedSalary);
    console.log("✅ Calculated Surge:", calculatedSurge);

    // Update order
    updateOrderDetails(orderFound, calculatedSalary);
    console.log("✅ Order details updated.");

    const isOrderCompleted = true;

    // Update customer, notification, and agent
    const updates = [updateCustomerSubscriptionCount(customerFound._id)];

    // Only push notification update if it's a batch order
    if (!isBatchOrder) {
      updates.push(
        updateNotificationStatus(orderId),
        updateAgentDetails(
          agentFound,
          orderFound,
          calculatedSalary,
          calculatedSurge,
          isOrderCompleted
        )
      );
    }

    await Promise.all(updates);

    console.log("✅ Order, Customer, and Agent (in-memory) updated.");

    // Stepper detail
    const stepperDetail = { by: agentFound.fullName, date: new Date() };
    orderFound.orderDetailStepper.completed = stepperDetail;

    console.log("📌 Saving documents...");
    agentFound.taskCompleted += 1;
    agentFound.markModified("appDetail");

    console.log("👉 Agent before save:", agentFound.appDetail);

    await Promise.all([
      orderFound.save(),
      customerFound.save(),
      agentFound.save(),
    ]);

    console.log("✅ Agent after save check...");
    const verifyAgent = await Agent.findById(agentId);
    console.log("👉 Agent from DB after save:", verifyAgent.appDetail);

    // Notifications
    const eventName = "orderCompleted";
    const { rolesToNotify, data } = await findRolesToNotify(eventName);

    let manager;
    for (const role of rolesToNotify) {
      let roleId;
      if (role === "admin") roleId = process.env.ADMIN_ID;
      else if (role === "merchant") roleId = orderFound?.merchantId;
      else if (role === "driver") roleId = orderFound?.agentId;
      else if (role === "customer") roleId = orderFound?.customerId;
      else {
        const roleValue = await ManagerRoles.findOne({ roleName: role });
        if (roleValue) manager = await Manager.findOne({ role: roleValue._id });
        if (manager) roleId = manager._id;
      }

      if (roleId) {
        console.log(`📌 Sending notification to ${role}:`, roleId);
        await sendNotification(
          roleId,
          eventName,
          {
            fcm: {
              orderId: orderFound._id || batchOrderFound?._id,
              customerId: customerFound._id,
              merchantId: orderFound?.merchantId || batchOrderFound?.merchantId,
            },
          },
          role.charAt(0).toUpperCase() + role.slice(1)
        );
      }
    }

    const socketData = { ...data, orderDetailStepper: stepperDetail };
    sendSocketData(process.env.ADMIN_ID, eventName, socketData);
    sendSocketData(orderFound.customerId, eventName, socketData);
    if (orderFound?.merchantId)
      sendSocketData(orderFound.merchantId, eventName, socketData);
    if (manager?._id) sendSocketData(manager._id, eventName, socketData);

    res.status(200).json({
      message: "Order completed successfully",
      data: calculatedSalary,
    });
  } catch (err) {
    console.error("❌ Error in completeOrderController:", err);
    next(appError(err.message));
  }
};

const completeBatchOrderController = async (req, res, next) => {
  try {
    const { orderId, isBatchOrder, batchOrderId } = req.body;
    const agentId = req.userAuth;

    console.log("👉 Incoming request:", {
      orderId,
      agentId,
      isBatchOrder,
      batchOrderId,
    });

    const [agentFound, orderFound] = await Promise.all([
      Agent.findById(agentId),
      Order.findById(orderId),
      // BatchOrder.findById(batchOrderId),
    ]);

    const [batchOrderFound] = await Promise.all([
      BatchOrder.findById(batchOrderId),
    ]);

    // console.log("✅ Agent found:", agentFound?._id);
    // console.log("✅ Order found:", orderFound?._id);

    // if (!agentFound) return next(appError("Agent not found", 404));
    // if (!orderFound) return next(appError("Order not found", 404));

    // if (orderFound.status === "Completed")
    //   return next(appError("Order already completed", 400));

    // const customerFound = await Customer.findById(batchOrderFound.customerId);
    // if (!customerFound) return next(appError("Customer not found", 404));

    // console.log("✅ Customer found:", customerFound._id);

    // const { itemTotal } = orderFound.billDetail;

    // Loyalty points
    // const loyaltyPointCriteria = await LoyaltyPoint.findOne({ status: true });
    // if (
    //   loyaltyPointCriteria &&
    //   itemTotal >= loyaltyPointCriteria.minOrderAmountForEarning
    // ) {
    //   console.log("📌 Updating loyalty points...");
    //   updateLoyaltyPoints(
    //     customerFound,
    //     loyaltyPointCriteria,
    //     orderFound.billDetail.grandTotal
    //   );
    // }

    // Referral rewards
    // if (!customerFound?.referralDetail?.processed) {
    //   console.log("📌 Processing referral rewards...");
    //   await processReferralRewards(customerFound, itemTotal);
    // }

    // Agent earnings
    const { calculatedSalary, calculatedSurge } = await calculateAgentEarnings(
      agentFound,
      batchOrderFound
    );

    // console.log("✅ Calculated Salary:", calculatedSalary);
    // console.log("✅ Calculated Surge:", calculatedSurge);

    // // Update order
    // updateOrderDetails(orderFound, calculatedSalary);
    // console.log("✅ Order details updated.");

    const isOrderCompleted = true;

    // // Update customer, notification, and agent
    const updates = [];

    // Only push notification update if it's a batch order
    if (isBatchOrder) {
      // Fetch all child orders of this batch
      const batchOrders = await Order.find({
        _id: { $in: batchOrderFound.dropDetails.map((d) => d.orderId) },
      });

      console.log("📌 Updating batch order and agent details...", batchOrders);

      updates.push(
        updateAgentDetailsForBatch(
          agentFound,
          batchOrders,
          calculatedSalary,
          calculatedSurge
        ),
        updateNotificationStatus(orderId)
      );
    }

    await Promise.all(updates);

    // console.log("✅ Order, Customer, and Agent (in-memory) updated.");

    // // Stepper detail
    // const stepperDetail = { by: agentFound.fullName, date: new Date() };
    // orderFound.orderDetailStepper.completed = stepperDetail;

    // console.log("📌 Saving documents...");
    // agentFound.taskCompleted += 1;
    // agentFound.markModified("appDetail");

    // console.log("👉 Agent before save:", agentFound.appDetail);

    // await Promise.all([
    //   orderFound.save(),
    //   customerFound.save(),
    //   agentFound.save(),
    // ]);

    // console.log("✅ Agent after save check...");
    // const verifyAgent = await Agent.findById(agentId);
    // console.log("👉 Agent from DB after save:", verifyAgent.appDetail);

    // // Notifications
    // const eventName = "orderCompleted";
    // const { rolesToNotify, data } = await findRolesToNotify(eventName);

    // let manager;
    // for (const role of rolesToNotify) {
    //   let roleId;
    //   if (role === "admin") roleId = process.env.ADMIN_ID;
    //   else if (role === "merchant") roleId = orderFound?.merchantId;
    //   else if (role === "driver") roleId = orderFound?.agentId;
    //   else if (role === "customer") roleId = orderFound?.customerId;
    //   else {
    //     const roleValue = await ManagerRoles.findOne({ roleName: role });
    //     if (roleValue) manager = await Manager.findOne({ role: roleValue._id });
    //     if (manager) roleId = manager._id;
    //   }

    // }

    // const socketData = { ...data, orderDetailStepper: stepperDetail };
    // sendSocketData(process.env.ADMIN_ID, eventName, socketData);
    // sendSocketData(orderFound.customerId, eventName, socketData);
    // if (orderFound?.merchantId)
    //   sendSocketData(orderFound.merchantId, eventName, socketData);
    // if (manager?._id) sendSocketData(manager._id, eventName, socketData);

    res.status(200).json({
      message: "Order completed successfully",
      data: calculatedSalary,
    });
  } catch (err) {
    console.error("❌ Error in completeOrderController:", err);
    next(appError(err.message));
  }
};

// Add ratings to customer by the order
const addRatingsToCustomer = async (req, res, next) => {
  try {
    const { review, rating } = req.body;
    const { orderId } = req.params;
    const agentId = req.userAuth;

    const orderFound = await Order.findById(orderId);

    if (!orderFound) return next(appError("Order not found", 404));

    const customerFound = await Customer.findById(orderFound.customerId);

    if (!customerFound) return next(appError("Customer not found", 404));

    let updatedOrderRating = {
      review,
      rating,
    };

    // Initialize orderRating if it doesn't exist
    if (!orderFound.orderRating) {
      orderFound.orderRating = {};
    }

    orderFound.orderRating.ratingByDeliveryAgent = updatedOrderRating;

    let ratingsByAgent = {
      agentId,
      review,
      rating,
    };

    customerFound.customerDetails.ratingsByAgents.push(ratingsByAgent);

    await Promise.all([orderFound.save(), customerFound.save()]);

    res.status(200).json({ message: "Customer rated successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get cash in hand value
const getCashInHandController = async (req, res, next) => {
  try {
    const agentId = req.userAuth;

    const agentFound = await Agent.findById(agentId);

    if (!agentFound) {
      return next(appError("agent not found", 404));
    }

    const cashInHand = agentFound.workStructure.cashInHand;

    res.status(200).json({ message: "Cash in hand", data: cashInHand });
  } catch (err) {
    next(appError(err.message));
  }
};

// Initiate deposit by razorpay
const depositCashToFamtoController = async (req, res, next) => {
  try {
    const { amount } = req.body;

    const { success, orderId, error } = await createRazorpayOrderId(amount);

    if (!success) {
      return next(appError(`Error in creating Razorpay order: ${error}`, 500));
    }

    res.status(200).json({ success: true, orderId, amount });
  } catch (err) {
    next(appError(err.message));
  }
};

// Verify deposit by razorpay
const verifyDepositController = async (req, res, next) => {
  try {
    const { paymentDetails, amount } = req.body;
    const agentId = req.userAuth;

    const agentFound = await Agent.findById(agentId);

    if (!agentFound) {
      return next(appError("agent not found", 404));
    }

    const isPaymentValid = await verifyPayment(paymentDetails);
    if (!isPaymentValid) {
      return next(appError("Invalid payment", 400));
    }

    let transaction = {
      agentId,
      type: "Debit",
      amount,
      madeOn: new Date(),
      title: "Deposit to Famto",
    };

    agentFound.workStructure.cashInHand -= amount;

    await Promise.all([
      agentFound.save(),
      AgentTransaction.create(transaction),
    ]);

    res.status(200).json({ message: "Deposit verified successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get transaction history of agents
const getAgentTransactionsController = async (req, res, next) => {
  try {
    const agentId = req.userAuth;

    const transactions = await AgentTransaction.find({ agentId }).sort({
      madeOn: -1,
    });

    // Sort and format transactions
    const formattedTransactions = transactions?.map((transaction) => ({
      date: formatDate(transaction.madeOn),
      time: formatTime(transaction.madeOn),
      amount: transaction?.amount || null,
      type: transaction?.type || null,
      title: transaction?.title || null,
    }));

    res.status(200).json({
      message: "Agent transaction history",
      data: formattedTransactions,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get earing og agents for the last 7 days
const getAgentEarningsLast7DaysController = async (req, res, next) => {
  try {
    const agentId = req.userAuth;

    const agent = await Agent.findById(agentId);

    if (!agent) {
      return next(appError("Agent not found", 404));
    }

    // Get the current date and the date 7 days ago
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    // Filter the appDetailHistory for the last 7 days
    const earningsLast7Days = agent.appDetailHistory
      .filter((entry) => entry.date >= sevenDaysAgo && entry.date <= today)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((entry) => ({
        date: formatDate(entry.date),
        totalEarning: entry.details.totalEarning,
      }));

    res.status(200).json({
      message: "Earnings for the last 7 days",
      data: earningsLast7Days || [],
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Update shops by agent in custom Order
const updateCustomOrderStatusController = async (req, res, next) => {
  try {
    const { latitude, longitude, status, description } = req.body;
    const { orderId } = req.params;
    const agentId = req.userAuth;

    const orderFound = await Order.findOne({
      _id: orderId,
      "orderDetail.deliveryMode": "Custom Order",
    });

    if (!orderFound) return next(appError("Order not found", 404));

    if (orderFound.agentId !== agentId)
      return next(appError("Agent access denied (Different agent)"));

    const location = [latitude, longitude];

    // Determine last location and calculate distance
    const shopUpdates = orderFound.detailAddedByAgent?.shopUpdates || [];
    const lastLocation =
      shopUpdates.length > 0
        ? shopUpdates[shopUpdates.length - 1]?.location
        : null;

    if (!lastLocation || lastLocation?.length !== 2) {
      return next(appError("Error in retrieving last shop location", 400));
    }

    // if (
    //   shopUpdates?.length !== 1 &&
    //   orderFound?.orderDetail?.pickupLocation?.length === 2
    // ) {
    const { distanceInKM } = await getDistanceFromPickupToDelivery(
      lastLocation,
      location
    );

    // Update order details
    const newDistance = distanceInKM || 0;
    const oldDistanceCoveredByAgent =
      orderFound?.detailAddedByAgent?.distanceCoveredByAgent || 0;

    orderFound.orderDetail.distance =
      (orderFound.orderDetail?.distance || 0) + newDistance;
    orderFound.detailAddedByAgent.distanceCoveredByAgent =
      oldDistanceCoveredByAgent + newDistance;
    // }

    // Initialize pickup location if not set
    if (!orderFound.orderDetail.pickupLocation && shopUpdates.length === 0) {
      orderFound.orderDetail.pickupLocation = location;
    }

    // Add shop update
    const updatedData = { location, status, description };
    orderFound.detailAddedByAgent.shopUpdates.push(updatedData);

    await orderFound.save();

    if (orderFound?.customerId) {
      const notificationData = {
        fcm: {
          title: "Custom order status update.",
          body: description,
          sendToCustomer: true,
        },
      };

      const eventName = "";

      await sendNotification(
        orderFound?.customerId,
        eventName,
        notificationData
      );
    }

    res.status(200).json({
      message: "Shop updated successfully in custom order",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get agent earning for the delivery
const getCompleteOrderMessageController = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const orderFound = await Order.findById(orderId);

    res.status(200).json({
      message: "Order amount",
      data: orderFound?.detailAddedByAgent?.agentEarning || 0,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Generate QR Code for customer payment
const generateRazorpayQRController = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    if (!orderId) return next(appError("Order ID is required", 400));

    const orderFound = await Order.findById(orderId);

    if (!orderFound) return next(appError("Order not found", 404));

    const amount = orderFound.billDetail.grandTotal;

    const qrCode = await createRazorpayQrCode(amount);

    res.status(200).json({ message: "QR code", data: qrCode });
  } catch (err) {
    console.error("Error generating QR code:", JSON.stringify(err, null, 2));
    next(appError(err.message || "An error occurred", 500));
  }
};

// Verify QR Code payment
const verifyQrPaymentController = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    const orderFound = await Order.findById(orderId);

    if (!orderFound) return next(appError("Order not found", 404));

    if (orderFound.paymentStatus === "Completed") {
      return res.status(200).json({ message: "Payment already processed" });
    }

    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

    const receivedSignature = req.headers["x-razorpay-signature"];

    const generatedSignature = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (receivedSignature === generatedSignature) {
      const paymentData = req.body.payload.payment.entity;

      orderFound.paymentStatus = "Completed";
      orderFound.paymentId = paymentData.id;

      await orderFound.save();

      return res.status(200).json({ message: "QR Code payment verified" });
    } else {
      return res.status(400).json({
        message: "QR Code payment verification  failed",
      });
    }
  } catch (err) {
    next(appError(err.message));
  }
};

// Check payment status of an order
const checkPaymentStatusOfOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const orderFound = await Order.findById(orderId);

    if (!orderFound) return next(appError("Order not found", 400));

    if (orderFound?.paymentStatus === "Completed") {
      return res.status(200).json({ status: true });
    }

    res.status(200).json({ status: false });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get all notifications for agent
const getAllNotificationsController = async (req, res, next) => {
  try {
    const agentId = req.userAuth;

    // Current date in IST
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // 5h30m in ms

    // Convert current UTC time to IST
    const nowIST = new Date(now.getTime() + istOffset);

    // Start of day in IST (00:00)
    const startOfDayIST = new Date(
      nowIST.getFullYear(),
      nowIST.getMonth(),
      nowIST.getDate(),
      0,
      0,
      0,
      0
    );

    // End of day in IST (23:59:59.999)
    const endOfDayIST = new Date(
      nowIST.getFullYear(),
      nowIST.getMonth(),
      nowIST.getDate(),
      23,
      59,
      59,
      999
    );

    // Convert back to UTC (Mongo stores in UTC)
    const startOfDayUTC = new Date(startOfDayIST.getTime() - istOffset);
    const endOfDayUTC = new Date(endOfDayIST.getTime() - istOffset);

    console.log("startOfDay (IST)", startOfDayIST);
    console.log("endOfDay (IST)", endOfDayIST);
    console.log("startOfDay (UTC)", startOfDayUTC);
    console.log("endOfDay (UTC)", endOfDayUTC);

    // // Set start and end of the day correctly
    // const startOfDay = new Date();
    // startOfDay.setDate(startOfDay.getDate() - 1);
    // startOfDay.setUTCHours(18, 30, 0, 0);
    // const endOfDay = new Date();
    // endOfDay.setUTCHours(18, 29, 59, 999);
    // console.log("startOfDay", startOfDay);
    // console.log("endOfDay", endOfDay);
    // Retrieve notifications within the day for the given agent, sorted by date
    const notifications = await AgentNotificationLogs.find({
      agentId,
      createdAt: { $gte: startOfDayUTC, $lte: endOfDayUTC },
    })
      // .populate("orderDetail")
      .sort({ createdAt: -1 })
      .lean();

    console.log("notifications", notifications);

    //   const notifications = await AgentNotificationLogs.find({
    //   agentId,
    //   createdAt: { $gte: startOfDay, $lte: endOfDay },
    // })
    //   .populate("orderId", "orderDetail")
    //   .sort({ createdAt: -1 })
    //   .lean();

    // Format response
    const formattedResponse = notifications.map((notification) => ({
      notificationId: notification?._id || null,
      // orderId: notification?.orderId || null,
      orderId: notification?.orderId, //?.map((o) => o._id || o),
      pickupDetail: notification?.pickupDetail?.address || null,
      // deliveryDetail: notification?.deliveryDetail?.address || null,
      deliveryDetail: Array.isArray(notification?.deliveryDetail)
        ? notification.deliveryDetail.map((d) => d.address || null)
        : [],
      orderType: notification?.orderType || null,
      status: notification?.status || null,
      taskDate: formatDate(notification?.orderId?.orderDetail?.deliveryTime),
      taskTime: formatTime(notification?.orderId?.orderDetail?.deliveryTime),
      isBatchOrder: notification.isBatchOrder || false,
    }));

    res.status(200).json({
      message: "All notification logs",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getAllAgentTaskController = async (req, res, next) => {
  try {
    const agentId = req.userAuth;

    // Set start and end of the day correctly
    const startOfDay = new Date();
    startOfDay.setDate(startOfDay.getDate() - 1);
    startOfDay.setUTCHours(18, 30, 0, 0);
    const endOfDay = new Date();
    endOfDay.setUTCHours(18, 29, 59, 999);
    const autoAllocation = await AutoAllocation.findOne();

    // Retrieve notifications within the day for the given agent, sorted by date
    const notifications = await AgentNotificationLogs.find({
      agentId,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      status: "Pending",
    })
      // .populate("orderId", "orderDetail")
      .populate("orderId", "_id pickups drops deliveryMode deliveryTime")
      .sort({ createdAt: -1 })
      .lean();

    // Format response
    const formattedResponse = notifications.map((notification) => {
      const order = notification?.orderId;

      const pickupAddress = order?.pickups?.[0]?.address || null;
      const deliveryAddress = order?.drops?.[0]?.address || null;
      return {
        orderId: order || null,
        merchantName: pickupAddress?.fullName || null,
        pickAddress: pickupAddress?.fullAddress || null,
        customerName: deliveryAddress?.fullName || null,
        customerAddress: deliveryAddress?.fullAddress || null,
        agentId: agentId,
        orderType: order?.deliveryMode || null,
        taskDate: formatDate(order?.deliveryTime),
        taskTime: formatTime(order?.deliveryTime),
        timer: autoAllocation?.expireTime || null,
        createdAt: notification?.createdAt,
      };
    });

    res.status(200).json({
      message: "All task logs",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get all announcements for agent
const getAllAnnouncementsController = async (req, res, next) => {
  try {
    const agentId = req.userAuth;

    const getAllAnnouncements = await AgentAnnouncementLogs.find({
      agentId,
    }).sort({
      createdAt: -1,
    });

    const formattedResponse = getAllAnnouncements?.map((announcement) => {
      const createdAt = new Date(announcement?.createdAt);
      const currentTime = new Date();
      const timeDifference = Math.abs(currentTime - createdAt);

      // Convert the time difference to a readable format (e.g., in minutes, hours, days)
      const minutes = Math.floor(timeDifference / (1000 * 60));
      const hours = Math.floor(timeDifference / (1000 * 60 * 60));
      const days = Math.floor(timeDifference / (1000 * 60 * 60 * 24));

      let timeString;
      if (days > 0) {
        timeString = `${days} day${days > 1 ? "s" : ""} ago`;
      } else if (hours > 0) {
        timeString = `${hours} hour${hours > 1 ? "s" : ""} ago`;
      } else if (minutes > 0) {
        timeString = `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
      } else {
        timeString = `just now`;
      }

      return {
        announcementId: announcement._id || null,
        imageUrl: announcement?.imageUrl || null,
        title: announcement?.title || null,
        description: announcement?.description || null,
        time: timeString,
      };
    });

    res.status(200).json({
      message: "All announcements logs",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get pocket balance (un-settled balance)
const getPocketBalanceForAgent = async (req, res, next) => {
  try {
    // Find the agent by ID
    const agent = await Agent.findById(req.userAuth);

    // Check if the agent exists
    if (!agent) return next(appError("Agent not found", 404));

    // Calculate total earnings where paymentSettled is false
    let totalEarnings = 0;

    const unsettledEarnings = agent.appDetailHistory.filter(
      (detail) => detail.details.paymentSettled === false
    );

    unsettledEarnings.forEach((detail) => {
      totalEarnings += detail.details.totalEarning || 0;
    });

    return res.status(200).json({
      success: true,
      totalEarnings,
    });
  } catch (error) {
    next(appError(err.message));
  }
};

const getTimeSlotsForAgent = async (req, res, next) => {
  try {
    const [customization, agent] = await Promise.all([
      AgentAppCustomization.findOne({}),
      Agent.findById(req.userAuth),
    ]);

    if (!customization) return next(appError("Customization not found", 404));
    if (!agent) return next(appError("Agent not found", 404));

    const selectedTimeSlotIds =
      agent.workStructure?.workTimings?.map((id) => id.toString()) || [];

    const timings = customization?.workingTime?.map((time) => ({
      id: time._id,
      time: `${time.startTime} - ${time.endTime}`,
      selected: selectedTimeSlotIds.includes(time._id.toString()),
    }));

    res.status(200).json(timings);
  } catch (err) {
    next(appError(err.message));
  }
};

const chooseTimeSlot = async (req, res, next) => {
  try {
    const { timeSlotId } = req.body;

    if (!Array.isArray(timeSlotId) || timeSlotId.length === 0) {
      return next(appError("At-least one slot is required", 400));
    }

    const customization = await AgentAppCustomization.findOne({});
    if (!customization) {
      return next(appError("Customization settings not found", 404));
    }

    const agent = await Agent.findById(req.userAuth);
    if (!agent) return next(appError("Agent not found", 404));

    const workTimeIds =
      customization.workingTime?.map((t) => t._id.toString()) || [];

    const allValid = timeSlotId.every((id) => workTimeIds.includes(id));

    if (!allValid) {
      return next(appError("One or more time slots are invalid", 400));
    }

    agent.workStructure.workTimings = timeSlotId;

    await agent.save();

    res.status(200).json({
      success: true,
      message: "Timing added successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  updateLocationController,
  registerAgentController,
  agentLoginController,
  deleteAgentProfileController,
  getAppDrawerDetailsController,
  getAgentProfileDetailsController,
  editAgentProfileController,
  updateAgentBankDetailController,
  getBankDetailController,
  addVehicleDetailsController,
  addGovernmentCertificatesController,
  toggleOnlineController,
  getAllVehicleDetailsController,
  getSingleVehicleDetailController,
  editAgentVehicleController,
  deleteAgentVehicleController,
  changeVehicleStatusController,
  rateCustomerController,
  getCurrentDayAppDetailController,
  getHistoryOfAppDetailsController,
  getRatingsOfAgentController,
  getTaskPreviewController,
  getPickUpDetailController,
  getDeliveryDetailController,
  addCustomOrderItemPriceController,
  addOrderDetailsController,
  confirmCashReceivedController,
  completeOrderController,
  completeBatchOrderController,
  addRatingsToCustomer,
  getCashInHandController,
  depositCashToFamtoController,
  verifyDepositController,
  getAgentTransactionsController,
  getAgentEarningsLast7DaysController,
  updateCustomOrderStatusController,
  getCheckoutDetailController,
  getCompleteOrderMessageController,
  generateRazorpayQRController,
  verifyQrPaymentController,
  checkPaymentStatusOfOrder,
  getAllNotificationsController,
  getAllAnnouncementsController,
  getPocketBalanceForAgent,
  getTimeSlotsForAgent,
  chooseTimeSlot,
  getAllAgentTaskController,
};
