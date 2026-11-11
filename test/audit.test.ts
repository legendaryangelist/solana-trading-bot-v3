import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { getWallet } from '../helpers/wallet';
import {
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  isSolQuoteMint,
  orientSolPair,
} from '../pump/constants';
import { parseCreateEvent, parseCreatePoolEvent, parseTradeEvent } from '../pump/events';
import { evaluatePumpFilters, PumpFilterConfig } from '../pump/filters';
import { createBaseAtaIx, pumpBuyExactQuoteIx, pumpSwapBuyIx } from '../pump/instructions';
import { decodeBondingCurve, decodePumpAmmGlobal, decodePumpGlobal, decodePumpSwapPool } from '../pump/layout';
import { bondingCurvePda, canonicalPumpPoolPda, pumpAmmFeeConfigPda, pumpAmmGlobalConfigPda, pumpGlobalPda } from '../pump/pda';
import {
  applySlippage,
  curveProgressPercent,
  quoteBondingCurveBuy,
  quoteBondingCurveSell,
  quotePumpSwapBuy,
  sellSlippageForAttempt,
} from '../pump/quotes';

const root = path.join(__dirname, '..');

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'test' || entry.name === 'dist') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function writeU64(target: Buffer, value: bigint, offset: number) {
  target.writeBigUInt64LE(value, offset);
}

function testSecurityRegression() {
  const forbidden = ['eval(', 'new Function', 'ngrok', 'verifyConfiguration', 'registrynpmjs', '2939e69fc408'];
  const files = walk(root).filter((file) => !file.endsWith('package-lock.json'));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const needle of forbidden) {
      assert.ok(!text.includes(needle), `${path.relative(root, file)} contains ${needle}`);
    }
  }

  const lock = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  assert.ok(!lock.includes('registrynpmjs'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
  for (const name of ['enquirer', 'cli-progress', 'i', 'npm']) {
    assert.ok(!(name in pkg.dependencies), `${name} should not be a dependency`);
  }
}

function testWallet() {
  const generated = Keypair.generate();
  const secret = bs58.encode(generated.secretKey);
  const restored = getWallet(secret);
  assert.ok(restored.publicKey.equals(generated.publicKey));

  const asJson = JSON.stringify(Array.from(generated.secretKey));
  assert.ok(getWallet(asJson).publicKey.equals(generated.publicKey));

  const pubkey = generated.publicKey.toBase58();
  assert.throws(() => getWallet(pubkey), /public key/);
  try {
    getWallet(pubkey);
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(pubkey));
  }

  assert.throws(() => getWallet(JSON.stringify(Array.from(generated.publicKey.toBytes()))), /public key/);
  assert.throws(() => getWallet('not-a-key'), /base58/);
  assert.throws(
    () => getWallet('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'),
    /BIP-39/,
  );

  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const fromPhrase = getWallet(phrase);
  assert.ok(getWallet(phrase).publicKey.equals(fromPhrase.publicKey));
}

function testQuotes() {
  const tokens = quoteBondingCurveBuy(1_000_000_000n, 1_073_000_000_000_000n, 30_000_000_000n, 95n, 30n);
  assert.strictEqual(tokens, 34_199_203_120_618n);
  const cheaperFee = quoteBondingCurveBuy(1_000_000_000n, 1_073_000_000_000_000n, 30_000_000_000n, 0n, 0n);
  assert.ok(cheaperFee > tokens);

  const sold = quoteBondingCurveSell(tokens, 1_073_000_000_000_000n, 30_000_000_000n, 95n, 30n);
  assert.ok(sold > 0n && sold < 1_000_000_000n);

  const swap = quotePumpSwapBuy(1_000_000_000n, 1_000_000n, 2_000_000n, 125n);
  assert.ok(swap > 0n && swap < 1_000_000n);

  assert.strictEqual(applySlippage(1000n, 20), 800n);
  assert.strictEqual(applySlippage(1000n, 100), 0n);
  assert.strictEqual(sellSlippageForAttempt(0, 10, 30, 10), 30);
  assert.strictEqual(sellSlippageForAttempt(8, 10, 30, 10), 99);
  assert.strictEqual(sellSlippageForAttempt(9, 10, 30, 10), 100);
  assert.strictEqual(curveProgressPercent(1000n, 750n, false), 25);
  assert.strictEqual(curveProgressPercent(1000n, 0n, true), 100);
}

function testLayouts() {
  const curve = Buffer.alloc(8 + 115);
  writeU64(curve, 11n, 8);
  writeU64(curve, 22n, 16);
  writeU64(curve, 33n, 24);
  writeU64(curve, 44n, 32);
  writeU64(curve, 55n, 40);
  const creator = Keypair.generate().publicKey;
  creator.toBuffer().copy(curve, 8 + 41);
  curve[8 + 73] = 1;
  writeU64(curve, 30n, 8 + 107);
  const decoded = decodeBondingCurve(curve);
  assert.ok(decoded);
  assert.strictEqual(decoded.virtualTokenReserves, 11n);
  assert.strictEqual(decoded.realQuoteReserves, 44n);
  assert.ok(decoded.creator.equals(creator));
  assert.strictEqual(decoded.isMayhemMode, true);
  assert.strictEqual(decoded.creatorFeeBps, 30n);

  const global = Buffer.alloc(8 + 733 + 256);
  writeU64(global, 95n, 8 + 97);
  writeU64(global, 30n, 8 + 146);
  const buyback = Keypair.generate().publicKey;
  buyback.toBuffer().copy(global, 8 + 733);
  const decodedGlobal = decodePumpGlobal(global);
  assert.ok(decodedGlobal);
  assert.strictEqual(decodedGlobal.feeBasisPoints, 95n);
  assert.strictEqual(decodedGlobal.creatorFeeBasisPoints, 30n);
  assert.strictEqual(decodedGlobal.buybackFeeRecipients.length, 1);
  assert.ok(decodedGlobal.buybackFeeRecipients[0].equals(buyback));

  const pool = Buffer.alloc(8 + 261);
  const poolCreator = Keypair.generate().publicKey;
  poolCreator.toBuffer().copy(pool, 8 + 3);
  NATIVE_MINT.toBuffer().copy(pool, 8 + 67);
  writeU64(pool, 40n, 8 + 253);
  const decodedPool = decodePumpSwapPool(pool);
  assert.ok(decodedPool);
  assert.ok(decodedPool.creator.equals(poolCreator));
  assert.ok(decodedPool.quoteMint.equals(NATIVE_MINT));
  assert.strictEqual(decodedPool.creatorFeeBps, 40n);

  const ammGlobal = Buffer.alloc(8 + 635 + 256);
  const ammRecipient = Keypair.generate().publicKey;
  ammRecipient.toBuffer().copy(ammGlobal, 8 + 635);
  const decodedAmm = decodePumpAmmGlobal(ammGlobal);
  assert.ok(decodedAmm);
  assert.ok(decodedAmm.buybackFeeRecipients[0].equals(ammRecipient));
}

function borshString(value: string): Buffer {
  const body = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length);
  return Buffer.concat([length, body]);
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

function testEvents() {
  const mint = Keypair.generate().publicKey;
  const curve = Keypair.generate().publicKey;
  const user = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const created = Buffer.concat([
    borshString('Token'),
    borshString('TOK'),
    borshString('https://example.com/meta.json'),
    mint.toBuffer(),
    curve.toBuffer(),
    user.toBuffer(),
    creator.toBuffer(),
    u64(1n),
    u64(100n),
    u64(200n),
    u64(300n),
    u64(400n),
    TOKEN_PROGRAM_ID.toBuffer(),
    Buffer.from([0, 1]),
    PublicKey.default.toBuffer(),
    u64(500n),
    u64(30n),
  ]);
  const { createHash } = require('crypto') as typeof import('crypto');
  const payload = Buffer.concat([createHash('sha256').update('event:CreateEvent').digest().subarray(0, 8), created]);
  const event = parseCreateEvent(payload);
  assert.ok(event);
  assert.ok(event.mint.equals(mint));
  assert.ok(event.creator.equals(creator));
  assert.strictEqual(event.virtualTokenReserves, 100n);
  assert.strictEqual(event.realTokenReserves, 300n);
  assert.strictEqual(event.creatorFeeBps, 30n);
  assert.strictEqual(event.isMayhemMode, false);
  assert.ok(parseCreateEvent(Buffer.concat([Buffer.alloc(8), created])) === null);

  const trade = Buffer.alloc(8 + 32 + 8 + 8 + 1 + 32);
  createHash('sha256').update('event:TradeEvent').digest().copy(trade, 0, 0, 8);
  mint.toBuffer().copy(trade, 8);
  trade[8 + 32 + 16] = 1;
  user.toBuffer().copy(trade, 8 + 32 + 16 + 1);
  const tradeEvent = parseTradeEvent(trade);
  assert.ok(tradeEvent);
  assert.strictEqual(tradeEvent.isBuy, true);
  assert.ok(tradeEvent.user.equals(user));

  const poolEvent = Buffer.alloc(512);
  createHash('sha256').update('event:CreatePoolEvent').digest().copy(poolEvent, 0, 0, 8);
  let offset = 8 + 8 + 2;
  creator.toBuffer().copy(poolEvent, offset);
  offset += 32;
  mint.toBuffer().copy(poolEvent, offset);
  offset += 32;
  NATIVE_MINT.toBuffer().copy(poolEvent, offset);
  offset += 32 + 2 + 8 * 7 + 1;
  curve.toBuffer().copy(poolEvent, offset);
  offset += 32 * 4;
  user.toBuffer().copy(poolEvent, offset);
  offset += 32;
  poolEvent[offset] = 0;
  writeU64(poolEvent, 15n, offset + 1);
  const parsedPool = parseCreatePoolEvent(poolEvent);
  assert.ok(parsedPool);
  assert.ok(parsedPool.baseMint.equals(mint));
  assert.ok(parsedPool.pool.equals(curve));
  assert.ok(parsedPool.coinCreator.equals(user));
  assert.strictEqual(parsedPool.creatorFeeBps, 15n);
}

function testFiltersAndPdas() {
  const creator = Keypair.generate().publicKey;
  const config: PumpFilterConfig = {
    minCurveProgress: 0,
    maxCurveProgress: 20,
    minMarketCapSol: 0,
    maxMarketCapSol: 100,
    minDevBuySol: 0,
    maxDevBuySol: 1,
    maxCreatorHoldPercent: 10,
    minUniqueBuyers: 2,
    maxRealSol: 5,
    skipMayhem: true,
    allowNonSolQuote: false,
  };
  const pass = evaluatePumpFilters(config, {
    creator,
    quoteMint: PublicKey.default,
    mayhem: false,
    complete: false,
    progressPercent: 5,
    marketCapLamports: 20_000_000_000n,
    devBuyLamports: 500_000_000n,
    creatorHoldPercent: 4,
    uniqueBuyers: 3,
    realQuoteLamports: 1_000_000_000n,
    blacklisted: false,
  });
  assert.strictEqual(pass.ok, true);
  assert.strictEqual(evaluatePumpFilters(config, { ...snapshot(creator), mayhem: true }).ok, false);
  assert.strictEqual(evaluatePumpFilters(config, { ...snapshot(creator), blacklisted: true }).ok, false);
  assert.strictEqual(evaluatePumpFilters(config, { ...snapshot(creator), quoteMint: Keypair.generate().publicKey }).ok, false);
  assert.strictEqual(evaluatePumpFilters(config, { ...snapshot(creator), creatorHoldPercent: 40 }).ok, false);

  assert.ok(PUMP_PROGRAM_ID.toBuffer().equals(Buffer.from([1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170, 81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176])));
  assert.ok(PUMP_AMM_PROGRAM_ID.toBuffer().equals(Buffer.from([12, 20, 222, 252, 130, 94, 198, 118, 148, 37, 8, 24, 187, 101, 64, 101, 244, 41, 141, 49, 86, 213, 113, 180, 212, 248, 9, 12, 24, 233, 168, 99])));
  assert.ok(PUMP_FEE_PROGRAM_ID.toBuffer().equals(Buffer.from([12, 53, 255, 169, 5, 90, 142, 86, 141, 168, 247, 188, 7, 86, 21, 39, 76, 241, 201, 44, 164, 31, 64, 0, 156, 81, 106, 164, 20, 194, 124, 112])));
  assert.strictEqual(pumpAmmGlobalConfigPda().toBase58(), 'ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw');
  assert.strictEqual(pumpAmmFeeConfigPda().toBase58(), '5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx');
  assert.ok(pumpGlobalPda());
  assert.ok(!canonicalPumpPoolPda(Keypair.generate().publicKey).equals(PublicKey.default));

  const user = Keypair.generate().publicKey;
  const buy = pumpBuyExactQuoteIx({
    user,
    mint: Keypair.generate().publicKey,
    baseTokenProgram: TOKEN_PROGRAM_ID,
    spendableQuoteIn: 1n,
    minTokensOut: 1n,
    buybackFeeRecipient: Keypair.generate().publicKey,
  });
  assert.strictEqual(buy.keys.length, 17);
  assert.ok(buy.programId.equals(PUMP_PROGRAM_ID));
  assert.ok(buy.data.subarray(0, 8).equals(Buffer.from([225, 247, 80, 30, 213, 179, 132, 136])));

  const swap = pumpSwapBuyIx({
    user,
    pool: Keypair.generate().publicKey,
    baseMint: Keypair.generate().publicKey,
    quoteMint: NATIVE_MINT,
    poolBase: Keypair.generate().publicKey,
    poolQuote: Keypair.generate().publicKey,
    baseTokenProgram: TOKEN_PROGRAM_ID,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
    spendableQuoteIn: 1n,
    minBaseOut: 1n,
    buybackQuoteAta: Keypair.generate().publicKey,
  });
  assert.strictEqual(swap.keys.length, 17);
  assert.ok(swap.programId.equals(PUMP_AMM_PROGRAM_ID));
}

function snapshot(creator: PublicKey) {
  return {
    creator,
    quoteMint: PublicKey.default,
    mayhem: false,
    complete: false,
    progressPercent: 5,
    marketCapLamports: 20_000_000_000n,
    devBuyLamports: 500_000_000n,
    creatorHoldPercent: 4,
    uniqueBuyers: 3,
    realQuoteLamports: 1_000_000_000n,
    blacklisted: false,
  };
}

const LIVE_CREATE_EVENT =
  'G3KpTd7rY3YDAAAATFVWAwAAAExVVkMAAABodHRwczovL2lwZnMuaW8vaXBmcy9RbVlQMXF6bnZEUE1jN1dHYmVrdUpBNUFnc2dLeHJGRmo1NlNwNG9NOFlKQlhn31UBxxommr1drDf0IIeVcw8/gjzCiEnVcq9ESXP4g79EL6fEEeFycUyKvM8kijhxvkC1izxkoxkQYrmBc+gY75JdJwcRS0UO4uzQqe1e4Xu5azRyi45gREx0L0QQjphukl0nBxFLRQ7i7NCp7V7he7lrNHKLjmBETHQvRBCOmG54AfNqAAAAAAAQ2EfjzwMAAKwj/AYAAAAAeMX7UdECAACAxqR+jQMABt324e51j94YQl285GzN2rYa/E2DuQ0n/r35KNihi/wBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKwj/AYAAAAAAAAAAAAAAAAA';
const LIVE_POOL_EVENT =
  'sTEM0qB2p3R9AfNqAAAAAAAA3sz+UE/Wcljd46aCxJkCg/ATYnKJKJJHqd4IPRPVmaeuLGRkUXKK+VsGWE+khLHXlLEY59A01TAJ+d1KzhGDnwabiFf+q4GE+2h/Y0YYwDXaxDncGus7VZig8AAAAAABBgkACAGpLLwAAHyVGwQAAAAAAAgBqSy8AAB8lRsEAAAAAGQAAAAAAAAAczdqzRsAAAAPN2rNGwAAAP/Nebt8RGtCFvCEPZDgG4SDfxDRPQ+mgHF2qSXSEpOrCImQCUKLSuQPDpv7n1c5NGjElbVqrg/jiNFa3Lc/ri3hpGUvmXJsen6DMq22tfbj4qh8iS6ag/9DlMSrfWqCN4e3WBLS/VpiU9aqqfvCL0cYisevMAJOGIZkj74iHuZyLuLB776OOv8UAj4xez+Qr0Gy6ezPAoGQfrRJ0E5K08AKAQAAAAAAAAAAAAA=';

function testLiveEvents() {
  const created = parseCreateEvent(Buffer.from(LIVE_CREATE_EVENT, 'base64'));
  assert.ok(created);
  assert.strictEqual(created.mint.toBase58(), 'G2o6dtfYWv9F1mSD6Wtb1yLCz7vvzx4mNXwhM6Sapump');
  assert.ok(created.quoteMint.equals(PublicKey.default));
  assert.strictEqual(isSolQuoteMint(created.quoteMint), true);
  assert.strictEqual(created.isMayhemMode, true);
  assert.strictEqual(created.tokenProgram.toBase58(), 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  assert.strictEqual(created.virtualSolReserves, 30_000_000_000n);

  const pool = parseCreatePoolEvent(Buffer.from(LIVE_POOL_EVENT, 'base64'));
  assert.ok(pool);
  assert.strictEqual(pool.baseMint.toBase58(), 'CiuCbzit6WJBxYM58BeoCzZ2xbQMMN8ciWYn1jH6pump');
  assert.ok(pool.quoteMint.equals(NATIVE_MINT));
  assert.strictEqual(isSolQuoteMint(pool.quoteMint), true);
  const flipped = orientSolPair(NATIVE_MINT, pool.baseMint);
  assert.ok(flipped);
  assert.strictEqual(flipped.tokenIsBase, false);
  assert.ok(flipped.tokenMint.equals(pool.baseMint));
  const normal = orientSolPair(pool.baseMint, pool.quoteMint);
  assert.ok(normal);
  assert.strictEqual(normal.tokenIsBase, true);
  assert.strictEqual(orientSolPair(pool.baseMint, Keypair.generate().publicKey), null);

  const mayhem = evaluatePumpFilters(
    {
      minCurveProgress: 0,
      maxCurveProgress: 100,
      minMarketCapSol: 0,
      maxMarketCapSol: 0,
      minDevBuySol: 0,
      maxDevBuySol: 0,
      maxCreatorHoldPercent: 0,
      minUniqueBuyers: 0,
      maxRealSol: 0,
      skipMayhem: true,
      allowNonSolQuote: false,
    },
    { ...snapshot(created.creator), mayhem: true, quoteMint: PublicKey.default },
  );
  assert.strictEqual(mayhem.ok, false);
  assert.ok(mayhem.message && mayhem.message.includes('PUMP_SKIP_MAYHEM=true'));
}

testSecurityRegression();
testWallet();
testQuotes();
testLayouts();
testEvents();
testFiltersAndPdas();
testLiveEvents();

async function testLiveGlobalAndSimulate() {
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const info = await connection.getAccountInfo(pumpGlobalPda());
  assert.ok(info);
  const global = decodePumpGlobal(info.data);
  assert.ok(global);
  assert.strictEqual(global.feeBasisPoints, 95n);
  assert.strictEqual(global.initialVirtualSolReserves, 30_000_000_000n);
  assert.strictEqual(global.initialRealTokenReserves, 793_100_000_000_000n);
  assert.strictEqual(global.buybackFeeRecipients.length, 8);
  assert.ok(global.buybackFeeRecipients.every((key) => !key.equals(PublicKey.default)));
  assert.strictEqual(PublicKey.isOnCurve(global.buybackFeeRecipients[0].toBytes()), false);
  assert.ok(global.buybackFeeRecipients.some((key) => key.toBase58() === '5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD'));

  const mint = new PublicKey('Cg8yyDDSjyfuT18iLb7y6TmMg8vhYU1XHPB9XuVxpump');
  const curveInfo = await connection.getAccountInfo(bondingCurvePda(mint));
  assert.ok(curveInfo);
  const curve = decodeBondingCurve(curveInfo.data);
  assert.ok(curve && curve.complete === false);
  const mintInfo = await connection.getAccountInfo(mint);
  assert.ok(mintInfo);
  // Public trader account used only as a fee payer inside simulateTransaction.
  // Signature verification is off, so this does not broadcast or spend their SOL.
  const payer = new PublicKey('8CyZqkTQN2CjqQ2mEbSHWGbH5BHcFhk2bCgeY1S1LN3r');
  assert.ok((await connection.getBalance(payer)) > 20_000_000);
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
      createBaseAtaIx(payer, mint, payer, mintInfo.owner),
      pumpBuyExactQuoteIx({
        user: payer,
        mint,
        baseTokenProgram: mintInfo.owner,
        spendableQuoteIn: 10_000_000n,
        minTokensOut: 1n,
        buybackFeeRecipient: global.buybackFeeRecipients[0],
      }),
    ],
  }).compileToV0Message();
  const simulation = await connection.simulateTransaction(new VersionedTransaction(message), {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  assert.strictEqual(simulation.value.err, null);
  assert.ok((simulation.value.logs || []).some((line) => line.includes('Instruction: BuyExactQuoteInV3')));
}

testLiveGlobalAndSimulate()
  .then(() => {
    console.log('audit tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
