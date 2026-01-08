const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Investment = require("../models/Investment");
const { sendDepositEmail } = require("../utils/sendEmail");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const BankAccount = require("../models/BankAccount");

/**
 * @section 1. Deposits & Collections
 */

/**
 * @desc    Process bulk monthly deposits and snapshot bank details
 * @route   POST /api/finance/deposit
 * @access  Admin/Super-Admin
 */

exports.processDeposit = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userIds, remarks, month, year } = req.body;

    if (!userIds || !Array.isArray(userIds)) {
      throw new Error("A valid list of Member IDs is required.");
    }

    // 1. Automatically locate the designated Mother Account
    const motherAccount = await BankAccount.findOne({
      isMotherAccount: true,
    }).session(session);
    if (!motherAccount) {
      throw new Error(
        "No Mother Account designated. Set one in Bank Management."
      );
    }

    const targetMonth =
      month || new Date().toLocaleString("default", { month: "long" });
    const targetYear = year || new Date().getFullYear();
    let totalBatchAmount = 0;

    // 2. Process Batch
    const depositResults = await Promise.all(
      userIds.map(async (id) => {
        const user = await User.findById(id).session(session);
        if (!user) return null;

        const amount = (user.shares || 1) * 1000;
        totalBatchAmount += amount;

        // Create transaction linked to Mother Account
        const newDeposit = await Transaction.create(
          [
            {
              user: id,
              type: "deposit",
              category: "monthly_deposit",
              subcategory: "Member Monthly Share",
              amount,
              month: targetMonth,
              year: targetYear,
              bankAccount: motherAccount._id, // Auto-link
              recordedBy: req.user.id,
              remarks: `${remarks || "Monthly Deposit"}`,
            },
          ],
          { session }
        );

        return newDeposit;
      })
    );

    // 3. Increment Mother Account balance automatically
    motherAccount.currentBalance += totalBatchAmount;
    await motherAccount.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: `Batch complete. ৳${totalBatchAmount.toLocaleString()} added to ${
        motherAccount.bankName
      }.`,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Check which members have already deposited for a specific month name/year
 * @route   GET /api/finance/check-payments
 */
exports.checkPayments = async (req, res) => {
  try {
    const { month, year, branch } = req.query;

    /**
     * 🚀 STRING-BASED LOGIC FIX:
     * Direct string match for months like "January"
     */
    const existingTransactions = await Transaction.find({
      type: "deposit",
      category: "monthly_deposit",
      month: month,
      year: parseInt(year),
    }).populate("user", "branch");

    const paidMemberIds = existingTransactions
      .filter((t) => t.user?.branch === branch)
      .map((t) => t.user._id);

    res.status(200).json({
      success: true,
      data: paidMemberIds,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Payment check failed",
      error: error.message,
    });
  }
};

/**
 * @section 2. Expenses & Summaries
 */

// @desc    Record a society expense
// @route   POST /api/finance/expense
exports.addExpense = async (req, res) => {
  try {
    const expense = await Transaction.create({
      ...req.body,
      type: "expense",
      // Derive month/year from provided date for consistency
      month: req.body.date
        ? new Date(req.body.date).toLocaleString("default", { month: "long" })
        : new Date().toLocaleString("default", { month: "long" }),
      year: req.body.date
        ? new Date(req.body.date).getFullYear()
        : new Date().getFullYear(),
      recordedBy: req.user.id,
    });
    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Expense failed",
      error: error.message,
    });
  }
};

// @desc    Comprehensive Dashboard Summary
exports.getAdminSummary = async (req, res) => {
  try {
    const financialStats = await Transaction.aggregate([
      { $group: { _id: "$type", total: { $sum: "$amount" } } },
    ]);
    const investmentStats = await Investment.aggregate([
      { $match: { status: "active" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalDeposits =
      financialStats.find((s) => s._id === "deposit")?.total || 0;
    const totalExpenses =
      financialStats.find((s) => s._id === "expense")?.total || 0;
    const totalInvestments = investmentStats[0]?.total || 0;
    const societyFund = totalDeposits - totalExpenses - totalInvestments;

    const totalMembers = await User.countDocuments({
      role: "member",
      status: "active",
    });
    const recentTransactions = await Transaction.find()
      .sort({ date: -1 })
      .limit(6)
      .populate("user", "name")
      .lean();

    res.status(200).json({
      success: true,
      totalMembers,
      totalCollection: societyFund,
      recentTransactions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Dashboard failed",
      error: error.message,
    });
  }
};

// @desc    Get Global Financial Summary (Member View)
exports.getSocietySummary = async (req, res) => {
  try {
    const financialStats = await Transaction.aggregate([
      { $group: { _id: "$type", total: { $sum: "$amount" } } },
    ]);
    const investmentStats = await Investment.aggregate([
      { $match: { status: "active" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalDeposits =
      financialStats.find((s) => s._id === "deposit")?.total || 0;
    const totalExpenses =
      financialStats.find((s) => s._id === "expense")?.total || 0;
    const totalInvestments = investmentStats[0]?.total || 0;
    const bankBalance = totalDeposits - totalExpenses - totalInvestments;

    res.status(200).json({
      success: true,
      data: {
        totalDeposits,
        totalExpenses,
        totalInvestments,
        bankBalance,
        totalCollection: bankBalance,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Summary failed",
      error: error.message,
    });
  }
};

// @desc    Get summary filtered by branch
// @route   GET /api/finance/summary/:branch
exports.getBranchSummary = async (req, res) => {
  try {
    const { branch } = req.params;
    const summary = await Transaction.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "member",
        },
      },
      { $unwind: "$member" },
      { $match: { "member.branch": branch } },
      {
        $group: {
          _id: "$type",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);
    res.status(200).json({ success: true, branch, data: summary });
  } catch (error) {
    res.status(500).json({ success: false, message: "Branch summary failed" });
  }
};

/**
 * @section 3. Investment Management (Full CRUD)
 */

// @desc    Get all investment projects
exports.getAllInvestments = async (req, res) => {
  try {
    const investments = await Investment.find()
      .sort({ createdAt: -1 })
      .populate("recordedBy", "name");
    res.status(200).json({ success: true, data: investments });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch investments",
      error: error.message,
    });
  }
};

// @desc    Add a new society investment project
exports.addInvestment = async (req, res) => {
  try {
    const legalDocs = req.file ? req.file.path.replace(/\\/g, "/") : null;
    const investment = await Investment.create({
      projectName: req.body.projectName,
      amount: Number(req.body.amount),
      date: req.body.date || Date.now(),
      remarks: req.body.remarks,
      legalDocs,
      recordedBy: req.user.id,
    });
    res.status(201).json({ success: true, data: investment });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Investment failed",
      error: error.message,
    });
  }
};

// @desc    Update investment project (Super-Admin only)
exports.updateInvestment = async (req, res) => {
  try {
    let investment = await Investment.findById(req.params.id);
    if (!investment)
      return res.status(404).json({ success: false, message: "Not found" });

    const updateFields = {
      projectName: req.body.projectName,
      amount: req.body.amount ? Number(req.body.amount) : investment.amount,
      date: req.body.date || investment.date,
      remarks: req.body.remarks || investment.remarks,
    };

    if (req.file) {
      if (investment.legalDocs) {
        const oldPath = path.join(__dirname, "../../", investment.legalDocs);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      updateFields.legalDocs = req.file.path.replace(/\\/g, "/");
    }

    const updated = await Investment.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Update failed", error: error.message });
  }
};

// @desc    Delete investment project (Super-Admin only)
exports.deleteInvestment = async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.id);
    if (!investment)
      return res.status(404).json({ success: false, message: "Not found" });

    if (investment.legalDocs) {
      const filePath = path.join(__dirname, "../../", investment.legalDocs);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await investment.deleteOne();
    res.status(200).json({ success: true, message: "Deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Delete failed", error: error.message });
  }
};

// @desc    Record monthly profit or expense for an investment project
// @route   POST /api/finance/investment/:id/profit
exports.recordInvestmentProfit = async (req, res) => {
  try {
    const { amount, remarks, month, year, type } = req.body;
    const investment = await Investment.findById(req.params.id);

    if (!investment) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const numericAmount = parseFloat(amount);

    if (type === "expense") {
      investment.totalProfit -= numericAmount;
    } else {
      investment.totalProfit += numericAmount;
    }

    await investment.save();

    // Create corresponding transaction record with subcategory link
    await Transaction.create({
      user: null,
      type: type === "expense" ? "expense" : "deposit",
      category: type === "expense" ? "investment_expense" : "investment_profit",
      subcategory: investment.projectName,
      amount: numericAmount,
      month: month || new Date().toLocaleString("default", { month: "long" }),
      year: year || new Date().getFullYear(),
      recordedBy: req.user.id,
      remarks: `${type === "expense" ? "Expense" : "Profit"} - ${
        investment.projectName
      }: ${remarks || ""}`,
    });

    res.status(200).json({ success: true, message: "Record updated" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get transaction history for a specific investment
exports.getInvestmentHistory = async (req, res) => {
  try {
    const project = await Investment.findById(req.params.id);
    if (!project)
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });

    const history = await Transaction.find({
      $or: [
        { remarks: { $regex: project.projectName, $options: "i" } },
        { subcategory: project.projectName },
      ],
    }).sort({ date: -1 });

    res.status(200).json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get data for printable investment report
// @route   GET /api/finance/investment/:id/report
exports.downloadInvestmentReport = async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.id).populate(
      "recordedBy",
      "name email"
    );

    if (!investment) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const history = await Transaction.find({
      $or: [
        { remarks: { $regex: investment.projectName, $options: "i" } },
        { subcategory: investment.projectName },
      ],
    }).sort({ date: 1 });

    const totalProfits = history
      .filter((t) => t.type === "deposit")
      .reduce((acc, curr) => acc + curr.amount, 0);

    const totalExpenses = history
      .filter((t) => t.type === "expense")
      .reduce((acc, curr) => acc + curr.amount, 0);

    const initialCapital = investment.amount;
    const netYield = investment.totalProfit;

    const roi =
      initialCapital > 0
        ? ((netYield / initialCapital) * 100).toFixed(2)
        : "0.00";

    res.status(200).json({
      success: true,
      data: {
        project: {
          id: investment._id,
          name: investment.projectName,
          capital: initialCapital,
          netYield: netYield,
          roi: `${roi}%`,
          status: investment.status,
          date: investment.date,
          recordedBy: investment.recordedBy?.name || "System Admin",
          remarks: investment.remarks,
        },
        transactions: history,
        summary: {
          totalInflow: totalProfits,
          totalOutflow: totalExpenses + initialCapital,
          transactionCount: history.length,
        },
      },
    });
  } catch (error) {
    console.error("Report Generation Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate comprehensive report data",
      error: error.message,
    });
  }
};

// @desc    Get all transactions for full audit statement
exports.getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("user", "name bankAccount branch")
      .populate("recordedBy", "name")
      .sort({ date: -1 });

    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Super Admin: Delete any transaction
exports.deleteTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findByIdAndDelete(req.params.id);
    if (!transaction) return res.status(404).json({ message: "Not found" });
    res.json({ success: true, message: "Transaction removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get collection statistics for chart visualization
exports.getCollectionTrend = async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();

    const trendData = await Transaction.aggregate([
      {
        $match: {
          type: "deposit",
          category: "monthly_deposit",
          year: currentYear,
        },
      },
      {
        $group: {
          _id: "$month",
          total: { $sum: "$amount" },
        },
      },
    ]);

    const monthOrder = [
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
    ];

    const dynamicTrend = monthOrder
      .map((m) => {
        const found = trendData.find((d) => d._id === m);
        return {
          name: m.substring(0, 3),
          total: found ? found.total : 0,
        };
      })
      .filter((m) => m.total > 0);

    res.status(200).json({ success: true, trend: dynamicTrend });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Get member-specific dashboard stats (Personalized)
 * @route   GET /api/finance/member-summary
 * @access  Private (Member/Admin)
 */
exports.getMemberSummary = async (req, res) => {
  try {
    const userId = req.user.id; // From authMiddleware

    // Calculate ONLY this specific member's total deposits
    const personalStats = await Transaction.aggregate([
      {
        $match: { user: new mongoose.Types.ObjectId(userId), type: "deposit" },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalDeposited: personalStats[0]?.total || 0,
        bankBalance: personalStats[0]?.total || 0, // Member's personal fund
        recentTransactions: await Transaction.find({ user: userId })
          .sort({ date: -1 })
          .limit(5)
          .lean(),
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Personal summary failed" });
  }
};

/**
 * @desc    Get personal transaction history for a member
 * @route   GET /api/finance/history/:id
 * @access  Private (Member/Admin)
 */
exports.getMemberHistory = async (req, res) => {
  try {
    // Allows admin to view via params OR member to view via their own ID
    const userId = req.params.id || req.user.id;

    // Find all transactions for this user regardless of category
    const history = await Transaction.find({ user: userId })
      .sort({ date: -1 })
      .populate("recordedBy", "name")
      .lean();

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "History retrieval failed" });
  }
};
