const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { sendWelcomeEmail } = require("../utils/email"); // ✅ Integrated your email utility

// @desc    Register a new member & send welcome email
// @route   POST /api/auth/register
// authController.js এর register ফাংশনের ভেতর
exports.register = async (req, res) => {
  const { name, email, password, phone, branch, joiningDate } = req.body;

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res
        .status(400)
        .json({ success: false, message: "User already exists" });
    }

    const user = await User.create({
      name,
      email,
      password, // এটি মডেলের pre-save middleware দ্বারা হ্যাশ হবে
      phone,
      branch,
      joiningDate: joiningDate || Date.now(),
    });

    if (user) {
      // ✅ এখানে plain text 'password' পাঠানো হচ্ছে যাতে মেম্বার সেটি দেখতে পায়
      try {
        await sendWelcomeEmail(user.email, user.name, password);
      } catch (mailError) {
        console.error("Email failed:", mailError);
      }

      const token = jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "1d" },
      );

      res.status(201).json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          branch: user.branch,
          joiningDate: user.joiningDate,
        },
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid Email or Password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid Email or Password" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        branch: user.branch,
        shares: user.shares || 0,
        joiningDate: user.joiningDate,
      },
    });
  } catch (error) {
    console.error("Login Controller Error:", error);
    res.status(500).json({
      success: false,
      message: "Server encountered an error during login",
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/update-profile
exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    user.name = req.body.name || user.name;
    user.phone = req.body.phone || user.phone;

    const updatedUser = await user.save();

    res.json({
      success: true,
      data: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        role: updatedUser.role,
        branch: updatedUser.branch,
        shares: updatedUser.shares,
        joiningDate: updatedUser.joiningDate,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update password
// @route   PUT /api/auth/update-password
exports.updatePassword = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("+password");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const isMatch = await bcrypt.compare(
      req.body.currentPassword,
      user.password,
    );
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid current password" });
    }

    user.password = req.body.newPassword;
    await user.save();

    res.json({
      success: true,
      message: "Security credentials updated successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Update FCM Token for Push Notifications
 * @route   PUT /api/auth/update-fcm-token
 * @access  Private
 */
exports.updateFCMToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: "No token provided",
      });
    }

    // req.user.id is available via your 'protect' middleware
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { fcmToken },
      { new: true, runValidators: true },
    );

    res.status(200).json({
      success: true,
      message: "FCM Token updated successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error during token update",
      error: error.message,
    });
  }
};
