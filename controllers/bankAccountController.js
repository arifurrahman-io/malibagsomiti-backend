const mongoose = require("mongoose");
const BankAccount = require("../models/BankAccount");
const Transaction = require("../models/Transaction");

/**
 * ✅ ADD BANK ACCOUNT: New Treasury Source
 */
exports.addBankAccount = async (req, res) => {
  try {
    const { isMotherAccount } = req.body;

    // Logic: Only one Mother Account can exist at a time for simplified routing [cite: 2025-10-11]
    if (isMotherAccount) {
      await BankAccount.updateMany({}, { isMotherAccount: false });
    }

    const bankAccount = await BankAccount.create({
      ...req.body,
      lastUpdatedBy: req.user.id,
    });

    res.status(201).json({ success: true, data: bankAccount });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * ✅ GET BANK ACCOUNTS: For Dashboard Cards
 * Optimized for horizontal scroll lists in React Native [cite: 2025-10-11].
 */
exports.getBankAccounts = async (req, res) => {
  try {
    const accounts = await BankAccount.find()
      .sort({ isMotherAccount: -1, createdAt: -1 })
      .lean();

    // Calculate total society liquidity for the App Hero Card
    const totalLiquidity = accounts.reduce(
      (acc, curr) => acc + curr.currentBalance,
      0
    );

    res.status(200).json({
      success: true,
      totalLiquidity,
      count: accounts.length,
      data: accounts.map((acc) => ({
        ...acc,
        id: acc._id.toString(), // Ensure string ID for RN keyExtractor
        formattedBalance: `৳${acc.currentBalance.toLocaleString()}`,
      })),
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch society treasury." });
  }
};

/**
 * ✅ TRANSFER BALANCE: Atomic Fund Movement
 * Synchronizes two bank balances and creates a double-entry ledger record [cite: 2025-10-11].
 */
exports.transferBalance = async (req, res) => {
  const { fromAccountId, toAccountId, amount, remarks } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const fromAcc = await BankAccount.findById(fromAccountId).session(session);
    const toAcc = await BankAccount.findById(toAccountId).session(session);

    if (!fromAcc || !toAcc)
      throw new Error("One or both bank accounts missing.");
    if (fromAcc.currentBalance < Number(amount)) {
      throw new Error(`Insufficient funds in ${fromAcc.bankName}.`);
    }

    // 1. Balance Swing
    fromAcc.currentBalance -= Number(amount);
    toAcc.currentBalance += Number(amount);

    await fromAcc.save({ session });
    await toAcc.save({ session });

    // 2. Double-Entry Style Transaction Record [cite: 2025-10-11]
    await Transaction.create(
      [
        {
          type: "transfer",
          category: "internal_transfer",
          subcategory: "Treasury Movement",
          amount: Number(amount),
          date: new Date(),
          month: new Date().toLocaleString("default", { month: "long" }),
          year: new Date().getFullYear(),
          remarks: `Internal Transfer: ${fromAcc.bankName} ➔ ${
            toAcc.bankName
          }. ${remarks || ""}`,
          transferDetails: {
            fromAccount: fromAccountId,
            toAccount: toAccountId,
          },
          recordedBy: req.user.id,
          bankAccount: toAccountId,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    res.status(200).json({
      success: true,
      message: `Transferred ৳${Number(amount).toLocaleString()} successfully.`,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

/**
 * ✅ UPDATE BANK ACCOUNT: Administrative Override
 */
exports.updateBankAccount = async (req, res) => {
  try {
    if (req.body.isMotherAccount) {
      await BankAccount.updateMany({}, { isMotherAccount: false });
    }

    const updatedAccount = await BankAccount.findByIdAndUpdate(
      req.params.id,
      { $set: req.body, lastUpdatedBy: req.user.id },
      { new: true, runValidators: true }
    );

    if (!updatedAccount)
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });

    res.status(200).json({ success: true, data: updatedAccount });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * ✅ DELETE BANK ACCOUNT: Restricted Access
 */
exports.deleteBankAccount = async (req, res) => {
  try {
    const account = await BankAccount.findById(req.params.id);
    if (!account)
      return res.status(404).json({ success: false, message: "Not found" });

    // Protection: Cannot delete account with remaining balance [cite: 2025-10-11]
    if (account.currentBalance > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Governance Protection: Cannot delete account with an active balance. Please transfer funds first.",
      });
    }

    await BankAccount.findByIdAndDelete(req.params.id);
    res
      .status(200)
      .json({ success: true, message: "Account removed from treasury." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
