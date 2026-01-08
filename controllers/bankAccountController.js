const mongoose = require("mongoose");
const BankAccount = require("../models/BankAccount");
const Transaction = require("../models/Transaction");

exports.addBankAccount = async (req, res) => {
  try {
    const bankAccount = await BankAccount.create({
      ...req.body,
      lastUpdatedBy: req.user.id,
    });
    res.status(201).json({ success: true, data: bankAccount });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getBankAccounts = async (req, res) => {
  try {
    const accounts = await BankAccount.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: accounts });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch accounts" });
  }
};

exports.transferBalance = async (req, res) => {
  const { fromAccountId, toAccountId, amount, remarks } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const fromAcc = await BankAccount.findById(fromAccountId).session(session);
    const toAcc = await BankAccount.findById(toAccountId).session(session);

    // 1. Validation Checks
    if (!fromAcc || !toAcc) {
      throw new Error("One or both bank accounts could not be located.");
    }

    if (fromAcc.currentBalance < Number(amount)) {
      throw new Error(
        `Insufficient funds in ${fromAcc.bankName}. Available: ${fromAcc.currentBalance}`
      );
    }

    // 2. Execute Balance Movement
    fromAcc.currentBalance -= Number(amount);
    toAcc.currentBalance += Number(amount);

    await fromAcc.save({ session });
    await toAcc.save({ session });

    // 3. Record the Transfer with Correct Classification
    await Transaction.create(
      [
        {
          type: "transfer",
          // 🔥 FIX: Explicitly set category to avoid defaulting to "monthly_deposit"
          category: "internal_transfer",
          subcategory: "Treasury Movement",
          amount: Number(amount),
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
          bankAccount: toAccountId, // Linked to receiving account for ledger tracking
        },
      ],
      { session }
    );

    await session.commitTransaction();
    res.status(200).json({
      success: true,
      message: `Successfully transferred ৳${Number(
        amount
      ).toLocaleString()} from ${fromAcc.bankName} to ${toAcc.bankName}.`,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

exports.updateBankAccount = async (req, res) => {
  try {
    const { isMotherAccount } = req.body;

    // Logic: If setting a new Mother Account, unset all others first
    if (isMotherAccount) {
      await BankAccount.updateMany({}, { isMotherAccount: false });
    }

    const updatedAccount = await BankAccount.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );

    if (!updatedAccount) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    }

    res.status(200).json({ success: true, data: updatedAccount });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Also ensure deleteBankAccount is defined
exports.deleteBankAccount = async (req, res) => {
  try {
    const account = await BankAccount.findByIdAndDelete(req.params.id);
    if (!account)
      return res.status(404).json({ success: false, message: "Not found" });
    res.status(200).json({ success: true, message: "Account removed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
