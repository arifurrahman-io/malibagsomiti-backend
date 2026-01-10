const Transaction = require("../models/Transaction");
const BankAccount = require("../models/BankAccount");
const Investment = require("../models/Investment");
const mongoose = require("mongoose");

/**
 * ✅ GET MEMBER TRANSACTIONS: Optimized for Mobile Infinite Scroll
 * Supports both personal view and admin-member audit [cite: 2025-10-11].
 */
exports.getMemberTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 15 } = req.query; // Pagination for smooth scrolling
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transactions = await Transaction.find({ user: req.user.id })
      .populate("bankAccount", "bankName accountNumber")
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Transaction.countDocuments({ user: req.user.id });

    /**
     * 🚀 APP SYNC:
     * Returns a pagination object so the React Native FlatList knows when to stop.
     */
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
      message: "লেনদেনের তথ্য পাওয়া যায়নি।",
      error: error.message,
    });
  }
};

/**
 * ✅ CREATE TRANSACTION: Atomic Triple-Sync Logic
 * Synchronizes: 1. Ledger, 2. Bank Balance, 3. Project ROI [cite: 2025-10-11].
 */
exports.createTransaction = async (req, res) => {
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
      bankAccount,
    } = req.body;

    // 1. Strict Validation
    if (!type || !category || !amount || !bankAccount) {
      return res.status(400).json({
        success: false,
        message: "Type, Category, Amount, and Bank Account are required.",
      });
    }

    // 2. Verify target Bank (Mother Account)
    const targetBank = await BankAccount.findById(bankAccount).session(session);
    if (!targetBank) {
      throw new Error("Target treasury account not found.");
    }

    const numAmount = Number(amount);

    // 3. 🔥 INVESTMENT ROI TRACKING (For Bento Grid dynamic updates)
    if (category.toLowerCase().includes("investment") && subcategory) {
      const project = await Investment.findOne({
        projectName: subcategory,
      }).session(session);
      if (project) {
        if (type === "deposit") project.totalProfit += numAmount;
        else if (type === "expense") project.totalProfit -= numAmount;
        await project.save({ session });
      }
    }

    // 4. Period Normalization (Critical for App History filtering) [cite: 2025-10-11]
    const transactionDate = date ? new Date(date) : new Date();
    const finalMonth =
      month || transactionDate.toLocaleString("default", { month: "long" });
    const finalYear = year || transactionDate.getFullYear();

    // 5. Create Transaction Record
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
          bankAccount,
          remarks: remarks || `${type} entry for ${category}`,
          recordedBy: req.user.id,
        },
      ],
      { session }
    );

    // 6. SYNC MOTHER ACCOUNT (Real-time Liquidity)
    if (type === "deposit") {
      targetBank.currentBalance += numAmount;
    } else {
      if (targetBank.currentBalance < numAmount) {
        throw new Error(`Insufficient funds in ${targetBank.bankName}.`);
      }
      targetBank.currentBalance -= numAmount;
    }

    await targetBank.save({ session });

    // 7. Success Response
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: "Registry synchronized across all accounts.",
      data: transaction[0],
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ success: false, message: error.message });
  }
};
