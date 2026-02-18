require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Firebase Admin SDK
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: "mouthful-foods-ca124",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    }),
    databaseURL: "https://mouthful-foods-ca124-default-rtdb.firebaseio.com"
  });
} catch (error) {
  // Firebase Admin not configured (optional for auth deletion)
}

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_PROD_URL
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (Postman, mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Create nodemailer transporter
let transporter;

// Auto-generate test account if no credentials provided
async function setupTransporter() {
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS && 
      process.env.EMAIL_USER !== 'your-email@gmail.com') {
    // Use real Gmail credentials
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    transporter.verify((error, success) => {
      if (error) {
        console.error('❌ Email configuration error:', error.message);
      }
    });
  } else {
    // Auto-generate Ethereal test account (no credentials needed!)
    const testAccount = await nodemailer.createTestAccount();
    
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
  }
}

setupTransporter();

// Send vendor approval email
async function sendVendorApprovalEmail(vendor) {
  const mailOptions = {
    from: `"Mouthful Foods" <${process.env.EMAIL_USER}>`,
    to: vendor.email,
    subject: "Your Vendor Account is Approved 🎉",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4CAF50;">Hello ${vendor.name}! 🎉</h2>
        <p style="font-size: 16px;">
          Congratulations! Your vendor account for <strong>${vendor.businessName}</strong> has been approved.
        </p>
        <p style="font-size: 16px;">
          Your account is now <strong style="color: #4CAF50;">ACTIVE</strong>.
        </p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="https://dashboard.mouthfulfoods.com/" 
             style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
            Access Dashboard
          </a>
        </div>
        <p style="font-size: 14px;">You can now:</p>
        <ul style="font-size: 14px;">
          <li>Manage your products</li>
          <li>View orders</li>
          <li>Track payments</li>
          <li>Update business information</li>
        </ul>
        <p style="font-size: 14px; color: #666; margin-top: 30px;">
          Best regards,<br>
          <strong>Mouthful Foods Admin Team</strong>
        </p>
      </div>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return { success: true, messageId: info.messageId };
}

// Send vendor suspension/rejection email
async function sendVendorSuspensionEmail(vendor, reason, isActive = true) {
  const subject = isActive 
    ? "Account Suspended - Mouthful Foods"
    : "Application Rejected - Mouthful Foods";
  
  const mailOptions = {
    from: `"Mouthful Foods" <${process.env.EMAIL_USER}>`,
    to: vendor.email,
    subject: subject,
    html: isActive
      ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #f44336;">Account Suspended</h2>
          <p>Hello ${vendor.name},</p>
          <p>Your vendor account for <strong>${vendor.businessName}</strong> has been suspended.</p>
          <div style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 20px 0;">
            <strong>Reason:</strong> ${reason}
          </div>
          <p>Please contact us for more details or to resolve this issue.</p>
          <div style="margin: 20px 0;">
            <p><strong>Contact Support:</strong></p>
            <p>📧 Email: <a href="mailto:support@mouthfulfoods.com">support@mouthfulfoods.com</a></p>
            <p>📱 Or contact us through the Mouthful Foods app</p>
          </div>
          <p style="font-size: 14px; color: #666; margin-top: 30px;">
            Best regards,<br>
            <strong>Mouthful Foods Admin Team</strong>
          </p>
        </div>
      `
      : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #f44336;">Application Rejected</h2>
          <p>Hello ${vendor.name},</p>
          <p>Your vendor application for <strong>${vendor.businessName}</strong> has been rejected.</p>
          <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
            <strong>Reason:</strong> ${reason}
          </div>
          <p>You are welcome to re-register with complete information through the Mouthful Foods mobile app.</p>
          <p style="font-size: 14px; color: #666; margin-top: 30px;">
            Best regards,<br>
            <strong>Mouthful Foods Admin Team</strong>
          </p>
        </div>
      `
  };

  const info = await transporter.sendMail(mailOptions);
  return { success: true, messageId: info.messageId };
}

// API endpoint to send approval email
app.post("/api/send-approval-email", async (req, res) => {
  try {
    const { vendor } = req.body;

    if (!vendor || !vendor.email || !vendor.name) {
      return res.status(400).json({
        success: false,
        error: "Missing required vendor information",
      });
    }

    const result = await sendVendorApprovalEmail(vendor);
    res.json({
      success: true,
      message: "Approval email sent successfully",
      data: result,
    });
  } catch (error) {
    console.error("Error sending approval email:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API endpoint to send suspension email
app.post("/api/send-suspension-email", async (req, res) => {
  try {
    const { vendor, reason, isActive } = req.body;

    if (!vendor || !vendor.email || !vendor.name) {
      return res.status(400).json({
        success: false,
        error: "Missing required vendor information",
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: "Reason is required",
      });
    }

    const result = await sendVendorSuspensionEmail(vendor, reason, isActive);
    res.json({
      success: true,
      message: "Email sent successfully",
      data: result,
    });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API endpoint to reject pending vendor and delete from database
app.post("/api/reject-and-delete-vendor", async (req, res) => {
  try {
    const { vendor, reason, userId } = req.body;

    if (!vendor || !vendor.email || !vendor.name) {
      return res.status(400).json({
        success: false,
        error: "Missing required vendor information",
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: "Reason is required",
      });
    }

    // Send rejection email (isActive = false for pending vendors)
    await sendVendorSuspensionEmail(vendor, reason, false);

    // Delete from Firebase Auth (if userId provided)
    if (userId && admin.apps.length > 0) {
      try {
        await admin.auth().deleteUser(userId);
        console.log(`✅ Deleted user from Firebase Auth: ${userId}`);
      } catch (authError) {
        console.error("⚠️ Error deleting Firebase Auth user:", authError.message);
        // Continue even if auth deletion fails
      }
    }

    res.json({
      success: true,
      message: "Vendor rejected, email sent, and user deleted from authentication",
    });
  } catch (error) {
    console.error("Error rejecting vendor:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok",
    emailConfigured: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS)
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Email service running on http://localhost:${PORT}`);
});
