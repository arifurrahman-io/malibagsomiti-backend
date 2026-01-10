const Transaction = require("../models/Transaction");
const BankAccount = require("../models/BankAccount");
const Investment = require("../models/Investment");
const mongoose = require("mongoose");

/**
 * ✅ GET MEMBER TRANSACTIONS: Optimized for Mobile Infinite Scroll
 * Supports both personal view and admin-member audit.
 */
exports.getMemberTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 15 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Dynamic filtering: uses user ID from auth middleware
    const transactions = await Transaction.find({ user: req.user.id })
      .populate("bankAccount", "bankName accountNumber")
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Transaction.countDocuments({ user: req.user.id });

    res.status(200).json({
      success: true,
      count: transactions.length,
      pagination: {
        total,
        currentPage: parseInt(page),
        hasNextPage: skip + transactions.length < total,
      },
      data: transactions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "No transactional data found.",
      error: error.message,
    });
  }
};

/**
 * ✅ CREATE TRANSACTION: Atomic Triple-Sync Logic
 * Synchronizes: 1. Ledger, 2. Specific Bank Balance, 3. Project ROI.
 */
exports.createTransaction = async (req, res) => {
  // Use a session to ensure all updates happen or none do (Atomicity)
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      type,
      category,
      subcategory,
      amount,
      remarks,
      date,
      month,
      year,
      userId,
      bankAccount, // 🔥 Dynamic ID from Mobile App (e.g., FDR or Savings ID)
    } = req.body;

    // 1. Strict Validation
    if (!type || !category || !amount || !bankAccount) {
      throw new Error("Type, Category, Amount, and Bank Account are required.");
    }

    const numAmount = Number(amount);

    // 2. 🔥 DYNAMIC TREASURY SYNC (No more Mother Account hardcoding)
    const targetBank = await BankAccount.findById(bankAccount).session(session);
    if (!targetBank) {
      throw new Error("The selected bank account does not exist.");
    }

    // 3. INVESTMENT ROI TRACKING (Standardized status/subcategory matching)
    if (category.toLowerCase().includes("investment") && subcategory) {
      const project = await Investment.findOne({
        projectName: { $regex: new RegExp(`^${subcategory}$`, "i") },
      }).session(session);

      if (project) {
        if (type === "deposit") project.totalProfit += numAmount;
        else if (type === "expense") project.totalProfit -= numAmount;
        await project.save({ session });
      }
    }

    // 4. Period Normalization
    const transactionDate = date ? new Date(date) : new Date();
    const finalMonth =
      month || transactionDate.toLocaleString("default", { month: "long" });
    const finalYear = year || transactionDate.getFullYear();

    // 5. Update Target Bank Balance (Deposit vs Expense)
    if (type === "deposit") {
      targetBank.currentBalance += numAmount;
    } else if (type === "expense") {
      if (targetBank.currentBalance < numAmount) {
        throw new Error(
          `Insufficient funds in ${targetBank.bankName}. Available: ৳${targetBank.currentBalance}`
        );
      }
      targetBank.currentBalance -= numAmount;
    }
    await targetBank.save({ session });

    // 6. Create Ledger Entry linked to the SPECIFIC bankAccount
    const transaction = await Transaction.create(
      [
        {
          user: userId || null,
          type,
          category,
          subcategory,
          amount: numAmount,
          date: transactionDate,
          month: finalMonth,
          year: finalYear,
          bankAccount, // Stores the specific ID (e.g., ...eb11 for FDR)
          remarks: remarks || `${type} entry for ${category}`,
          recordedBy: req.user.id,
        },
      ],
      { session }
    );

    // 7. Commit changes to Database
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: `Transaction committed to ${targetBank.bankName}.`,
      data: transaction[0],
    });
  } catch (error) {
    // Rollback all changes if any step fails
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ success: false, message: error.message });
  }
};
