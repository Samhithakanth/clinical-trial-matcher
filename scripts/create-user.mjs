#!/usr/bin/env node
// Creates (or resets the password of) a TrialMatch web app account.
//
// Usage (from the project folder, after running sql/003_auth.sql):
//   node --env-file=.env.local scripts/create-user.mjs <username> <ROLE> "<Display Name>"
//   ROLE is one of: ADMIN, CLINICIAN, RESEARCHER, COMPLIANCE
//
// The password is typed at a hidden prompt and stored only as an scrypt
// hash (same format as src/lib/password.ts).

import { randomBytes, scrypt } from "node:crypto";
import readline from "node:readline";
import mysql from "mysql2/promise";

const ROLES = ["ADMIN", "CLINICIAN", "RESEARCHER", "COMPLIANCE"];
const [, , rawUsername, rawRole, ...nameParts] = process.argv;
const username = (rawUsername || "").trim().toLowerCase();
const role = (rawRole || "").trim().toUpperCase();
const displayName = nameParts.join(" ").trim() || username;

if (!/^[a-z0-9_.-]{3,50}$/.test(username) || !ROLES.includes(role)) {
  console.error('Usage: node --env-file=.env.local scripts/create-user.mjs <username> <ROLE> "<Display Name>"');
  console.error(`ROLE: ${ROLES.join(", ")}. Username: 3-50 chars, lowercase letters, numbers, _ . -`);
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = function (text) {
      if (!rl.stdoutMuted) rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    rl.stdoutMuted = true;
  });
}

function hashPassword(password) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(`scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`),
    );
  });
}

const password = await askHidden(`Password for ${username}: `);
if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error("Password must be at least 10 characters and contain letters and numbers.");
  process.exit(1);
}
if ((await askHidden("Repeat password: ")) !== password) {
  console.error("Passwords do not match.");
  process.exit(1);
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "clinical_trial_matcher",
});

try {
  const hash = await hashPassword(password);
  const [result] = await connection.execute(
    `INSERT INTO app_account (username, display_name, password_hash, role)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name),
       password_hash = VALUES(password_hash), role = VALUES(role),
       is_active = TRUE, failed_attempts = 0, locked_until = NULL,
       session_version = session_version + 1`,
    [username, displayName, hash, role],
  );
  console.log(result.affectedRows === 1 ? `Created ${role} account "${username}".` : `Updated account "${username}" (role ${role}, new password).`);
} catch (error) {
  console.error("Could not save the account:", error.message);
  if (error.code === "ER_NO_SUCH_TABLE") console.error("Run sql/003_auth.sql first.");
  process.exitCode = 1;
} finally {
  await connection.end();
}
