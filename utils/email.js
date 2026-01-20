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
    from: `"Malibagh Somiti" <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    html: options.html,
  };

  await transporter.sendMail(mailOptions);
};

// --- Updated Welcome Email Function (English) ---
const sendWelcomeEmail = async (email, name, password) => {
  const appLink =
    "https://play.google.com/store/apps/details?id=bd.com.arifurrahman.MalibagSomiti";

  const html = `
    <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 550px; margin: auto; border: 1px solid #f1f5f9; border-radius: 16px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="background-color: #2563eb; padding: 24px; text-align: center;">
        <h2 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">Malibagh Somiti</h2>
        <p style="color: rgba(255,255,255,0.9); margin-top: 4px; font-size: 13px;">Digital Management System</p>
      </div>

      <div style="padding: 24px;">
        <h3 style="color: #1e293b; margin-top: 0; font-size: 18px; font-weight: 600;">Welcome, ${name}!</h3>
        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 24px;">
          Your account has been successfully created. You can now access your savings, deposits, and society reports digitally. Use the credentials below for your first login.
        </p>
        
        <div style="background: #f8fafc; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 24px;">
          <h4 style="margin: 0 0 12px 0; color: #1e293b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;">Login Credentials</h4>
          <p style="margin: 6px 0; color: #475569; font-size: 14px;"><strong>Email:</strong> <span style="color: #1e293b;">${email}</span></p>
          <p style="margin: 6px 0; color: #475569; font-size: 14px;"><strong>Password:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; color: #1e293b; font-weight: bold;">${password}</code></p> 
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0;">
             <p style="margin: 0; font-size: 12px; color: #dc2626; font-weight: 600;">* Security Action: Please change this password immediately after logging in.</p>
          </div>
        </div>

        <div style="text-align: center; background-color: #f0fdf4; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
          <p style="font-size: 13px; color: #166534; font-weight: 600; margin-bottom: 12px;">Get the Official Android App</p>
          <a href="${appLink}" style="background-color: #10b981; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 10px; font-weight: 700; display: inline-block; font-size: 14px; transition: background-color 0.2s;">Install App</a>
          <p style="margin-top: 10px; font-size: 11px; color: #166534; opacity: 0.8;">Available on Google Play Store</p>
        </div>

        <div style="border-top: 1px solid #f1f5f9; padding-top: 20px;">
          <p style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.05em;">Member Perks</p>
          <table style="width: 100%; font-size: 13px; color: #475569;">
            <tr>
              <td style="padding: 4px 0;">✓ Real-time Balance Tracking</td>
              <td style="padding: 4px 0;">✓ Digital Receipts</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;">✓ Investment ROI Updates</td>
              <td style="padding: 4px 0;">✓ Transparent Governance</td>
            </tr>
          </table>
        </div>
      </div>

      <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 11px; color: #94a3b8; margin: 0; line-height: 1.5;">
          This is an automated system message. Please do not reply directly to this email.<br>
          <strong>© 2026 Malibagh Somiti Digital System</strong>
        </p>
      </div>
    </div>
  `;

  await sendEmail({
    email,
    subject: "Welcome to Malibagh Somiti - Your Account is Ready",
    html,
  });
};

// 2. Deposit confirmation function (Remains English as per your original)
// --- Updated Monthly Deposit Email Function ---
const sendDepositEmail = async (email, data) => {
  const appLink =
    "https://play.google.com/store/apps/details?id=bd.com.arifurrahman.MalibagSomiti";

  const html = `
    <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background-color: #ffffff;">
      
      <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 25px 20px; text-align: center;">
        <div style="background: rgba(255,255,255,0.2); width: 45px; height: 45px; border-radius: 50%; line-height: 45px; margin: 0 auto 10px; display: block;">
           <span style="color: white; font-size: 22px; font-weight: bold;">৳</span>
        </div>
        <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700;">Deposit Confirmed</h2>
        <p style="color: rgba(255,255,255,0.8); margin-top: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">Malibagh Somiti</p>
      </div>

      <div style="padding: 24px 20px;">
        <p style="font-size: 16px; color: #1e293b; margin-top: 0; margin-bottom: 12px;">Hello <strong>${data.name}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.5; color: #475569; margin-bottom: 20px;">
          Your contribution for <strong>${data.month} ${data.year}</strong> has been received and added to your savings.
        </p>

        <div style="background: #f8fafc; border-radius: 12px; padding: 16px; border: 1px solid #f1f5f9; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Amount</td>
              <td style="padding: 6px 0; text-align: right; color: #0f172a; font-weight: 700;">৳${data.amount.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Date</td>
              <td style="padding: 6px 0; text-align: right; color: #0f172a; font-weight: 600;">${data.date}</td>
            </tr>
            <tr style="border-top: 1px solid #e2e8f0;">
              <td style="padding: 12px 0 0; color: #2563eb; font-weight: 700;">Total Savings</td>
              <td style="padding: 12px 0 0; text-align: right; color: #2563eb; font-weight: 800; font-size: 16px;">৳${data.totalBalance.toLocaleString()}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; background-color: #f0fdf4; padding: 16px; border-radius: 12px;">
          <p style="font-size: 12px; color: #166534; font-weight: 600; margin: 0 0 10px 0;">Track your savings on our mobile app</p>
          <a href="${appLink}" style="background-color: #10b981; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: 700; display: inline-block; font-size: 13px;">Download App</a>
        </div>
      </div>

      <div style="background-color: #f8fafc; padding: 15px; text-align: center; border-top: 1px solid #f1f5f9;">
        <p style="font-size: 10px; color: #94a3b8; margin: 0; text-transform: uppercase; letter-spacing: 1px;">
          Secured by Malibagh Somiti Digital System
        </p>
      </div>
    </div>
  `;

  await sendEmail({
    email,
    subject: `Deposit Confirmation - ${data.month || "New"} ${data.year || "Update"}`,
    html,
  });
};

// 3. Export including the new English welcome function
module.exports = { sendEmail, sendDepositEmail, sendWelcomeEmail };
