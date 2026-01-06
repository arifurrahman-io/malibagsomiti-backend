/**
 * @desc    Restricts access to specific user roles
 * @param   {...String} roles - Allowed roles (e.g., 'admin', 'super-admin')
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    // req.user is populated by the protect middleware (JWT verification)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required to access this resource.",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access Denied: Your role (${req.user.role}) does not have permission to perform this action.`,
      });
    }

    // Access granted
    next();
  };
};

module.exports = authorize;
