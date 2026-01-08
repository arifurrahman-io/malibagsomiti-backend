const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Find user and explicitly include hidden fields needed for state
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid Email or Password",
      });
    }

    // 2. Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid Email or Password",
      });
    }

    // 3. Generate JWT
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    /**
     * 4. SYNCED RESPONSE:
     * Added 'joiningDate' to fix the "N/A" dashboard issue.
     * Added 'phone' to ensure Member ID shows correctly.
     */
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone, // ✅ Fixed: For Member ID visibility
        role: user.role,
        branch: user.branch,
        shares: user.shares || 0,
        joiningDate: user.joiningDate, // ✅ Fixed: Resolves "Membership Active: N/A"
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

    // Update allowable fields
    user.name = req.body.name || user.name;
    user.phone = req.body.phone || user.phone;

    const updatedUser = await user.save();

    // Return the full updated object to refresh the frontend store correctly
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
        joiningDate: updatedUser.joiningDate, // ✅ Maintain sync after profile update
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

    // Verify current credentials
    const isMatch = await bcrypt.compare(
      req.body.currentPassword,
      user.password
    );
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid current password" });
    }

    // Hash is handled by the User model's pre-save middleware
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
