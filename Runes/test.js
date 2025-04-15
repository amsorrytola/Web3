/**
 * test.js
 *
 * Tests for the Runes API built on bitcoin‑core regtest.
 */

const chai = require('chai');
const chaiHttp = require('chai-http');
const bitcoin = require('bitcoinjs-lib');
const Client = require('bitcoin-core');
const { expect } = chai;

chai.use(chaiHttp);

const API_URL = 'http://localhost:3000'; // change if needed

// Set up a bitcoin‑core RPC client (same parameters as in server.js)
const client = new Client({
  network: 'regtest',
  username: 'regtestuser',
  password: 'regtestpass',
  port: 18443
});

// Helper: Decodes a single LEB128 value from a buffer starting at index.
// Returns an object with `value` (as a BigInt) and the number of bytes read.
function decodeLEB128(buf, start = 0) {
  let result = BigInt(0);
  let shift = 0n;
  let index = start;
  while (index < buf.length) {
    const byte = buf[index];
    result |= BigInt(byte & 0x7F) << shift;
    index++;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: result, length: index - start };
}

// Helper: Extracts the runestone message from the OP_RETURN output of a transaction.
// Returns the raw runestone message as a Buffer, or null if not found.
function extractRunestoneMessage(txHex) {
  const tx = bitcoin.Transaction.fromHex(txHex);
  // Look for the first output that is an OP_RETURN output.
  for (const output of tx.outs) {
    try {
      const decompiled = bitcoin.script.decompile(output.script);
      // Our script should be [OP_RETURN, <Buffer with OP_13 + runestone data>]
      if (decompiled && decompiled[0] === bitcoin.opcodes.OP_RETURN) {
        const data = decompiled[1];
        if (data && Buffer.isBuffer(data) && data[0] === 0x53) { // 0x53 is OP_13
          // Return the runestone payload (everything after our custom opcode)
          return data.slice(1);
        }
      }
    } catch (e) {
      // ignore errors and continue
    }
  }
  return null;
}

describe('Runes API Tests', function () {
  // Increase timeout for RPC interactions
  this.timeout(10000);

  // 1. Test the etching endpoint
  describe('POST /api/etch', () => {
    let etchTxid = null;

    it('should create an etching transaction', (done) => {
      chai.request(API_URL)
        .post('/api/etch')
        .send({ runeName: "UNCOMMONGOODS", divisibility: 2, premine: 1000 })
        .end((err, res) => {
          if (err) return done(err);
          expect(res).to.have.status(200);
          expect(res.body.txid).to.exist;
          etchTxid = res.body.txid;
          done();
        });
    });

    it('should produce a transaction with an OP_RETURN runestone output using the Runes protocol', async () => {
      // Get the raw transaction from bitcoin‑core
      const rawTx = await client.getRawTransaction(etchTxid);
      const runestoneMsg = extractRunestoneMessage(rawTx);
      expect(runestoneMsg).to.not.be.null;
      // Now, decode the first field. According to our etching message,
      // the first field should be Tag 1 (Divisibility), and then its value.
      const decodedField = decodeLEB128(runestoneMsg, 0);
      expect(decodedField.value).to.equal(BigInt(1)); // Tag 1 for divisibility

      // Decode the next value: the divisibility value.
      const next = decodeLEB128(runestoneMsg, decodedField.length);
      expect(next.value).to.equal(BigInt(2)); // Our input was divisibility: 2
    });
  });

  // 2. Test the minting endpoint
  describe('POST /api/mint', () => {
    let mintTxid = null;
    // Assume a valid runeId; in real tests, you might use the txid from an etch.
    const testRuneId = "500:20";

    it('should create a mint transaction', (done) => {
      chai.request(API_URL)
        .post('/api/mint')
        .send({ runeId: testRuneId })
        .end((err, res) => {
          if (err) return done(err);
          expect(res).to.have.status(200);
          expect(res.body.txid).to.exist;
          mintTxid = res.body.txid;
          done();
        });
    });

    it('should produce a transaction with a mint message following the Runes protocol', async () => {
      const rawTx = await client.getRawTransaction(mintTxid);
      const runestoneMsg = extractRunestoneMessage(rawTx);
      expect(runestoneMsg).to.not.be.null;
      // For a mint message, our first field should be Tag 20.
      const decodedField = decodeLEB128(runestoneMsg, 0);
      expect(decodedField.value).to.equal(BigInt(20));
      // Next two values represent the rune ID: block and tx.
      const blockField = decodeLEB128(runestoneMsg, decodedField.length);
      const txField = decodeLEB128(runestoneMsg, decodedField.length + blockField.length);
      // Since we passed "500:20", we expect block = 500 and tx = 20.
      expect(blockField.value).to.equal(BigInt(500));
      expect(txField.value).to.equal(BigInt(20));
    });
  });

  // 3. Test the transfer endpoint
  describe('POST /api/transfer', () => {
    let transferTxid = null;
    const testRuneId = "500:20";
    const amountToTransfer = 50;
    const outputIndex = 1; // assume this means the second output

    it('should create a transfer transaction', (done) => {
      chai.request(API_URL)
        .post('/api/transfer')
        .send({ runeId: testRuneId, amount: amountToTransfer, output: outputIndex })
        .end((err, res) => {
          if (err) return done(err);
          expect(res).to.have.status(200);
          expect(res.body.txid).to.exist;
          transferTxid = res.body.txid;
          done();
        });
    });

    it('should produce a transaction with a transfer edict according to the Runes protocol', async () => {
      const rawTx = await client.getRawTransaction(transferTxid);
      const runestoneMsg = extractRunestoneMessage(rawTx);
      expect(runestoneMsg).to.not.be.null;
      // The transfer message starts with a Body tag (0), then the edict fields.
      const firstField = decodeLEB128(runestoneMsg, 0);
      expect(firstField.value).to.equal(BigInt(0)); // Body tag
      let offset = firstField.length;
      // Next: the runeId block
      const blockField = decodeLEB128(runestoneMsg, offset);
      offset += blockField.length;
      // Next: the runeId tx
      const txField = decodeLEB128(runestoneMsg, offset);
      offset += txField.length;
      // Next: transfer amount
      const amountField = decodeLEB128(runestoneMsg, offset);
      offset += amountField.length;
      // Next: output index
      const outputField = decodeLEB128(runestoneMsg, offset);

      // Assert that the edict fields match our input.
      expect(blockField.value).to.equal(BigInt(500));
      expect(txField.value).to.equal(BigInt(20));
      expect(amountField.value).to.equal(BigInt(amountToTransfer));
      expect(outputField.value).to.equal(BigInt(outputIndex));
    });
  });
});
