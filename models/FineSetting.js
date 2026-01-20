const mongoose = require("mongoose");

const FineSettingSchema = new mongoose.Schema(
  {
    gracePeriodMonths: {
      type: Number,
      required: true,
      default: 1,
    },
    finePercentage: {
      type: Number,
      required: true,
      default: 5,
    },
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// ✅ সঠিক পদ্ধতি: mongoose.models চেক করা (ফাংশন হিসেবে নয়)
module.exports =
  mongoose.models.FineSetting ||
  mongoose.model("FineSetting", FineSettingSchema);
