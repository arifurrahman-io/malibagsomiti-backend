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
        "monthly_savings",
        "investment_profit",
        "investment_expense", // ADDED for better ledger tracking
        "electricity",
        "maintenance",
        "project_cost",
        "other",
      ],
      default: "monthly_savings",
    },
    amount: { type: Number, required: true },
    month: {
      type: Number,
      min: 0,
      max: 11,
      required: true, // Ensuring period tracking is always present
    },
    year: {
      type: Number,
      required: true,
    },
    date: { type: Date, default: Date.now, index: true },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true, // Track which admin performed the action
    },
    remarks: { type: String },
  },
  { timestamps: true }
);

/**
 * LOGIC FIX: Optimized Compound Index
 * 1. We added 'remarks' to the index so multiple different entries (different projects)
 * can exist in the same month.
 * 2. We added a 'partialFilterExpression' so the unique constraint only applies
 * to member deposits, not society-level investment entries.
 */
transactionSchema.index(
  { user: 1, month: 1, year: 1, category: 1, remarks: 1 },
  {
    unique: true,
    partialFilterExpression: { user: { $exists: true } },
  }
);

module.exports = mongoose.model("Transaction", transactionSchema);
