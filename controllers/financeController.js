const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Investment = require("../models/Investment");
const { sendDepositEmail } = require("../utils/sendEmail");
const fs = require("fs");
const path = require("path");

/**
 * @section 1. Deposits & Collections
 */

// @desc    Process a monthly deposit (Bulk or Single) with Month/Year tracking
// @route   POST /api/finance/deposit
/**
 * @section 1. Deposits & Collections
 */

// @desc    Process a monthly deposit (Bulk or Single) with Month/Year tracking
// @route   POST /api/finance/deposit
exports.processDeposit = async (req, res) => {
  try {
    const { userIds, remarks, month, year } = req.body; // month: "February"

    if (!userIds || !Array.isArray(userIds)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user list" });
    }

    const targetMonth =
      month || new Date().toLocaleString("default", { month: "long" });
    const targetYear = year || new Date().getFullYear();

    const depositResults = await Promise.all(
      userIds.map(async (id) => {
        const user = await User.findById(id);
        if (!user) return null;

        const amount = (user.shares || 1) * 1000;

        // 1. Create Ledger Entry
        const newDeposit = await Transaction.create({
          user: id,
          type: "deposit",
          category: "monthly_deposit",
          amount,
          month: targetMonth,
          year: targetYear,
          recordedBy: req.user.id,
          remarks:
            remarks || `Monthly deposit for ${targetMonth} ${targetYear}`,
        });

        // 2. Calculate Total Savings for the Email Receipt
        const totalHistory = await Transaction.aggregate([
          {
            $match: {
              user: user._id,
              type: "deposit",
              category: "monthly_deposit",
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);

        // 3. Trigger Professional Email Receipt (Non-blocking)
        // This ensures the admin doesn't wait for emails to send
        sendDepositEmail(user.email, {
          name: user.name,
          amount,
          totalBalance: totalHistory[0]?.total || amount,
          date: new Date().toLocaleDateString("en-GB"), // e.g., 07/01/2026
          period: `${targetMonth} ${targetYear}`,
        }).catch((err) =>
          console.error(`Email failed for ${user.name}:`, err.message)
        );

        return newDeposit;
      })
    );

    res.status(201).json({
      success: true,
      count: depositResults.filter((r) => r).length,
      message: "Ledger updated and email receipts dispatched.",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Also update checkPayments to match this 1-indexed logic
// @desc    Check which members have already deposited for a specific month name/year
// @route   GET /api/finance/check-payments
exports.checkPayments = async (req, res) => {
  try {
    const { month, year, branch } = req.query;

    /**
     * 🚀 STRING-BASED LOGIC FIX:
     * We no longer subtract 1 or parse integers for the month.
     * We compare the string directly (e.g., "February" === "February").
     */
    const existingTransactions = await Transaction.find({
      type: "deposit",
      category: "monthly_deposit",
      month: month, // Direct string match (e.g., "January", "February")
      year: parseInt(year),
    }).populate("user", "branch");

    /**
     * Logic Safeguard:
     * Use optional chaining (?.) to prevent crashes if a user was
     * deleted but their transaction remains in the ledger.
     */
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

    // Ensure numeric conversion to avoid string concatenation errors
    const numericAmount = parseFloat(amount);

    /** * CALCULATION FIX:
     * If 'expense', subtract from totalProfit.
     * If 'deposit' (profit), add to totalProfit.
     */
    if (type === "expense") {
      investment.totalProfit -= numericAmount;
    } else {
      investment.totalProfit += numericAmount;
    }

    await investment.save();

    // Create corresponding transaction record for the ledger
    await Transaction.create({
      user: null,
      type: type === "expense" ? "expense" : "deposit",
      category: type === "expense" ? "investment_expense" : "investment_profit",
      amount: numericAmount,
      month: month ?? new Date().getMonth(),
      year: year ?? new Date().getFullYear(),
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

    // Find transactions that match the project's name in the remarks
    // Or, if you add an 'investment' ref field to your Transaction model, use that.
    const history = await Transaction.find({
      remarks: { $regex: project.projectName, $options: "i" },
    }).sort({ date: -1 });

    res.status(200).json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// controllers/financeController.js

// @desc    Get data for printable investment report
// @route   GET /api/finance/investment/:id/report
exports.downloadInvestmentReport = async (req, res) => {
  try {
    // 1. Fetch Investment and populate the admin who recorded it
    const investment = await Investment.findById(req.params.id).populate(
      "recordedBy",
      "name email"
    );

    if (!investment) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    /**
     * 2. Fetch Full Transaction History
     * Queries all deposits (profits) and expenses linked to this project's name.
     */
    const history = await Transaction.find({
      remarks: { $regex: investment.projectName, $options: "i" },
    }).sort({ date: 1 });

    /**
     * 3. LOGICAL FINANCIAL SUMMARY
     * This calculates the numbers required for the "Summary Cards" in your report.
     */
    const totalProfits = history
      .filter((t) => t.type === "deposit")
      .reduce((acc, curr) => acc + curr.amount, 0);

    const totalExpenses = history
      .filter((t) => t.type === "expense")
      .reduce((acc, curr) => acc + curr.amount, 0);

    const initialCapital = investment.amount;
    const netYield = investment.totalProfit; // Uses the field updated by recordInvestmentProfit

    // Calculate performance ROI
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
          totalOutflow: totalExpenses + initialCapital, // Combined cost of project
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
// @route   GET /api/finance/all-transactions
// controllers/financeController.js

// Fetching with Bank Details
exports.getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("user", "name bankAccountNumber") // Fixed: Explicitly fetch bank info
      .populate("recordedBy", "name")
      .sort({ date: -1 });
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Super Admin: Delete any transaction
exports.deleteTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findByIdAndDelete(req.params.id);
    if (!transaction) return res.status(404).json({ message: "Not found" });
    res.json({ success: true, message: "Transaction removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getCollectionTrend = async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();

    // 1. Aggregate deposits by month and year
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
          _id: "$month", // This is now "January", "February", etc.
          total: { $sum: "$amount" },
        },
      },
    ]);

    // 2. Define chronological order for string months
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

    // 3. Map and Sort data for the frontend chart
    const dynamicTrend = monthOrder
      .map((m) => {
        const found = trendData.find((d) => d._id === m);
        return {
          name: m.substring(0, 3), // "January" -> "Jan"
          total: found ? found.total : 0,
        };
      })
      .filter((m) => m.total > 0); // Optional: Only show months with data

    res.status(200).json({ success: true, trend: dynamicTrend });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
