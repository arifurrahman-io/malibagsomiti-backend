const Transaction = require("../models/Transaction");
const BankAccount = require("../models/BankAccount");
const Investment = require("../models/Investment");
const mongoose = require("mongoose");

/**
 * @desc    লগইন করা মেম্বারের নিজস্ব লেনদেন দেখা
 * @route   GET /api/finance/transaction/my-history
 * @access  Private (Member/Admin)
 */
exports.getMemberTransactions = async (req, res) => {
  try {
    // শুধুমাত্র লগইন করা ইউজারের আইডি দিয়ে ট্রাঞ্জেকশন ফিল্টার করা
    // আপনার মডেল অনুযায়ী 'user' ফিল্ডটি চেক করে নিন
    const transactions = await Transaction.find({ user: req.user.id })
      .populate("bankAccount", "bankName accountNumber")
      .sort({ date: -1 });

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "লেনদেনের তথ্য পাওয়া যায়নি।",
      error: error.message,
    });
  }
};

/**
 * @desc    Create a financial entry synced with Mother Account & Investment Projects
 * @route   POST /api/finance/transaction
 * @access  Private (Admin/Super-Admin)
 */
exports.createTransaction = async (req, res) => {
  // 1. Start a Session for Atomic Updates across three collections
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

    // 2. Strict Validation
    if (!type || !category || !amount || !bankAccount) {
      return res.status(400).json({
        success: false,
        message: "Type, Category, Amount, and Bank Account are required.",
      });
    }

    // 3. Verify target Bank Account (Mother Account)
    const targetBank = await BankAccount.findById(bankAccount).session(session);
    if (!targetBank) {
      throw new Error("Target treasury account not found in the registry.");
    }

    const numAmount = Number(amount);

    // 4. 🔥 INVESTMENT ROI TRACKING LOGIC
    if (category.toLowerCase().includes("investment") && subcategory) {
      const project = await Investment.findOne({
        projectName: subcategory,
      }).session(session);

      if (project) {
        if (type === "deposit") {
          project.totalProfit += numAmount;
        } else if (type === "expense") {
          project.totalProfit -= numAmount;
        }
        await project.save({ session });
      }
    }

    // 5. Determine Date and Period
    const transactionDate = date ? new Date(date) : new Date();

    // 6. Create Transaction Record
    const transaction = await Transaction.create(
      [
        {
          user: userId || null, // মেম্বারের আইডি এখানে সেভ হচ্ছে
          type,
          category,
          subcategory,
          amount: numAmount,
          date: transactionDate,
          month: month || null,
          year: year || null,
          bankAccount,
          remarks:
            remarks ||
            `${type} entry for ${category} (${subcategory || "General"})`,
          recordedBy: req.user.id,
        },
      ],
      { session }
    );

    // 7. SYNC MOTHER ACCOUNT BALANCE
    if (type === "deposit") {
      targetBank.currentBalance += numAmount;
    } else if (type === "expense") {
      if (targetBank.currentBalance < numAmount) {
        throw new Error(
          `Insufficient funds in ${targetBank.bankName}. Current: ${targetBank.currentBalance}`
        );
      }
      targetBank.currentBalance -= numAmount;
    }

    await targetBank.save({ session });

    // 8. Commit changes
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      data: transaction[0],
      message: `Ledger synchronized, Bank balance updated, and Project ROI calculated.`,
    });
  } catch (error) {
    // 9. Rollback
    await session.abortTransaction();
    session.endSession();

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
