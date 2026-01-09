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
    const motherAccount = await BankAccount.findOne({
      isMotherAccount: true,
    }).session(session);

    if (!motherAccount) throw new Error("No Mother Account designated.");

    const targetMonth =
      month || new Date().toLocaleString("default", { month: "long" });
    const targetYear = year || new Date().getFullYear();
    let totalBatchAmount = 0;

    const depositResults = await Promise.all(
      userIds.map(async (id) => {
        const user = await User.findById(id).session(session);
        if (!user) return null;

        const amount = (user.shares || 1) * 1000;
        totalBatchAmount += amount;

        return await Transaction.create(
          [
            {
              user: id,
              type: "deposit",
              category: "monthly_deposit",
              subcategory: "Member Monthly Share",
              amount,
              month: targetMonth,
              year: targetYear,
              date: new Date(), // Set current date for trend grouping
              bankAccount: motherAccount._id,
              recordedBy: req.user.id,
              remarks: remarks || `Monthly Share: ${targetMonth} ${targetYear}`,
            },
          ],
          { session }
        );
      })
    );

    motherAccount.currentBalance += totalBatchAmount;
    await motherAccount.save({ session });

    await session.commitTransaction();
    res.status(201).json({
      success: true,
      message: `Batch of ৳${totalBatchAmount.toLocaleString()} processed.`,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ success: false, error: error.message });
  } finally {
    session.endSession();
  }
};

exports.getCollectionTrend = async (req, res) => {
  try {
    const trend = await this.getInternalTrendData();
    res.status(200).json({ success: true, trend });
  } catch (error) {
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
    // 1. Fetch all bank accounts to get actual society liquidity
    const accounts = await BankAccount.find();
    const totalLiquidity = accounts.reduce(
      (sum, acc) => sum + (acc.currentBalance || 0),
      0
    );

    // 2. Get Investment Stats
    const investmentStats = await Investment.aggregate([
      { $match: { status: "active" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    // 3. Count Active Members
    const totalMembers = await User.countDocuments({
      role: "member",
      status: "active",
    });

    /**
     * 🚀 NEW: Aggregate Total Society Shares
     * Sums the 'shares' field from all active users
     */
    const shareStats = await User.aggregate([
      { $match: { status: "active" } },
      { $group: { _id: null, totalShares: { $sum: "$shares" } } },
    ]);
    const totalSharesCount = shareStats[0]?.totalShares || 0;

    // 4. Get Recent Activity
    const recentTransactions = await Transaction.find()
      .sort({ date: -1 })
      .limit(8)
      .populate("user", "name")
      .lean();

    // 5. Generate Trend Data
    const trend = await this.getInternalTrendData();

    // 6. Final Response
    res.status(200).json({
      success: true,
      totalMembers,
      totalSharesCount, // 🔥 Added for Main Dashboard
      totalCollection: totalLiquidity,
      totalInvestments: investmentStats[0]?.total || 0,
      recentTransactions,
      collectionTrend: trend,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getInternalTrendData = async () => {
  const currentYear = new Date().getFullYear();

  // Aggregate by the actual 'date' field to support Direct Entries
  const trendData = await Transaction.aggregate([
    {
      $match: {
        type: "deposit",
        $or: [
          { year: currentYear },
          {
            date: {
              $gte: new Date(`${currentYear}-01-01`),
              $lte: new Date(`${currentYear}-12-31`),
            },
          },
        ],
      },
    },
    {
      $group: {
        _id: { $month: "$date" }, // Group by month index (1-12)
        total: { $sum: "$amount" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return monthNames
    .map((name, index) => {
      const found = trendData.find((d) => d._id === index + 1);
      return {
        name: name,
        total: found ? found.total : 0,
      };
    })
    .filter(
      (m) => m.total > 0 || new Date().getMonth() >= monthNames.indexOf(m.name)
    );
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
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { projectName, amount, bankAccount } = req.body;
    const fundingBank = await BankAccount.findById(bankAccount).session(
      session
    );

    if (!fundingBank || fundingBank.currentBalance < amount) {
      throw new Error("Insufficient funds in selected bank account.");
    }

    // 1. Create Project
    const investment = await Investment.create(
      [{ ...req.body, recordedBy: req.user.id }],
      { session }
    );

    // 2. Deduct Capital from Bank
    fundingBank.currentBalance -= Number(amount);
    await fundingBank.save({ session });

    // 3. Log Deduction in Ledger
    await Transaction.create(
      [
        {
          type: "expense",
          category: "investment_capital",
          subcategory: projectName,
          amount: Number(amount),
          bankAccount: fundingBank._id,
          recordedBy: req.user.id,
          remarks: `Capital outflow for ${projectName}`,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    res.status(201).json({ success: true, data: investment[0] });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
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
/**
 * @desc    Get member-specific dashboard stats (Synced with Modern UI)
 * @route   GET /api/finance/member-summary
 * @access  Private (Member/Admin)
 */
exports.getMemberSummary = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Personal Savings (Net Liquidity)
    const personalStats = await Transaction.aggregate([
      {
        $match: { user: new mongoose.Types.ObjectId(userId), type: "deposit" },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    // 2. Bank Accounts (Society Mother Account)
    const motherAccount = await BankAccount.findOne({ isMotherAccount: true });

    // 3. Active Investments (Society Level)
    const activeInvestment = await Investment.findOne({
      status: "active",
    }).sort({ createdAt: -1 });

    // 4. User Details for Shares & Member ID
    const userDetails = await User.findById(userId).select("shares phone");

    res.status(200).json({
      success: true,
      data: {
        // Stats for the 4 top cards
        netLiquidity: personalStats[0]?.total || 0,
        societyShares: userDetails?.shares || 0,
        memberId: userDetails?.phone || "N/A",

        // Bank Data
        bankAccount: {
          bankName: motherAccount?.bankName || "Society Treasury",
          branch: motherAccount?.branchName || "Main Branch",
          accountNumber: motherAccount?.accountNumber || "****2453",
          balance: motherAccount?.currentBalance || 0,
        },

        // Investment Data
        activeInvestment: {
          name: activeInvestment?.projectName || "No Active Projects",
          amount: activeInvestment?.amount || 0,
          category: activeInvestment?.investmentType || "Project Capital",
        },

        // Personal Registry List
        recentTransactions: await Transaction.find({ user: userId })
          .sort({ date: -1 })
          .limit(5)
          .lean(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Dashboard data sync failed",
      error: error.message,
    });
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
