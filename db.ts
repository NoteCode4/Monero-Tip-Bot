/* 
 * This file is part of [Monero Tip Bot].
 *
 * [Monero Tip Bot] is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * [Monero Tip Bot] is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with [Monero Tip Bot]. If not, see <https://www.gnu.org/licenses/>.
 */

import { DB } from "https://deno.land/x/sqlite/mod.ts";

export const db = new DB("./data/users.db");

db.query(`
  CREATE TABLE IF NOT EXISTS users (
    cindex INTEGER PRIMARY KEY AUTOINCREMENT,
    userID INTEGER UNIQUE,
    walletIndex INTEGER,
    balance REAL DEFAULT 0,
    tipAddress TEXT DEFAULT NULL,
    page INTEGER DEFAULT 1
  )
`);

db.query(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chatID INTEGER NOT NULL,
  userID INTEGER NOT NULL,
  messageID INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  first_name TEXT
);
`)

db.query(`
  CREATE TABLE IF NOT EXISTS transactions (
    txHash TEXT PRIMARY KEY,
    accountIndex INTEGER NOT NULL,
    amount REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
    UNIQUE (txHash, accountIndex)
);`)

db.query(`
  CREATE TABLE IF NOT EXISTS Tiptransactions (
  txID TEXT PRIMARY KEY,          -- Unique transaction ID
  senderID INTEGER,               -- User ID of the sender
  recipientID INTEGER,            -- User ID of the recipient
  amount REAL,                    -- Amount of XMR tipped
  type TEXT,                      -- Type of transaction (e.g., "tip")
  timestamp INTEGER DEFAULT (strftime('%s', 'now')) -- Timestamp of the transaction
);`);

async function cleanupOldMessages() {
  try {
    // Delete messages older than 48 hours (timestamp in seconds)
    const deleteQuery = `
      DELETE FROM messages
      WHERE timestamp < (strftime('%s', 'now') - 48 * 60 * 60)
    `;
    const result = await db.query(deleteQuery);
    console.log(`Cleanup completed. Removed ${result.changes} old messages.`);
  } catch (error) {
    console.error("Error during message cleanup:", error);
  }
}

setInterval(async () => {
  console.log("Running scheduled message cleanup...");
  await cleanupOldMessages();
}, 60 * 60 * 1000); // 1 hour