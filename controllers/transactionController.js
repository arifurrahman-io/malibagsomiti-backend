const Transaction = require("../models/Transaction");
const BankAccount = require("../models/BankAccount");
const mongoose = require("mongoose");

/**
 * @desc    Create a financial entry synced with Mother Account
 * Supports Month/Year for Share Deposits & Date-selection for General Entries
 * @route   POST /api/finance/transaction
 * @access  Private (Admin/Super-Admin)
 */
exports.createTransaction = async (req, res) => {
  // 1. Start a Session for Atomic Updates
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      type,
      category,
      subcategory,
      amount,
      remarks,
      date, // From UI Date Picker
      month, // From Share Deposit Form (Mandatory for shares)
      year, // From Share Deposit Form (Mandatory for shares)
      userId, // Required for member-specific deposits
      bankAccount, // Linked Mother Account
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

    // 4. Determine Date and Period
    // Financial entries use the date picker; Share deposits include month/year
    const transactionDate = date ? new Date(date) : new Date();

    // 5. Create Transaction Record
    const transaction = await Transaction.create(
      [
        {
          user: userId || null,
          type,
          category,
          subcategory,
          amount: Number(amount),
          date: transactionDate,
          // Month/Year are only saved if explicitly provided (e.g., Member Shares)
          // This avoids the duplicate key error for standard date-based entries
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

    // 6. SYNC MOTHER ACCOUNT BALANCE
    const numAmount = Number(amount);
    if (type === "deposit") {
      targetBank.currentBalance += numAmount;
    } else if (type === "expense") {
      // Safety check for expenses
      if (targetBank.currentBalance < numAmount) {
        throw new Error(
          `Insufficient funds in ${targetBank.bankName}. Current: ${targetBank.currentBalance}`
        );
      }
      targetBank.currentBalance -= numAmount;
    }

    // Save the bank balance update
    await targetBank.save({ session });

    // 7. Commit changes to both collections
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      data: transaction[0],
      message: `Ledger entry saved and ${targetBank.bankName} balance updated.`,
    });
  } catch (error) {
    // 8. Rollback: Ensure data consistency
    await session.abortTransaction();
    session.endSession();

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
