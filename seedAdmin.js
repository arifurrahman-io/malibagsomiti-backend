const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const User = require("./models/User");

dotenv.config();

const createSuperAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const adminExists = await User.findOne({ role: "super-admin" });
    if (adminExists) {
      console.log("Super-Admin already exists!");
      process.exit();
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash("123456", salt);

    await User.create({
      name: "Head Admin",
      email: "arifurrahman.now@gmail.com",
      phone: "01684516151",
      password: hashedPassword,
      role: "super-admin",
      branch: "Malibag-A-Day",
      shares: 1,
      nid: "0000000000",
      status: "active",
    });

    console.log("🚀 Super-Admin created successfully!");
    process.exit();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

createSuperAdmin();
