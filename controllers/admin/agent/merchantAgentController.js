const mongoose = require("mongoose");

const appError = require("../../../utils/appError");
const {
  uploadToFirebase,
  deleteFromFirebase,
} = require("../../../utils/imageOperation");

const Agent = require("../../../models/Agent");
const Merchant = require("../../../models/Merchant");

const filterMerchantAgentsController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;

    const { vehicleType, geofence, status, name } = req.query;

    const filterCriteria = { merchantId, isBlocked: false };

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
      filterCriteria.$or = [
        {
          fullName: {
            $regex: name.trim(),
            $options: "i",
          },
        },
        {
          phoneNumber: {
            $regex: name.trim(),
            $options: "i",
          },
        },
      ];
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

const fetchSingleMerchantAgentController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { agentId } = req.params;

    const agent = await Agent.findOne({ _id: agentId, merchantId }).populate(
      "geofenceId",
      "name"
    );

    if (!agent) return next(appError("Agent not found", 404));

    const formattedResponse = {
      agentId: agent._id,
      fullName: agent.fullName,
      phoneNumber: agent.phoneNumber,
      email: agent.email,
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
        managerId: agent?.workStructure?.managerId || null,
        salaryStructureId: agent?.workStructure?.salaryStructureId || null,
        workTimings: agent?.workStructure?.workTimings,
        tag: agent?.workStructure?.tag || "Normal",
      },
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const addMerchantAgentController = async (req, res, next) => {
  const merchantId = req.merchantId;

  try {
    const merchant = await Merchant.findById(merchantId).select(
      "merchantDetail.geofenceId"
    );

    if (!merchant) return next(appError("Merchant not found", 404));

    const merchantGeofenceId = merchant?.merchantDetail?.geofenceId;

    if (!merchantGeofenceId) {
      return next(
        appError(
          "Set your service area (geofence) before adding a delivery agent",
          400
        )
      );
    }

    const {
      fullName,
      phoneNumber,
      email,
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

    const salaryStructureId = req.body.salaryStructureId || null;
    const tag = req.body.tag || "Normal";

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
      merchantId,
      fullName,
      phoneNumber,
      email,
      geofenceId: merchantGeofenceId,
      agentImageURL,
      isApproved: "Approved",
      workStructure: {
        managerId: null,
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
      message: "Add agent by merchant",
      data: newAgent,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const editMerchantAgentController = async (req, res, next) => {
  const merchantId = req.merchantId;

  try {
    const { agentId } = req.params;

    const agentFound = await Agent.findOne({ _id: agentId, merchantId });

    if (!agentFound) return next(appError("Agent not found", 404));

    const {
      fullName,
      email,
      phoneNumber,
      governmentCertificateDetail,
      bankDetail,
      workStructure,
    } = req.body;

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

    const workTimings = workStructure?.workTimings
      ? workStructure.workTimings.split(",")
      : agentFound?.workStructure?.workTimings || [];

    const updatedAgent = await Agent.findByIdAndUpdate(
      agentId,
      {
        fullName,
        phoneNumber,
        email,
        agentImageURL,
        workStructure: {
          ...(workStructure || {}),
          workTimings,
          managerId: null,
          salaryStructureId:
            workStructure?.salaryStructureId ||
            agentFound?.workStructure?.salaryStructureId ||
            null,
          tag: workStructure?.tag || agentFound?.workStructure?.tag || "Normal",
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

const changeMerchantAgentStatusController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { agentId } = req.params;

    const agentFound = await Agent.findOne({ _id: agentId, merchantId });

    if (!agentFound) {
      return next(appError("Agent not found", 404));
    }

    if (agentFound.isApproved === "Pending") {
      return res.status(400).json({
        message: "Agent is not approved",
      });
    }

    if (agentFound.status === "Busy") {
      return res.status(400).json({
        message: "Agent can't go offline during an ongoing delivery",
      });
    }

    let description = "";

    if (agentFound.status === "Free") {
      agentFound.status = "Inactive";
      description = "Agent status changed to OFFLINE from merchant panel";

      agentFound.loginEndTime = new Date();

      if (agentFound.loginStartTime) {
        const loginDuration = new Date() - new Date(agentFound.loginStartTime);
        agentFound.appDetail.loginDuration += loginDuration;
      }

      agentFound.loginStartTime = null;
    } else {
      agentFound.status = "Free";
      description = "Agent status changed to ONLINE from merchant panel";

      agentFound.loginStartTime = new Date();
    }

    await agentFound.save();

    res.status(200).json({
      message: "Agent status changed",
      data: agentFound.status !== "Inactive",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const blockMerchantAgentController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { reason } = req.body;
    const { agentId } = req.params;

    const agent = await Agent.findOne({ _id: agentId, merchantId });

    if (!agent) return next(appError("Agent not found", 404));

    const currentTime = new Date();

    agent.isBlocked = true;
    agent.status = "Inactive";
    agent.reasonForBlockingOrDeleting = reason || null;
    agent.blockedDate = currentTime;
    agent.loginStartTime = null;
    agent.loginEndTime = null;

    await agent.save();

    res.status(200).json({ message: "Agent blocked successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  filterMerchantAgentsController,
  fetchSingleMerchantAgentController,
  addMerchantAgentController,
  editMerchantAgentController,
  changeMerchantAgentStatusController,
  blockMerchantAgentController,
};
