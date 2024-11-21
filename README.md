# Monero Tip Bot

Monero Tip Bot allows users to send tips and perform rain operations in group chats using the Monero blockchain. The bot is built using Deno and allows tipping other users as well as distributing Monero in a group (rain).

## Requirements

Before running the bot, make sure you have [Deno](https://deno.land/) installed on your system.

## Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/NoteCode4/Monero-Tip-Bot.git
   cd Monero-Tip-Bot
   ```

2. Install Deno (if not installed already):

   - Follow the [official Deno installation guide](https://deno.land/#installation) for your platform.

3. Create a `.env` file in the root of the project and add the following variables:

   ```
   BOT_TOKEN=<your-telegram-bot-token>  # required
   WALLET_PASSWORD=<your-wallet-password>  # optional
   MONERO_NODE_URL=<your-monero-node-url>  # optional
   ```

   - `BOT_TOKEN` is required for your Telegram bot.
   - `WALLET_PASSWORD` is optional; it is used to access your wallet.
   - `MONERO_NODE_URL` is optional; it is used to connect to a custom Monero node (leave blank to use the default).

## Running the Bot

To run the bot, use the following command:

```bash
deno run --allow-all bot.ts
```

- This will start the bot and allow it to access required resources.

## Important Files

- `./my_wallet` - The bot's wallet. Do **not delete or move** this file as it contains the bot's wallet information.
- `./my_wallet.keys` - The bot's private keys. These must **not be deleted or lost** since they hold all the bot’s account information.
- `./data/user.db` - The bot's data storage. This database contains user information, so do **not delete** it, or all the bot data will be lost.

## Handling Errors

If you encounter the following error:

```
error: Uncaught (in promise) TypeError: Deno.dlopen is not a function
dylib = Deno.dlopen(libPath, moneroSymbols);
```

You can try the following steps:

1. Create a `lib` directory:

   ```bash
   mkdir lib
   cd lib
   ```

2. Download the required library:

   ```bash
   wget https://github.com/MrCyjaneK/monero_c/releases/download/v0.18.3.4-RC5/monero_x86_64-linux-gnu_libwallet2_api_c.so.xz -O monero_libwallet2_api_c.so.xz
   ```

3. Unzip the downloaded file:

   ```bash
   unxz -f *.xz
   ```

4. Go back to the main directory:

   ```bash
   cd ..
   ```

## Commands

- `/tip <amount>` - Tip a user with a specified amount of Monero. The user must reply to a message from the person they want to tip.
- `/rain <amount> <number_of_Users>` - Send a rain of Monero to multiple users in the group. Format the command as `/rain <amount> <number_of_Users>`. 

Both commands will require a transaction fee, as they interact with the Monero blockchain.

## Notes

- Each tip or rain transaction involves a fee as it is processed on the Monero blockchain.
- Balance and transactions are based on the Monero blockchain, and you will need enough Monero in your bot's wallet for these operations.

## License

This project is licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html).
```
