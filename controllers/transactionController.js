const Transaction = require("../models/Transaction");

/**
 * @desc    Create a manual deposit or expense entry
 * @route   POST /api/finance/transaction
 * @access  Private (Admin/Super-Admin)
 */
exports.createTransaction = async (req, res) => {
  try {
    const { type, category, subcategory, amount, remarks, date, userId } =
      req.body;

    // 1. Validation for essential outcomes
    if (!type || !category || !amount) {
      return res.status(400).json({
        success: false,
        message: "Type, Category, and Amount are required for the ledger.",
      });
    }

    // 2. Derive Month and Year for reporting consistency
    // This ensures manual entries align with bulk collection reports.
    const transactionDate = date ? new Date(date) : new Date();
    const targetMonth = transactionDate.toLocaleString("default", {
      month: "long",
    });
    const targetYear = transactionDate.getFullYear();

    // 3. Create Transaction with flexible user association
    const transaction = await Transaction.create({
      // Uses userId if provided for a specific member, else null for society-level
      user: userId || null,
      type,
      category,
      subcategory,
      amount: Number(amount), // Ensure numerical format for aggregations
      month: targetMonth,
      year: targetYear,
      date: transactionDate,
      remarks:
        remarks ||
        `${type} entry for ${category} (${subcategory || "General"})`,
      recordedBy: req.user.id, // Track the admin responsible
    });

    res.status(201).json({
      success: true,
      data: transaction,
      message: "Transaction logged successfully in the audit registry.",
    });
  } catch (error) {
    // Catch Mongoose validation errors (e.g., amount is NaN or missing required fields)
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
