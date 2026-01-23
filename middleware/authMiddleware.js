const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Protect routes - Verify Token
exports.protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized, no token",
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🔒 HARD CHECK: decoded.id must exist
    if (!decoded?.id) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    // Fetch user
    const user = await User.findById(decoded.id).select("-password");

    // 🔴 CRITICAL FIX: STOP if user not found
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found for provided token",
      });
    }

    // Attach user safely
    req.user = user;

    next();
  } catch (error) {
    console.error("JWT Protect Error:", error);
    return res.status(401).json({
      success: false,
      message: "Not authorized, token failed",
    });
  }
};

// Authorize roles - RBAC Logic
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized`,
      });
    }

    next();
  };
};
