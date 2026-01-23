const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please add a name"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Please add an email"],
      unique: true,
      index: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please add a valid email",
      ],
    },
    password: {
      type: String,
      required: [true, "Please add a password"],
      minlength: 6,
      select: false,
    },
    phone: {
      type: String,
      required: [true, "Please add a phone number"],
    },

    bankAccount: {
      type: String,
      trim: true,
    },
    // ✅ নতুন ফিল্ড ২
    accountNumber: {
      type: String,
      trim: true,
    },

    nid: {
      type: String,
      required: [true, "Please add an NID number"],
      unique: true,
    },
    // 🔥 FINANCIAL TRACKING FIELDS [cite: 2026-01-10]
    totalDeposited: {
      type: Number,
      default: 0, // This is what your HistoryScreen reads
    },
    shares: {
      type: Number,
      default: 1,
      min: [1, "Member must have at least 1 share"],
    },
    monthlySubscription: {
      type: Number,
      default: 1000, // Cost per share
    },
    profilePicture: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ["member", "admin", "super-admin"],
      default: "member",
    },
    branch: {
      type: String,
      required: [true, "Please select a branch"],
      enum: [
        "Malibagh-A-Day",
        "Malibagh-A-Morning",
        "Malibagh-B-Day",
        "Malibagh-B-Morning",
        "Malibagh-C-Day",
        "Malibagh-C-Morning",
      ],
      index: true,
    },
    joiningDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    // models/User.js
    fcmTokens: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// --- VIRTUALS for Dynamic UI [cite: 2025-10-11] ---
/**
 * Automatically calculates how much the member should pay per month
 */
userSchema.virtual("requiredMonthlyPayment").get(function () {
  return this.shares * this.monthlySubscription;
});

// --- PASSWORD ENCRYPTION MIDDLEWARE ---
userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// --- HELPER METHOD ---
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
