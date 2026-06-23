const OfferPopup = require("../../../models/OfferPopup");
const appError = require("../../../utils/appError");
const {
  deleteFromFirebase,
  uploadToFirebase,
} = require("../../../utils/imageOperation");

const getOfferPopupController = async (req, res, next) => {
  try {
    const offerPopup = await OfferPopup.findOne({}).lean();

    res.status(200).json({
      status: offerPopup?.status ?? false,
      imageUrl: offerPopup?.imageUrl ?? "",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const updateOfferPopupController = async (req, res, next) => {
  try {
    const { status } = req.body;

    let offerPopup = await OfferPopup.findOne({});

    let imageUrl = offerPopup?.imageUrl || "";

    if (req.file) {
      if (offerPopup?.imageUrl) {
        await deleteFromFirebase(offerPopup.imageUrl);
      }
      imageUrl = await uploadToFirebase(req.file, "OfferPopupImages");
    }

    const payload = {
      status: status === "true" || status === true,
      imageUrl,
    };

    if (offerPopup) {
      offerPopup = await OfferPopup.findByIdAndUpdate(
        offerPopup._id,
        { $set: payload },
        { new: true }
      );
    } else {
      offerPopup = await OfferPopup.create(payload);
    }

    res.status(200).json({
      message: "Offer popup updated successfully",
      data: offerPopup,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = { getOfferPopupController, updateOfferPopupController };
