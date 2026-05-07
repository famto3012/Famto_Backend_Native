const CustomerAppCustomization = require("../../../models/CustomerAppCustomization");

const appError = require("../../../utils/appError");
const {
  deleteFromFirebase,
  uploadToFirebase,
} = require("../../../utils/imageOperation");

const getCustomerCustomizationController = async (req, res, next) => {
  try {
    const customization = await CustomerAppCustomization.findOne({}).lean();

    const formattedResponse = {
      splashScreenUrl: customization?.splashScreenUrl || null,
      phoneNumber: customization?.phoneNumber || false,
      emailVerification: customization?.emailVerification || false,
      email: customization?.email || false,
      otpVerification: customization?.otpVerification || false,
      loginViaOtp: customization?.loginViaOtp || false,
      loginViaGoogle: customization?.loginViaGoogle || false,
      loginViaApple: customization?.loginViaApple || false,
      loginViaFacebook: customization?.loginViaFacebook || false,
      customOrderCustomization: {
        startTime: customization?.customOrderCustomization?.startTime || null,
        endTime: customization?.customOrderCustomization?.endTime || null,
        taxId: customization?.customOrderCustomization?.taxId || null,
      },
      pickAndDropOrderCustomization: {
        startTime:
          customization?.pickAndDropOrderCustomization?.startTime || null,
        endTime: customization?.pickAndDropOrderCustomization?.endTime || null,
        taxId: customization?.pickAndDropOrderCustomization?.taxId || null,
      },
      takeAwayOrderCustomization: {
        taxId: customization?.takeAwayOrderCustomization?.taxId || null,
      },
      appUpdateType: customization.appUpdateType,
      statusImageUrl: customization?.statusImageUrl,
      status: customization?.status,
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const getTimingsForCustomerApp = async (req, res, next) => {
  try {
    const customization = await CustomerAppCustomization.findOne({})
      .select("customOrderCustomization pickAndDropOrderCustomization")
      .lean();

    const formattedResponse = {
      customOrderTimings: {
        startTime: customization.customOrderCustomization.startTime,
        endTime: customization.customOrderCustomization.endTime,
      },
      pickAndDropOrderTimings: {
        startTime: customization.pickAndDropOrderCustomization.startTime,
        endTime: customization.pickAndDropOrderCustomization.endTime,
      },
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const createOrUpdateCustomerCustomizationController = async (
  req,
  res,
  next
) => {
  try {
    const {
      email,
      phoneNumber,
      emailVerification,
      otpVerification,
      loginViaOtp,
      loginViaGoogle,
      loginViaApple,
      loginViaFacebook,
      customOrderCustomization,
      pickAndDropOrderCustomization,
      takeAwayOrderCustomization,
      appUpdateType,
      status,
    } = req.body;

    let customization = await CustomerAppCustomization.findOne({});

    let splashScreenUrl = customization?.splashScreenUrl || "";
    let statusImageUrl = customization?.statusImageUrl || "";

    // ✅ Upload splash screen image
    if (req.files?.splashScreenImage?.[0]) {
      if (customization?.splashScreenUrl) {
        await deleteFromFirebase(customization.splashScreenUrl);
      }

      splashScreenUrl = await uploadToFirebase(
        req.files.splashScreenImage[0],
        "CustomerAppSplashScreenImages"
      );
    }

    // ✅ Upload status image
    if (req.files?.statusImage?.[0]) {
      if (customization?.statusImageUrl) {
        await deleteFromFirebase(customization.statusImageUrl);
      }

      statusImageUrl = await uploadToFirebase(
        req.files.statusImage[0],
        "CustomerAppStatusImages"
      );
    }

    const payload = {
      email,
      phoneNumber,
      emailVerification,
      otpVerification,
      loginViaOtp,
      loginViaGoogle,
      loginViaApple,
      loginViaFacebook,
      splashScreenUrl,

      // ✅ New fields
      status,
      statusImageUrl,

      customOrderCustomization: {
        startTime: customOrderCustomization?.startTime,
        endTime: customOrderCustomization?.endTime,
        taxId: customOrderCustomization?.taxId || null,
      },

      pickAndDropOrderCustomization: {
        startTime: pickAndDropOrderCustomization?.startTime,
        endTime: pickAndDropOrderCustomization?.endTime,
        taxId: pickAndDropOrderCustomization?.taxId || null,
      },

      takeAwayOrderCustomization: {
        taxId: takeAwayOrderCustomization?.taxId || null,
      },

      appUpdateType,
    };

    // ✅ Update
    if (customization) {
      customization = await CustomerAppCustomization.findByIdAndUpdate(
        customization._id,
        {
          $set: payload,
        },
        { new: true }
      );
    } else {
      // ✅ Create
      customization = await CustomerAppCustomization.create(payload);
    }

    return res.status(200).json({
      message: "Customer App Customization updated successfully",
      data: customization,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getCustomerAppAppUpdateType = async (req, res, next) => {
  try {
    const customization = await CustomerAppCustomization.findOne({})
      .select("appUpdateType")
      .lean();

    res.status(200).json({
      success: true,
      appUpdateType: customization.appUpdateType,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getCustomerAppStatus = async (req, res, next) => {
  try {
    const customization = await CustomerAppCustomization.findOne({})
    res.status(200).json({
      success: true,
      status: customization.status,
      statusImageUrl: customization.statusImageUrl,
    });

  } catch (err) {
    next(appError(err.message));
  }
}

module.exports = {
  createOrUpdateCustomerCustomizationController,
  getCustomerCustomizationController,
  getTimingsForCustomerApp,
  getCustomerAppAppUpdateType,
  getCustomerAppStatus,
};
