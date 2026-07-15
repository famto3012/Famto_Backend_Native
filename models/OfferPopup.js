const mongoose = require("mongoose");

const offerPopupSchema = new mongoose.Schema(
  {
    status: {
      type: Boolean,
      default: false,
    },
    imageUrl: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const OfferPopup = mongoose.model("OfferPopup", offerPopupSchema);
module.exports = OfferPopup;
