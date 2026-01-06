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
      select: false, // Automatically excludes password from queries for security
    },
    phone: {
      type: String,
      required: [true, "Please add a phone number"],
    },
    nid: {
      type: String,
      required: [true, "Please add an NID number"],
      unique: true,
    },
    bankAccount: { type: String },
    role: {
      type: String,
      enum: ["member", "admin", "super-admin"],
      default: "member",
    },
    branch: {
      type: String,
      required: [true, "Please select a branch"],
      enum: [
        "Malibag-A-Day",
        "Malibag-A-Morning",
        "Malibag-B-Day",
        "Malibag-B-Morning",
        "Malibag-C-Day",
        "Malibag-C-Morning",
      ],
      index: true,
    },
    shares: {
      type: Number,
      default: 1,
      min: [1, "Member must have at least 1 share"],
    },
    monthlySubscription: {
      type: Number,
      default: 1000,
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
  },
  { timestamps: true }
);

// --- PASSWORD ENCRYPTION MIDDLEWARE ---
/**
 * Modern Mongoose pre-save hook using async/await.
 * Removed 'next' to prevent "TypeError: next is not a function".
 */
userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// --- HELPER METHOD ---
// Compares entered password with the hashed password in the database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
