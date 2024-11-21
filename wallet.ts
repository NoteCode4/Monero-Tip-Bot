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

import {
  loadMoneroDylib,
  Wallet,
  WalletManager
} from "https://raw.githubusercontent.com/MrCyjaneK/monero_c/9496ab4fbe63c0af3605472dbdf614d8c1fd89af/impls/monero.ts/mod.ts";
import { existsSync } from "https://deno.land/std/fs/mod.ts";
import { db } from "./db.ts";
import { bot } from "./bot.ts"
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";

export const env = config();
// Try to load dylib from the default lib/* path
// You can also use loadWowneroDylib for Wownero
loadMoneroDylib();

const walletPath = "./my_wallet";
const wm = await WalletManager.new();

export let wallet;

if (existsSync(walletPath + ".keys")) {
  wallet = await Wallet.open(wm, walletPath, env.WALLET_PASSWORD || "password");
  console.log("Wallet opened.");
} else {
  wallet = await Wallet.create(wm, walletPath,  env.WALLET_PASSWORD || "password");
  console.log("New wallet created.");
}

const coin = "monero"
if (coin !== "monero" && coin !== "wownero") {
  throw new Error("COIN env var invalid or missing");
}

const WOWNERO_NODE_URL = "https://node3.monerodevs.org:34568";
const MONERO_NODE_URL = env.MONERO_NODE_URL || "http://xmr-node.cakewallet.com:18081";

const NODE_URL = coin === "monero" ? MONERO_NODE_URL : WOWNERO_NODE_URL;

async function syncBlockchain(wallet: Wallet): Promise<bigint> {
  // Wait for blockchain to sync
  const blockHeight = await new Promise<bigint>((resolve) => {
    let timeout: number;

    const poll = async () => {
      const blockChainHeight = await wallet.blockChainHeight();
      const daemonBlockchainHeight = await wallet.daemonBlockChainHeight();
      console.log("Blockchain height:", blockChainHeight, "Daemon blockchain height:", daemonBlockchainHeight, "Remains:", daemonBlockchainHeight - blockChainHeight);
      if (blockChainHeight === daemonBlockchainHeight) {
        clearTimeout(timeout);
        resolve(blockChainHeight);
      } else {
        setTimeout(poll, 500);
      }
    };

    poll();
  });
  await new Promise((r) => setTimeout(r, 1500)); // wait for it to sync
  return blockHeight;
}

try {
  await wallet.initWallet(NODE_URL);
  console.log("Wallet initialized with daemon.");
} catch (error) {
  console.error("Failed to initialize wallet with daemon:", error);
}

await wallet.refreshAsync();
await syncBlockchain(wallet);

await wallet.refreshAsync();
await wallet.store();
await wallet.refreshAsync();

const billion = 1000000000000

console.log(`Wallet Synchronized : ${await wallet.synchronized()}`);

await wallet.store();
async function listenForTransactions(wallet: Wallet, db: DB) {
  try {

    // Refresh the wallet to sync with the blockchain
    await wallet.refreshAsync();
    // Fetch transaction history
    const transactions = await wallet.getHistory();
    await transactions.refresh();
    const count = await transactions.count();

    for (let index = 0; index < count; index++) {
      const tx = await transactions.transaction(index);

      const txHash = await tx.hash();
      const direction = await tx.direction();
      const isPending = await tx.isPending();
      const isFailed = await tx.isFailed();
      const accountIndex = await tx.subaddrAccount();
      const amount = Number(await tx.amount()) / 1e12; // Convert atomic units to Monero
      const timestamp = Number(await tx.timestamp());
      const status = isFailed
        ? "failed"
        : isPending
          ? "pending"
          : "confirmed";

      // Only process confirmed incoming transactions
      if (direction === "in" && status === "confirmed") {
        // Check if the transaction is already processed
        const existingTx = db.query(
          "SELECT txHash FROM transactions WHERE txHash = ?",
          [txHash]
        );

        if (existingTx.length === 0) {
          // Find the user associated with the walletIndex (accountIndex)
          const user = db.query(
            "SELECT cindex, userID, balance FROM users WHERE walletIndex = ?",
            [accountIndex]
          );

          if (user.length > 0) {
            const cindex = user[0][0]; // cindex
            const userID = user[0][1]; // userID
            const currentBalance = user[0][2]; // current balance

            // Update user's balance
            db.query(
              "UPDATE users SET balance = ? WHERE cindex = ?",
              [currentBalance + amount, cindex]
            );

            await bot.api.sendMessage(userID, `${amount.toFixed(8)} XMR has been added to your balance.\n\nTransaction Hash : \n${txHash}`, {
              parse_mode: "Markdown"
            }).catch(err => {
              if (err.description == "Forbidden: bot can't initiate conversation with a user") {
                return
              }
            });
          } else {
            console.warn(
              `No user found for accountIndex ${accountIndex}. Skipping transaction.`
            );
          }

          // Insert the transaction into the transactions table
          db.query(
            `INSERT INTO transactions (txHash, accountIndex, amount, timestamp, status)
             VALUES (?, ?, ?, ?, ?)`,
            [txHash, accountIndex, amount, timestamp, "confirmed"]
          );

          console.log(
            `Recorded transaction: ${txHash}, Amount: ${amount}, AccountIndex: ${accountIndex}`
          );
          wallet.store()

          // Create a new subaddress for the accountIndex using addSubaddress
          const newSubaddressIndex = await wallet.addSubaddress(accountIndex);

          const newSubaddress = await wallet.address(accountIndex, Number(await wallet.numSubaddresses(accountIndex)));
          console.log(`Created new subaddress for account ${accountIndex}: ${newSubaddress}`);
          wallet.store()
          console.log(`Stored new subaddress in database for accountIndex ${accountIndex}`);
        }
      }
    }
  } catch (error) {
    console.error("Error listening for transactions:", error);
  }
}

console.log("Listening for transactions...");
setInterval(async () => {
  listenForTransactions(wallet, db);
}, 30000) // Poll every 30 seconds

console.log(`Current Number of Wallet Accounts : ${Number(await wallet.numSubaddressAccounts())}`)