const mongoose = require("mongoose");

const BankAccountSchema = new mongoose.Schema(
  {
    bankName: { type: String, required: true },
    accountNumber: { type: String, required: true, unique: true },
    accountType: {
      type: String,
      enum: ["Current", "Savings", "FDR", "DPS"],
      required: true,
    },
    accountHolderNames: [{ type: String, required: true }],
    currentBalance: { type: Number, default: 0 },
    // 🔥 NEW: DESIGNATION FOR MOTHER ACCOUNT
    isMotherAccount: { type: Boolean, default: false },
    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BankAccount", BankAccountSchema);
