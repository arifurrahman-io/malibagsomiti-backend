const mongoose = require("mongoose");

const investmentSchema = new mongoose.Schema(
  {
    projectName: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    }, // Initial capital invested
    totalProfit: {
      type: Number,
      default: 0,
    }, // Cumulative monthly profits earned so far
    date: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["active", "completed", "cancelled"],
      default: "active",
    },
    legalDocs: {
      type: String,
    }, // Stores the file path of the uploaded legal document
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, // Admin/Super-Admin ID who initiated the project
    remarks: {
      type: String,
    }, // Detailed investment/legal descriptions
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * Virtual for Return on Investment (ROI) percentage
 * Automatically calculates the project's performance for the UI
 */
investmentSchema.virtual("roi").get(function () {
  if (!this.amount || this.amount === 0) return 0;
  return ((this.totalProfit / this.amount) * 100).toFixed(2);
});

module.exports = mongoose.model("Investment", investmentSchema);
