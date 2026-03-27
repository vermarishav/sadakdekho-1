require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const User = require("./models/User");
const TempUser = require("./models/TempUser");

const app = express();


// ── Middleware ─────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));
app.use(express.static("public"));
app.use("/videos", express.static("public/videos"));
const videoRoute = require("./routes/videoRoute"); app.use("/api", videoRoute);

// ── MongoDB ───────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));


// ── Mail ──────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


// ── Auth Middleware ───────────────────────────────
const authenticate = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ success: false });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false });
  }
};


// ── REGISTER ──────────────────────────────────────
app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Account already exists"
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    // 🔥 remove old tokens
    await TempUser.deleteMany({ email });

    const verifyToken = crypto.randomBytes(32).toString("hex");

    await TempUser.create({
      name,
      email,
      password: hashed,
      verifyToken,
      verifyTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
    });

    const base = process.env.FRONTEND_URL || "http://localhost:3000";

    const verifyLink = `${base}/verify-email?token=${verifyToken}`;

    await transporter.sendMail({
      from: `"SadakDekho" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify your account",
      html: emailTemplate(
        "Welcome 👋",
        "Click below to verify your account",
        verifyLink,
        "Verify Account"
      )
    });

    res.json({ success: true, message: "Email sent" });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ success: false });
  }
});


// ── RESEND EMAIL ──────────────────────────────────
app.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;

    const tempUser = await TempUser.findOne({ email });

    if (!tempUser) {
      return res.json({
        success: false,
        message: "No pending verification"
      });
    }

    const base = process.env.FRONTEND_URL || "http://localhost:3000";

    const verifyLink = `${base}/verify-email?token=${tempUser.verifyToken}`;

    await transporter.sendMail({
      from: `"SadakDekho" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify your account",
      html: emailTemplate(
        "Verify Email",
        "Click below to verify",
        verifyLink,
        "Verify"
      )
    });

    res.json({ success: true });

  } catch (err) {
    console.error("RESEND ERROR:", err);
    res.status(500).json({ success: false });
  }
});


// ── VERIFY EMAIL ──────────────────────────────────
app.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    const tempUser = await TempUser.findOne({
      verifyToken: token,
      verifyTokenExpiry: { $gt: new Date() } // ✅ FIXED
    });

    if (!tempUser) {
      return res.send("❌ Link expired or invalid");
    }

    let user = await User.findOne({ email: tempUser.email });

    if (!user) {
      user = await User.create({
        name: tempUser.name,
        email: tempUser.email,
        password: tempUser.password
      });
    }

    // 🔥 remove all tokens
    await TempUser.deleteMany({ email: tempUser.email });

    const jwtToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", jwtToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    });

    res.redirect((process.env.FRONTEND_URL || "http://localhost:3000") + "/index.html");

  } catch (err) {
    console.error("VERIFY ERROR:", err);
    res.send("Server error");
  }
});


// ── LOGIN ─────────────────────────────────────────
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Account not found"
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({
        success: false,
        message: "Wrong password"
      });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});


// ── LOGOUT ────────────────────────────────────────
app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

// ── Forgot Password ───────────────────────────────────────────────────────────
app.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.json({ success: false, message: "Account not found" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.resetToken = token;
    user.resetTokenExpiry = Date.now() + 15 * 60 * 1000;
    await user.save();

    const frontendURL = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetLink = `${frontendURL}/reset.html?token=${token}`;

    await transporter.sendMail({
      from: `"SadakDekho" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset your password",
      html: `
        <h3>Password Reset</h3>
        <p>Click the link below to reset your password:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>This link expires in 15 minutes.</p>
      `
    });

    res.json({ success: true, message: "Reset link sent to email" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Reset Password ────────────────────────────────────────────────────────────
app.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() }
    });

    if (!user) return res.json({ success: false, message: "Token invalid or expired" });

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
// ── PROFILE ───────────────────────────────────────
app.get("/profile", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      res.clearCookie("token");
      return res.status(401).json({ success: false });
    }

    res.json({ success: true, user });

  } catch {
    res.status(401).json({ success: false });
  }
});

// ── Place Suggestions ─────────────────────────────────────────────────────────
app.get("/api/suggest", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json([]);

    const routes = await mongoose.connection
      .collection("routes")
      .find({ "path.placeName": { $regex: q, $options: "i" } })
      .toArray();

    const results = [];
    const seen = new Set(); // avoid duplicates

    routes.forEach(route => {
      route.path.forEach(p => {
        if (
          p.placeName.toLowerCase().includes(q.toLowerCase()) &&
          !seen.has(p.placeName.toLowerCase())
        ) {
          seen.add(p.placeName.toLowerCase());
          results.push({ name: p.placeName, lat: p.lat, lng: p.lng });
        }
      });
    });

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

// ── LOCATION VIDEO API (FINAL FIXED FOR YOUR DB) ─────────────────────
app.get("/api/locationVideo", async (req, res) => {
  try {
    let result = null;

    // 🔍 SEARCH BY PLACE NAME
    if (req.query.place) {
      const place = req.query.place.toLowerCase();

      const routes = await mongoose.connection
        .collection("routes")
        .find()
        .toArray();

      for (const route of routes) {
        const point = route.path.find(p =>
          p.placeName.toLowerCase().includes(place)
        );

        if (point) {
          result = {
            name: point.placeName,
            description: `${point.placeName} on route from ${route.fromPlace} to ${route.toPlace}`,
            video: route.videoUrl,
            timestamp: point.time
          };
          break;
        }
      }
    }

    // 📍 SEARCH BY GPS
    else if (req.query.lat && req.query.lng) {
      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.query.lng);

      const routes = await mongoose.connection
        .collection("routes")
        .find()
        .toArray();

      let minDist = Infinity;

      routes.forEach(route => {
        route.path.forEach(p => {
          const dist = Math.sqrt(
            (p.lat - lat) ** 2 +
            (p.lng - lng) ** 2
          );

          if (dist < minDist) {
            minDist = dist;

            result = {
              name: p.placeName,
              description: `${p.placeName} near your location`,
              video: route.videoUrl,
              timestamp: p.time
            };
          }
        });
      });
    }

    // ❌ NOT FOUND
    if (!result) {
      return res.json({ success: false });
    }

    // ✅ SUCCESS
    res.json({
      success: true,
      name: result.name,
      description: result.description,
      video: result.video,
      timestamp: result.timestamp
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});
// ── EMAIL TEMPLATE ────────────────────────────────
function emailTemplate(title, text, link, btn) {
  return `
    <div style="font-family:sans-serif;text-align:center">
      <h2>SadakDekho</h2>
      <h3>${title}</h3>
      <p>${text}</p>
      <a href="${link}" 
         style="padding:10px 20px;background:#1f80ff;color:#fff;text-decoration:none;border-radius:5px">
         ${btn}
      </a>
    </div>
  `;
}


// ── SERVER ───────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));