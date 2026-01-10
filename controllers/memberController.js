const User = require("../models/User");
const Transaction = require("../models/Transaction");
const mongoose = require("mongoose");

/**
 * ✅ CREATE MEMBER: Atomic Registry Entry
 * Calibrates monthly subscription automatically based on share count [cite: 2025-10-11].
 */
exports.createMember = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      nid,
      bankAccount,
      branch,
      shares,
      joiningDate,
    } = req.body;

    // 1. Uniqueness Check (NID/Email)
    const memberExists = await User.findOne({ $or: [{ email }, { nid }] });
    if (memberExists) {
      return res.status(400).json({
        success: false,
        message: "A member with this Email or NID is already registered.",
      });
    }

    // 2. Financial Calibration
    const shareCount = parseInt(shares) || 1;
    const monthlySubscription = shareCount * 1000; // Standard society rule

    const member = await User.create({
      name,
      email,
      password,
      phone,
      nid,
      bankAccount,
      branch,
      shares: shareCount,
      joiningDate: joiningDate || Date.now(),
      monthlySubscription,
      role: "member",
    });

    res.status(201).json({
      success: true,
      message: `${member.name} successfully registered.`,
      data: {
        id: member._id.toString(),
        name: member.name,
        email: member.email,
        branch: member.branch,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Registry failure.",
      error: error.message,
    });
  }
};

/**
 * ✅ GET ALL MEMBERS: High-Performance List
 * Optimized with server-side filtering for Branch performance sliders [cite: 2025-10-11].
 */
exports.getAllMembers = async (req, res) => {
  try {
    const { branch, status, search } = req.query;

    let matchFilter = { role: "member" };
    if (branch) matchFilter.branch = branch;
    if (status) matchFilter.status = status;

    // Search by Name or Phone for the Admin Search Bar
    if (search) {
      matchFilter.$or = [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const members = await User.aggregate([
      { $match: matchFilter },
      {
        $lookup: {
          from: "transactions",
          localField: "_id",
          foreignField: "user",
          as: "txs",
        },
      },
      {
        $addFields: {
          id: { $toString: "$_id" },
          totalDeposited: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$txs",
                    as: "t",
                    cond: { $eq: ["$$t.type", "deposit"] },
                  },
                },
                as: "d",
                in: "$$d.amount",
              },
            },
          },
        },
      },
      { $project: { txs: 0, password: 0, __v: 0 } },
      { $sort: { name: 1 } },
    ]);

    res
      .status(200)
      .json({ success: true, count: members.length, data: members });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch registry.",
      error: error.message,
    });
  }
};

/**
 * ✅ GET MEMBER PROFILE: Personal Financial Summary
 * Optimized for Mobile Dashboards (Bento Grid support) [cite: 2025-10-11].
 */
exports.getMemberProfile = async (req, res) => {
  try {
    const targetId = req.params.id || req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(targetId);

    const member = await User.findById(userObjectId).select("-password").lean();
    if (!member) {
      return res
        .status(404)
        .json({ success: false, message: "Member not found." });
    }

    // 1. Aggregate Deposit History
    const stats = await Transaction.aggregate([
      { $match: { user: userObjectId, type: "deposit" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    // 2. Fetch last 5 activities for the "Recent Activity" component [cite: 2025-10-11]
    const recentTransactions = await Transaction.find({ user: userObjectId })
      .sort({ date: -1 })
      .limit(5)
      .populate("recordedBy", "name")
      .lean();

    res.status(200).json({
      success: true,
      data: {
        ...member,
        id: member._id.toString(),
        financialSummary: {
          totalDeposits: stats[0]?.total || 0,
          shares: member.shares || 0,
          estimatedValue: (member.shares || 0) * 1000,
          recentActivity: recentTransactions,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Profile load error.",
      error: error.message,
    });
  }
};

/**
 * ✅ UPDATE MEMBER: Governance & Security
 * Syncs monthly subscriptions if shares are modified [cite: 2025-10-11].
 */
exports.updateMember = async (req, res) => {
  try {
    const updateData = { ...req.body };

    if (!updateData.password || updateData.password.trim() === "")
      delete updateData.password;
    if (updateData.shares)
      updateData.monthlySubscription = parseInt(updateData.shares) * 1000;

    const updatedMember = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedMember)
      return res
        .status(404)
        .json({ success: false, message: "Member not found." });

    res.status(200).json({
      success: true,
      message: "Sync complete.",
      data: updatedMember,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Update failed.",
      error: error.message,
    });
  }
};

/**
 * ✅ TOGGLE STATUS: Account Lock/Unlock
 */
exports.toggleStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found." });

    user.status = user.status === "active" ? "inactive" : "active";
    await user.save();

    res.status(200).json({
      success: true,
      message: `Status updated to ${user.status}.`,
      data: { status: user.status },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Toggle failed." });
  }
};

/**
 * ✅ DELETE MEMBER: Registry Cleanup (Super Admin Only)
 */
exports.deleteMember = async (req, res) => {
  try {
    const member = await User.findById(req.params.id);
    if (!member)
      return res
        .status(404)
        .json({ success: false, message: "Member not found." });

    if (member.role !== "member") {
      return res.status(403).json({
        success: false,
        message: "Security: Admin accounts protected.",
      });
    }

    await User.findByIdAndDelete(req.params.id);
    res
      .status(200)
      .json({ success: true, message: "Member removed from registry." });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Deletion failed.",
      error: error.message,
    });
  }
};
