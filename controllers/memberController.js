const User = require("../models/User");
const Transaction = require("../models/Transaction");

// @desc    Register a new member (Create)
// @route   POST /api/members
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

    // 1. Check if member already exists
    const memberExists = await User.findOne({ $or: [{ email }, { nid }] });
    if (memberExists) {
      return res.status(400).json({
        success: false,
        message: "Member with this email or NID already exists",
      });
    }

    // 2. Create member with expanded fields
    const member = await User.create({
      name,
      email,
      password,
      phone,
      nid,
      bankAccount,
      branch,
      shares,
      joiningDate: joiningDate || Date.now(),
      monthlySubscription: (shares || 1) * 1000, // Auto-calculate subscription
    });

    res.status(201).json({
      success: true,
      message: "Member registered successfully",
      data: { id: member._id, name: member.name, email: member.email },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  }
};

// @desc    Get all members with branch/status filtering (Read)
// @route   GET /api/members
exports.getAllMembers = async (req, res) => {
  try {
    const { branch, status } = req.query;
    let query = { role: "member" };

    if (branch) query.branch = branch;
    if (status) query.status = status;

    const members = await User.find(query)
      .select("-password")
      .sort({ name: 1 }) // Sorted alphabetically for better UX
      .lean();

    res.status(200).json({
      success: true,
      data: members,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch members",
      error: error.message,
    });
  }
};

// @desc    Get detailed member profile + Financial Summary (Read)
// @route   GET /api/members/profile/:id
exports.getMemberProfile = async (req, res) => {
  try {
    const member = await User.findById(req.params.id)
      .select("-password")
      .lean();

    if (!member) {
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });
    }

    // Aggregate financial stats for dynamic UI cards
    const stats = await Transaction.aggregate([
      { $match: { user: member._id } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
    ]);

    const financialSummary = {
      totalDeposits: stats.find((s) => s._id === "monthly_deposit")?.total || 0,
      shareValue: (member.shares || 1) * 1000,
      recentTransactions: await Transaction.find({ user: member._id })
        .sort({ date: -1 })
        .limit(5)
        .lean(),
    };

    res.status(200).json({ success: true, ...member, financialSummary });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error loading profile" });
  }
};

// @desc    Update member details (Admin Only)
// @route   PUT /api/members/:id
exports.updateMember = async (req, res) => {
  try {
    const updateData = { ...req.body };

    // 1. FIX: Remove password if it is empty or provided as an empty string
    // This prevents validation errors for a required password field during updates
    if (!updateData.password || updateData.password.trim() === "") {
      delete updateData.password;
    }

    // 2. Logic: Recalculate subscription if shares are changed
    if (updateData.shares) {
      updateData.monthlySubscription = updateData.shares * 1000;
    }

    // 3. FIX: Use 'context: query' to let Mongoose know this is a partial update
    const updatedMember = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      {
        new: true,
        runValidators: true,
        context: "query", // Critical for partial updates with required fields
      }
    ).select("-password");

    if (!updatedMember) {
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });
    }

    res.status(200).json({
      success: true,
      message: "Member updated successfully",
      data: updatedMember,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Update failed. Ensure all required fields are valid.",
      error: error.message,
    });
  }
};

// @desc    Toggle Member Status (Update)
// @route   PATCH /api/members/:id/status
exports.toggleStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    user.status = user.status === "active" ? "inactive" : "active";
    await user.save();

    res.status(200).json({
      success: true,
      message: `Member is now ${user.status}`,
      status: user.status,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Status update failed" });
  }
};

// @desc    Permanently delete a member (Delete - Super Admin Only)
// @route   DELETE /api/members/:id
exports.deleteMember = async (req, res) => {
  try {
    const member = await User.findById(req.params.id);

    if (!member) {
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });
    }

    // Security check: Don't allow deleting other admins via this route
    if (member.role !== "member") {
      return res.status(403).json({
        success: false,
        message: "Only member accounts can be deleted",
      });
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: "Member permanently removed from society database",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Deletion failed",
      error: error.message,
    });
  }
};
