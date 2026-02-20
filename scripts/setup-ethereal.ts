#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Script to generate Ethereal.email test account credentials
// Run: npx tsx scripts/setup-ethereal.ts
// ---------------------------------------------------------------------------
import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const envPath = path.join(rootDir, ".env");

async function main() {
  console.log("🔧 Generating Ethereal.email test account...");

  const testAccount = await nodemailer.createTestAccount();

  console.log("\n✅ Ethereal test account created!");
  console.log("\n📧 Credentials:");
  console.log(`   Email: ${testAccount.user}`);
  console.log(`   Password: ${testAccount.pass}`);
  console.log(`   SMTP Host: ${testAccount.smtp.host}`);
  console.log(`   SMTP Port: ${testAccount.smtp.port}`);
  console.log(`   Web Interface: https://ethereal.email/`);

  console.log("\n📝 Add these to your .env file:");
  const envVars = `
# Email Configuration (Ethereal.email for testing)
EMAIL_PROVIDER=smtp
SMTP_HOST=${testAccount.smtp.host}
SMTP_PORT=${testAccount.smtp.port}
SMTP_USER=${testAccount.user}
SMTP_PASS=${testAccount.pass}
SMTP_SECURE=false
`;

  console.log(envVars);

  // Offer to append to .env
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    
    // Check if EMAIL_PROVIDER already exists
    if (envContent.includes("EMAIL_PROVIDER")) {
      console.log("\n⚠️  EMAIL_PROVIDER already exists in .env - skipping auto-update.");
      console.log("   Please manually update your .env file with the credentials above.");
    } else {
      fs.appendFileSync(envPath, envVars);
      console.log("\n✅ Credentials appended to .env file!");
    }
  } else {
    console.log("\n⚠️  No .env file found. Please create one and add the credentials above.");
  }

  console.log("\n🎯 Next steps:");
  console.log("   1. Restart your server");
  console.log("   2. Test by requesting a magic link (POST /v1/auth/request-link)");
  console.log("   3. Check server logs for the Ethereal preview URL");
  console.log("   4. View the email at https://ethereal.email/messages");
  console.log("\n💡 Tip: Ethereal accounts are temporary. Re-run this script if credentials expire.\n");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
