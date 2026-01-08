const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: false, // For society-level entries
    },
    type: {
      type: String,
      enum: ["deposit", "expense", "transfer", "investment"],
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    subcategory: {
      type: String,
      required: false,
    },
    amount: { type: Number, required: true },

    // 🔥 LINK TO BANK (Mother Account)
    bankAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      required: false,
    },

    transferDetails: {
      fromAccount: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount" },
      toAccount: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount" },
    },

    // 🔥 OPTIONAL FIELDS: Mandatory for Monthly Share, but optional for Financial Entry
    month: {
      type: String,
      required: false, // Changed from true
    },
    year: {
      type: Number,
      required: false, // Changed from true
    },

    // 🔥 PRIMARY DATE: Mandatory for all entries
    date: {
      type: Date,
      default: Date.now,
      required: true, // Ensured for Financial Entry
      index: true,
    },

    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    remarks: { type: String },
  },
  { timestamps: true }
);

// 🔥 INDEX UPDATE: Removed unique constraints to allow flexible entries
// We keep the index for reporting performance but ensure unique is false
transactionSchema.index(
  { user: 1, date: 1, category: 1, bankAccount: 1, type: 1 },
  { unique: false }
);

module.exports = mongoose.model("Transaction", transactionSchema);
