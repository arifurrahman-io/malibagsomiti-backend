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

/**
 * ✅ API HANDLER: Get Collection Trend
 */
exports.getCollectionTrend = async (req, res) => {
  try {
    const trend = await this.getInternalTrendData();
    res.status(200).json({
      success: true,
      data: trend, // Wrapped in data for React Native compatibility [cite: 2025-10-11]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Check which members have already deposited for a specific month name/year
 * @route   GET /api/finance/check-payments
 */
/**
 * ✅ CHECK PAYMENTS: High-performance registry lookup [cite: 2025-10-11]
 * Identifies which members in a specific branch have already paid for a given month.
 */
exports.checkPayments = async (req, res) => {
  try {
    const { month, year, branch } = req.query;

    if (!month || !year || !branch) {
      return res.status(400).json({
        success: false,
        message: "Month, year, and branch are required parameters.",
      });
    }

    /**
     * 🚀 OPTIMIZED QUERY:
     * Using $lookup or pre-filtering by branch via populated user match.
     */
    const existingTransactions = await Transaction.find({
      type: "deposit",
      category: "monthly_deposit",
      month: month, // Direct string match (e.g., "January")
      year: parseInt(year),
    }).populate({
      path: "user",
      select: "branch",
      match: { branch: branch }, // Only populate if branch matches
    });

    /**
     * 🚀 DATA CLEANUP:
     * Filter out transactions where the user didn't match the branch criteria.
     */
    const paidMemberIds = existingTransactions
      .filter((t) => t.user !== null) // If match failed, user is null
      .map((t) => t.user._id);

    res.status(200).json({
      success: true,
      count: paidMemberIds.length,
      data: paidMemberIds,
    });
  } catch (error) {
    console.error("Payment Integrity Check Error:", error.message);
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

// @desc    Record a society expense & update bank balance
// @route   POST /api/finance/expense
exports.addExpense = async (req, res) => {
  try {
    const { amount, bankAccountId, date, category, remarks } = req.body;

    // 1. Validate Bank Account Existence
    const bank = await BankAccount.findById(bankAccountId);
    if (!bank) {
      return res
        .status(404)
        .json({ success: false, message: "Bank account not found" });
    }

    // 2. Derive standardized Date strings for registry consistency [cite: 2025-10-11]
    const expenseDate = date ? new Date(date) : new Date();
    const month = expenseDate.toLocaleString("default", { month: "long" });
    const year = expenseDate.getFullYear();

    // 3. Create the Transaction Registry Entry
    const expense = await Transaction.create({
      amount,
      category: category || "General Expense",
      remarks,
      bankAccount: bankAccountId,
      date: expenseDate,
      type: "expense",
      month,
      year,
      recordedBy: req.user.id,
    });

    // 4. ✅ DYNAMIC SYNC: Deduct from Bank Balance [cite: 2025-10-11]
    bank.currentBalance -= Number(amount);
    await bank.save();

    // 5. ✅ RESPOND: Structured for React Native state updates [cite: 2025-10-11]
    res.status(201).json({
      success: true,
      data: expense,
    });
  } catch (error) {
    console.error("Expense Recording Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to record expense",
      error: error.message,
    });
  }
};

// @desc    Comprehensive Global Dashboard Summary for Admins
exports.getAdminSummary = async (req, res) => {
  try {
    // 1. Fetch Society Liquidity (Total of all Bank Accounts)
    // Using lean() for faster read performance on the dashboard
    const accounts = await BankAccount.find().lean();
    const totalLiquidity = accounts.reduce(
      (sum, acc) => sum + (acc.currentBalance || 0),
      0
    );

    // 2. Investment Portfolio Stats
    const investmentStats = await Investment.aggregate([
      { $match: { status: "active" } },
      {
        $group: {
          _id: null,
          totalCapital: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    // 3. Member & Share Metrics
    const totalMembers = await User.countDocuments({
      role: "member",
      status: "active",
    });

    const shareStats = await User.aggregate([
      { $match: { status: "active", role: "member" } },
      { $group: { _id: null, totalShares: { $sum: "$shares" } } },
    ]);
    const totalSharesCount = shareStats[0]?.totalShares || 0;

    /**
     * 🚀 4. BRANCH PERFORMANCE AGGREGATION (Atomic & Real-time)
     * Instead of relying on User.totalDeposited, we calculate from the Transaction ledger.
     * This ensures the Progress Bar is 100% accurate [cite: 2025-10-11].
     */
    const branchStats = await User.aggregate([
      { $match: { role: "member", status: "active" } },
      {
        $lookup: {
          from: "transactions",
          localField: "_id",
          foreignField: "user",
          as: "memberTransactions",
        },
      },
      {
        $project: {
          branch: 1,
          deposits: {
            $filter: {
              input: "$memberTransactions",
              as: "tx",
              cond: { $eq: ["$$tx.type", "deposit"] },
            },
          },
        },
      },
      {
        $group: {
          _id: "$branch",
          collection: { $sum: { $sum: "$deposits.amount" } },
        },
      },
      {
        $project: {
          name: { $ifNull: ["$_id", "General"] },
          collection: 1,
          // Calculate progress against a target (e.g., ৳500,000)
          progress: {
            $min: [
              {
                $round: [
                  { $multiply: [{ $divide: ["$collection", 500000] }, 100] },
                  0,
                ],
              },
              100,
            ],
          },
        },
      },
      { $sort: { collection: -1 } },
    ]);

    // 5. Global Recent Activity Log
    const recentTransactions = await Transaction.find()
      .sort({ date: -1 })
      .limit(8)
      .populate("user", "name")
      .lean();

    // 6. Calculate Monthly Growth Trend [cite: 2025-10-11]
    const currentMonth = new Date().toLocaleString("default", {
      month: "long",
    });
    const currentYear = new Date().getFullYear();

    const monthlyGrowth = await Transaction.aggregate([
      {
        $match: {
          type: "deposit",
          month: currentMonth,
          year: currentYear,
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    // 7. ✅ STRUCTURED RESPONSE
    res.status(200).json({
      success: true,
      data: {
        totalNetWorth: totalLiquidity, // Hero Amount
        totalMembers, // Registry Card Value
        totalShares: totalSharesCount, // Registry Card Subtext
        activeProjects: investmentStats[0]?.count || 0, // Portfolio Card Value
        totalInvestments: investmentStats[0]?.totalCapital || 0,
        recentTransactions, // Activity Log
        branchStats: branchStats.length > 0 ? branchStats : [], // Branch Slider
        monthlyGrowth: monthlyGrowth[0]?.total || 0, // Trend Text
      },
    });
  } catch (error) {
    console.error("Dashboard Sync Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Governance data failed to synchronize.",
      error: error.message,
    });
  }
};

/**
 * ✅ GLOBAL TREND AGGREGATION
 * Supports Chart.js (Web) and React Native Gifted Charts (App) [cite: 2025-10-11]
 */
exports.getInternalTrendData = async () => {
  const currentYear = new Date().getFullYear();
  const currentMonthIndex = new Date().getMonth(); // 0-indexed

  // 1. Aggregate deposits using both date objects and string-based year fields
  const trendData = await Transaction.aggregate([
    {
      $match: {
        type: "deposit",
        $or: [
          { year: currentYear },
          {
            date: {
              $gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
              $lte: new Date(`${currentYear}-12-31T23:59:59.999Z`),
            },
          },
        ],
      },
    },
    {
      $group: {
        // Fallback: If date object missing, use a mapping for the 'month' string field
        _id: {
          $cond: [
            { $gt: ["$date", null] },
            { $month: "$date" },
            1, // Default to Jan if no date but exists in year (rare)
          ],
        },
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

  /**
   * 🚀 FORMATTING FOR WEB & APP:
   * Returns a complete dataset for charts, ensuring current and past months
   * are visible even with 0 collections.
   */
  const formattedTrend = monthNames.map((name, index) => {
    const found = trendData.find((d) => d._id === index + 1);
    return {
      label: name, // Standard for Web Chart.js
      value: found ? found.total : 0, // Standard for RN Gifted Charts
      // Metadata for high-end UI tooltips [cite: 2025-10-11]
      fullMonth: name,
      year: currentYear,
    };
  });

  // Filter to show months only up to the current month for a cleaner UI
  return formattedTrend.filter((_, index) => index <= currentMonthIndex);
};

// @desc    Get Global Financial Summary (Member View)
/**
 * ✅ GLOBAL SOCIETY SUMMARY: High-performance aggregation [cite: 2025-10-11]
 * Optimized for Web Dashboards and React Native Bento Grids.
 */
exports.getSocietySummary = async (req, res) => {
  try {
    // 1. Get Sum of all Bank Balances (Actual Liquidity) [cite: 2025-10-11]
    const accounts = await BankAccount.find();
    const totalBankBalance = accounts.reduce(
      (sum, acc) => sum + (acc.currentBalance || 0),
      0
    );

    // 2. Aggregate Transaction History for Audit Stats
    const financialStats = await Transaction.aggregate([
      {
        $group: {
          _id: "$type",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    // 3. Aggregate Active Investment Portfolio [cite: 2025-10-11]
    const investmentStats = await Investment.aggregate([
      { $match: { status: "active" } },
      {
        $group: {
          _id: null,
          totalCapital: { $sum: "$amount" },
          projectCount: { $sum: 1 },
        },
      },
    ]);

    // Extracting stats for the response
    const deposits =
      financialStats.find((s) => s._id === "deposit")?.total || 0;
    const expenses =
      financialStats.find((s) => s._id === "expense")?.total || 0;
    const activeInvestmentsValue = investmentStats[0]?.totalCapital || 0;

    /**
     * 🚀 DYNAMIC DATA STRUCTURE:
     * Structured to feed AdminDashboard hero cards and grid items [cite: 2025-10-11].
     */
    res.status(200).json({
      success: true,
      data: {
        totalNetWorth: totalBankBalance, // Society Liquidity
        totalDeposits: deposits, // Lifetime Registry total
        totalExpenses: expenses, // Lifetime Outflow
        activeInvestments: activeInvestmentsValue, // Capital in Projects
        projectCount: investmentStats[0]?.projectCount || 0,
        // Aligned with Registry key for collection progress [cite: 2025-10-11]
        totalCollection: totalBankBalance,
      },
    });
  } catch (error) {
    console.error("Society Summary Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not sync society summary.",
      error: error.message,
    });
  }
};

/**
 * ✅ BRANCH-SPECIFIC SUMMARY: High-performance aggregation
 * Optimized for Branch Analytics and Regional Performance Tracking [cite: 2025-10-11].
 */
exports.getBranchSummary = async (req, res) => {
  try {
    const { branch } = req.params;

    const summary = await Transaction.aggregate([
      // 1. Join with Users collection to access branch data [cite: 2025-10-11]
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "member",
        },
      },
      { $unwind: "$member" },
      // 2. Filter transactions belonging to members of the specific branch [cite: 2025-10-11]
      { $match: { "member.branch": branch } },
      // 3. Group by transaction type to calculate branch metrics [cite: 2025-10-11]
      {
        $group: {
          _id: "$type",
          totalAmount: { $sum: "$amount" },
          transactionCount: { $sum: 1 },
        },
      },
    ]);

    /**
     * 🚀 DATA NORMALIZATION:
     * Converts the array into a structured object for easy frontend consumption [cite: 2025-10-11].
     */
    const deposits = summary.find((s) => s._id === "deposit")?.totalAmount || 0;
    const expenses = summary.find((s) => s._id === "expense")?.totalAmount || 0;
    const txCount = summary.reduce(
      (acc, curr) => acc + curr.transactionCount,
      0
    );

    // 4. Fetch additional branch metadata (Total active members in this branch) [cite: 2025-10-11]
    const memberCount = await User.countDocuments({
      branch,
      role: "member",
      status: "active",
    });

    res.status(200).json({
      success: true,
      data: {
        branchName: branch,
        totalCollection: deposits,
        totalExpense: expenses,
        netBalance: deposits - expenses,
        memberCount,
        activityCount: txCount,
        // Calculate progress against a regional target (e.g., 200,000 BDT) [cite: 2025-10-11]
        targetProgress: Math.min(Math.round((deposits / 200000) * 100), 100),
      },
    });
  } catch (error) {
    console.error(`Branch Summary Error [${branch}]:`, error.message);
    res.status(500).json({
      success: false,
      message: "Could not retrieve branch metrics",
      error: error.message,
    });
  }
};

/**
 * @section 3. Investment Management (Full CRUD)
 */

/**
 * ✅ GET ALL INVESTMENTS: High-end portfolio tracker
 * Optimized for React Native Bento Grids and Web Analytical Dashboards [cite: 2025-10-11].
 */
exports.getAllInvestments = async (req, res) => {
  try {
    // 1. Fetch investments with audit metadata
    const investments = await Investment.find()
      .sort({ createdAt: -1 })
      .populate("recordedBy", "name")
      .lean(); // Use lean for faster read performance on mobile

    /**
     * 🚀 DATA ENRICHMENT:
     * We calculate ROI and health status on the server so the React Native app
     * can render progress bars instantly without local math [cite: 2025-10-11].
     */
    const enrichedInvestments = investments.map((project) => {
      const capital = project.amount || 0;
      const profit = project.totalProfit || 0;

      // Calculate ROI Percentage [cite: 2025-10-11]
      const roi = capital > 0 ? ((profit / capital) * 100).toFixed(1) : 0;

      return {
        ...project,
        roiPercentage: parseFloat(roi),
        // Visual status for high-end UI badges [cite: 2025-10-11]
        displayStatus: project.status === "active" ? "PROFITABLE" : "COMPLETED",
        // Formatting for currency consistency
        formattedCapital: `৳${capital.toLocaleString()}`,
        formattedProfit: `৳${profit.toLocaleString()}`,
      };
    });

    // 2. ✅ STRUCTURED RESPONSE: Wrapped in 'data' for frontend state sync [cite: 2025-10-11]
    res.status(200).json({
      success: true,
      count: enrichedInvestments.length,
      data: enrichedInvestments,
    });
  } catch (error) {
    console.error("Investment Registry Fetch Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch society portfolio",
      error: error.message,
    });
  }
};

/**
 * ✅ ADD INVESTMENT: Atomic transaction for society projects
 * Synchronizes Bank Balance, Project Registry, and Global Ledger [cite: 2025-10-11].
 */
exports.addInvestment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { projectName, amount, bankAccount, startDate, category } = req.body;

    // 1. Verify Funding Source
    const fundingBank = await BankAccount.findById(bankAccount).session(
      session
    );

    if (!fundingBank) {
      throw new Error("Target bank account not found.");
    }
    if (fundingBank.currentBalance < Number(amount)) {
      throw new Error(
        `Insufficient funds. Current balance: ৳${fundingBank.currentBalance}`
      );
    }

    // 2. Standardize Dates for App Registry [cite: 2025-10-11]
    const dateObj = startDate ? new Date(startDate) : new Date();
    const month = dateObj.toLocaleString("default", { month: "long" });
    const year = dateObj.getFullYear();

    // 3. Create Project Record
    const investment = await Investment.create(
      [
        {
          ...req.body,
          status: "active",
          recordedBy: req.user.id,
        },
      ],
      { session }
    );

    // 4. Update Society Bank Balance (Real-time Liquidity) [cite: 2025-10-11]
    fundingBank.currentBalance -= Number(amount);
    await fundingBank.save({ session });

    // 5. Create Ledger Entry (for History & Trend Charts)
    await Transaction.create(
      [
        {
          type: "expense",
          category: "investment_capital",
          amount: Number(amount),
          bankAccount: fundingBank._id,
          recordedBy: req.user.id,
          date: dateObj,
          month, // Used for App History Filtering
          year, // Used for App Trend Aggregation
          remarks: `Investment Capital: ${projectName}`,
          // Link transaction to project for better auditing
          referenceId: investment[0]._id,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    // 6. ✅ STRUCTURED RESPONSE: Wrapped in 'data' for React Native UI sync [cite: 2025-10-11]
    res.status(201).json({
      success: true,
      message: "Investment project initiated successfully",
      data: investment[0],
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Investment Failure:", error.message);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to process investment",
    });
  } finally {
    session.endSession();
  }
};

/**
 * ✅ UPDATE INVESTMENT: Super-Admin Governance
 * Handles metadata changes, legal document swaps, and data normalization [cite: 2025-10-11].
 */
exports.updateInvestment = async (req, res) => {
  try {
    let investment = await Investment.findById(req.params.id);
    if (!investment) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    // 1. Prepare dynamic update fields [cite: 2025-10-11]
    const updateFields = {
      projectName: req.body.projectName || investment.projectName,
      amount: req.body.amount ? Number(req.body.amount) : investment.amount,
      status: req.body.status || investment.status,
      remarks: req.body.remarks || investment.remarks,
      // Ensure date consistency for History filtering
      date: req.body.date ? new Date(req.body.date) : investment.date,
    };

    // 2. Handle Legal Document Updates (Multer Integration)
    if (req.file) {
      // Delete old file if it exists to save server space
      if (investment.legalDocs) {
        const oldPath = path.join(__dirname, "../../", investment.legalDocs);
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch (err) {
            console.error("File deletion error:", err.message);
          }
        }
      }
      // Normalize path for both Web and Android/iOS
      updateFields.legalDocs = req.file.path.replace(/\\/g, "/");
    }

    // 3. Execute Update
    const updated = await Investment.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).lean();

    /**
     * 🚀 APP OPTIMIZATION:
     * We attach the full server URL to the legalDocs path so the React Native
     * app can open the document directly in a WebView or via expo-sharing.
     */
    const protocol = req.protocol;
    const host = req.get("host");
    if (updated.legalDocs) {
      updated.documentUrl = `${protocol}://${host}/${updated.legalDocs}`;
    }

    res.status(200).json({
      success: true,
      message: "Investment updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Investment Update Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
    });
  }
};

/**
 * ✅ DELETE INVESTMENT: Super-Admin Governance
 * Removes project registry, cleans up legal files, and handles audit trail [cite: 2025-10-11].
 */
exports.deleteInvestment = async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.id);

    if (!investment) {
      return res.status(404).json({
        success: false,
        message: "Project record not found in society registry.",
      });
    }

    // 1. Storage Cleanup: Remove legal documents from server
    if (investment.legalDocs) {
      const filePath = path.join(__dirname, "../../", investment.legalDocs);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error(
            "File deletion failed during project removal:",
            err.message
          );
          // We continue deletion even if file removal fails to avoid stuck records
        }
      }
    }

    // 2. Optional: Check for active profits before deletion
    if (investment.totalProfit > 0 && investment.status === "active") {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete an active project with recorded profits. Please close the project first.",
      });
    }

    // 3. Delete the Document
    await investment.deleteOne();

    /**
     * 🚀 APP SYNC:
     * Provide a clear success message that can be used in a Toast or Alert
     * on the React Native side to confirm the deletion [cite: 2025-10-11].
     */
    res.status(200).json({
      success: true,
      message: "Project and associated documents removed successfully.",
      deletedId: req.params.id, // Return ID to help frontend filter state
    });
  } catch (error) {
    console.error("Investment Deletion Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Security protocols prevented project deletion.",
      error: error.message,
    });
  }
};

/**
 * ✅ RECORD INVESTMENT PROFIT/EXPENSE
 * Updates Project ROI, Bank Liquidity, and Global Ledger [cite: 2025-10-11].
 */
exports.recordInvestmentProfit = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { amount, remarks, month, year, type, bankAccountId } = req.body;
    const investment = await Investment.findById(req.params.id).session(
      session
    );

    if (!investment) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    // 1. Identify the Target Bank for the Cash Flow [cite: 2025-10-11]
    const bank = await BankAccount.findById(bankAccountId).session(session);
    if (!bank) {
      throw new Error(
        "A valid bank account must be selected to record profit/expense."
      );
    }

    const numericAmount = parseFloat(amount);

    // 2. Update Project Internal Ledger
    if (type === "expense") {
      investment.totalProfit -= numericAmount;
      bank.currentBalance -= numericAmount; // Deduct from society liquidity
    } else {
      investment.totalProfit += numericAmount;
      bank.currentBalance += numericAmount; // Add to society liquidity
    }

    await investment.save({ session });
    await bank.save({ session });

    // 3. Create Global Transaction Record [cite: 2025-10-11]
    const transaction = await Transaction.create(
      [
        {
          type: type === "expense" ? "expense" : "deposit",
          category:
            type === "expense" ? "investment_expense" : "investment_profit",
          subcategory: investment.projectName,
          amount: numericAmount,
          bankAccount: bank._id,
          month:
            month || new Date().toLocaleString("default", { month: "long" }),
          year: year || new Date().getFullYear(),
          recordedBy: req.user.id,
          date: new Date(),
          remarks: `${type === "expense" ? "Expense" : "Profit"} - ${
            investment.projectName
          }: ${remarks || ""}`,
          referenceId: investment._id,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    /**
     * 🚀 APP SYNC:
     * Returning the updated investment object allows the React Native app
     * to update the ROI chart immediately [cite: 2025-10-11].
     */
    res.status(200).json({
      success: true,
      message: `Project ${type} recorded successfully`,
      data: {
        updatedInvestment: investment,
        newBankBalance: bank.currentBalance,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Investment ROI Update Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

/**
 * ✅ GET INVESTMENT HISTORY: Full Audit Trail
 * Retrieves all capital outflows, profits, and expenses linked to a project [cite: 2025-10-11].
 */
exports.getInvestmentHistory = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Verify Project Existence
    const project = await Investment.findById(id).lean();
    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Investment project not found.",
      });
    }

    /**
     * 🚀 RELIABLE QUERY LOGIC:
     * We search for transactions explicitly linked via referenceId OR subcategory.
     * This captures capital outflows (recorded at creation) and profit/expense entries.
     */
    const history = await Transaction.find({
      $or: [{ referenceId: id }, { subcategory: project.projectName }],
    })
      .populate("recordedBy", "name")
      .populate("bankAccount", "accountName") // Shows which bank was used
      .sort({ date: -1 })
      .lean();

    /**
     * 🚀 DATA NORMALIZATION:
     * We structure the response to provide both the raw ledger and a
     * project summary for the "Header" of the app screen [cite: 2025-10-11].
     */
    res.status(200).json({
      success: true,
      data: {
        projectSummary: {
          name: project.projectName,
          capital: project.amount,
          currentProfit: project.totalProfit,
          status: project.status,
          roi:
            project.amount > 0
              ? ((project.totalProfit / project.amount) * 100).toFixed(2)
              : 0,
        },
        transactions: history,
      },
    });
  } catch (error) {
    console.error("Investment Audit Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve project ledger",
      error: error.message,
    });
  }
};

/**
 * ✅ GENERATE INVESTMENT REPORT DATA
 * Optimized for expo-print (App) and Window.print (Web) [cite: 2025-10-11].
 */
exports.downloadInvestmentReport = async (req, res) => {
  try {
    // 1. Fetch Project with expanded Auditor details
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
     * 🚀 RELIABLE AUDIT TRAIL:
     * Using ID-based matching to ensure no data is mixed up in the report [cite: 2025-10-11].
     */
    const history = await Transaction.find({
      $or: [
        { referenceId: investment._id },
        { subcategory: investment.projectName },
      ],
    })
      .populate("bankAccount", "accountName")
      .sort({ date: 1 })
      .lean();

    // 2. Comprehensive Financial Calculations
    const totalProfits = history
      .filter((t) => t.category === "investment_profit")
      .reduce((acc, curr) => acc + curr.amount, 0);

    const totalExpenses = history
      .filter((t) => t.category === "investment_expense")
      .reduce((acc, curr) => acc + curr.amount, 0);

    const initialCapital = investment.amount;
    const netYield = investment.totalProfit; // Calculated in recordProfit controller

    const roiValue = initialCapital > 0 ? (netYield / initialCapital) * 100 : 0;

    /**
     * 🚀 PDF-READY DATA OBJECT:
     * We provide raw numbers for charts and formatted strings for the table
     * to ensure high-end UI/UX [cite: 2025-10-11].
     */
    res.status(200).json({
      success: true,
      data: {
        reportMetadata: {
          generatedAt: new Date().toISOString(),
          societyName: "Malibag Somiti", // Branding for header [cite: 2025-10-11]
          reportType: "Project Performance Statement",
        },
        project: {
          id: investment._id,
          name: investment.projectName,
          capital: initialCapital,
          formattedCapital: `৳${initialCapital.toLocaleString()}`,
          netYield: netYield,
          formattedYield: `৳${netYield.toLocaleString()}`,
          roi: `${roiValue.toFixed(2)}%`,
          status: investment.status.toUpperCase(),
          startDate: investment.date,
          auditor: investment.recordedBy?.name || "System Admin",
          remarks: investment.remarks || "No additional remarks.",
        },
        // Transactions formatted for PDF Tables
        transactions: history.map((t) => ({
          date: new Date(t.date).toLocaleDateString("en-GB"),
          type: t.type.toUpperCase(),
          category: t.category.replace("_", " ").toUpperCase(),
          bank: t.bankAccount?.accountName || "N/A",
          amount: t.amount,
          formattedAmount: `৳${t.amount.toLocaleString()}`,
          remarks: t.remarks,
        })),
        summary: {
          totalInflow: totalProfits,
          totalOutflow: totalExpenses + initialCapital,
          netPosition: totalProfits - (totalExpenses + initialCapital),
          transactionCount: history.length,
        },
      },
    });
  } catch (error) {
    console.error("Report Prep Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to generate comprehensive report data",
      error: error.message,
    });
  }
};

/**
 * ✅ GET ALL TRANSACTIONS: High-Performance Audit Trail
 * Optimized for Infinite Scroll (App) and Paginated Tables (Web) [cite: 2025-10-11].
 */
exports.getAllTransactions = async (req, res) => {
  try {
    // 1. Extract Query Parameters for Filtering [cite: 2025-10-11]
    const {
      page = 1,
      limit = 20,
      type,
      category,
      branch,
      startDate,
      endDate,
    } = req.query;

    // 2. Build Dynamic Filter Object
    const query = {};
    if (type) query.type = type;
    if (category) query.category = category;

    // Filter by Date Range if provided
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // 3. Join with Users to support Branch-based filtering
    // If filtering by branch, we use an aggregation or separate logic
    let transactionQuery = Transaction.find(query);

    if (branch) {
      // Find users in that branch first to filter transactions
      const usersInBranch = await User.find({ branch }).select("_id");
      const userIds = usersInBranch.map((u) => u._id);
      query.user = { $in: userIds };
    }

    // 4. Execute Paginated Query
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transactions = await Transaction.find(query)
      .populate("user", "name bankAccount branch")
      .populate("recordedBy", "name")
      .populate("bankAccount", "accountName") // Added for audit clarity
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // 5. Get Total Count for Frontend Pagination Logic
    const totalTransactions = await Transaction.countDocuments(query);

    /**
     * 🚀 APP-FRIENDLY RESPONSE:
     * Includes metadata to help the React Native app handle "Infinite Loading".
     */
    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        total: totalTransactions,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalTransactions / limit),
        hasNextPage: skip + transactions.length < totalTransactions,
      },
    });
  } catch (error) {
    console.error("Audit Trail Fetch Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Security check: Failed to retrieve audit logs.",
      error: error.message,
    });
  }
};

/**
 * ✅ DELETE TRANSACTION: Super-Admin Governance
 * Reverses financial impact on Bank and User profiles before deletion [cite: 2025-10-11].
 */
exports.deleteTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const transaction = await Transaction.findById(req.params.id).session(
      session
    );

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction record not found." });
    }

    // 1. REVERSE BANK BALANCE [cite: 2025-10-11]
    if (transaction.bankAccount) {
      const bank = await BankAccount.findById(transaction.bankAccount).session(
        session
      );
      if (bank) {
        if (transaction.type === "deposit") {
          bank.currentBalance -= transaction.amount; // Reverse deposit
        } else if (transaction.type === "expense") {
          bank.currentBalance += transaction.amount; // Reverse expense
        }
        await bank.save({ session });
      }
    }

    // 2. REVERSE MEMBER DEPOSIT (if applicable) [cite: 2025-10-11]
    if (transaction.user && transaction.category === "monthly_deposit") {
      const user = await User.findById(transaction.user).session(session);
      if (user) {
        user.totalDeposited -= transaction.amount;
        // Optionally decrement shares if the logic requires it
        await user.save({ session });
      }
    }

    // 3. REVERSE INVESTMENT PROFIT (if applicable)
    if (
      transaction.referenceId &&
      transaction.category.includes("investment")
    ) {
      const project = await Investment.findById(
        transaction.referenceId
      ).session(session);
      if (project) {
        if (transaction.type === "deposit") {
          project.totalProfit -= transaction.amount;
        } else {
          project.totalProfit += transaction.amount;
        }
        await project.save({ session });
      }
    }

    // 4. Finalize Deletion
    await transaction.deleteOne({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Transaction reversed and removed successfully.",
      deletedId: req.params.id,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Deletion/Reversal Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Security protocols failed to reverse this transaction.",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/**
 * ✅ GET COLLECTION TREND: High-End Analytics
 * Optimized for Line/Bar charts on Web and Mobile [cite: 2025-10-11].
 */
exports.getCollectionTrend = async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const currentMonthIndex = new Date().getMonth();

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

    /**
     * 🚀 DATA NORMALIZATION:
     * We map all months to ensure the chart line is continuous.
     * We also format keys for GiftedCharts (value/label) and Chart.js (total/name).
     */
    const dynamicTrend = monthOrder.map((m, index) => {
      const found = trendData.find((d) => d._id === m);
      const amount = found ? found.total : 0;

      return {
        label: m.substring(0, 3), // e.g., "Jan"
        value: amount, // Used by RN Gifted Charts
        total: amount, // Used by Web Chart.js
        name: m, // Full month for tooltips
        monthIndex: index,
      };
    });

    // Calculate Growth: Current vs Last Month
    const currentMonthData = dynamicTrend[currentMonthIndex]?.total || 0;
    const lastMonthData = dynamicTrend[currentMonthIndex - 1]?.total || 0;
    const growth =
      lastMonthData > 0
        ? (((currentMonthData - lastMonthData) / lastMonthData) * 100).toFixed(
            1
          )
        : 0;

    res.status(200).json({
      success: true,
      data: {
        chartData: dynamicTrend.filter((_, i) => i <= currentMonthIndex), // Show only up to current month
        stats: {
          currentMonthTotal: currentMonthData,
          growthPercentage: growth,
          isPositive: growth >= 0,
        },
      },
    });
  } catch (error) {
    console.error("Trend Aggregation Error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Get member-specific dashboard stats (Synced with Modern UI)
 * @route   GET /api/finance/member-summary
 * @access  Private (Member/Admin)
 */
exports.getMemberSummary = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Personal Savings (Net Liquidity card)
    const personalStats = await Transaction.aggregate([
      {
        $match: { user: new mongoose.Types.ObjectId(userId), type: "deposit" },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    /**
     * 2. Bank Accounts (Sliding Data)
     * Changed from findOne to find() to support multiple accounts (Savings, Current, FDR)
     *
     */
    const bankAccounts = await BankAccount.find({
      $or: [{ isMotherAccount: true }, { currentBalance: { $gt: 0 } }],
    }).lean();

    /**
     * 3. Active Investments (Sliding Data)
     * Changed from findOne to find() to support multiple active projects [cite: 2025-10-11]
     */
    const investments = await Investment.find({
      status: "active",
    })
      .sort({ createdAt: -1 })
      .lean();

    // 4. User Details for Shares & Member ID
    const userDetails = await User.findById(userId).select("shares phone");

    res.status(200).json({
      success: true,
      data: {
        // Top Card Stats
        netLiquidity: personalStats[0]?.total || 0,
        societyShares: userDetails?.shares || 0,
        memberId: userDetails?.phone || "N/A",

        /**
         * 5. Arrays for sliding components [cite: 2025-10-11]
         * These keys must match your Dashboard.jsx FlatList data props
         */
        bankAccounts: bankAccounts.map((acc) => ({
          _id: acc._id,
          bankName: acc.bankName,
          accountNumber: acc.accountNumber || "****2453",
          currentBalance: acc.currentBalance || 0,
          accountType: acc.accountType || "SAVINGS",
        })),

        investments: investments.map((inv) => ({
          _id: inv._id,
          projectName: inv.projectName,
          amount: inv.amount || 0,
          investmentType: inv.investmentType || "Project Capital",
        })),

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
 * ✅ GET MEMBER HISTORY: Personal Ledger & Portfolio Summary
 * Dual-purpose: Member views own history, Admin views member details [cite: 2025-10-11].
 */
exports.getMemberHistory = async (req, res) => {
  try {
    // 1. Identify Target User
    const userId = req.params.id || req.user.id;

    // 2. Fetch User Profile for Summary Header
    const user = await User.findById(userId)
      .select("name totalDeposited shares branch joiningDate status")
      .lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Member record not found." });
    }

    // 3. Fetch Paginated Transactions
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const history = await Transaction.find({ user: userId })
      .sort({ date: -1 })
      .populate("recordedBy", "name")
      .populate("bankAccount", "accountName") // Shows where their money was deposited
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const totalCount = await Transaction.countDocuments({ user: userId });

    /**
     * 🚀 DATA NORMALIZATION:
     * We group the response so the App/Web can show a high-end "Stats Header"
     * followed by the transaction list [cite: 2025-10-11].
     */
    res.status(200).json({
      success: true,
      data: {
        memberProfile: {
          name: user.name,
          branch: user.branch,
          shares: user.shares || 0,
          totalContribution: user.totalDeposited || 0,
          joiningDate: user.joiningDate,
          accountStatus: user.status.toUpperCase(),
        },
        transactions: history.map((t) => ({
          ...t,
          // Format date for regional readability [cite: 2025-10-11]
          formattedDate: new Date(t.date).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }),
          isDeposit: t.type === "deposit",
        })),
        pagination: {
          total: totalCount,
          currentPage: parseInt(page),
          hasNextPage: skip + history.length < totalCount,
        },
      },
    });
  } catch (error) {
    console.error("Member Ledger Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not retrieve member history.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get Single Investment Details
 * @route   GET /api/finance/investment/:id
 * @access  Protected
 */
exports.getInvestmentById = async (req, res) => {
  try {
    // We use findById and populate bank info for the bento grid
    const investment = await Investment.findById(req.params.id)
      .populate("bankAccount", "bankName accountNumber")
      .lean();

    if (!investment) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    res.status(200).json({ success: true, data: investment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
