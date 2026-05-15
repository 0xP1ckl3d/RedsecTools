const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "..", "..", "data", "pastes.db");
const DATA_DIR = path.dirname(DB_PATH);
const FILES_DIR = path.join(__dirname, "..", "..", "..", "data", "files");
const TMP_DIR = path.join(__dirname, "..", "..", "..", "data", "tmp");
const AVATARS_DIR = path.join(__dirname, "..", "..", "..", "data", "avatars");
const BULLETIN_ASSETS_DIR = path.join(__dirname, "..", "..", "..", "data", "bulletin-assets");
const BRAND_DIR = path.join(__dirname, "..", "..", "..", "data", "brand");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function openDatabase() {
  ensureDir(DATA_DIR);
  ensureDir(FILES_DIR);
  ensureDir(TMP_DIR);
  ensureDir(AVATARS_DIR);
  ensureDir(BULLETIN_ASSETS_DIR);
  ensureDir(BRAND_DIR);

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

module.exports = {
  openDatabase,
  DB_PATH,
  DATA_DIR,
  FILES_DIR,
  TMP_DIR,
  AVATARS_DIR,
  BULLETIN_ASSETS_DIR,
  BRAND_DIR,
};
