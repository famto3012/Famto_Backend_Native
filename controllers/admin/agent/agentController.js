const { createTransport } = require("nodemailer");
const mongoose = require("mongoose");
const csvWriter = require("csv-writer").createObjectCsvWriter;
const fs = require("fs");
const path = require("path");
const { validationResult } = require("express-validator");
const moment = require("moment-timezone");

const appError = require("../../../utils/appError");
const {
  uploadToFirebase,
  deleteFromFirebase,
} = require("../../../utils/imageOperation");

const Agent = require("../../../models/Agent");
const AccountLogs = require("../../../models/AccountLogs");
const { formatDate, formatTime } = require("../../../utils/formatters");
const { formatToHours } = require("../../../utils/agentAppHelpers");
const ejs = require("ejs");
const AgentAppCustomization = require("../../../models/AgentAppCustomization");
const { sendSocketData } = require("../../../socket/socket");
const AgentActivityLog = require("../../../models/AgentActivityLog");
const AgentWorkHistory = require("../../../models/AgentWorkHistory");
const AgentTransaction = require("../../../models/AgentTransaction");
const AgentPricing = require("../../../models/AgentPricing");

const addAgentByAdminController = async (req, res, next) => {
  const {
    fullName,
    phoneNumber,
    email,
    managerId,
    salaryStructureId,
    geofenceId,
    tag,
    aadharNumber,
    drivingLicenseNumber,
    model,
    type,
    licensePlate,
    accountHolderName,
    accountNumber,
    IFSCCode,
    UPIId,
    workTimings,
  } = req.body;

  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(500).json({ errors: formattedErrors });
  }

  try {
    let rcFrontImageURL = "";
    let rcBackImageURL = "";
    let aadharFrontImageURL = "";
    let aadharBackImageURL = "";
    let drivingLicenseFrontImageURL = "";
    let drivingLicenseBackImageURL = "";
    let agentImageURL = "";

    if (req.files) {
      const {
        rcFrontImage,
        rcBackImage,
        aadharFrontImage,
        aadharBackImage,
        drivingLicenseFrontImage,
        drivingLicenseBackImage,
        agentImage,
      } = req.files;

      if (rcFrontImage) {
        rcFrontImageURL = await uploadToFirebase(rcFrontImage[0], "RCImages");
      }
      if (rcBackImage) {
        rcBackImageURL = await uploadToFirebase(rcBackImage[0], "RCImages");
      }
      if (aadharFrontImage) {
        aadharFrontImageURL = await uploadToFirebase(
          aadharFrontImage[0],
          "AadharImages"
        );
      }
      if (aadharBackImage) {
        aadharBackImageURL = await uploadToFirebase(
          aadharBackImage[0],
          "AadharImages"
        );
      }
      if (drivingLicenseFrontImage) {
        drivingLicenseFrontImageURL = await uploadToFirebase(
          drivingLicenseFrontImage[0],
          "DrivingLicenseImages"
        );
      }
      if (drivingLicenseBackImage) {
        drivingLicenseBackImageURL = await uploadToFirebase(
          drivingLicenseBackImage[0],
          "DrivingLicenseImages"
        );
      }
      if (agentImage) {
        agentImageURL = await uploadToFirebase(agentImage[0], "AgentImages");
      }
    }

    const formattedTimings = workTimings ? workTimings.split(",") : [];

    const newAgent = await Agent.create({
      fullName,
      phoneNumber,
      email,
      geofenceId,
      agentImageURL,
      workStructure: {
        managerId: managerId || null,
        workTimings: formattedTimings,
        salaryStructureId,
        tag,
      },
      bankDetail: {
        accountHolderName,
        accountNumber,
        IFSCCode,
        UPIId,
      },
      governmentCertificateDetail: {
        aadharNumber,
        aadharFrontImageURL,
        aadharBackImageURL,
        drivingLicenseNumber,
        drivingLicenseFrontImageURL,
        drivingLicenseBackImageURL,
      },
      vehicleDetail: {
        model,
        type,
        licensePlate,
        rcFrontImageURL,
        rcBackImageURL,
      },
    });

    if (!newAgent) {
      return next(appError("Error in adding new agent"));
    }

    res.status(200).json({
      message: "Add agent by admin",
      data: newAgent,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const editAgentByAdminController = async (req, res, next) => {
  const {
    fullName,
    email,
    phoneNumber,
    geofenceId,
    governmentCertificateDetail,
    bankDetail,
    workStructure,
  } = req.body;

  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(500).json({ errors: formattedErrors });
  }

  try {
    const agentFound = await Agent.findById(req.params.agentId);

    if (!agentFound) return next(appError("Agent not found", 404));

    let {
      aadharFrontImageURL = agentFound?.governmentCertificateDetail
        ?.aadharFrontImageURL,
      aadharBackImageURL = agentFound?.governmentCertificateDetail
        ?.aadharBackImageURL,
      drivingLicenseFrontImageURL = agentFound?.governmentCertificateDetail
        ?.drivingLicenseFrontImageURL,
      drivingLicenseBackImageURL = agentFound?.governmentCertificateDetail
        ?.drivingLicenseBackImageURL,
      agentImageURL = agentFound?.agentImageURL,
    } = {};

    if (req.files) {
      const {
        aadharFrontImage,
        aadharBackImage,
        drivingLicenseFrontImage,
        drivingLicenseBackImage,
        agentImage,
      } = req.files;

      const fileOperations = [
        {
          file: aadharFrontImage,
          url: aadharFrontImageURL,
          type: "AadharImages",
          setUrl: (url) => (aadharFrontImageURL = url),
        },
        {
          file: aadharBackImage,
          url: aadharBackImageURL,
          type: "AadharImages",
          setUrl: (url) => (aadharBackImageURL = url),
        },
        {
          file: drivingLicenseFrontImage,
          url: drivingLicenseFrontImageURL,
          type: "DrivingLicenseImages",
          setUrl: (url) => (drivingLicenseFrontImageURL = url),
        },
        {
          file: drivingLicenseBackImage,
          url: drivingLicenseBackImageURL,
          type: "DrivingLicenseImages",
          setUrl: (url) => (drivingLicenseBackImageURL = url),
        },
        {
          file: agentImage,
          url: agentImageURL,
          type: "AgentImages",
          setUrl: (url) => (agentImageURL = url),
        },
      ];

      for (const { file, url, type, setUrl } of fileOperations) {
        if (file) {
          if (url) {
            await deleteFromFirebase(url);
          }
          setUrl(await uploadToFirebase(file[0], type));
        }
      }
    }

    const workTimings = req.body.workStructure.workTimings
      ? req.body.workStructure.workTimings.split(",")
      : [];

    const updatedAgent = await Agent.findByIdAndUpdate(
      req.params.agentId,
      {
        fullName,
        phoneNumber,
        email,
        geofenceId: geofenceId._id,
        agentImageURL,
        workStructure: {
          ...workStructure,
          workTimings,
          managerId:
            workStructure?.managerId === "null" || !workStructure?.managerId
              ? null
              : mongoose.Types.ObjectId.createFromHexString(
                  workStructure?.managerId
                ),
        },
        bankDetail: { ...bankDetail },
        governmentCertificateDetail: {
          ...governmentCertificateDetail,
          aadharFrontImageURL,
          aadharBackImageURL,
          drivingLicenseFrontImageURL,
          drivingLicenseBackImageURL,
        },
      },
      { new: true }
    );

    if (!updatedAgent) return next(appError("Error in editing agent"));

    res.status(200).json(updatedAgent);
  } catch (err) {
    next(appError(err.message));
  }
};

const fetchSingleAgentController = async (req, res, next) => {
  try {
    const { agentId } = req.params;

    const [agent, activityLog] = await Promise.all([
      Agent.findById(agentId)
        .populate("geofenceId", "name")
        .populate("workStructure.managerId", "name")
        .populate("workStructure.salaryStructureId", "ruleName")
        .select(
          "-ratingsByCustomers -appDetail -appDetailHistory -agentTransaction -location -role -taskCompleted -reasonForBlockingOrDeleting -blockedDate -loginStartTime -loginEndTime"
        )
        .lean(),
      AgentActivityLog.find({ agentId }).sort({ madeOn: -1 }).limit(20),
    ]);

    if (!agent) return next(appError("Agent not found", 404));

    const formattedResponse = {
      agentId: agent._id,
      fullName: agent.fullName,
      phoneNumber: agent.phoneNumber,
      email: agent.email,
      registrationStatus: agent.isApproved,
      agentImage: agent.agentImageURL,
      isBlocked: agent.isBlocked,
      status: agent.status === "Inactive" ? false : true,
      approvalStatus: agent.isApproved,
      geofenceId: agent?.geofenceId?._id || null,
      geofence: agent?.geofenceId?.name || null,
      vehicleDetail: agent?.vehicleDetail?.map((data) => ({
        vehicleId: data?._id || null,
        model: data?.model || null,
        type: data?.type || null,
        licensePlate: data?.licensePlate || null,
        rcFrontImage: data?.rcFrontImageURL || null,
        rcBackImage: data?.rcBackImageURL || null,
      })),
      governmentCertificateDetail: {
        aadharNumber: agent?.governmentCertificateDetail?.aadharNumber || null,
        aadharFrontImage:
          agent?.governmentCertificateDetail?.aadharFrontImageURL || null,
        aadharBackImage:
          agent?.governmentCertificateDetail?.aadharBackImageURL || null,
        drivingLicenseNumber:
          agent?.governmentCertificateDetail?.drivingLicenseNumber || null,
        drivingLicenseFrontImage:
          agent?.governmentCertificateDetail?.drivingLicenseFrontImageURL ||
          null,
        drivingLicenseBackImage:
          agent?.governmentCertificateDetail?.drivingLicenseBackImageURL ||
          null,
      },
      bankDetail: agent?.bankDetail,
      workStructure: {
        managerId: agent?.workStructure?.managerId?._id || null,
        manager: agent?.workStructure?.managerId?.name || null,
        salaryStructureId: agent?.workStructure?.salaryStructureId?._id || null,
        salaryStructure:
          agent?.workStructure?.salaryStructureId?.ruleName || null,
        workTimings: agent?.workStructure?.workTimings,
        tag: agent?.workStructure?.tag || null,
      },
      activityLog: activityLog?.map((log) => ({
        date: formatDate(log.date),
        time: formatTime(log.date),
        description: log.description,
      })),
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const changeAgentStatusController = async (req, res, next) => {
  try {
    const { agentId } = req.params;

    const agentFound = await Agent.findById(agentId);

    if (!agentFound) {
      return next(appError("Agent not found", 404));
    }

    if (agentFound.isApproved === "Pending") {
      res.status(400).json({
        message: "Agent is not approved",
      });
      return;
    }

    if (agentFound.status === "Busy") {
      res.status(400).json({
        message: "Agent can't go offline during an ongoing delivery",
      });
      return;
    }

    let description = "";

    const eventName = "updatedAgentStatusToggle";

    if (agentFound.status === "Free") {
      agentFound.status = "Inactive";
      const data = { status: "Offline" };

      // Set the end time when the agent goes offline
      agentFound.loginEndTime = new Date();

      if (agentFound.loginStartTime) {
        const loginDuration = new Date() - new Date(agentFound.loginStartTime); // in milliseconds
        agentFound.appDetail.loginDuration += loginDuration;
      }

      description = "Agent status changed to OFFLINE from panel";

      agentFound.loginStartTime = null;

      sendSocketData(agentFound._id, eventName, data);
    } else {
      const agentWorkTimings = agentFound.workStructure.workTimings || [];
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
          message: `Agent can go online during their working time only!`,
        });

        return;
      }

      agentFound.status = "Free";

      const data = { status: "Online" };

      description = "Agent status changed to ONLINE from panel";

      // Set the start time when the agent goes online
      agentFound.loginStartTime = new Date();

      sendSocketData(agentFound._id, eventName, data);
    }

    await Promise.all([
      agentFound.save(),
      AgentActivityLog.create({
        agentId,
        date: new Date(),
        description,
      }),
    ]);

    let status;
    if (agentFound.status === "Free") {
      status = true;
    } else {
      status = false;
    }

    res.status(200).json({
      message: "Agent status changed",
      data: status,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const approveAgentRegistrationController = async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.agentId);

    if (!agent) {
      return next(appError("Agent not found", 404));
    }

    const errors = [];

    if (!agent.workStructure.salaryStructureId) {
      errors.push("Please add a salary structure");
    }

    if (!agent.workStructure.tag) {
      errors.push("Please add a tag");
    }

    if (agent.workStructure.workTimings.length === 0) {
      errors.push("Please add a work timing");
    }

    if (errors.length > 0) {
      return res.status(400).json(errors);
    }

    agent.isApproved = "Approved";

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

    await agent.save();

    res.status(200).json({
      message: "Agent registration approved",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const rejectAgentRegistrationController = async (req, res, next) => {
  try {
    const agentFound = await Agent.findById(req.params.agentId);

    if (!agentFound) {
      return next(appError("Agent not found", 404));
    }

    // Send email with message
    const rejectionTemplatePath = path.join(
      __dirname,
      "../../../templates/rejectionTemplate.ejs"
    );

    const htmlContent = await ejs.renderFile(rejectionTemplatePath, {
      recipientName: agentFound.fullName,
      app: "agent",
      email: "hr@famto.in",
    });

    // Set up nodemailer transport
    const transporter = createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    await transporter.sendMail({
      to: agentFound.email,
      subject: "Registration rejection",
      html: htmlContent,
    });

    await Agent.findByIdAndDelete(req.params.agentId);

    res.status(200).json({
      message: "Agent registration rejected",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getRatingsByCustomerController = async (req, res, next) => {
  try {
    const agentFound = await Agent.findById(req.params.agentId).populate({
      path: "ratingsByCustomers",
      populate: {
        path: "customerId",
        model: "Customer",
        select: "fullName _id",
      },
    });

    if (!agentFound) {
      return next(appError("Agent not found", 404));
    }

    const ratings = agentFound.ratingsByCustomers.map((rating) => ({
      review: rating?.review,
      rating: rating?.rating,
      customerId: {
        id: rating?.customerId?._id,
        fullName: rating?.customerId?.fullName,
      },
    }));

    res.status(200).json({
      message: "Ratings of agent by customer",
      data: ratings,
    });
  } catch (err) {
    next(err.message);
  }
};

const filterAgentsController = async (req, res, next) => {
  try {
    const { vehicleType, geofence, status, name } = req.query;

    const filterCriteria = { isBlocked: false };

    if (status && status.trim().toLowerCase() !== "all") {
      filterCriteria.status = status;
    }

    if (vehicleType && vehicleType.trim().toLowerCase() !== "all") {
      filterCriteria["vehicleDetail.type"] = {
        $regex: vehicleType.trim(),
        $options: "i",
      };
    }

    if (geofence && geofence.trim().toLowerCase() !== "all") {
      filterCriteria.geofenceId = mongoose.Types.ObjectId.createFromHexString(
        geofence.trim()
      );
    }

    if (name) {
      filterCriteria.fullName = { $regex: name.trim(), $options: "i" };
    }

    const results = await Agent.find(
      filterCriteria,
      "_id fullName email phoneNumber workStructure geofenceId status isApproved"
    )
      .populate("workStructure.managerId", "name")
      .populate("geofenceId", "name")
      .sort({
        isApproved: -1,
      });

    const formattedResponse = results.map((agent) => {
      return {
        _id: agent._id,
        fullName: agent.fullName,
        email: agent.email,
        phoneNumber: agent.phoneNumber,
        manager: agent?.workStructure?.managerId?.name || "-",
        geofence: agent?.geofenceId?.name || "-",
        status: agent.status === "Inactive" ? false : true,
        isApproved: agent.isApproved,
      };
    });

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const blockAgentController = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const { agentId } = req.params;

    const agent = await Agent.findById(agentId);

    if (!agent) return next(appError("Agent not found", 404));

    const currentTime = new Date();
    const loginStart = new Date(agent?.loginStartTime || currentTime);

    const oldLoginDuration = agent.appDetail.toObject().loginDuration ?? 0;

    const appDetail = {
      ...agent.appDetail.toObject(),
      loginDuration: oldLoginDuration + (currentTime - loginStart),
    };

    // Apply earnings logic only if agent has orders and salary structure
    if (appDetail.orders > 0 && agent?.workStructure?.salaryStructureId) {
      const agentPricing = await AgentPricing.findById(
        agent.workStructure.salaryStructureId
      ).lean();

      if (agentPricing) {
        const loginDurationHours = appDetail.loginDuration / 3600000;
        appDetail.totalEarning = 0;

        if (agentPricing.type?.startsWith("Monthly")) {
          const minHours = agentPricing.minLoginHours || 0;
          const baseFare = agentPricing.baseFare || 0;
          const perHour = baseFare / minHours;

          const billableHours = Math.min(minHours, loginDurationHours);
          appDetail.totalEarning = Math.round(perHour * billableHours);
        } else {
          const minLoginMillis =
            (agentPricing.minLoginHours || 0) * 60 * 60 * 1000;
          const minOrders = agentPricing.minOrderNumber || 0;

          const qualifies =
            appDetail.loginDuration >= minLoginMillis &&
            appDetail.orders >= minOrders;

          if (qualifies) {
            const baseFare = agentPricing.baseFare || 0;
            const extraOrders = appDetail.orders - minOrders;
            const extraOrderEarnings =
              (extraOrders > 0 ? extraOrders : 0) *
              (agentPricing.fareAfterMinOrderNumber || 0);

            const extraMillis = appDetail.loginDuration - minLoginMillis;
            const extraHours =
              extraMillis > 0 ? Math.floor(extraMillis / 3600000) : 0;
            const extraHourEarnings =
              extraHours * (agentPricing.fareAfterMinLoginHours || 0);

            appDetail.totalEarning =
              baseFare + extraOrderEarnings + extraHourEarnings;
          }
        }
      }
    }

    // Update agent status
    agent.isBlocked = true;
    agent.status = "Inactive";
    agent.reasonForBlockingOrDeleting = reason;
    agent.blockedDate = currentTime;
    agent.loginStartTime = null;
    agent.loginEndTime = null;

    const workHistoryData = { ...appDetail };

    console.log({ workHistoryData });

    agent.appDetail = {
      totalEarning: 0,
      orders: 0,
      pendingOrders: 0,
      totalDistance: 0,
      cancelledOrders: 0,
      loginDuration: 0,
      orderDetail: [],
    };

    await Promise.all([
      agent.save(),
      AccountLogs.create({
        userId: agentId,
        fullName: agent.fullName,
        role: agent.role,
        description: reason,
      }),
      AgentWorkHistory.create({
        ...workHistoryData,
        agentId,
        workDate: currentTime,
      }),
    ]);

    res.status(200).json({ message: "Agent blocked successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

const filterAgentPayoutController = async (req, res, next) => {
  try {
    let {
      status,
      agent,
      geofence,
      date,
      name,
      page = 1,
      limit = 50,
    } = req.query;

    const skip = (page - 1) * limit;

    const filterCriteria = { isApproved: "Approved" };

    if (agent && agent.toLowerCase() !== "all") filterCriteria._id = agent;

    if (geofence && geofence.toLowerCase() !== "all") {
      filterCriteria.geofenceId =
        mongoose.Types.ObjectId.createFromHexString(geofence);
    }

    if (name) {
      filterCriteria.fullName = { $regex: name.trim(), $options: "i" };
    }

    const matchedAgents = await Agent.find(filterCriteria).select(
      "_id fullName phoneNumber workStructure.cashInHand"
    );

    const agentIds = matchedAgents.map((a) => a._id);

    // Step 3: Create date filter (if date provided)
    const dateFilter = {};
    if (date) {
      const formattedDay = moment.tz(date, "Asia/Kolkata");

      // Start and end of the previous day in IST
      const startDate = formattedDay.startOf("day").toDate();
      const endDate = formattedDay.endOf("day").toDate();

      dateFilter.workDate = { $gte: startDate, $lte: endDate };
    }

    const historyFilter = {
      agentId: { $in: agentIds },
      ...dateFilter,
    };

    if (status !== undefined) {
      historyFilter.paymentSettled = status === "true";
    }

    const [histories, totalCount] = await Promise.all([
      AgentWorkHistory.find(historyFilter)
        .populate(
          "agentId",
          "fullName email phoneNumber workStructure.cashInHand"
        )
        .sort({ workDate: -1 })
        .skip(skip)
        .limit(limit),
      AgentWorkHistory.countDocuments(historyFilter),
    ]);

    const formattedResponse = histories?.map((history) => {
      const calculatedEarning = (
        history.totalEarning - history?.agentId?.workStructure?.cashInHand || 0
      ).toFixed(2);

      return {
        detailId: history._id,
        agentId: history.agentId._id,
        agentName: history.agentId.fullName,
        phoneNumber: history.agentId.phoneNumber,
        cashInHand:
          history?.agentId?.workStructure?.cashInHand?.toFixed(2) || 0,
        calculatedEarning,
        workDate: formatDate(history.workDate),
        totalEarning: history.totalEarning?.toFixed(2),
        orders: history.orders,
        pendingOrders: history.pendingOrders,
        totalDistance: history.totalDistance?.toFixed(2),
        cancelledOrders: history.cancelledOrders,
        loginHours: formatToHours(history.loginDuration),
        paymentSettled: history.paymentSettled,
      };
    });

    res.status(200).json({
      totalDocuments: totalCount,
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const approvePaymentController = async (req, res, next) => {
  try {
    const { agentId, detailId } = req.params;

    const [paymentDetail, agent] = await Promise.all([
      AgentWorkHistory.findOne({ _id: detailId, agentId }),
      Agent.findById(agentId).select("workStructure.cashInHand"),
    ]);

    if (!paymentDetail) {
      return next(appError("Payment document not found", 404));
    }

    if (!agent) {
      return next(appError("Agent not found", 404));
    }

    if (!agent.workStructure) {
      return next(appError("Agent's work structure not found", 404));
    }

    if (paymentDetail.paymentSettled) {
      return next(appError("Payment already settled", 400));
    }

    const { totalEarning } = paymentDetail;
    const cashInHand = agent.workStructure.cashInHand || 0;

    let debitAmount = 0;
    let calculatedBalance = 0;
    const transactionUpdates = [];

    // Calculate deductions from cash in hand
    if (cashInHand > 0) {
      debitAmount = Math.min(cashInHand, totalEarning);
      calculatedBalance = cashInHand - debitAmount;

      transactionUpdates.push(
        {
          agentId,
          type: "Credit",
          title: "Salary credited",
          madeOn: new Date(),
          amount: totalEarning,
        },
        {
          agentId,
          type: "Debit",
          title: "Cash in hand deducted",
          madeOn: new Date(),
          amount: debitAmount,
        }
      );
    } else {
      transactionUpdates.push({
        agentId,
        type: "Credit",
        title: "Salary credited",
        madeOn: new Date(),
        amount: totalEarning,
      });
    }

    // Update fields
    paymentDetail.paymentSettled = true;
    agent.workStructure.cashInHand = calculatedBalance;
    agent.markModified("workStructure");

    // Commit all changes
    await Promise.all([
      paymentDetail.save(),
      agent.save(),
      AgentTransaction.insertMany(transactionUpdates),
    ]);

    res.status(200).json({
      message: "Payment approved",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const downloadAgentCSVController = async (req, res, next) => {
  try {
    const { geofence, status, vehicleType, name } = req.query;

    // Build query object based on filters
    const filter = { isApproved: "Approved" };
    if (geofence && geofence !== "All") filter.geofenceId = geofence?.trim();
    if (status && status !== "All") filter.status = status?.trim();
    if (name) {
      filter.$or = [{ fullName: { $regex: name.trim(), $options: "i" } }];
    }
    if (vehicleType) {
      filter["vehicleDetail.type"] = {
        $regex: vehicleType?.trim(),
        $options: "i",
      };
    }

    // Fetch the data based on filter (get both approved and pending agents)
    let allAgents = await Agent.find(filter)
      .populate("geofenceId", "name")
      .populate("workStructure.managerId", "name")
      .populate("workStructure.salaryStructureId", "ruleName")
      .sort({ createdAt: -1 })
      .exec();

    let formattedResponse = [];

    // Collect all agents in one array
    allAgents?.forEach((agent) => {
      agent?.vehicleDetail?.forEach((vehicle) => {
        formattedResponse.push({
          agentId: agent?._id || "-",
          agentName: agent?.fullName || "-",
          agentEmail: agent?.email || "-",
          agentPhoneNumber: agent?.phoneNumber || "-",
          geofence: agent?.geofenceId?.name || "-",
          registrationStatus: agent?.isApproved || "-", // Keep both "Approved" and "Pending"
          aadharNumber: agent?.governmentCertificateDetail?.aadharNumber || "-",
          drivingLicenseNumber:
            agent?.governmentCertificateDetail?.drivingLicenseNumber || "-",
          accountHolderName: agent?.bankDetail?.accountHolderName || "-",
          accountNumber: agent?.bankDetail?.accountNumber || "-",
          IFSCCode: agent?.bankDetail?.IFSCCode || "-",
          UPIId: agent?.bankDetail?.UPIId || "-",
          manager: agent?.workStructure?.managerId?.name || "-",
          salaryStructure:
            agent?.workStructure?.salaryStructureId?.ruleName || "-",
          tag: agent?.workStructure?.tag || "-",
          cashInHand: agent?.workStructure?.cashInHand || "-",
          vehicleModel: vehicle?.model || "-",
          vehicleStatus: vehicle?.vehicleStatus ? "True" : "False",
          vehicleType: vehicle?.type || "-",
          licensePlate: vehicle?.licensePlate || "-",
        });
      });
    });

    const filePath = path.join(__dirname, "../../../Agent.csv");

    const csvHeaders = [
      { id: "agentId", title: "Agent ID" },
      { id: "agentName", title: "Agent name" },
      { id: "agentEmail", title: "Email" },
      { id: "agentPhoneNumber", title: "Phone number" },
      { id: "geofence", title: "Geofence" },
      { id: "registrationStatus", title: "Registration status" }, // Both "Approved" and "Pending"
      { id: "aadharNumber", title: "Aadhar number" },
      { id: "drivingLicenseNumber", title: "Driving license number" },
      { id: "accountHolderName", title: "Account holder name" },
      { id: "accountNumber", title: "Account number" },
      { id: "IFSCCode", title: "IFSC code" },
      { id: "UPIId", title: "UPI ID" },
      { id: "manager", title: "Manager" },
      { id: "salaryStructure", title: "Salary structure" },
      { id: "tag", title: "Tag" },
      { id: "cashInHand", title: "Cash in hand" },
      { id: "vehicleModel", title: "Vehicle model" },
      { id: "vehicleStatus", title: "Vehicle status" },
      { id: "vehicleType", title: "Vehicle type" },
      { id: "licensePlate", title: "License plate" },
    ];

    const writer = csvWriter({
      path: filePath,
      header: csvHeaders,
    });

    await writer.writeRecords(formattedResponse);

    res.status(200).download(filePath, "Agent_Data.csv", (err) => {
      if (err) {
        next(err);
      } else {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Error deleting file:", unlinkErr);
          }
        });
      }
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const downloadAgentPayoutCSVController = async (req, res, next) => {
  try {
    const { status, agent, geofence, date, name } = req.query;

    const filterCriteria = { isApproved: "Approved" };

    if (agent && agent.toLowerCase() !== "all") {
      filterCriteria._id = agent;
    }

    if (geofence && geofence.toLowerCase() !== "all") {
      filterCriteria.geofenceId = mongoose.Types.ObjectId(geofence);
    }

    if (name) {
      filterCriteria.fullName = { $regex: name.trim(), $options: "i" };
    }

    // Fetch agents with geofence details
    const matchedAgents = await Agent.find(filterCriteria)
      .populate("geofenceId", "name")
      .select(
        "_id fullName phoneNumber workStructure.cashInHand geofenceId bankDetail"
      );

    const agentIds = matchedAgents.map((a) => a._id);

    // Step 3: Create date filter (if date provided)
    const dateFilter = {};
    if (date) {
      const previousDay = moment.tz(date, "Asia/Kolkata");

      // Start and end of the previous day in IST
      const startDate = previousDay.startOf("day").toDate();
      const endDate = previousDay.endOf("day").toDate();

      dateFilter.workDate = { $gte: startDate, $lte: endDate };
    }

    const historyFilter = {
      agentId: { $in: agentIds },
      ...dateFilter,
    };

    if (status !== undefined) {
      historyFilter.paymentSettled = status === "true";
    }

    const histories = await AgentWorkHistory.find(historyFilter)
      .populate(
        "agentId",
        "fullName email phoneNumber workStructure.cashInHand geofenceId"
      )
      .sort({ workDate: -1 });

    const formattedResponse = histories.map((history) => {
      const agentData = matchedAgents.find(
        (agent) => String(agent._id) === String(history.agentId._id)
      );

      const calculatedEarning = (
        history.totalEarning - (agentData?.workStructure?.cashInHand || 0)
      ).toFixed(2);

      return {
        detailId: history._id,
        agentId: history.agentId._id,
        agentName: history.agentId.fullName,
        phoneNumber: history.agentId.phoneNumber,
        cashInHand: agentData?.workStructure?.cashInHand?.toFixed(2) || "0.00",
        calculatedEarning,
        workDate: formatDate(history.workDate),
        totalEarning: history.totalEarning?.toFixed(2),
        orders: history.orders,
        pendingOrders: history.pendingOrders,
        totalDistance: history.totalDistance?.toFixed(2),
        cancelledOrders: history.cancelledOrders,
        loginHours: formatToHours(history.loginDuration),
        paymentSettled: history.paymentSettled,
        accountHolderName: agentData?.bankDetail?.accountHolderName || "",
        accountNumber: agentData?.bankDetail?.accountNumber || "",
        IFSCCode: agentData?.bankDetail?.IFSCCode || "",
        UPIId: agentData?.bankDetail?.UPIId || "",
        geofenceName: agentData?.geofenceId?.name || "N/A",
      };
    });

    const filePath = path.join(__dirname, "../../../Agent_Payments.csv");
    const csvHeaders = [
      { id: "agentId", title: "Agent ID" },
      { id: "agentName", title: "Full Name" },
      { id: "phoneNumber", title: "Phone Number" },
      { id: "workDate", title: "Worked Date" },
      { id: "orders", title: "Orders" },
      { id: "cancelledOrders", title: "Cancelled Orders" },
      { id: "totalDistance", title: "Total Distance" },
      { id: "loginHours", title: "Login Hours" },
      { id: "cashInHand", title: "Cash In Hand" },
      { id: "totalEarning", title: "Total Earnings" },
      { id: "calculatedEarning", title: "Adjusted Payment" },
      { id: "paymentSettled", title: "Payment Settled" },
      { id: "accountHolderName", title: "Account Holder Name" },
      { id: "accountNumber", title: "Account Number" },
      { id: "IFSCCode", title: "IFSC Code" },
      { id: "UPIId", title: "UPI Id" },
      { id: "geofenceName", title: "Geofence Name" },
    ];

    const writer = csvWriter({
      path: filePath,
      header: csvHeaders,
    });

    await writer.writeRecords(formattedResponse);

    res.status(200).download(filePath, "Agent_Payments.csv", (err) => {
      if (err) {
        next(err);
      } else {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Error deleting file:", unlinkErr);
          }
        });
      }
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const updateVehicleDetailController = async (req, res, next) => {
  try {
    const { agentId, vehicleId } = req.params;
    const { licensePlate, model, type } = req.body;

    const agent = await Agent.findById(agentId).select("vehicleDetail");

    if (!agent) return next(appError("Agent not found", 404));

    let vehicleFound = agent.vehicleDetail?.find(
      (vehicle) => vehicle._id.toString() === vehicleId
    );

    if (!vehicleFound) return next(appError("Vehicle not found", 404));

    let { rcFrontImageURL, rcBackImageURL } = vehicleFound;

    const rcFrontImage = req.files.rcFrontImage?.[0];
    const rcBackImage = req.files.rcBackImage?.[0];

    if (rcFrontImage) {
      if (rcFrontImageURL) await deleteFromFirebase(rcFrontImageURL);
      rcFrontImageURL = await uploadToFirebase(rcFrontImage, "RCImages");
    }

    if (rcBackImage) {
      if (rcBackImageURL) await deleteFromFirebase(rcBackImageURL);
      rcBackImageURL = await uploadToFirebase(rcBackImage, "RCImages");
    }

    vehicleFound.licensePlate = licensePlate;
    vehicleFound.model = model;
    vehicleFound.type = type;
    vehicleFound.rcFrontImageURL = rcFrontImageURL;
    vehicleFound.rcBackImageURL = rcBackImageURL;

    await agent.save();

    res.status(200).json({
      success: true,
      message: "Vehicle detail updated successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  addAgentByAdminController,
  fetchSingleAgentController,
  editAgentByAdminController,
  approveAgentRegistrationController,
  rejectAgentRegistrationController,
  getRatingsByCustomerController,
  filterAgentsController,
  blockAgentController,
  filterAgentPayoutController,
  approvePaymentController,
  changeAgentStatusController,
  downloadAgentCSVController,
  downloadAgentPayoutCSVController,
  updateVehicleDetailController,
};
