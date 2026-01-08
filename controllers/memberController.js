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

    // 1. Uniqueness Check
    const memberExists = await User.findOne({ $or: [{ email }, { nid }] });
    if (memberExists) {
      return res.status(400).json({
        success: false,
        message:
          "A member with this Email or NID is already registered in the system.",
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
      bankAccount, // Member's personal bank for withdrawals
      branch,
      shares: shareCount,
      joiningDate: joiningDate || Date.now(),
      monthlySubscription,
      role: "member",
    });

    res.status(201).json({
      success: true,
      message: `${member.name} has been successfully added to the society registry.`,
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
      message: "Registry registration failed.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all members with total deposits (Read)
 * @route   GET /api/members
 */
exports.getAllMembers = async (req, res) => {
  try {
    const { branch, status } = req.query;

    let matchFilter = { role: "member" };
    if (branch) matchFilter.branch = branch;
    if (status) matchFilter.status = status;

    // Aggregates deposits from the centralized Transaction collection
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
      message: "Failed to fetch registry data.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get detailed member profile + Personal Financial Summary (Read)
 * @route   GET /api/members/profile/:id
 */
exports.getMemberProfile = async (req, res) => {
  try {
    const targetId = req.params.id || req.user.id;

    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid User ID format." });
    }

    // Convert to ObjectId once to reuse safely in aggregation and find
    const userObjectId = new mongoose.Types.ObjectId(targetId);

    const member = await User.findById(userObjectId).select("-password").lean();

    if (!member) {
      return res
        .status(404)
        .json({ success: false, message: "Member record not found." });
    }

    // Comprehensive financial aggregation
    const stats = await Transaction.aggregate([
      {
        $match: {
          user: userObjectId,
          type: "deposit",
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const financialSummary = {
      totalDeposits: stats[0]?.total || 0,
      currentShareCount: member.shares || 0,
      estimatedShareValue: (member.shares || 0) * 1000,
      // Added population for better UI transparency
      recentTransactions: await Transaction.find({ user: userObjectId })
        .sort({ date: -1 })
        .limit(10)
        .populate("recordedBy", "name")
        .lean(),
    };

    res.status(200).json({
      success: true,
      data: {
        ...member,
        id: member._id.toString(), // Ensure id is a string for frontend consistency
        financialSummary,
      },
    });
  } catch (error) {
    console.error("Profile Fetch Error:", error);
    res.status(500).json({
      success: false,
      message: "Error loading profile data.",
      error: error.message,
    });
  }
};

/**
 * @desc    Update member details & Recalibrate Subscription (Admin Only)
 * @route   PUT /api/members/:id
 */
exports.updateMember = async (req, res) => {
  try {
    const updateData = { ...req.body };

    // Prevent security credentials from being overwritten by empty strings
    if (!updateData.password || updateData.password.trim() === "") {
      delete updateData.password;
    }

    // Auto-update subscription if shares change to maintain treasury integrity
    if (updateData.shares) {
      updateData.monthlySubscription = parseInt(updateData.shares) * 1000;
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
        .json({ success: false, message: "Member not found." });
    }

    res.status(200).json({
      success: true,
      message: "Member record synchronized successfully.",
      data: updatedMember,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Update synchronization failed.",
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
        .json({ success: false, message: "User not found." });

    user.status = user.status === "active" ? "inactive" : "active";
    await user.save();

    res.status(200).json({
      success: true,
      message: `Account for ${user.name} is now ${user.status}.`,
      status: user.status,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Status update failed." });
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
        .json({ success: false, message: "Member not found." });

    // Governance safety: Prevents accidental deletion of admin accounts
    if (member.role !== "member") {
      return res.status(403).json({
        success: false,
        message:
          "Governance Protection: Administrative accounts cannot be removed from this interface.",
      });
    }

    await User.findByIdAndDelete(req.params.id);
    res.status(200).json({
      success: true,
      message: "Member permanently removed from society registry.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Registry deletion failed.",
      error: error.message,
    });
  }
};
