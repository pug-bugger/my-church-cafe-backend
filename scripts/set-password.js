#!/usr/bin/env node
// Set a user's password by email.
//
//   npm run set-password -- user@example.com            # prompts for the password
//   npm run set-password -- user@example.com 'newpass'  # non-interactive
//
// Prefer the prompt: a password on the command line lands in shell history.
// Works on passwordless (Google-only) accounts too — it gives them a password.
const path = require("path");
const readline = require("readline");

// env.js reads .env from the working directory; anchor it to the backend root
// so the script works from anywhere (including through the release symlink).
process.chdir(path.resolve(__dirname, ".."));

const bcrypt = require("bcryptjs");
const { getPool } = require("../src/config/db");

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const [email, passwordArg] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: npm run set-password -- <email> [password]");
    process.exit(1);
  }

  let password = passwordArg;
  if (password === undefined) {
    password = await promptHidden("New password: ");
    const confirm = await promptHidden("Repeat password: ");
    if (password !== confirm) {
      console.error("Passwords do not match.");
      process.exit(1);
    }
  }
  if (!password) {
    console.error("Password must not be empty.");
    process.exit(1);
  }

  const pool = getPool();
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email FROM users WHERE email = ? LIMIT 1",
      [email.trim()],
    );
    if (rows.length === 0) {
      console.error(`No user with email ${email}`);
      process.exitCode = 1;
      return;
    }
    const user = rows[0];
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [
      passwordHash,
      user.id,
    ]);
    console.log(`Password updated for ${user.name} <${user.email}> (id ${user.id}).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
