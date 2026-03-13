#!/usr/bin/env node
/**
 * Run a command using the Python venv in python/.venv.
 * Usage: node scripts/run-python.js process.py
 *        node scripts/run-python.js -m pip install -r requirements.txt
 * If the venv doesn't exist, exits with a message to run npm run python:setup.
 */
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const venvDir = path.join(root, "python", ".venv");
const py =
  process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");

const fs = require("fs");
if (!fs.existsSync(py)) {
  console.error("Python venv not found. Run once from repo root:");
  console.error("  npm run python:setup");
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync(py, args, {
  stdio: "inherit",
  cwd: path.join(root, "python"),
});
process.exit(result.status ?? 1);
