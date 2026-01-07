const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: false, // Allows society-level entries without a specific member
    },
    type: {
      type: String,
      enum: ["deposit", "expense"],
      required: true,
    },
    /**
     * 🔥 FIX 1: Removed strict 'enum' for categories.
     * This allows the "Direct Entry" page to use any category you create
     * in the Category Manager dynamically.
     */
    category: {
      type: String,
      required: true,
      default: "monthly_deposit",
    },
    /**
     * 🔥 FIX 2: Added 'subcategory' field.
     * This was missing in your model, causing the 400 error when the
     * frontend tried to save a sub-classification.
     */
    subcategory: {
      type: String,
      required: false,
    },
    amount: { type: Number, required: true },
    month: {
      type: String,
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
      required: true, // Tracks the admin
    },
    remarks: { type: String },
  },
  { timestamps: true }
);

// Optimized Index for reporting performance
transactionSchema.index(
  { user: 1, month: 1, year: 1, category: 1 },
  { unique: false }
);

module.exports = mongoose.model("Transaction", transactionSchema);
