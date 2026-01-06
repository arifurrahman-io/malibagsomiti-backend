const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: false, // Explicitly false to allow society-level entries
    },
    type: {
      type: String,
      enum: ["deposit", "expense"],
      required: true,
    },
    category: {
      type: String,
      enum: [
        "monthly_deposit", // UPDATED: Matches MemberController & FinanceController logic
        "monthly_savings", // Kept for backward compatibility
        "investment_profit",
        "investment_expense",
        "electricity",
        "maintenance",
        "project_cost",
        "other",
      ],
      default: "monthly_deposit",
    },
    amount: { type: Number, required: true },
    month: {
      type: String, // Changed from Number to String
      required: true,
      enum: [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ],
    },
    year: {
      type: Number,
      required: true,
    },
    date: { type: Date, default: Date.now, index: true },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true, // Tracks the admin who performed the action
    },
    remarks: { type: String },
  },
  { timestamps: true }
);

/**
 * LOGIC FIX: Optimized Compound Index
 * We removed the 'unique: true' constraint from this specific index.
 * * WHY?
 * In bulk processing (processDeposit), if an admin clicks "Deposit" twice
 * or if a member has a similar manual entry, 'unique: true' throws a
 * hard MongoError 11000, which results in the 500 Internal Server Error
 * you encountered. Handling duplicates is now managed in the controller
 * logic for better stability.
 */
transactionSchema.index(
  { user: 1, month: 1, year: 1, category: 1 },
  { unique: false }
);

module.exports = mongoose.model("Transaction", transactionSchema);
