const User = require("../models/User");
const XLSX = require("xlsx");
const Transaction = require("../models/Transaction");
const mongoose = require("mongoose");
const { sendWelcomeEmail } = require("../utils/email"); // ✅ Added Email Utility
const bcrypt = require("bcryptjs");

/**
 * ✅ CREATE MEMBER: Atomic Registry Entry
 * Calibrates monthly subscription automatically and sends credentials via email.
 */
exports.createMember = async (req, res) => {
  try {
    const {
      name,
      email,
      password, // Plain text password from Admin input
      phone,
      nid,
      bankAccount,
      branch,
      shares,
      joiningDate,
      accountNumber,
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
    const monthlySubscription = shareCount * 1000;

    // 3. Create Member in Database
    const member = await User.create({
      name,
      email,
      password, // Will be hashed by User model middleware
      phone,
      nid,
      bankAccount,
      accountNumber,
      branch,
      shares: shareCount,
      joiningDate: joiningDate || Date.now(),
      monthlySubscription,
      role: "member",
    });

    // 4. ✅ SEND WELCOME EMAIL WITH CREDENTIALS
    // We send the plain text 'password' before it's hashed so the member knows it.
    if (member) {
      try {
        await sendWelcomeEmail(member.email, member.name, password);
      } catch (mailError) {
        console.error(
          "Member created but Welcome Email failed:",
          mailError.message,
        );
        // We do not block the response even if the email fails
      }
    }

    res.status(201).json({
      success: true,
      message: `${member.name} successfully registered and notified via email.`,
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
 * Optimized with server-side filtering for Branch performance sliders.
 */
exports.getAllMembers = async (req, res) => {
  try {
    const { branch, status, search } = req.query;

    let matchFilter = { role: "member" };

    // 1. Handle Branch Filtering
    if (branch && branch !== "All") {
      matchFilter.branch = branch;
    }

    // 2. Handle Status Filtering
    if (status) {
      matchFilter.status = status;
    }

    // 3. Advanced Search
    if (search) {
      matchFilter.$or = [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { bankAccount: { $regex: `${search}$`, $options: "i" } },
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
          // ✅ FIX: Explicitly ensure totalFineDue is passed through
          // If the field is missing in DB, default it to 0
          totalFineDue: { $ifNull: ["$totalFineDue", 0] },
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
      // ✅ PROJECT: Ensure we only hide sensitive/unnecessary data
      // Do NOT exclude totalFineDue here
      {
        $project: {
          txs: 0,
          password: 0,
          __v: 0,
        },
      },
      { $sort: { bankAccount: 1 } },
    ]).collation({ locale: "en_US", numericOrdering: true });

    res.status(200).json({
      success: true,
      count: members.length,
      data: members,
    });
  } catch (error) {
    console.error("Fetch Registry Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch registry.",
      error: error.message,
    });
  }
};

/**
 * ✅ GET MEMBER PROFILE: Personal Financial Summary
 * Optimized for Mobile Dashboards (Bento Grid support).
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

    const stats = await Transaction.aggregate([
      { $match: { user: userObjectId, type: "deposit" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

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
 * Syncs monthly subscriptions if shares are modified.
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
      { new: true, runValidators: true },
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

/**
 * ✅ BULK IMPORT MEMBERS: High-Performance Spreadsheet Sync
 * Handles password hashing, 2023-default date calibration, and subscription math.
 */
exports.bulkImportMembers = async (req, res) => {
  try {
    const { members } = req.body;

    if (!members || !Array.isArray(members)) {
      return res.status(400).json({
        success: false,
        message: "Invalid data format. Expected an array of members.",
      });
    }

    // Prepare members with secure hashing and business logic calibration
    const formattedMembers = await Promise.all(
      members.map(async (m) => {
        // 1. Force the Default Joining Date to Jan 1st, 2023 (Noon)
        // Using Noon (12:00:00) prevents timezone offsets from shifting it to Dec 31st
        const validatedDate =
          m.joiningDate && !isNaN(Date.parse(m.joiningDate))
            ? new Date(m.joiningDate)
            : new Date("2023-01-01T12:00:00");

        // 2. Manual Password Hashing (Required for insertMany)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(
          m.password || "Member123",
          salt,
        );

        // 3. Financial Calibration
        const shareCount = parseInt(m.shares) || 1;
        const subscription = shareCount * 1000;

        return {
          name: m.name,
          email: m.email,
          phone: m.phone,
          nid: m.nid,
          bankAccount: m.bankAccount,
          accountNumber: m.accountNumber,
          branch: m.branch || "Malibagh-A-Day",
          password: hashedPassword, // Store securely
          role: "member",
          status: "active",
          joiningDate: validatedDate,
          shares: shareCount,
          monthlySubscription: subscription,
        };
      }),
    );

    // 4. Batch Insertion
    // { ordered: false } ensures that if one row (e.g., duplicate NID) fails,
    // the rest are still processed.
    const result = await User.insertMany(formattedMembers, { ordered: false });

    res.status(201).json({
      success: true,
      message: `${result.length} profiles successfully synchronized with the registry.`,
      data: result,
    });
  } catch (error) {
    console.error("Bulk Import Operational Failure:", error);
    res.status(500).json({
      success: false,
      message: "Registry sync failed. Ensure NIDs and Emails are unique.",
      error: error.message,
    });
  }
};
