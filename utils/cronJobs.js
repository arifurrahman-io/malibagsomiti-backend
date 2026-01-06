const cron = require("node-cron");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const sendEmail = require("./sendEmail");

// Schedule: Runs at 00:00 on day 1 of every month
const monthlySummaryJob = cron.schedule("0 0 1 * *", async () => {
  console.log("Running Monthly Financial Summary Automation...");

  try {
    const members = await User.find({ status: "active", role: "member" });

    for (const member of members) {
      // Calculate personal total for the summary
      const stats = await Transaction.aggregate([
        { $match: { user: member._id } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const totalDeposits = stats[0]?.total || 0;

      // Professional HTML Content
      const htmlContent = `
        <div style="font-family: sans-serif; border: 1px solid #eee; padding: 20px;">
          <h2 style="color: #2c3e50;">Monthly Financial Status</h2>
          <p>Hello <strong>${member.name}</strong>,</p>
          <p>Here is your society account summary for this month:</p>
          <div style="background: #f9f9f9; padding: 15px; border-radius: 8px;">
            <p><strong>Total Shares:</strong> ${member.shares}</p>
            <p><strong>Total Deposited:</strong> BDT ${totalDeposits}</p>
          </div>
          <p style="font-size: 12px; color: #777;">Login to your dashboard to view detailed history.</p>
        </div>
      `;

      await sendEmail({
        email: member.email,
        subject: `Financial Summary - ${new Date().toLocaleString("default", {
          month: "long",
        })}`,
        html: htmlContent,
      });
    }
  } catch (error) {
    console.error("Cron Job Error:", error);
  }
});

module.exports = monthlySummaryJob;
