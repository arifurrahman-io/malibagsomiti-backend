const Transaction = require("../models/Transaction");

exports.getBranchSummary = async (req, res) => {
  const { branch } = req.params;

  try {
    // Use aggregation for high-performance calculations
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

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: "Could not generate summary" });
  }
};
