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

import { Bot, InputFile, session } from "https://deno.land/x/grammy/mod.ts";
import { db } from './db.ts';
import { wallet , env } from './wallet.ts';
import { qrcode } from "https://deno.land/x/qrcode/mod.ts";
import {
  type Conversation,
  type ConversationFlavor,
  conversations,
  createConversation,
} from "https://deno.land/x/grammy_conversations@v1.2.0/mod.ts";


type MyContext = Context & ConversationFlavor;
type MyConversation = Conversation<MyContext>;

// Create bot object
if (!env.BOT_TOKEN) {
  console.log("Please put a BOT_TOKEN in the .env file")
  Deno.exit(1);
}
export const bot = new Bot<MyContext>(env.BOT_TOKEN); // <-- place your bot token inside this string

function createInlineKeyboard(rows: { text: string; callbackData: string }[][]): any {
  return {
    inline_keyboard: rows.map(row => row.map(option => ({
      text: option.text,
      callback_data: option.callbackData
    })))
  };
}

async function withdraw(conversation, ctx) {
  const m1 = await ctx.reply("Please reply to this message your XMR address.", {
    reply_markup: {
      force_reply: true
    }
  });
  const ma1 = await conversation.waitForReplyTo(m1);
  const m2 = await ctx.reply(`Please reply to this message the amount you want to withdraw. If you want to withdraw all existing unlocked balance please reply _ALL_.`, {
    reply_markup: {
      force_reply: true
    },
    parse_mode: "markdown"
  });
  const ma2 = await conversation.waitForReplyTo(m2)

  // Parse user input
  const address = ma1.message.text
  let amount;
  if (ma2.message.text.toUpperCase() == "ALL") {
    amount = 0

    if (!address) {
      return ctx.reply("Invalid Response!", {
        parse_mode: "Markdown",
        reply_markup: mainKeyboard
      });
    }
  } else {
    amount = parseFloat(ma2.message.text);

    // Validate inputs
    if (!address || isNaN(amount) || amount <= 0) {
      return ctx.reply("Invalid Response!", {
        parse_mode: "Markdown",
        reply_markup: mainKeyboard
      });
    }
  }

  const senderID = ma2.message.from?.id;

  try {
    // Check if the user exists in the database
    const sender = await db.query("SELECT * FROM users WHERE userID = ?", [senderID]);
    if (!sender.length) {
      return ctx.reply("You need to register with the bot before using this command.");
    }

    const [cindex, userID, walletIndex, balance] = sender[0];
    const senderData = {
      cindex,
      userID,
      walletIndex,
      balance: Number(balance), // Ensure balance is numeric
    };

    // Check unlocked balance in the wallet
    const unlockedBalance = Number(await wallet.unlockedBalance(senderData.walletIndex)) / 1e12;
    
    if (ma2.message.text.toUpperCase() !== "ALL") {
      if (unlockedBalance < amount) {
        return ctx.reply("Insufficient unlocked balance in your wallet.");
      }
    }

    // Convert amount to atomic units
    const atomicAmount = BigInt(Math.round(amount * 1e12));

    // Create the transaction
    let transaction

    if (ma2.message.text.toUpperCase() == "ALL") {
      transaction = await wallet.createTransactionMultDest([address], [atomicAmount], true, 1, senderData.walletIndex);
    } else {
      transaction = await wallet.createTransactionMultDest([address], [atomicAmount], false, 1, senderData.walletIndex);
    }

    if (await transaction.errorString()) {
      const error = await transaction.errorString();
      function getFirstFiveWords(str) {
        // Split the string into an array of words
        const words = str.split(" ");
        // Join the first 5 words back into a string
        return words.slice(0, 5).join(" ");
      }

      if (getFirstFiveWords(error) == "not enough money to transfer,") {
        ctx.reply(`Insufficient Balance!\n\nReminder: Every withdrawal needs fee.`, {
          parse_mode: "Markdown",
          reply_to_message_id: ctx.message?.message_id,
          reply_markup: mainKeyboard
        });
      }

      if (error == "Invalid destination address") {
        ctx.reply(`${error}.`, {
          parse_mode: "Markdown",
          reply_to_message_id: ctx.message?.message_id,
          reply_markup: mainKeyboard
        });
      }
      return console.log(await transaction.errorString())
    }

    // Transaction successfully created
    const txHash = await transaction.txid();
    const fee = await transaction.fee();
    const txAmount = await transaction.amount();

    ctx.reply(`*Withdrawal Receipt!* \n\nAmount: \`${Number(txAmount) / 1e12}\` XMR\nFee: ${Number(fee) / 1e12} XMR\nDestination:\n\`${address}\``, {
      parse_mode: "markdown"
    });
    const m3 = ctx.reply(`Please reply _CONFIRM_ to this message to confirm your withdrawal.`, {
      parse_mode: "markdown",
      reply_markup: {
        force_reply: true
      }
    })
    const ma3 = await conversation.waitForReplyTo(m3);

    const confirmation = ma3.message.text

    // Notify the user

    if (confirmation.toUpperCase() == "CONFIRM") {
      const commit = await transaction.commit("", true);

      ctx.reply(
        `Withdrawal successful! \n\nAmount: \`${Number(txAmount) / 1e12}\` XMR\nFee: ${Number(fee) / 1e12} XMR\nDestination:\n\`${address}\`\nTransaction Hash:\n\`${txHash}\``,
        { parse_mode: "Markdown" , reply_markup: mainKeyboard}
      );
    } else {
      ctx.reply(`Transaction Cancelled , Confirmation Failed.` , {
         reply_markup: mainKeyboard
      })
    }

  } catch (err) {
    console.error("Error in /withdraw command:", err);
    ctx.reply("An error occurred while processing your withdrawal. Please try again later.");
  }
}

bot.use(session({ initial: () => ({}) }));
bot.use(conversations());
bot.use(createConversation(withdraw));

const base64ToBuffer = (base64String: string): Uint8Array => {
  // Remove the "data:image/png;base64," or any similar prefix if present
  const cleanBase64 = base64String.replace(/^data:image\/[a-z]+;base64,/, "");

  // Decode the cleaned base64 string to a buffer
  const decoded = atob(cleanBase64);
  const byteArray = new Uint8Array(decoded.length);

  for (let i = 0; i < decoded.length; i++) {
    byteArray[i] = decoded.charCodeAt(i);
  }

  return byteArray;
};


const mainKeyboard = createInlineKeyboard([
  [
    { text: "Balance", callbackData: "checkBalance" },
    { text: "Deposit", callbackData: "depositBalance" },
    { text: 'Withdraw', callbackData: "withdrawBalance" }
  ]
]);

const depositKeyboard = createInlineKeyboard([
  [
    { text: "Transaction History", callbackData: "transaction" }
  ],
  [
    { text: "Show My All My Address", callbackData: "allMy" }
  ],
  [
    { text: "Advance Settings", callbackData: "advance" }
  ],
  [
    {
      text: "< Back", callbackData: "back"
    }
  ]
]);

const advanceKeyboard = createInlineKeyboard([
  [
    { text: "Generate New Deposit Address", callbackData: "generate" }
  ], [
    { text: "Set Tip Address", callbackData: "setAddress" },
    { text: "Remove Tip Adddress", callbackData: "removeAddress" }
  ],
  [
    { text: "My Tip Address", callbackData: "myAddress" }
  ],
  [
    { text: "< Back", callbackData: "back" }
  ]
])

const billion = 1000000000000;

function userExists(userID: number): boolean {
  const result = db.query("SELECT COUNT(*) FROM users WHERE userID = ?", [userID]);
  const [count] = result[0];
  return count > 0;
}

function addUser(userID: number, walletIndex: number): void {
  db.query("INSERT INTO users (userID, walletIndex) VALUES (?, ?)", [userID, walletIndex]);
}

bot.command('start', async (ctx) => {
  if (userExists(ctx.message.from.id)) {
    const result = db.query("SELECT * FROM users WHERE userID = ?", [ctx.message.from.id]);

    if (result.length > 0) {
      const [cindex, userID, walletIndex, balance] = result[0];
      const data = {
        cindex,
        userID,
        walletIndex,
        balance: Number(balance), // Ensure balance is a number
      };

      const numSubaddresses = Number(await wallet.numSubaddresses(data.walletIndex));
      let numC;
      if (numSubaddresses == 0) {
        numC = 0
      } else {
        numC = numSubaddresses - 1
      }
      const address = await wallet.address(data.walletIndex, numC);

      ctx.reply(`Hello ${ctx.message.from.first_name} thank you for using Monero Tip Bot,\n\nYou're current Monero address : \`${address}\``, {
        reply_markup: mainKeyboard,
        parse_mode: "Markdown"
      });
    } else {
      console.log("User not found.");
    }
  } else {
    await wallet.addSubaddressAccount();
    await wallet.store()
    const totalAccountsAfter = Number(await wallet.numSubaddressAccounts());
    const newAccountIndex = totalAccountsAfter; // New account is the last index
    console.log("New subaddress created at index:", newAccountIndex);
    await wallet.store()
    addUser(ctx.message.from.id, newAccountIndex)

    const address = await wallet.address(newAccountIndex)

    ctx.reply(`Hello ${ctx.message.from.first_name} thank you for using Monero Tip Bot,\n\nYou're current Monero address : \`${address}\``, {
      reply_markup: mainKeyboard,
      parse_mode: "Markdown"
    })
  }
})

bot.on('callback_query', async (ctx) => {
  const callbackData = ctx.callbackQuery.data;

  if (callbackData === "checkBalance") {
    const result = db.query("SELECT * FROM users WHERE userID = ?", [ctx.callbackQuery.from.id]);

    if (result.length > 0) {
      const result = db.query("SELECT * FROM users WHERE userID = ?", [ctx.callbackQuery.from.id]);

      if (result.length > 0) {
        const [cindex, userID, walletIndex, balance] = result[0];
        const data = {
          cindex,
          userID,
          walletIndex,
          balance: Number(balance), // Ensure balance is a number
        };

        await ctx.answerCallbackQuery("Checking your balance...");
        const unlockedBalance = Number(await wallet.unlockedBalance(data.walletIndex)) / billion;
        const bal = Number(await wallet.balance(data.walletIndex)) / billion;
        const lockedBalance = bal - unlockedBalance;

        // Remove the inline keyboard
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

        // Send the balance information conditionally
        if (lockedBalance > 0) {
          await ctx.reply(`Your current XMR balance is: \`${unlockedBalance.toFixed(12)}\`\nLocked XMR balance: ${lockedBalance.toFixed(12)}`, {
            reply_markup: mainKeyboard,
            parse_mode: "markdown"
          });
        } else {
          await ctx.reply(`Your current XMR balance is: \`${bal.toFixed(12)}\``, {
            reply_markup: mainKeyboard,
            parse_mode: "markdown"
          });
        }
      } else {
        console.log("User not found.");
      }
    }
  } else if (callbackData === "depositBalance") {
    const result = db.query("SELECT * FROM users WHERE userID = ?", [ctx.callbackQuery.from.id]);

    if (result.length > 0) {
      const [cindex, userID, walletIndex, balance] = result[0];
      const data = {
        cindex,
        userID,
        walletIndex,
        balance: Number(balance), // Ensure balance is a number
      };

      const numSubaddresses = Number(await wallet.numSubaddresses(data.walletIndex));
      let numC;
      if (numSubaddresses == 0) {
        numC = 0
      } else {
        numC = numSubaddresses - 1
      }
      const address = await wallet.address(data.walletIndex, numC);

      await ctx.answerCallbackQuery("Processing...");
      const qrCode = await qrcode(address); // Generate QR code as a Base64

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      ctx.replyWithPhoto(new InputFile(base64ToBuffer(qrCode)), {
        caption: `Your current XMR address is \`${address}\``,
        reply_markup: depositKeyboard,
        parse_mode: "MarkdownV2"
      });
    } else {
      console.log("User not found.");
    }
  } else if (callbackData === "withdrawBalance") {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    await ctx.reply("*Please follow the instructions to withdraw.* \n\n_1. Must have enough balance for both the amount and fee.\n2. Provide the information asked._\n\n*MUST REPLY TO THE BOTS MESSAGE, RESPONSE THAT ARE NOT REPLIED TO THE MESSAGE WILL BE IGNORED.*\n\n*NOTE: WRONG or MISTYPED address or amount is NON REFUNDABLE , so recheck your address and amount before proceeding.*", {
      reply_markup: mainKeyboard,
      parse_mode: "Markdown"
    });

    await ctx.conversation.enter("withdraw");
  } else if (callbackData == "generate") {

    const result = db.query("SELECT * FROM users WHERE userID = ?", [ctx.callbackQuery.from.id]);

    if (result.length > 0) {
      const [cindex, userID, walletIndex, balance] = result[0];
      const data = {
        cindex,
        userID,
        walletIndex,
        balance: Number(balance), // Ensure balance is a number
      };

      await wallet.addSubaddress(data.walletIndex);
      let numC;
      const numSubaddresses = Number(await wallet.numSubaddresses(data.walletIndex))
      if (numSubaddresses == 0) {
        numC = 0
      } else {
        numC = numSubaddresses - 1
      }
      const newSubaddress = await wallet.address(data.walletIndex, numC);
      console.log(`Created new subaddress for account ${data.walletIndex}: ${newSubaddress}`);
      wallet.store()
      await ctx.answerCallbackQuery("Processing...");

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      await ctx.reply(`Your new XMR address is \`${newSubaddress}\``, {
        parse_mode: "markdown",
        reply_markup: advanceKeyboard
      })

    }
  } else if (callbackData == "setAddress") {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    await ctx.reply("*Please follow the instructions to change your Tip Address.* \n\n1. Type the command /set *<address>*\n\n*NOTE: The Tip Address will receive all the tips you receive so make sure to use a Wallet that you can access anytime. Incorrect Addresses can be chaned but all the tips it received is NON REFUNDABLE.*", {
      reply_markup: advanceKeyboard,
      parse_mode: "Markdown"
    });
  } else if (callbackData == "removeAddress") {
    const userID = ctx.callbackQuery.from?.id;

    // Check if the user is in the database
    const user = await db.query("SELECT * FROM users WHERE userID = ?", [userID]);

    if (!user.length) {
      return ctx.reply("You are not registered in the system.");
    }

    // Check if the user already has a tipAddress set
    const [cindex, userIDDb, walletIndex, balance, tipAddress] = user[0];

    if (!tipAddress) {
      await ctx.answerCallbackQuery("Processing...");

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      return ctx.reply("You do not have a tip address set.", {
        reply_markup: advanceKeyboard
      });
    }

    // Set the tipAddress to null in the database
    await db.query("UPDATE users SET tipAddress = NULL WHERE userID = ?", [userID]);

    // Reply to the user confirming the removal\

    await ctx.answerCallbackQuery("Processing...");

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    return ctx.reply("Your tip address has been removed.", {
      reply_markup: mainKeyboard
    });

  } else if (callbackData == "myAddress") {

    const userID = ctx.callbackQuery.from?.id;

    // Check if the user is in the database
    const user = await db.query("SELECT * FROM users WHERE userID = ?", [userID]);

    if (!user.length) {
      return ctx.reply("You are not registered in the system.");
    }

    // Check if the user already has a tipAddress set
    const [cindex, userIDDb, walletIndex, balance, tipAddress] = user[0];

    if (!tipAddress) {
      await ctx.answerCallbackQuery("Processing...");

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      return ctx.reply("You do not have a tip address set.", {
        reply_markup: advanceKeyboard
      });
    }

    // Reply to the user confirming the removal\

    await ctx.answerCallbackQuery("Processing...");

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    return ctx.reply(`Your tip address is \`${tipAddress}\``, {
      reply_markup: mainKeyboard,
      parse_mode: "markdown"
    });
  } else if (callbackData == "transaction") {
    const senderID = ctx.from?.id;

    // Retrieve sender data from the database
    const sender = await db.query("SELECT * FROM users WHERE userID = ?", [senderID]);

    if (!sender.length) {
      return ctx.reply("You are not registered in the system.");
    }

    const [cindexS, userIDS, walletIndexS, balanceS, pageS] = sender[0];  // Add pageS to get the page from the database
    const senderData = {
      cindex: cindexS,
      userID: userIDS,
      walletIndex: walletIndexS,
      balance: Number(balanceS),
      page: pageS || 1, // Use the page from the database if not provided in callbackData
    };

    try {
      // Fetch the transaction history for the specific account index using wallet.getHistory
      const transactions = await wallet.getHistory(senderData.walletIndex); // Fetch for the specific wallet index
      await transactions.refresh();
      const count = await transactions.count();

      // Check if there are any transactions
      if (count === 0) {
        return ctx.reply("No transactions found for your account.");
      }

      // Get all transactions first to filter by subaddress account
      let validTransactions = [];
      for (let index = 0; index < count; index++) {
        const tx = await transactions.transaction(index);
        const transactionSubaddressAccount = await tx.subaddrAccount();

        // Only include transactions that match the user's account index
        if (transactionSubaddressAccount === walletIndexS) {
          validTransactions.push(tx);
        }
      }

      const validCount = validTransactions.length;

      // Calculate the range of transactions for the current page
      const startIndex = (senderData.page - 1) * 10;
      const endIndex = Math.min(startIndex + 10, validCount); // Fetch up to 10 transactions per page

      // Check if there are any valid transactions for the current page
      if (validCount === 0 || startIndex >= validCount) {
        return ctx.reply("No transactions found for this page.");
      }

      // Initialize response message
      let responseMessage = `Here are your transactions (Page ${senderData.page}):\n\n`;

      // Loop through valid transactions on the current page
      for (let index = startIndex; index < endIndex; index++) {
        const tx = validTransactions[index];

        const txID = await tx.hash() || "Unknown TXID";
        const amount = (Number(await tx.amount()) / 1e12).toFixed(8); // Convert from atomic units to XMR
        const type = await tx.direction() === "in" ? "DEPOSIT" : "WITHDRAWAL";
        const timestamp = new Date(Number(await tx.timestamp()) * 1000).toLocaleString(); // Format timestamp

        responseMessage += `------------\n${index + 1}.)\nTransaction ID: \n\`${txID}\`\nAmount: \`${amount}\` XMR\nType: ${type}\nDate: ${timestamp}\n\n`;
      }

      // Set up pagination buttons
      const paginationButtons = [];

      // Previous button (only if it's not the first page)
      if (senderData.page > 1) {
        paginationButtons.push({ text: "<", callbackData: `page:${senderData.page - 1}` });
      }

      // Page number button (current page)
      paginationButtons.push({ text: `${senderData.page}`, callbackData: "currentPage" });

      // Next button (only if there's more pages)
      if (senderData.page * 10 < validCount) {
        paginationButtons.push({ text: ">", callbackData: `page:${senderData.page + 1}` });
      }

      // Send the response with transaction details and pagination buttons
      await ctx.answerCallbackQuery("Processing...");
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [],
      });
      await ctx.reply(responseMessage, {
        reply_markup: createInlineKeyboard([paginationButtons, [{ text: "< Back", callbackData: "back" }]]),
        parse_mode: "markdown"
      });

    } catch (error) {
      console.error("Error fetching transaction history:", error);
      await ctx.reply("There was an error retrieving your transaction history. Please try again later.");
    }
  } else if (callbackData == "back") {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    const result = db.query("SELECT * FROM users WHERE userID = ?", [ctx.callbackQuery.from.id]);

    if (result.length > 0) {
      const [cindex, userID, walletIndex, balance] = result[0];
      const data = {
        cindex,
        userID,
        walletIndex,
        balance: Number(balance), // Ensure balance is a number
      };

      const numSubaddresses = Number(await wallet.numSubaddresses(data.walletIndex));
      let numC;
      if (numSubaddresses == 0) {
        numC = 0
      } else {
        numC = numSubaddresses - 1
      }
      const address = await wallet.address(data.walletIndex, numC);

      ctx.reply(`Hello ${ctx.callbackQuery.from?.first_name} thank you for using Monero Tip Bot,\n\nYou're current Monero address : \`${address}\``, {
        reply_markup: mainKeyboard,
        parse_mode: "Markdown"
      })
    }
  } else if (callbackData == "advance") {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [],
    });
    ctx.reply(`Advance Settings: `, {
      reply_markup: advanceKeyboard
    })
  } else if (callbackData == "allMy") {
    const MAX_ADDRESSES_PER_PAGE = 15;
    // Retrieve sender data from the database
    const senderID = ctx.from?.id;
    const sender = await db.query("SELECT * FROM users WHERE userID = ?", [senderID]);

    if (!sender.length) {
      return ctx.reply("You are not registered in the system.");
    }

    const [cindexS, userIDS, walletIndexS, balanceS, page] = sender[0];
    const senderData = {
      cindex: cindexS,
      userID: userIDS,
      walletIndex: walletIndexS,
      balance: Number(balanceS),
      page: page || 1, // Default to page 1 if no page is set
    };

    try {
      // Get the number of subaddresses in the account
      const numSubaddresses = await wallet.numSubaddresses(senderData.walletIndex);
      //console.log(`Account ${senderData.walletIndex} has ${Number(numSubaddresses)} subaddresses:`);

      // Calculate the range of subaddresses for the current page
      const startIndex = (senderData.page - 1) * MAX_ADDRESSES_PER_PAGE;
      const endIndex = Math.min(startIndex + MAX_ADDRESSES_PER_PAGE, Number(numSubaddresses)); // Fetch up to 15 addresses per page

      // Initialize response message
      let responseMessage = `Here are the addresses (Page ${senderData.page}):\n\n`;

      // Loop through subaddresses on the current page
      for (let subaddressIndex = startIndex; subaddressIndex < endIndex; subaddressIndex++) {
        const address = await wallet.address(senderData.walletIndex, subaddressIndex);
        responseMessage += `\n------------\n\nAddress [${subaddressIndex + 1}]:\n\`${address}\`\n`;
      }

      // Set up pagination buttons
      const paginationButtons = [];

      // Previous button (only if it's not the first page)
      if (senderData.page > 1) {
        paginationButtons.push({ text: "<", callbackData: `Apage:${senderData.page - 1}` });
      }

      // Page number button (current page)
      paginationButtons.push({ text: `${senderData.page}`, callbackData: "currentPage" });

      // Next button (only if there's more pages)
      if (senderData.page * MAX_ADDRESSES_PER_PAGE < Number(numSubaddresses)) {
        paginationButtons.push({ text: ">", callbackData: `Apage:${senderData.page + 1}` });
      }

      // Send the response with addresses and pagination buttons
      await ctx.answerCallbackQuery("Fetching addresses...");
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] })
      await ctx.reply(responseMessage, {
        reply_markup: createInlineKeyboard([paginationButtons, [
          { text: "< Back", callbackData: "back" }
        ]]),
        parse_mode: "markdown",
      });

    } catch (error) {
      console.error("Error fetching subaddresses:", error);
      await ctx.reply("There was an error retrieving your addresses. Please try again later.");
    }
  }

  if (callbackData.startsWith("Apage:")) {

    const page = parseInt(callbackData.split(":")[1], 10);

    // Update the page in the database
    await db.query("UPDATE users SET page = ? WHERE userID = ?", [page, ctx.from?.id]);

    const MAX_ADDRESSES_PER_PAGE = 15;
    // Retrieve sender data from the database
    const senderID = ctx.from?.id;
    const sender = await db.query("SELECT * FROM users WHERE userID = ?", [senderID]);

    if (!sender.length) {
      return ctx.reply("You are not registered in the system.");
    }

    const [cindexS, userIDS, walletIndexS, balanceS, pageS] = sender[0];
    const senderData = {
      cindex: cindexS,
      userID: userIDS,
      walletIndex: walletIndexS,
      balance: Number(balanceS),
      page: page || pageS || 1, // Default to page 1 if no page is set
    };

    try {
      // Get the number of subaddresses in the account
      const numSubaddresses = await wallet.numSubaddresses(senderData.walletIndex);
      //console.log(`Account ${senderData.walletIndex} has ${Number(numSubaddresses)} subaddresses:`);

      // Calculate the range of subaddresses for the current page
      const startIndex = (senderData.page - 1) * MAX_ADDRESSES_PER_PAGE;
      const endIndex = Math.min(startIndex + MAX_ADDRESSES_PER_PAGE, Number(numSubaddresses)); // Fetch up to 15 addresses per page

      // Initialize response message
      let responseMessage = `Here are the addresses (Page ${senderData.page}):\n\n`;

      // Loop through subaddresses on the current page
      for (let subaddressIndex = startIndex; subaddressIndex < endIndex; subaddressIndex++) {
        const address = await wallet.address(senderData.walletIndex, subaddressIndex);
        responseMessage += `\n------------\n\nAddress [${subaddressIndex + 1}]:\n\`${address}\`\n`;
      }

      // Set up pagination buttons
      const paginationButtons = [];

      // Previous button (only if it's not the first page)
      if (senderData.page > 1) {
        paginationButtons.push({ text: "<", callbackData: `Apage:${senderData.page - 1}` });
      }

      // Page number button (current page)
      paginationButtons.push({ text: `${senderData.page}`, callbackData: "currentPage" });

      // Next button (only if there's more pages)
      if (senderData.page * MAX_ADDRESSES_PER_PAGE < Number(numSubaddresses)) {
        paginationButtons.push({ text: ">", callbackData: `Apage:${senderData.page + 1}` });
      }

      // Send the response with addresses and pagination buttons
      await ctx.answerCallbackQuery("Fetching addresses...");
      await ctx.editMessageText(responseMessage, {
        reply_markup: createInlineKeyboard([paginationButtons, [
          { text: "< Back", callbackData: "back" }
        ]]),
        parse_mode: "markdown",
      });

    } catch (error) {
      console.error("Error fetching subaddresses:", error);
      await ctx.reply("There was an error retrieving your addresses. Please try again later.");
    }
  }

  if (callbackData.startsWith("page:")) {
    const page = parseInt(callbackData.split(":")[1], 10);

    // Update the page in the database
    await db.query("UPDATE users SET page = ? WHERE userID = ?", [page, ctx.from?.id]);

    // Call the /transactions command again to show the correct page
    await ctx.answerCallbackQuery("Fetching your transactions...");

    const senderID = ctx.from?.id;

    // Retrieve sender data from the database
    const sender = await db.query("SELECT * FROM users WHERE userID = ?", [senderID]);

    if (!sender.length) {
      return ctx.reply("You are not registered in the system.");
    }

    const [cindexS, userIDS, walletIndexS, balanceS, pageS] = sender[0];  // Add pageS to get the page from the database
    const senderData = {
      cindex: cindexS,
      userID: userIDS,
      walletIndex: walletIndexS,
      balance: Number(balanceS),
      page: page || pageS || 1, // Use the page from the database if not provided in callbackData
    };

    try {
      // Fetch the transaction history for the specific account index using wallet.getHistory
      const transactions = await wallet.getHistory(senderData.walletIndex); // Fetch for the specific wallet index
      await transactions.refresh();
      const count = await transactions.count();

      // Check if there are any transactions
      if (count === 0) {
        return ctx.reply("No transactions found for your account.");
      }

      // Get all transactions first to filter by subaddress account
      let validTransactions = [];
      for (let index = 0; index < count; index++) {
        const tx = await transactions.transaction(index);
        const transactionSubaddressAccount = await tx.subaddrAccount();

        // Only include transactions that match the user's account index
        if (transactionSubaddressAccount === walletIndexS) {
          validTransactions.push(tx);
        }
      }

      const validCount = validTransactions.length;

      // Calculate the range of transactions for the current page
      const startIndex = (senderData.page - 1) * 10;
      const endIndex = Math.min(startIndex + 10, validCount); // Fetch up to 10 transactions per page

      // Check if there are any valid transactions for the current page
      if (validCount === 0 || startIndex >= validCount) {
        return ctx.reply("No transactions found for this page.");
      }

      // Initialize response message
      let responseMessage = `Here are your transactions (Page ${senderData.page}):\n\n`;

      // Loop through valid transactions on the current page
      for (let index = startIndex; index < endIndex; index++) {
        const tx = validTransactions[index];

        const txID = await tx.hash() || "Unknown TXID";
        const amount = (Number(await tx.amount()) / 1e12).toFixed(8); // Convert from atomic units to XMR
        const type = await tx.direction() === "in" ? "DEPOSIT" : "WITHDRAWAL";
        const timestamp = new Date(Number(await tx.timestamp()) * 1000).toLocaleString(); // Format timestamp

        responseMessage += `------------\n${index + 1}.)\nTransaction ID: \n\`${txID}\`\nAmount: \`${amount}\` XMR\nType: ${type}\nDate: ${timestamp}\n\n`;
      }

      // Set up pagination buttons
      const paginationButtons = [];

      // Previous button (only if it's not the first page)
      if (senderData.page > 1) {
        paginationButtons.push({ text: "<", callbackData: `page:${senderData.page - 1}` });
      }

      // Page number button (current page)
      paginationButtons.push({ text: `${senderData.page}`, callbackData: "currentPage" });

      // Next button (only if there's more pages)
      if (senderData.page * 10 < validCount) {
        paginationButtons.push({ text: ">", callbackData: `page:${senderData.page + 1}` });
      }

      // Send the response with transaction details and pagination buttons
      await ctx.answerCallbackQuery("Processing...");
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [],
      });
      await ctx.editMessageText(responseMessage, {
        reply_markup: createInlineKeyboard([paginationButtons, [{ text: "< Back", callbackData: "back" }]]),
        parse_mode: "markdown"
      });

    } catch (error) {
      console.error("Error fetching transaction history:", error);
      await ctx.reply("There was an error retrieving your transaction history. Please try again later.");
    }
  }
});

bot.command("balance", async (ctx) => {
  const result = db.query("SELECT * FROM users WHERE userID = ?", [ctx.from?.id]);

  if (result.length > 0) {
    const result = db.query("SELECT * FROM users WHERE userID = ?", [ctx.from?.id]);

    if (result.length > 0) {
      const [cindex, userID, walletIndex, balance] = result[0];
      const data = {
        cindex,
        userID,
        walletIndex,
        balance: Number(balance), // Ensure balance is a number
      };
      const unlockedBalance = Number(await wallet.unlockedBalance(data.walletIndex)) / billion;
      const bal = Number(await wallet.balance(data.walletIndex)) / billion;
      const lockedBalance = bal - unlockedBalance;

      // Send the balance information conditionally
      if (lockedBalance > 0) {
        await ctx.reply(`Your current XMR balance is: \`${unlockedBalance.toFixed(12)}\`\nLocked XMR balance: ${lockedBalance.toFixed(12)}`, {
          parse_mode: "markdown"
        });
      } else {
        await ctx.reply(`Your current XMR balance is: \`${bal.toFixed(12)}\``, {
          parse_mode: "markdown"
        });
      }
    } else {
      console.log("User not found.");
    }
  }
})

bot.command("tip", async (ctx) => {
  if (!ctx.update.message?.reply_to_message) {
    return ctx.reply("You need to reply to a message to tip someone.");
  }

  const [amountStr] = ctx.match?.split(" ") ?? [];
  const amount = parseFloat(amountStr);
  const recipientID = ctx.update.message?.reply_to_message.from.id;
  const recipientFirstName = ctx.update.message?.reply_to_message.from.first_name;
  const senderID = ctx.from?.id;
  const senderFirstName = ctx.from?.first_name;

  // Check if it's a group chat
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
    return ctx.reply("You can only use the tip command in a group chat.");
  }

  // Check if the user is trying to tip themselves
  if (senderID === recipientID) {
    return ctx.reply("You cannot tip yourself.");
  }

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply("Invalid tip command. Use `/tip <amount>`.");
  }

  // Retrieve sender data
  const sender = await db.query("SELECT * FROM users WHERE userID = ?", [senderID]);
  if (!sender.length) {
    return ctx.reply("You are not registered in the system.");
  }

  const [cindexS, userIDS, walletIndexS, balanceS] = sender[0];
  const senderData = {
    cindex: cindexS,
    userID: userIDS,
    walletIndex: walletIndexS,
    balance: Number(balanceS),
  };

  // Check recipient data
  let recipient = await db.query("SELECT * FROM users WHERE userID = ?", [recipientID]);
  let isRecipientNew = false;

  if (!recipient.length) {
    await wallet.addSubaddressAccount();
    await wallet.store()
    const totalAccountsAfter = Number(await wallet.numSubaddressAccounts());
    const newAccountIndex = totalAccountsAfter; // New account is the last index
    console.log("New subaddress created at index:", newAccountIndex);
    await wallet.store()
    addUser(recipientID, newAccountIndex)

    isRecipientNew = true;

    // Fetch the newly created recipient data
    recipient = await db.query("SELECT * FROM users WHERE userID = ?", [recipientID]);
  }

  const [cindex, userID, walletIndex, balance, tipAddress] = recipient[0];
  const recipientData = {
    cindex,
    userID,
    walletIndex,
    balance: Number(balance), // Ensure balance is a number
    tipAddress, // Add the tipAddress here
  };

  // If the recipient has a tipAddress, use it
  const recipientAddress = recipientData.tipAddress || (await wallet.address(recipientData.walletIndex, 0));

  // Check sender's unlocked balance
  const unlockedBalance = Number(await wallet.unlockedBalance(senderData.walletIndex)) / billion; // Convert atomic units to XMR
  if (unlockedBalance < amount) {
    return ctx.reply("Insufficient unlocked balance in your wallet.");
  }

  // Attempt to create a transaction
  try {
    const transaction = await wallet.createTransaction(
      recipientAddress,
      await wallet.amountFromString(amount), // Convert amount to atomic units
      1, // Priority
      senderData.walletIndex
    );

    if (await transaction.errorString()) {
      const error = await transaction.errorString();
      const getFirstFiveWords = (str: string) => str.split(" ").slice(0, 5).join(" ");

      if (getFirstFiveWords(error) === "not enough money to transfer,") {
        return ctx.reply(`Insufficient Balance!\n\nReminder: Tip uses fee too.`, {
          parse_mode: "Markdown",
          reply_to_message_id: ctx.message?.message_id,
        });
      }

      if (error === "Invalid destination address") {
        return ctx.reply(`${error}.`, {
          parse_mode: "Markdown",
          reply_to_message_id: ctx.message?.message_id,
        });
      }

      return console.log(await transaction.errorString());
    }

    // Log the transaction in Tiptransactions table
    const txID = await transaction.txid();
    const fee = await transaction.fee();
    await transaction.commit("", true);
    await wallet.store()

    await db.query(
      "INSERT INTO Tiptransactions (txID, senderID, recipientID, amount, type) VALUES (?, ?, ?, ?, ?)",
      [txID, senderID, recipientID, amount, "tip"]
    );

    // Notify sender and recipient
    ctx.reply(`Successfully tipped \`${amountStr}\` XMR to user [${recipientFirstName}](tg://user?id=${recipientID})!\n\nTransaction Fee: ${Number(fee) / billion} XMR\nTransaction ID: ${txID}`, {
      parse_mode: "Markdown",
      reply_to_message_id: ctx.message?.message_id,
    });

    // Send DM to recipient only if they are not new
    if (!isRecipientNew) {
      bot.api.sendMessage(
        recipientID,
        `You received \`${amountStr}\` XMR from user [${senderFirstName}](tg://user?id=${senderID})!\n\nTransaction Fee: ${Number(fee) / billion} XMR\nTransaction ID: ${txID}`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (error) {
    console.error("Transaction error:", error);
    ctx.reply("Failed to complete the transaction. Please try again later.");
  }
});



//bot.command("withdraw", async (ctx) => {});

bot.command("set", async (ctx) => {
  // Ensure the user provides an address in the command
  const [tipAddress] = ctx.match?.split(" ") ?? [];

  // Check if the user provided an address
  if (!tipAddress) {
    return ctx.reply("Please provide an address to set, e.g. /setAddress <Monero Address>");
  }

  const userID = ctx.message.from?.id;

  // Check if the user is already in the database
  const user = await db.query("SELECT * FROM users WHERE userID = ?", [userID]);

  if (!user.length) {
    return ctx.reply("You are not registered in the system.");
  }

  // Update the tipAddress in the database
  await db.query("UPDATE users SET tipAddress = ? WHERE userID = ?", [tipAddress, userID]);

  // Reply to the user confirming the update
  return ctx.reply(`Your tip address has been set to: ${tipAddress}`);
});



bot.command("check", async (ctx) => {
  const [txID] = ctx.match?.split(" ") ?? [];

  // Validate input
  if (!txID) {
    return ctx.reply("Please provide a valid transaction ID. Usage: /check <txID>");
  }

  try {
    // Initialize history object
    const history = await wallet.getHistory();

    // Iterate over transactions to find the matching txID
    let transaction = null;
    let index = 0;

    while (true) {
      try {
        const tx = await history.transaction(index);

        if ((await tx.hash()) === txID) {
          transaction = tx;
          break;
        }

        index++; // Move to the next transaction
      } catch (err) {
        // Exit the loop if no more transactions are found
        if (err.message.includes("index out of range")) {
          break;
        }

        throw err; // Propagate other unexpected errors
      }
    }

    if (!transaction) {
      return ctx.reply("Transaction not found. Please ensure the txID is correct.");
    }

    // Extract relevant transaction details
    const direction = await transaction.direction(); // "in" or "out"
    const amount = Number(await transaction.amount()) / 1e12; // Convert atomic units to XMR
    const fee = Number(await transaction.fee()) / 1e12; // Convert atomic units to XMR
    const blockHeight = await transaction.blockHeight();
    const timestamp = Number(await transaction.timestamp()) * 1000; // Convert to milliseconds
    const confirmations = Number(await transaction.confirmations());
    const status = await transaction.isPending() ? "Pending" : "Confirmed";

    // Format the details
    const message = `
*Transaction Details:*
- *Transaction ID:* \`${txID}\`
- *Direction:* ${direction === "in" ? "Incoming" : "Outgoing"}
- *Amount:* ${amount.toFixed(8)} XMR
- *Fee:* ${fee.toFixed(8)} XMR
- *Block Height:* ${blockHeight}
- *Timestamp:* ${new Date(timestamp).toLocaleString()}
- *Confirmations:* ${confirmations}
- *Status:* ${status}
    `.trim();

    // Send the response
    ctx.reply(message, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("Error checking transaction:", err);
    ctx.reply("An error occurred while checking the transaction. Please try again later.");
  }
});

bot.command("rain", async (ctx) => {
  // Ensure the command is used in a group chat
  if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
    return ctx.reply("This command can only be used in a group chat.");
  }

  // Parse the command arguments
  const args = ctx.message?.text?.split(" ");
  if (args.length !== 3) {
    return ctx.reply("Usage: /rain <amount> <number_of_people>");
  }

  const amount = parseFloat(args[1]);
  const numPeople = parseInt(args[2], 10);

  if (isNaN(amount) || isNaN(numPeople) || amount <= 0 || numPeople <= 0) {
    return ctx.reply("Invalid arguments. Please provide a valid amount and number of people.");
  }

  const senderID = ctx.from?.id;
  const senderFirstname = ctx.from?.first_name;

  try {
    // Retrieve sender's wallet data from the database
    const senderDataQuery = "SELECT * FROM users WHERE userID = ?";
    const senderDataResult = await db.query(senderDataQuery, [senderID]);

    if (!senderDataResult.length) {
      return ctx.reply("You are not registered in the system.");
    }

    const [cindexS, userIDS, walletIndexS, balanceS] = senderDataResult[0];
    const senderData = {
      cindex: cindexS,
      userID: userIDS,
      walletIndex: walletIndexS,
      balance: Number(balanceS),
    };

    // Check if the sender's balance is sufficient
    const senderWalletIndex = senderData.walletIndex;
    const unlockedBalance = Number(await wallet.unlockedBalance(senderWalletIndex)) / 1e12; // Convert atomic units to XMR

    if (unlockedBalance < amount) {
      return ctx.reply("Insufficient unlocked balance in your wallet.");
    }

    // Fetch messages from the database within the last 48 hours
    const timeLimit = Math.floor(Date.now() / 1000) - 48 * 60 * 60; // 48 hours ago
    const eligibleUsersQuery = `SELECT DISTINCT m.userID, MAX(m.timestamp), m.first_name
FROM messages m
WHERE m.chatID = ? AND m.timestamp > ? AND m.userID != ?
GROUP BY m.userID, m.first_name
`;
    const eligibleUsers = await db.query(eligibleUsersQuery, [ctx.chat.id, timeLimit, senderID]);

    if (!eligibleUsers.length) {
      return ctx.reply("No eligible users found in the chat.");
    }

    // Ensure we don't exceed the actual number of eligible users
    const selectedUsers = eligibleUsers.length > numPeople
      ? eligibleUsers.sort(() => Math.random() - 0.5).slice(0, numPeople) // Random selection
      : eligibleUsers;

    // Calculate the amount per user
    const adjustedAmount = selectedUsers.length < numPeople
      ? amount / selectedUsers.length
      : amount / numPeople;


    // Retrieve recipient addresses
    const destinationAddresses = [];
    const amounts = [];
    const toMessage = [];
    for (const [userID, firstName] of selectedUsers) {
      const recipientQuery = "SELECT * FROM users WHERE userID = ?";
      const recipientResult = await db.query(recipientQuery, [userID]);

      if (!recipientResult.length) {
        // Create account for the user if not found in the database
        await wallet.addSubaddressAccount();
        await wallet.store()
        const totalAccountsAfter = Number(await wallet.numSubaddressAccounts());
        const newAccountIndex = totalAccountsAfter; // New account is the last index
        console.log("New subaddress created at index:", newAccountIndex);
        await wallet.store()
        addUser(userID, newAccountIndex)
        const numSubaddresses = Number(await wallet.numSubaddresses(newAccountIndex));
        let numC;
        if (numSubaddresses == 0) {
          numC = 0
        } else {
          numC = numSubaddresses - 1
        }
        const recipientAddress = await wallet.address(newAccountIndex, numC);
        destinationAddresses.push(recipientAddress);
        amounts.push(BigInt(Math.floor(adjustedAmount * 1e12))); // Convert to atomic units and ensure it's an integer
      } else {
        const [cindex, rUserID, walletIndex, balance, tipAddress] = recipientResult[0];
        const numSubaddresses = Number(await wallet.numSubaddresses(walletIndex));
        let numC;
        if (numSubaddresses == 0) {
          numC = 0
        } else {
          numC = numSubaddresses - 1
        }
        const recipientAddress = tipAddress || await wallet.address(walletIndex, numC);
        destinationAddresses.push(recipientAddress);
        amounts.push(BigInt(Math.floor(adjustedAmount * 1e12))); // Convert to atomic units and ensure it's an integer
        toMessage.push([userID])
      }
    }

    // Send the transaction
    const transaction = await wallet.createTransactionMultDest(
      destinationAddresses,
      amounts,
      false, // Not sweeping all
      1, // Priority
      senderWalletIndex
    );

    if (await transaction.errorString()) {
      const error = await transaction.errorString();
      console.error("Transaction error:", error);
      return ctx.reply("Failed to complete the rain transaction, " + error);
    }

    const txID = await transaction.txid();
    const fee = Number(await transaction.fee()) / 1e12; // Convert atomic units to XMR
    await transaction.commit("", true); // Commit the transaction

    // Build the response
    const responseMessages = selectedUsers.map(
      ([userID, timestamp, firstName]) =>
        `💸 User [${firstName}](tg://user?id=${userID}) receives ${adjustedAmount.toFixed(8)} XMR!`
    );

    await ctx.reply(
      `Rain time! 🌧️ ${amount.toFixed(8)} XMR distributed among ${selectedUsers.length} users:\n\n${responseMessages.join("\n")}\n\nTransaction Fee: ${fee} XMR\nTransaction ID: \`${txID}\``,
      { parse_mode: "Markdown" }
    );

    try {
      toMessage.map(
        ([userID]) => {
          bot.api.sendMessage(
            userID,
            `You received \`${adjustedAmount.toFixed(8)}\` XMR from the rain of user [${senderFirstname}](tg://user?id=${senderID})!\n\nTransaction Fee: ${fee} XMR\nTransaction ID: \`${txID}\``,
            { parse_mode: "Markdown" }
          ).catch(err => {
            if (err.description == "Forbidden: bot can't initiate conversation with a user") {
              return
            }
          })
        }
      );
    } catch (error) {
      console.log(error)
    }
  } catch (error) {
    console.error("Error during /rain:", error);
    await ctx.reply("An error occurred while processing the rain command. Please try again later.");
  }
});

bot.on("message", async (ctx) => {
  try {
    const chatID = ctx.chat?.id;
    const userID = ctx.from?.id;
    const messageID = ctx.message?.message_id;
    const timestamp = ctx.message?.date;
    const firstName = ctx.from?.first_name

    if (chatID && userID && messageID && timestamp) {
      // Save message data to your database
      await db.query(
        "INSERT INTO messages (chatID, userID, messageID, timestamp , first_name) VALUES (?, ?, ?, ? , ?)",
        [chatID, userID, messageID, timestamp, firstName]
      );

      // Optional: Clean up old messages to keep the database size manageable
      //await db.query("DELETE FROM messages WHERE timestamp < ?", [Date.now() / 1000 - 3600]); // Keep only the last hour
    }
  } catch (error) {
    console.error("Error saving message:", error);
  }
});



bot.catch((error) => {
  if (error.error.description) {
    console.error('Error occurred:', error.error.description)
  } else {
    console.error(error)
  }
});

bot.start()
