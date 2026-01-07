const User = require("../models/User");
const Transaction = require("../models/Transaction");
const mongoose = require("mongoose");

/**
 * @desc    Register a new member (Create)
 * @route   POST /api/members
 * @access  Admin/Super-Admin
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

    const memberExists = await User.findOne({ $or: [{ email }, { nid }] });
    if (memberExists) {
      return res.status(400).json({
        success: false,
        message: "Member with this email or NID already exists",
      });
    }

    const shareCount = parseInt(shares) || 1;
    // Calculation logic matching society rules
    const monthlySubscription = shareCount * 1000;

    const member = await User.create({
      name,
      email,
      password,
      phone,
      nid,
      bankAccount,
      branch,
      shares: shareCount,
      joiningDate: joiningDate || Date.now(), // Fixed field name for frontend consistency
      monthlySubscription,
      role: "member",
    });

    res.status(201).json({
      success: true,
      message: "Member registered successfully",
      data: {
        id: member._id,
        name: member.name,
        email: member.email,
        joiningDate: member.joiningDate,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all members with branch/status filtering (Read)
 * @route   GET /api/members
 */
exports.getAllMembers = async (req, res) => {
  try {
    const { branch, status } = req.query;

    let matchFilter = { role: "member" };
    if (branch) matchFilter.branch = branch;
    if (status) matchFilter.status = status;

    const members = await User.aggregate([
      { $match: matchFilter },
      {
        $lookup: {
          from: "transactions",
          localField: "_id",
          foreignField: "user",
          as: "transactions",
        },
      },
      {
        $addFields: {
          totalDeposited: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$transactions",
                    as: "t",
                    cond: { $eq: ["$$t.type", "deposit"] },
                  },
                },
                as: "deposit",
                in: "$$deposit.amount",
              },
            },
          },
        },
      },
      { $project: { transactions: 0, password: 0 } },
      { $sort: { name: 1 } },
    ]);

    res.status(200).json({ success: true, data: members });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch members",
      error: error.message,
    });
  }
};

/**
 * @desc    Get detailed member profile + Personal Financial Summary (Read)
 * @route   GET /api/members/profile/:id
 * @access  Private (Member/Admin)
 */
exports.getMemberProfile = async (req, res) => {
  try {
    const targetId = req.params.id || req.user.id;

    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid User ID" });
    }

    const member = await User.findById(targetId).select("-password").lean();

    if (!member) {
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });
    }

    // Comprehensive financial aggregation for the profile view
    const stats = await Transaction.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(targetId),
          type: "deposit",
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const financialSummary = {
      totalDeposits: stats[0]?.total || 0,
      currentShareCount: member.shares || 0,
      estimatedShareValue: (member.shares || 1) * 1000,
      recentTransactions: await Transaction.find({ user: targetId })
        .sort({ date: -1 })
        .limit(5)
        .lean(),
    };

    res.status(200).json({
      success: true,
      data: {
        ...member,
        id: member._id, // Normalize ID for frontend
        financialSummary,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error loading profile data",
      error: error.message,
    });
  }
};

/**
 * @desc    Update member details (Admin Only)
 * @route   PUT /api/members/:id
 */
exports.updateMember = async (req, res) => {
  try {
    const updateData = { ...req.body };

    // Prevent password being overwritten by empty strings
    if (!updateData.password || updateData.password.trim() === "") {
      delete updateData.password;
    }

    // Auto-update subscription if shares change
    if (updateData.shares) {
      updateData.monthlySubscription = updateData.shares * 1000;
    }

    const updatedMember = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    ).select("-password");

    if (!updatedMember) {
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });
    }

    res.status(200).json({
      success: true,
      message: "Member record synchronized successfully",
      data: updatedMember,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Update synchronization failed",
      error: error.message,
    });
  }
};

/**
 * @desc    Toggle Member Status (Active/Inactive)
 */
exports.toggleStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    user.status = user.status === "active" ? "inactive" : "active";
    await user.save();

    res.status(200).json({
      success: true,
      message: `Member status updated to ${user.status}`,
      status: user.status,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Status update failed" });
  }
};

/**
 * @desc    Permanently delete a member (Delete - Super Admin Only)
 */
exports.deleteMember = async (req, res) => {
  try {
    const member = await User.findById(req.params.id);

    if (!member)
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });

    if (member.role !== "member") {
      return res.status(403).json({
        success: false,
        message: "Governance safety: Only member accounts can be removed",
      });
    }

    await User.findByIdAndDelete(req.params.id);
    res
      .status(200)
      .json({ success: true, message: "Member removed from registry" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Registry deletion failed",
      error: error.message,
    });
  }
};
