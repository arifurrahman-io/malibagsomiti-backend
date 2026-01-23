const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Investment = require("../models/Investment");
const { sendDepositEmail } = require("../utils/email");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const BankAccount = require("../models/BankAccount");
const FineSetting = require("../models/FineSetting");
const admin = require("../config/firebase");
const { sendPushNotification } = require("../utils/notification");
const Notification = require("../models/Notification");

const dir = "./uploads/documents/";

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

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
    const {
      userIds = [],
      membersPayingFine = [],
      remarks,
      month,
      year,
    } = req.body;

    const motherAccount = await BankAccount.findOne({
      isMotherAccount: true,
    }).session(session);
    if (!motherAccount)
      throw new Error("No Mother Account designated in registry.");

    const settings = (await FineSetting.findOne().session(session)) || {
      gracePeriodMonths: 2,
      finePercentage: 5,
    };

    const targetMonth =
      month || new Date().toLocaleString("default", { month: "long" });
    const targetYear = year || new Date().getFullYear();
    let totalBatchAmount = 0;

    const depositDataList = [];
    const notificationsToInsert = [];
    const fcmTokensToSend = [];

    // 1️⃣ Loop through users to process ledger entries
    for (const id of userIds) {
      const user = await User.findById(id).session(session);
      if (!user) continue;

      const shareAmount = (user.shares || 1) * 1000;
      let memberTransactionTotal = shareAmount;

      // --- 🚀 FINE PROCESSING ---
      if (membersPayingFine.includes(id)) {
        // Aggregate without session to avoid MongoDB "Illegal Operation" errors
        const fineReductions = await Transaction.aggregate([
          {
            $match: {
              user: user._id,
              category: { $in: ["fine_waiver", "fine_payment"] },
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);

        const totalReduced = fineReductions[0]?.total || 0;
        const fineCalc = calculateFineLogic(user, settings, totalReduced);
        const fineToPay = fineCalc.fine;

        if (fineToPay > 0) {
          memberTransactionTotal += fineToPay;
          await Transaction.create(
            [
              {
                user: id,
                type: "deposit",
                category: "fine_payment",
                amount: fineToPay,
                month: targetMonth,
                year: targetYear,
                date: new Date(),
                bankAccount: motherAccount._id,
                recordedBy: req.user.id,
                remarks: `Penalty Payment: ${targetMonth} ${targetYear}`,
              },
            ],
            { session },
          );
        }
      }

      // Update user savings
      const updatedUser = await User.findByIdAndUpdate(
        id,
        { $inc: { totalDeposited: shareAmount } },
        { session, new: true },
      );

      // Record Share Deposit
      await Transaction.create(
        [
          {
            user: id,
            type: "deposit",
            category: "monthly_deposit",
            subcategory: "Member Monthly Share",
            amount: shareAmount,
            month: targetMonth,
            year: targetYear,
            date: new Date(),
            bankAccount: motherAccount._id,
            recordedBy: req.user.id,
            remarks: remarks || `Monthly Share: ${targetMonth} ${targetYear}`,
          },
        ],
        { session },
      );

      totalBatchAmount += memberTransactionTotal;

      // 2️⃣ Collect data for Notifications/Emails
      depositDataList.push({
        email: user.email,
        name: user.name,
        amount: memberTransactionTotal,
        totalBalance: updatedUser.totalDeposited,
        month: targetMonth,
        year: targetYear,
      });

      if (user.fcmTokens?.length > 0) {
        fcmTokensToSend.push(...user.fcmTokens);
        user.fcmTokens.forEach((token) => {
          notificationsToInsert.push({
            userId: user._id,
            title: "Deposit Confirmed 💰",
            body: `৳${memberTransactionTotal.toLocaleString()} received for ${targetMonth}.`,
            type: "DEPOSIT",
            fcmToken: token,
            sentAt: new Date(),
          });
        });
      }
    }

    motherAccount.currentBalance += totalBatchAmount;
    await motherAccount.save({ session });

    // 3️⃣ Commit DB Changes
    await session.commitTransaction();
    session.endSession();

    // 4️⃣ Execute Async Tasks (Email and Push)
    // We use Promise.allSettled so if one email fails, others still send

    // Save bell notifications
    if (notificationsToInsert.length > 0) {
      Notification.insertMany(notificationsToInsert).catch((e) =>
        console.error("Bell Error:", e),
      );
    }

    // Send Push Notifications
    if (fcmTokensToSend.length > 0) {
      sendPushNotification(fcmTokensToSend, {
        notification: {
          title: "Deposit Confirmed 💰",
          body: `Monthly payment for ${targetMonth} processed.`,
        },
        data: { screen: "Dashboard", type: "DEPOSIT" },
      }).catch((e) => console.error("Push Error:", e));
    }

    // ✅ FIXED: Send Emails with individual error handling
    if (depositDataList.length > 0) {
      Promise.allSettled(
        depositDataList.map((data) =>
          sendDepositEmail(data.email, {
            name: data.name,
            amount: data.amount,
            date: new Date().toLocaleDateString("en-GB"),
            totalBalance: data.totalBalance,
            month: data.month,
            year: data.year,
          }),
        ),
      ).then((results) => {
        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0)
          console.error(`${failed.length} emails failed to send.`);
      });
    }

    res.status(201).json({
      success: true,
      message: `Batch complete: ৳${totalBatchAmount.toLocaleString()} added to Treasury.`,
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("Critical Deposit Failure:", error.message);
    res.status(500).json({ success: false, error: error.message });
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

    // 1. Validation: Only Month and Year are strictly required for a global check
    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: "Month and year are required parameters.",
      });
    }

    // 2. Build Dynamic Match Filter
    // We only filter by branch if it's provided and not set to "All"
    const userMatch = {};
    if (branch && branch !== "All") {
      userMatch.branch = branch;
    }

    /**
     * 🚀 OPTIMIZED QUERY:
     * Fetch transactions and populate users based on the dynamic branch filter.
     */
    const existingTransactions = await Transaction.find({
      type: "deposit",
      category: "monthly_deposit",
      month: month, // Direct string match (e.g., "January")
      year: parseInt(year),
    }).populate({
      path: "user",
      select: "branch _id",
      match: Object.keys(userMatch).length > 0 ? userMatch : null, // Apply branch filter only if needed
    });

    /**
     * 🚀 DATA CLEANUP:
     * 1. Filter out transactions where the user didn't match the branch (if branch was specified).
     * 2. If branch is "All", we keep everyone who has a valid user object.
     */
    const paidMemberIds = existingTransactions
      .filter((t) => t.user !== null)
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

/**
 * @desc    Comprehensive Global Dashboard Summary for Admins
 * @route   GET /api/finance/summary
 * @access  Private (Admin/Super-Admin)
 */
exports.getAdminSummary = async (req, res) => {
  try {
    // 1. Fetch Global Fine Settings from Database
    const settings = (await FineSetting.findOne().lean()) || {
      gracePeriodMonths: 1,
      finePercentage: 5,
    };

    // 2. Parallel Data Fetching for High-Performance Performance
    const [accounts, investmentStats, members, shareStats, fineReductions] =
      await Promise.all([
        BankAccount.find().lean(), // Fetches all registry accounts
        Investment.aggregate([
          { $match: { status: "active" } },
          {
            $group: {
              _id: null,
              totalCapital: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ]),
        User.find({ role: "member", status: "active" }).select(
          "name phone joiningDate shares monthlySubscription branch totalDeposited",
        ),
        User.aggregate([
          { $match: { status: "active", role: "member" } },
          { $group: { _id: null, totalShares: { $sum: "$shares" } } },
        ]),
        /**
         * 🔥 CORE UPDATE: Aggregate all fine reductions (Waivers + Payments)
         * We subtract these categories from the calculated penalty to get the real 'Due' balance.
         */
        Transaction.aggregate([
          { $match: { category: { $in: ["fine_waiver", "fine_payment"] } } },
          { $group: { _id: "$user", totalReduced: { $sum: "$amount" } } },
        ]),
      ]);

    // 3. Calculation of Society Liquidity (Total Net Worth)
    const totalLiquidity = accounts.reduce(
      (sum, acc) => sum + (acc.currentBalance || 0),
      0,
    );

    // 4. 🔥 CORE LOGIC: Aggregate Total Fine Due Society-Wide
    let societyTotalFine = 0;

    members.forEach((member) => {
      // Find total of already paid or waived amounts for this specific member
      const memberReduction = fineReductions.find(
        (r) => r._id?.toString() === member._id?.toString(),
      );
      const totalReduced = memberReduction ? memberReduction.totalReduced : 0;

      /**
       * 🚀 SYNCED CALCULATION:
       * Uses the centralized helper to ensure 100% consistency across the platform.
       */
      const calc = calculateFineLogic(member, settings, totalReduced);
      societyTotalFine += calc.fine;
    });

    // 5. Branch Performance Aggregation (Regional Analytics)
    const branchStats = await User.aggregate([
      { $match: { role: "member", status: "active" } },
      {
        $lookup: {
          from: "transactions",
          localField: "_id",
          foreignField: "user",
          as: "txs",
        },
      },
      {
        $project: {
          branch: { $ifNull: ["$branch", "General"] },
          deposits: {
            $filter: {
              input: { $ifNull: ["$txs", []] },
              as: "t",
              cond: { $eq: ["$$t.type", "deposit"] },
            },
          },
        },
      },
      {
        $group: {
          _id: "$branch",
          collection: {
            $sum: {
              $reduce: {
                input: "$deposits",
                initialValue: 0,
                in: { $add: ["$$value", { $ifNull: ["$$this.amount", 0] }] },
              },
            },
          },
          memberCount: { $sum: 1 },
        },
      },
      {
        $project: {
          name: "$_id",
          collection: 1,
          memberCount: 1,
          // Progress vs regional target of ৳500,000
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

    // 6. Generate Chart Data (Income vs Expenditure)
    const today = new Date();
    const currentYear = today.getFullYear();
    const monthlyStats = await Transaction.aggregate([
      {
        $match: {
          $or: [{ year: currentYear }, { year: currentYear.toString() }],
        },
      },
      {
        $group: {
          _id: { month: "$month", type: "$type" },
          total: { $sum: "$amount" },
        },
      },
    ]);

    const monthNames = [
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

    const chartData = monthNames.map((m) => {
      const income =
        monthlyStats.find((s) => s._id.month === m && s._id.type === "deposit")
          ?.total || 0;
      const expense =
        monthlyStats.find((s) => s._id.month === m && s._id.type === "expense")
          ?.total || 0;
      return {
        label: m.substring(0, 3),
        income,
        expense,
      };
    });

    // 7. Recent Transactions Feed
    const recentTransactions = await Transaction.find()
      .sort({ date: -1 })
      .limit(10) // Enhanced limit for deeper logs view
      .populate("user", "name")
      .lean();

    const currentMonthLabel = monthNames[today.getMonth()].substring(0, 3);
    const monthlyGrowth =
      chartData.find((d) => d.label === currentMonthLabel)?.income || 0;

    // 8. Final Response Mapped to React Native UI structure
    res.status(200).json({
      success: true,
      data: {
        totalNetWorth: totalLiquidity,
        totalMembers: members.length,
        totalShares: shareStats[0]?.totalShares || 0,
        activeProjects: investmentStats[0]?.count || 0,
        totalInvestments: investmentStats[0]?.totalCapital || 0,
        totalFineDue: societyTotalFine, // Aggregated remaining fine balance
        recentTransactions,
        branchStats: branchStats.length > 0 ? branchStats : [],
        topDepositors: members.map((member) => ({
          _id: member._id,
          name: member.name,
          phone: member.phone,
          branch: member.branch || "General",
          totalDeposited: member.totalDeposited || 0,
        })), // Passed for the Branch Registry FlatList
        monthlyGrowth,
        chartData,
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
 * @desc    Get Smooth Area Chart Data (Monthly Income vs Expense)
 * @route   GET /api/finance/analytics/monthly-comparison
 */
exports.getMonthlyComparisonTrend = async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();

    const stats = await Transaction.aggregate([
      {
        $match: {
          year: currentYear.toString(), // আপনার মডেলে বছর স্ট্রিং হিসেবে থাকলে
        },
      },
      {
        $group: {
          _id: { month: "$month", type: "$type" },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    const months = [
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

    // ডাটা ফরম্যাটিং (React Native এর জন্য)
    const chartData = months.map((m) => {
      const deposit = stats.find(
        (s) => s._id.month === m && s._id.type === "deposit",
      );
      const expense = stats.find(
        (s) => s._id.month === m && s._id.type === "expense",
      );

      return {
        label: m.substring(0, 3),
        income: deposit ? deposit.totalAmount : 0,
        expense: expense ? expense.totalAmount : 0,
      };
    });

    res.status(200).json({
      success: true,
      data: chartData,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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
      0,
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
      0,
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
 * ✅ ADD INVESTMENT: নতুন প্রজেক্ট বা ইনভেস্টমেন্ট শুরু করা
 * এটি অটোমেটিকভাবে ব্যাংক ব্যালেন্স আপডেট করে, লেজার এন্ট্রি তৈরি করে এবং মেম্বারদের নোটিফিকেশন পাঠায়।
 */
exports.addInvestment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { projectName, amount, bankAccount, startDate, remarks } = req.body;

    // 1️⃣ Validate Funding Source
    const fundingBank =
      await BankAccount.findById(bankAccount).session(session);
    if (!fundingBank) {
      throw new Error("Target bank account not found in registry.");
    }
    if (fundingBank.currentBalance < Number(amount)) {
      throw new Error(
        `Insufficient funds in ${fundingBank.bankName}. Available: ৳${fundingBank.currentBalance.toLocaleString()}`,
      );
    }

    // 2️⃣ File Upload Handling
    let legalDocsPath = "";
    if (req.file) {
      legalDocsPath = `/uploads/documents/${req.file.filename}`;
    }

    // 3️⃣ Date Formatting
    const dateObj = startDate ? new Date(startDate) : new Date();
    const month = dateObj.toLocaleString("default", { month: "long" });
    const year = dateObj.getFullYear();

    // 4️⃣ Create Investment Record
    const investment = await Investment.create(
      [
        {
          projectName,
          amount: Number(amount),
          bankAccount,
          remarks,
          legalDocs: legalDocsPath,
          status: "active",
          recordedBy: req.user.id,
          date: dateObj,
        },
      ],
      { session },
    );

    // 5️⃣ Update Bank Balance
    fundingBank.currentBalance -= Number(amount);
    await fundingBank.save({ session });

    // 6️⃣ Create Transaction Record (Audit Trail)
    await Transaction.create(
      [
        {
          user: req.user.id,
          type: "investment",
          category: "Investment",
          subcategory: projectName,
          amount: Number(amount),
          bankAccount: fundingBank._id,
          recordedBy: req.user.id,
          date: dateObj,
          month,
          year,
          remarks: `Capital Allocation: ${projectName}`,
          referenceId: investment[0]._id,
        },
      ],
      { session },
    );

    // 7️⃣ Commit Transaction - Critical for data integrity before notifications
    await session.commitTransaction();
    session.endSession();

    // 8️⃣ Fetch Active Members With FCM Tokens
    try {
      const allMembers = await User.find({
        role: "member",
        status: "active",
        fcmTokens: { $exists: true, $ne: [] },
      }).select("fcmTokens _id");

      const notificationsToInsert = [];
      const tokensToSend = [];

      const notifTitle = `New Project Initiated! 🚀`;
      const notifBody = `We just started "${projectName}" with a capital of ৳${Number(amount).toLocaleString()}.`;

      allMembers.forEach((member) => {
        if (Array.isArray(member.fcmTokens) && member.fcmTokens.length > 0) {
          tokensToSend.push(...member.fcmTokens);

          member.fcmTokens.forEach((token) => {
            notificationsToInsert.push({
              userId: member._id,
              title: notifTitle,
              body: notifBody,
              type: "INVESTMENT",
              referenceId: investment[0]._id,
              delivered: true,
              read: false,
              sentAt: new Date(),
            });
          });
        }
      });

      if (tokensToSend.length > 0) {
        // ✅ CORRECTED PAYLOAD: Separated Notification and Data for background alerts
        await sendPushNotification(tokensToSend, {
          notification: {
            title: notifTitle,
            body: notifBody,
          },
          data: {
            screen: "Investments",
            id: investment[0]._id.toString(),
            type: "INVESTMENT",
          },
        });

        if (notificationsToInsert.length > 0) {
          await Notification.insertMany(notificationsToInsert);
        }
      }
    } catch (notifError) {
      console.error("Non-critical Notification Error:", notifError.message);
    }

    // 9️⃣ Respond Success
    res.status(201).json({
      success: true,
      message: `${projectName} initiated successfully. All members have been notified.`,
      data: investment[0],
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();

    console.error("Investment Failure:", error.message);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to initiate investment project",
    });
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
      { new: true, runValidators: true },
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
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { closingValue, bankAccount } = req.body; // Sent from the Mobile Modal
    const investment = await Investment.findById(req.params.id).session(
      session,
    );

    if (!investment) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found." });
    }

    // 1. DYNAMIC TREASURY SYNC: Add closing value back to the Mother Account
    const targetBank = await BankAccount.findById(
      bankAccount || investment.bankAccount,
    ).session(session);
    if (targetBank && closingValue) {
      targetBank.currentBalance += Number(closingValue);
      await targetBank.save({ session });

      // 2. CREATE AUDIT TRAIL: Record the final liquidation in the Ledger
      await Transaction.create(
        [
          {
            user: req.user.id,
            type: "deposit",
            category: "Investment",
            subcategory: investment.projectName,
            amount: Number(closingValue),
            month: new Date().toLocaleString("default", { month: "long" }),
            year: new Date().getFullYear(),
            date: new Date(),
            bankAccount: targetBank._id,
            remarks: `Project Liquidation: ${investment.projectName} closed.`,
            recordedBy: req.user.id,
          },
        ],
        { session },
      );
    }

    // 3. STORAGE CLEANUP: Remove legal documents from server
    if (investment.legalDocs) {
      const filePath = path.join(__dirname, "../../", investment.legalDocs);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error("File removal error:", err.message);
        }
      }
    }

    // 4. FINALIZE: Remove the project document
    await investment.deleteOne({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Project liquidated and registry records removed successfully.",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Investment Liquidation Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Governance protocol failed to close project.",
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
      session,
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
        "A valid bank account must be selected to record profit/expense.",
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
      { session },
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
      "name email",
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
          societyName: "Malibagh Somiti", // Branding for header [cite: 2025-10-11]
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
      session,
    );

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction record not found." });
    }

    // 1. REVERSE BANK BALANCE [cite: 2025-10-11]
    if (transaction.bankAccount) {
      const bank = await BankAccount.findById(transaction.bankAccount).session(
        session,
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
        transaction.referenceId,
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
            1,
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
/**
 * @desc    Get member-specific dashboard stats (Synced with Modern UI)
 * @route   GET /api/finance/member-summary
 * @access  Private (Member/Admin)
 */
exports.getMemberSummary = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Fetch Dynamic Settings from database
    const dbSettings = await FineSetting.findOne().lean();
    const activeSettings = {
      gracePeriodMonths: dbSettings?.gracePeriodMonths ?? 1,
      finePercentage: dbSettings?.finePercentage ?? 5,
    };

    // 2. Parallel Data Fetching for Performance
    const [
      globalStats,
      personalStats,
      bankAccounts,
      investments,
      userDetails,
      fineReductions,
    ] = await Promise.all([
      Transaction.aggregate([
        {
          $group: {
            _id: null,
            totalIncome: {
              $sum: { $cond: [{ $eq: ["$type", "deposit"] }, "$amount", 0] },
            },
            totalExpense: {
              $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", 0] },
            },
          },
        },
      ]),
      Transaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            type: "deposit",
            category: { $ne: "fine_payment" },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      BankAccount.find({
        $or: [{ isMotherAccount: true }, { currentBalance: { $gt: 0 } }],
      }).lean(),
      Investment.find({ status: "active" }).sort({ createdAt: -1 }).lean(),
      User.findById(userId).select(
        "shares phone joiningDate monthlySubscription",
      ),
      Transaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            category: { $in: ["fine_waiver", "fine_payment"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const globalData = globalStats[0] || { totalIncome: 0, totalExpense: 0 };
    const totalReduced = fineReductions[0]?.total || 0;

    // 3. 🔥 DYNAMIC FINE CALCULATION & MONTHLY BREAKDOWN
    let totalFineDue = 0;
    let overdueMonths = 0;
    let fineDetails = [];

    if (userDetails && userDetails.joiningDate) {
      const today = new Date();
      const start = new Date(userDetails.joiningDate);
      const shareCount = userDetails.shares || 1;

      // ✅ FIX: Use the stored subscription directly or calculate once if missing
      // Do NOT multiply shareCount * monthlySubscription as that doubles the value
      const monthlyInstallment =
        userDetails.monthlySubscription || shareCount * 1000;

      const monthlyFineRate =
        (monthlyInstallment * activeSettings.finePercentage) / 100;

      // Start calculating from the month AFTER joining
      let checkDate = new Date(start.getFullYear(), start.getMonth() + 1, 1);

      while (checkDate < new Date(today.getFullYear(), today.getMonth(), 1)) {
        const yearDiff = today.getFullYear() - checkDate.getFullYear();
        const monthDiff = today.getMonth() - checkDate.getMonth();
        const monthsAgoFinished = yearDiff * 12 + monthDiff - 1;

        // Cumulative fine logic for EVERY overdue month past grace period
        if (monthsAgoFinished > activeSettings.gracePeriodMonths) {
          const monthName = checkDate.toLocaleString("default", {
            month: "long",
          });
          const yearName = checkDate.getFullYear();
          const calculatedFine = Math.round(
            monthsAgoFinished * monthlyFineRate,
          );

          fineDetails.push({
            month: monthName,
            year: yearName,
            payableAmount: monthlyInstallment,
            fineAmount: calculatedFine,
          });

          totalFineDue += calculatedFine;
          overdueMonths++;
        }
        checkDate.setMonth(checkDate.getMonth() + 1);
      }

      // Subtract both waivers and cash payments from gross penalty
      totalFineDue = Math.max(0, Math.round(totalFineDue) - totalReduced);
    }

    // 4. Response Data Mapped for React Native UI
    res.status(200).json({
      success: true,
      data: {
        netLiquidity: personalStats[0]?.total || 0,
        societyShares: userDetails?.shares || 0,
        memberId: userDetails?.phone || "N/A",
        totalFineDue: totalFineDue,
        fineDetails: fineDetails,
        overdueMonths: overdueMonths,
        totalFineAdjustments: totalReduced,

        globalRegistry: {
          income: globalData.totalIncome,
          expense: globalData.totalExpense,
          net: globalData.totalIncome - globalData.totalExpense,
        },

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

        recentTransactions: await Transaction.find({ user: userId })
          .sort({ date: -1 })
          .limit(5)
          .lean(),
      },
    });
  } catch (error) {
    console.error("Dashboard Sync Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Dashboard data sync failed",
      error: error.message,
    });
  }
};

/**
 * ✅ GET MEMBER HISTORY: Full Audit Trail & Real-time Fine Calculation
 * Dual-purpose: Admin views member dossier with penalties and registry history.
 */
/**
 * ✅ GET MEMBER HISTORY: Full Audit Trail & Real-time Fine Calculation
 * Dual-purpose: Admin views member dossier with penalties and registry history.
 */
exports.getMemberHistory = async (req, res) => {
  try {
    const userId = req.params.id || req.user.id;

    // 1. FETCH CONFIG & CORE DATA IN PARALLEL
    const [user, settings, historyData, fineReductions] = await Promise.all([
      User.findById(userId)
        .select(
          "name totalDeposited shares branch joiningDate status profilePicture monthlySubscription",
        )
        .lean(),
      FineSetting.findOne().lean() || {
        gracePeriodMonths: 1,
        finePercentage: 5,
      },
      Transaction.find({ user: userId })
        .sort({ date: -1 })
        .populate("recordedBy", "name")
        .populate("bankAccount", "bankName accountNumber")
        .lean(),
      /**
       * 🔥 Aggregate all fine reductions (Waivers + Paid Fines)
       * We treat 'fine_payment' and 'fine_waiver' as deductions from the gross penalty.
       */
      Transaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            category: { $in: ["fine_waiver", "fine_payment"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Member not found." });
    }

    // 2. 🔥 DYNAMIC FINE CALCULATION USING HELPER
    const totalReduced = fineReductions[0]?.total || 0;

    /**
     * 🚀 SYNCED CALCULATION:
     * Uses centralized logic to calculate cumulative fines and subtract adjustments.
     */
    const calc = calculateFineLogic(user, settings, totalReduced);

    // 3. DATA NORMALIZATION FOR MODERN UI
    res.status(200).json({
      success: true,
      data: {
        memberProfile: {
          id: user._id,
          name: user.name,
          avatar: user.profilePicture || null,
          branch: user.branch,
          shares: user.shares || 0,
          totalDeposited: user.totalDeposited || 0, // Savings remains untouched by fine payments
          totalFineDue: calc.fine, // Net remaining balance
          overdueMonths: calc.months,
          totalFineAdjustments: totalReduced, // Combined Waivers + Payments
          joiningDate: user.joiningDate,
          accountStatus: user.status.toUpperCase(),
          lastActivity: historyData.length > 0 ? historyData[0].date : null,
        },
        // Mapping history for professional list view
        transactions: historyData.map((t) => ({
          id: t._id,
          category: t.category || "General Entry",
          amount: t.amount,
          type: t.type,
          isDeposit: t.type === "deposit",
          month: t.month,
          year: t.year,
          date: t.date,
          formattedDate: new Date(t.date).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
          }),
          bank: t.bankAccount
            ? {
                name: t.bankAccount.bankName,
                acc: t.bankAccount.accountNumber?.slice(-4) || "****",
              }
            : null,
          recordedBy: t.recordedBy?.name || "System",
        })),
      },
    });
  } catch (error) {
    console.error("Member Ledger Logic Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Registry sync failed.",
      error: error.message,
    });
  }
};

exports.getInvestmentById = async (req, res) => {
  try {
    // 1. Fetch by ID and populate funding source details
    const investment = await Investment.findById(req.params.id)
      .populate("bankAccount", "bankName accountNumber")
      .lean();

    // 2. Handle missing records to avoid null reference crashes
    if (!investment) {
      return res.status(404).json({
        success: false,
        message: "Investment record not found.",
      });
    }

    // 3. Structured response for Axios res.data.data
    res.status(200).json({
      success: true,
      data: investment,
    });
  } catch (error) {
    // 🔥 Logs the exact reason for the 500 error in your terminal
    console.error("Internal Server Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server Error: Database sync failed.",
      error: error.message,
    });
  }
};

/**
 * ✅ HELPER: ক্যালকুলেশন লজিক (রিয়েল-টাইম সেটিংস সহ)
 */
/**
 * ✅ CENTRALIZED FINE CALCULATOR
 * Calculated for every overdue month after the grace period.
 */
/**
 * ✅ CENTRALIZED FINE CALCULATOR
 * Calculates cumulative fines for every month exceeding the grace period.
 * Subtracts both administrative waivers and actual cash payments already made.
 */
const calculateFineLogic = (member, settings, totalReduced = 0) => {
  const { gracePeriodMonths, finePercentage } = settings;
  const today = new Date();

  // 1. Installment & Monthly Fine Rate based on shares
  const monthlyInstallment =
    (member.shares || 1) * (member.monthlySubscription || 1000);
  const monthlyFineRate = (monthlyInstallment * finePercentage) / 100;

  // 2. Determine start and end points for calculation
  const joiningDate = new Date(member.joiningDate);
  // Calculation only goes up to the last fully finished month (e.g., if today is June, last finished is May)
  const lastFinishedMonthIndex = today.getMonth() - 1;
  const currentYear = today.getFullYear();

  let grossFine = 0;
  let overdueMonthsCount = 0;

  /**
   * 🚀 TIME-WEIGHTED ITERATION:
   * We start from the month after joining and iterate through every month up to the last finished month.
   */
  let checkDate = new Date(
    joiningDate.getFullYear(),
    joiningDate.getMonth() + 1,
    1,
  );

  while (checkDate < new Date(currentYear, today.getMonth(), 1)) {
    // Calculate how many months have passed since this specific month ended
    const yearDiff = today.getFullYear() - checkDate.getFullYear();
    const monthDiff = today.getMonth() - checkDate.getMonth();
    const monthsAgoFinished = yearDiff * 12 + monthDiff - 1;

    /**
     * ✅ YOUR SPECIFIC RULE:
     * If grace period is 2, and a month finished 3 months ago, it gets 3 months of fines.
     * If it finished 2 months ago, it is within grace and gets 0 fines.
     */
    if (monthsAgoFinished > gracePeriodMonths) {
      grossFine += monthsAgoFinished * monthlyFineRate;
      overdueMonthsCount++;
    }

    // Increment iterator by one month
    checkDate.setMonth(checkDate.getMonth() + 1);
  }

  // 3. Final balance after manual waivers or partial payments
  const remainingFine = Math.max(0, Math.round(grossFine) - totalReduced);

  return {
    fine: remainingFine,
    months: overdueMonthsCount,
    totalReduced: totalReduced,
  };
};

/**
 * ✅ PARTIAL FINE WAIVER: Audit Trail Integration
 * Records a waiver transaction that reduces the member's total penalty.
 */
exports.waiveFinePartial = async (req, res) => {
  try {
    const { userId, waiveAmount, remarks } = req.body;

    if (!userId || !waiveAmount) {
      return res.status(400).json({
        success: false,
        message: "User ID and Amount are required for partial waiver.",
      });
    }

    // 🔥 Create an adjustment record
    const waiverTransaction = await Transaction.create({
      user: userId,
      type: "adjustment", // Matches updated enum
      category: "fine_waiver", // Matches calculation logic
      amount: Number(waiveAmount),
      date: new Date(),
      recordedBy: req.user.id,
      bankAccount: null, // Waiver does not affect bank balance
      remarks: remarks || "", // Remarks now strictly optional
    });

    res.status(201).json({
      success: true,
      message: `Successfully waived ৳${waiveAmount.toLocaleString()}`,
      data: waiverTransaction,
    });
  } catch (error) {
    console.error("Partial Waiver Error:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Server error during waiver" });
  }
};

/**
 * ✅ COLLECT PAID FINE
 * Adds money to the bank but NOT to member's personal savings (totalDeposited).
 */
exports.collectPaidFine = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId, amount, bankAccountId, remarks } = req.body;

    const bank = await BankAccount.findById(bankAccountId).session(session);
    if (!bank) throw new Error("Target bank account not found.");

    // 1. Create Transaction
    const finePaid = await Transaction.create(
      [
        {
          user: userId,
          type: "deposit",
          category: "fine_payment", // Distinct from monthly_deposit
          amount: Number(amount),
          bankAccount: bankAccountId,
          recordedBy: req.user.id,
          date: new Date(),
          remarks: remarks || "Penalty payment received.",
        },
      ],
      { session },
    );

    // 2. Update Bank Balance
    bank.currentBalance += Number(amount);
    await bank.save({ session });

    // 🔥 NOTE: We do NOT call User.findByIdAndUpdate with $inc: { totalDeposited: amount }
    // This ensures the fine is not treated as member savings.

    await session.commitTransaction();
    res.status(200).json({
      success: true,
      message: "Fine collected and added to Treasury.",
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ success: false, error: error.message });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get current fine settings [cite: 2025-10-11]
 * @route   GET /api/finance/fine-settings
 */
exports.getFineSettings = async (req, res) => {
  try {
    let settings = await FineSetting.findOne();

    // যদি ডিবিতে ডাটা না থাকে তবে ডিফল্ট ক্রিয়েট করবে
    if (!settings) {
      settings = await FineSetting.create({
        gracePeriodMonths: 1,
        finePercentage: 5,
      });
    }

    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Update fine settings & Sync Engine
 * @route   PUT /api/finance/fine-settings
 */
exports.updateFineSettings = async (req, res) => {
  try {
    const { gracePeriodMonths, finePercentage } = req.body;

    if (gracePeriodMonths === undefined || finePercentage === undefined) {
      return res
        .status(400)
        .json({ success: false, message: "Parameters required." });
    }

    // ডাটাবেসে আপডেট বা ক্রিয়েট (Upsert)
    const settings = await FineSetting.findOneAndUpdate(
      {},
      {
        gracePeriodMonths: Number(gracePeriodMonths),
        finePercentage: Number(finePercentage),
        lastUpdatedBy: req.user.id,
      },
      { new: true, upsert: true },
    );

    res.status(200).json({
      success: true,
      message: "Fine Engine Configured & Synchronized!",
      data: settings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * @desc    Get Defaulter List with Dynamic Calculations
 * @route   GET /api/finance/defaulters
 * @access  Admin/Super-Admin
 */
exports.getDefaulterList = async (req, res) => {
  try {
    // 1. Fetch current dynamic engine settings
    const settings = (await FineSetting.findOne()) || {
      gracePeriodMonths: 1,
      finePercentage: 5,
    };

    // 2. Parallel Fetch: Active members and all fine-related ledger adjustments
    const [members, fineReductions] = await Promise.all([
      User.find({ role: "member", status: "active" }).select(
        "name phone joiningDate shares branch monthlySubscription",
      ),
      Transaction.aggregate([
        {
          $match: {
            category: { $in: ["fine_waiver", "fine_payment"] },
          },
        },
        {
          $group: {
            _id: "$user",
            totalReduced: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    // 3. Process Defaulter Registry with Dynamic Calculations
    const defaulters = members
      .map((member) => {
        // Find total reductions (Paid Fines + Admin Waivers) for this member
        const reductionData = fineReductions.find(
          (r) => r._id.toString() === member._id.toString(),
        );
        const totalReducedAmount = reductionData
          ? reductionData.totalReduced
          : 0;

        /**
         * 🚀 REAL-TIME CALCULATION:
         * Calculates overdue months, time-weighted fine, and dynamic principal due.
         */
        const calc = calculateFineLogic(member, settings, totalReducedAmount);

        /**
         * ✅ INCLUSION LOGIC:
         * Include member if they owe a penalty OR if they have overdue months (Principal Due).
         */
        if (calc.fine > 0 || calc.months > 0) {
          return {
            ...member._doc,
            totalFineDue: calc.fine, // Penalty amount after reductions
            overdueMonths: calc.months, // Total calendar months past grace period
            dueAmount: calc.dueAmount, // Dynamic Principal (Installment Rate * Overdue Months)
            totalReductions: totalReducedAmount, // Total ledger adjustments (Paid + Waived)
          };
        }
        return null;
      })
      .filter((m) => m !== null);

    // 4. Respond with formatted registry data for the frontend table
    res.status(200).json({
      success: true,
      count: defaulters.length,
      data: defaulters,
    });
  } catch (error) {
    console.error("Defaulter Registry Sync Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to synchronize defaulter registry.",
      error: error.message,
    });
  }
};
