// config/db.js
const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Speeds up initial connection by forcing IPv4
      family: 4,
      // Limits how long the driver waits for a server response
      serverSelectionTimeoutMS: 5000,
      // Reuses connections to avoid repeating the slow handshake
      maxPoolSize: 10,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Connection Error: ${error.message}`);
  }
};

module.exports = connectDB;
