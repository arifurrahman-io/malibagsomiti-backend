const nodemailer = require("nodemailer");

// 1. Base email sender function
const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"Malibag Teachers' Society" <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    html: options.html,
  };

  await transporter.sendMail(mailOptions);
};

// 2. Add the specific function expected by your financeController
const sendDepositEmail = async (email, data) => {
  const html = `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee;">
      <h2 style="color: #2563eb;">Deposit Confirmed</h2>
      <p>Hello <strong>${data.name}</strong>,</p>
      <p>A monthly deposit has been recorded for your account.</p>
      <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Amount:</strong> BDT ${data.amount}</p>
        <p><strong>Date:</strong> ${data.date}</p>
        <p><strong>Total Savings:</strong> BDT ${data.totalBalance}</p>
      </div>
      <p style="font-size: 12px; color: #64748b;">This is an automated notification from Malibag Teachers' Society.</p>
    </div>
  `;

  await sendEmail({
    email,
    subject: "Monthly Deposit Confirmation",
    html,
  });
};

// 3. Export as an object so destructuring in controller works
module.exports = { sendEmail, sendDepositEmail };
