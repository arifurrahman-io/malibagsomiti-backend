const Transaction = require("../models/Transaction");
const User = require("../models/User");

/**
 * ✅ BRANCH SUMMARY: Regional Performance Analytics
 * Optimized for React Native Progress Bars and Web Comparison Charts [cite: 2025-10-11].
 */
exports.getBranchSummary = async (req, res) => {
  const { branch } = req.params;

  try {
    // 1. High-Performance Aggregation
    const summaryData = await Transaction.aggregate([
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

    // 2. Normalize data for the Frontend (Flattening the array) [cite: 2025-10-11]
    const deposits =
      summaryData.find((s) => s._id === "deposit")?.totalAmount || 0;
    const expenses =
      summaryData.find((s) => s._id === "expense")?.totalAmount || 0;

    // 3. Fetch Branch Meta-data for ROI/Target calculations
    const memberCount = await User.countDocuments({
      branch,
      role: "member",
      status: "active",
    });

    /**
     * 🚀 DYNAMIC UI LOGIC:
     * We calculate the collection percentage against a monthly goal.
     * Assuming a goal of 1000 BDT per member per month.
     */
    const monthlyGoal = memberCount * 1000;
    const collectionPerformance =
      monthlyGoal > 0
        ? Math.min(Math.round((deposits / monthlyGoal) * 100), 100)
        : 0;

    res.status(200).json({
      success: true,
      data: {
        branchName: branch,
        stats: {
          totalDeposits: deposits,
          totalExpenses: expenses,
          netLiquidity: deposits - expenses,
          activeMembers: memberCount,
          transactionCount: summaryData.reduce(
            (acc, curr) => acc + curr.count,
            0
          ),
        },
        visualization: {
          performancePercentage: collectionPerformance, // Drives Progress Bars
          formattedGoal: `৳${monthlyGoal.toLocaleString()}`,
          formattedCollection: `৳${deposits.toLocaleString()}`,
        },
      },
    });
  } catch (error) {
    console.error(`Branch Stats Error [${branch}]:`, error.message);
    res.status(500).json({
      success: false,
      message: "Could not generate regional summary",
      error: error.message,
    });
  }
};
