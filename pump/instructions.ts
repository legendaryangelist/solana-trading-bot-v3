import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  AMM_BUY_EXACT_QUOTE_IN_V2,
  AMM_SELL_V2,
  BUY_EXACT_QUOTE_IN_V3,
  PUMP_AMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  SELL_V3,
} from './constants';
import {
  bondingCurvePda,
  eventAuthorityPda,
  pumpAmmFeeConfigPda,
  pumpAmmGlobalConfigPda,
  pumpFeeConfigPda,
  pumpGlobalPda,
  userVolumePda,
} from './pda';

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

function meta(pubkey: PublicKey, isWritable: boolean, isSigner = false) {
  return { pubkey, isWritable, isSigner };
}

export function pumpUserBaseAta(mint: PublicKey, user: PublicKey, tokenProgram: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, user, false, tokenProgram);
}

export function pumpBuyExactQuoteIx(input: {
  user: PublicKey;
  mint: PublicKey;
  baseTokenProgram: PublicKey;
  spendableQuoteIn: bigint;
  minTokensOut: bigint;
  buybackFeeRecipient: PublicKey;
}): TransactionInstruction {
  const curve = bondingCurvePda(input.mint);
  const data = Buffer.concat([BUY_EXACT_QUOTE_IN_V3, u64(input.spendableQuoteIn), u64(input.minTokensOut)]);
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    data,
    keys: [
      meta(pumpGlobalPda(), false),
      meta(input.mint, false),
      meta(NATIVE_MINT, false),
      meta(input.baseTokenProgram, false),
      meta(TOKEN_PROGRAM_ID, false),
      meta(curve, true),
      meta(getAssociatedTokenAddressSync(input.mint, curve, true, input.baseTokenProgram), true),
      meta(getAssociatedTokenAddressSync(NATIVE_MINT, curve, true, TOKEN_PROGRAM_ID), true),
      meta(input.user, true, true),
      meta(pumpUserBaseAta(input.mint, input.user, input.baseTokenProgram), true),
      meta(getAssociatedTokenAddressSync(NATIVE_MINT, input.user, false, TOKEN_PROGRAM_ID), true),
      meta(userVolumePda(input.user, PUMP_PROGRAM_ID), true),
      meta(pumpFeeConfigPda(), false),
      meta(input.buybackFeeRecipient, true),
      meta(SystemProgram.programId, false),
      meta(eventAuthorityPda(PUMP_PROGRAM_ID), false),
      meta(PUMP_PROGRAM_ID, false),
    ],
  });
}

export function pumpSellIx(input: {
  user: PublicKey;
  mint: PublicKey;
  baseTokenProgram: PublicKey;
  amount: bigint;
  minQuoteOut: bigint;
  buybackFeeRecipient: PublicKey;
}): TransactionInstruction {
  const curve = bondingCurvePda(input.mint);
  const data = Buffer.concat([SELL_V3, u64(input.amount), u64(input.minQuoteOut)]);
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    data,
    keys: [
      meta(pumpGlobalPda(), false),
      meta(input.mint, false),
      meta(NATIVE_MINT, false),
      meta(input.baseTokenProgram, false),
      meta(TOKEN_PROGRAM_ID, false),
      meta(curve, true),
      meta(getAssociatedTokenAddressSync(input.mint, curve, true, input.baseTokenProgram), true),
      meta(getAssociatedTokenAddressSync(NATIVE_MINT, curve, true, TOKEN_PROGRAM_ID), true),
      meta(input.user, true, true),
      meta(pumpUserBaseAta(input.mint, input.user, input.baseTokenProgram), true),
      meta(getAssociatedTokenAddressSync(NATIVE_MINT, input.user, false, TOKEN_PROGRAM_ID), true),
      meta(userVolumePda(input.user, PUMP_PROGRAM_ID), true),
      meta(pumpFeeConfigPda(), false),
      meta(input.buybackFeeRecipient, true),
      meta(SystemProgram.programId, false),
      meta(eventAuthorityPda(PUMP_PROGRAM_ID), false),
      meta(PUMP_PROGRAM_ID, false),
    ],
  });
}

export function pumpSwapBuyIx(input: {
  user: PublicKey;
  pool: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  poolBase: PublicKey;
  poolQuote: PublicKey;
  baseTokenProgram: PublicKey;
  quoteTokenProgram: PublicKey;
  spendableQuoteIn: bigint;
  minBaseOut: bigint;
  buybackQuoteAta: PublicKey;
}): TransactionInstruction {
  const data = Buffer.concat([AMM_BUY_EXACT_QUOTE_IN_V2, u64(input.spendableQuoteIn), u64(input.minBaseOut)]);
  return new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM_ID,
    data,
    keys: pumpSwapKeys(input),
  });
}

export function pumpSwapSellIx(input: {
  user: PublicKey;
  pool: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  poolBase: PublicKey;
  poolQuote: PublicKey;
  baseTokenProgram: PublicKey;
  quoteTokenProgram: PublicKey;
  baseAmountIn: bigint;
  minQuoteOut: bigint;
  buybackQuoteAta: PublicKey;
}): TransactionInstruction {
  const data = Buffer.concat([AMM_SELL_V2, u64(input.baseAmountIn), u64(input.minQuoteOut)]);
  return new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM_ID,
    data,
    keys: pumpSwapKeys(input),
  });
}

function pumpSwapKeys(input: {
  user: PublicKey;
  pool: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  poolBase: PublicKey;
  poolQuote: PublicKey;
  baseTokenProgram: PublicKey;
  quoteTokenProgram: PublicKey;
  buybackQuoteAta: PublicKey;
}) {
  return [
    meta(input.pool, true),
    meta(input.user, true, true),
    meta(pumpAmmGlobalConfigPda(), false),
    meta(input.baseMint, false),
    meta(input.quoteMint, false),
    meta(getAssociatedTokenAddressSync(input.baseMint, input.user, false, input.baseTokenProgram), true),
    meta(getAssociatedTokenAddressSync(input.quoteMint, input.user, false, input.quoteTokenProgram), true),
    meta(input.poolBase, true),
    meta(input.poolQuote, true),
    meta(input.baseTokenProgram, false),
    meta(input.quoteTokenProgram, false),
    meta(SystemProgram.programId, false),
    meta(userVolumePda(input.user, PUMP_AMM_PROGRAM_ID), true),
    meta(pumpAmmFeeConfigPda(), false),
    meta(input.buybackQuoteAta, true),
    meta(eventAuthorityPda(PUMP_AMM_PROGRAM_ID), false),
    meta(PUMP_AMM_PROGRAM_ID, false),
  ];
}

export function createBaseAtaIx(payer: PublicKey, mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey) {
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    getAssociatedTokenAddressSync(mint, owner, false, tokenProgram),
    owner,
    mint,
    tokenProgram,
  );
}

export function closeBaseAtaIx(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey) {
  return createCloseAccountInstruction(
    getAssociatedTokenAddressSync(mint, owner, false, tokenProgram),
    owner,
    owner,
    [],
    tokenProgram,
  );
}

export function wrapSolIxs(payer: PublicKey, lamports: bigint): TransactionInstruction[] {
  if (lamports <= 0n) {
    return [];
  }
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, payer, false, TOKEN_PROGRAM_ID);
  return [
    createAssociatedTokenAccountIdempotentInstruction(payer, ata, payer, NATIVE_MINT, TOKEN_PROGRAM_ID),
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: ata,
      lamports,
    }),
    createSyncNativeInstruction(ata, TOKEN_PROGRAM_ID),
  ];
}
