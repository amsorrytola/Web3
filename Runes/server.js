/**
 * server.js
 *
 * A sample API that “etches”, mints, and transfers runes by building Bitcoin transactions
 * with an OP_RETURN output containing a custom “runestone” message.
 * This version uses your Unisat testnet wallet for signing.
 *
 * Wallet Details (Testnet):
 *   Address: tb1qw6gysxzz80haly4fn3gmx4rsjpueufqg5kzpp9
 *   Hex Private Key: a51f33c00982e1d333383483afe777ad69c2fbaae59b5990c83c043d90868744
 *   WIF Private Key: cT7gDhNJeKWkE4a8WnedBbo77x5RFr3na1biPKKgm1xEnmkShMTM
 */

const express = require('express');
const Client = require('bitcoin-core');
const bitcoin = require('bitcoinjs-lib');

const app = express();
app.use(express.json());

// Configure bitcoin‑core Testnet RPC client – adjust these as needed.
const client = new Client({
  network: 'testnet',
  username: 'myuser',       // Update with your RPC username
  password: 'mypassword',   // Update with your RPC password
  port: 8332               // Testnet RPC port
});

// Your Unisat wallet details (Testnet)
const WALLET_ADDRESS = 'tb1qw6gysxzz80haly4fn3gmx4rsjpueufqg5kzpp9';
const WIF_PRIVATE_KEY = 'cT7gDhNJeKWkE4a8WnedBbo77x5RFr3na1biPKKgm1xEnmkShMTM';

// ---------------------------------------------------------------------------
// Helper: LEB128 Encoder for BigInts (for u128 values)
// ---------------------------------------------------------------------------
function encodeLEB128(n) {
  const bytes = [];
  do {
    let byte = Number(n & BigInt(0x7F));
    n = n >> BigInt(7);
    if (n !== BigInt(0)) {
      byte |= 0x80; // Set continuation bit
    }
    bytes.push(byte);
  } while (n !== BigInt(0));
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Helper: Build a runestone message for an etching transaction.
// Encodes minimal fields:
// • Divisibility (Tag 1)
// • Rune name (Tag 4) – converting A–Z to a number (modified base‑26)
// • Optional Premine (Tag 6)
// Finally appends Body tag (0) to finish the fields.
// ---------------------------------------------------------------------------
function createRunestoneEtchMessage({ runeName, divisibility, premine }) {
  const parts = [];
  // Tag 1: Divisibility
  parts.push(encodeLEB128(BigInt(1)));
  parts.push(encodeLEB128(BigInt(divisibility)));

  // Tag 4: Rune name – convert letters A–Z into a numeric value.
  function encodeRuneName(name) {
    name = name.toUpperCase().replace(/[^A-Z]/g, "");
    let num = BigInt(0);
    for (const char of name) {
      const code = BigInt(char.charCodeAt(0) - 65);  // A = 0, B = 1, etc.
      num = num * BigInt(26) + code;
    }
    return num;
  }
  parts.push(encodeLEB128(BigInt(4)));
  parts.push(encodeLEB128(encodeRuneName(runeName)));

  // Tag 6: Premine (optional)
  if (premine !== undefined) {
    parts.push(encodeLEB128(BigInt(6)));
    parts.push(encodeLEB128(BigInt(premine)));
  }
  // Tag 0: Body (end-of-fields marker)
  parts.push(encodeLEB128(BigInt(0)));

  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Helper: Build a runestone message for a mint transaction.
// Encodes Tag 20 (Mint) with the rune ID (passed as "BLOCK:TX").
// ---------------------------------------------------------------------------
function createRunestoneMintMessage({ runeId }) {
  const parts = [];
  parts.push(encodeLEB128(BigInt(20)));  // Tag 20: Mint
  const [blockStr, txStr] = runeId.split(":");
  parts.push(encodeLEB128(BigInt(blockStr)));
  parts.push(encodeLEB128(BigInt(txStr)));
  parts.push(encodeLEB128(BigInt(0)));    // End-of-fields marker
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Helper: Build a runestone message for a transfer transaction.
// Encodes a single edict (after the Body tag):
//   [block, tx, amount, output]
// ---------------------------------------------------------------------------
function createRunestoneTransferMessage({ runeId, amount, output }) {
  const parts = [];
  parts.push(encodeLEB128(BigInt(0)));  // Body tag first to mark end-of-fields.
  const [blockStr, txStr] = runeId.split(":");
  parts.push(encodeLEB128(BigInt(blockStr)));
  parts.push(encodeLEB128(BigInt(txStr)));
  parts.push(encodeLEB128(BigInt(amount)));
  parts.push(encodeLEB128(BigInt(output)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Helper: Create and broadcast a transaction that includes an OP_RETURN
// output with our runestone message. This version uses PSBT and manually
// signs the input using the provided Unisat private key.
// ---------------------------------------------------------------------------
async function createTransactionWithRunestone(runestoneMessage) {
  // List UTXOs from the testnet wallet. We filter for our specific wallet address.
  const utxos = await client.listUnspent();
  const filtered = utxos.filter(u => u.address === WALLET_ADDRESS);
  if (filtered.length === 0)
    throw new Error("No UTXOs available for wallet " + WALLET_ADDRESS);
  const utxo = filtered[0];

  const network = bitcoin.networks.testnet;
  const psbt = new bitcoin.Psbt({ network });

  const inputValue = Math.floor(utxo.amount * 1e8); // convert BTC to satoshis
  const fee = 1000; // fixed fee in satoshis
  const changeValue = inputValue - fee;
  if (changeValue <= 0)
    throw new Error("UTXO value too low for fee.");

  // Add input
  psbt.addInput({
    hash: utxo.txid,
    index: utxo.vout,
    witnessUtxo: {
      script: bitcoin.address.toOutputScript(WALLET_ADDRESS, network),
      value: inputValue,
    },
  });

  // Add OP_RETURN output with runestone message.
  // Our script: [OP_RETURN, OP_13, <runestone message>]
  const opReturnPrefix = Buffer.from([0x53]); // OP_13
  const opReturnData = Buffer.concat([opReturnPrefix, runestoneMessage]);
  const embed = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, opReturnData]);
  psbt.addOutput({
    script: embed,
    value: 0,
  });

  // Add change output (send back to our wallet address)
  psbt.addOutput({
    address: WALLET_ADDRESS,
    value: changeValue,
  });

  // Sign the transaction using the provided private key.
  const keyPair = bitcoin.ECPair.fromWIF(WIF_PRIVATE_KEY, network);
  psbt.signInput(0, keyPair);
  psbt.validateSignaturesOfInput(0);
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();
  const txid = await client.sendRawTransaction(txHex);
  return txid;
}

// ---------------------------------------------------------------------------
// API Endpoints
// ---------------------------------------------------------------------------

// 1. Etch: Creates a new rune by etching its definition onto the blockchain.
app.post('/api/etch', async (req, res) => {
  try {
    const { runeName, divisibility, premine } = req.body;
    if (!runeName || divisibility === undefined) {
      return res.status(400).json({ error: "Missing required fields: runeName and divisibility" });
    }
    const runestoneMessage = createRunestoneEtchMessage({ runeName, divisibility, premine });
    const txid = await createTransactionWithRunestone(runestoneMessage);
    return res.json({ txid, message: "Etching transaction created" });
  } catch (error) {
    console.error("Etching Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// 2. Mint: Creates a mint transaction for an existing rune (runeId in "BLOCK:TX" format).
app.post('/api/mint', async (req, res) => {
  try {
    const { runeId } = req.body;
    if (!runeId) {
      return res.status(400).json({ error: "Missing required field: runeId" });
    }
    const runestoneMessage = createRunestoneMintMessage({ runeId });
    const txid = await createTransactionWithRunestone(runestoneMessage);
    return res.json({ txid, message: "Mint transaction created" });
  } catch (error) {
    console.error("Minting Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// 3. Transfer: Creates a transfer transaction to move runes from one location to another.
// Requires: runeId, amount (to transfer), and the output index (destination index).
app.post('/api/transfer', async (req, res) => {
  try {
    const { runeId, amount, output } = req.body;
    if (!runeId || amount === undefined || output === undefined) {
      return res.status(400).json({ error: "Missing required fields: runeId, amount, output" });
    }
    const runestoneMessage = createRunestoneTransferMessage({ runeId, amount, output });
    const txid = await createTransactionWithRunestone(runestoneMessage);
    return res.json({ txid, message: "Transfer transaction created" });
  } catch (error) {
    console.error("Transfer Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Start the API server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Runes API server running on port ${PORT}`);
});
