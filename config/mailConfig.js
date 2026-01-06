const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_PORT == 465, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // Optimize for bulk sending (Monthly Summary)
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
});

// Verify connection on startup
transporter.verify((error, success) => {
  if (error) {
    console.log("Email Server Error:", error);
  } else {
    console.log("Email Server is ready for notifications");
  }
});

module.exports = transporter;
