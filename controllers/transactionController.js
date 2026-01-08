const Transaction = require("../models/Transaction");
const BankAccount = require("../models/BankAccount");
const Investment = require("../models/Investment"); // 🔥 Added to track project ROI
const mongoose = require("mongoose");

/**
 * @desc    Create a financial entry synced with Mother Account & Investment Projects
 * Supports ROI tracking for Projects and standard Bank Sync for Ledger entries.
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
    // If the category is 'Investment', we link the subcategory to a project name
    if (category.toLowerCase().includes("investment") && subcategory) {
      const project = await Investment.findOne({
        projectName: subcategory,
      }).session(session);

      if (project) {
        // If it's a deposit (Profit), increase project yield; if expense (Loss), decrease it
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
          user: userId || null,
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
      // Safety check for treasury liquidity
      if (targetBank.currentBalance < numAmount) {
        throw new Error(
          `Insufficient funds in ${targetBank.bankName}. Current: ${targetBank.currentBalance}`
        );
      }
      targetBank.currentBalance -= numAmount;
    }

    // Save the bank balance update
    await targetBank.save({ session });

    // 8. Commit changes to Transaction, BankAccount, and Investment collections
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      data: transaction[0],
      message: `Ledger synchronized, Bank balance updated, and Project ROI calculated.`,
    });
  } catch (error) {
    // 9. Rollback: Ensure no partial data is saved if any step fails
    await session.abortTransaction();
    session.endSession();

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
