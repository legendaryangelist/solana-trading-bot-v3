import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';

/** Bonding-curve program. pump-fun/pump-public-docs idl/pump.ts */
export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

/** PumpSwap AMM. pump-fun/pump-public-docs idl/pump_amm.ts */
export const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

/** Shared fee program. */
export const PUMP_FEE_PROGRAM_ID = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/**
 * Bonding-curve fees from https://pump.fun/docs/fees (updated 17 October 2026):
 * 0.30% creator + 0.95% protocol, no LP fee.
 * A curve can set a higher creator fee; callers take the max.
 */
export const BONDING_CURVE_PROTOCOL_FEE_BPS = 95n;
export const BONDING_CURVE_CREATOR_FEE_BPS = 30n;

/**
 * PumpSwap canonical-pool fee at the 0–420 SOL market-cap tier (same source):
 * 0.30% creator + 0.93% protocol + 0.02% LP. Higher tiers charge less, so this
 * is the conservative quote for a new graduation.
 */
export const PUMPSWAP_LP_FEE_BPS = 2n;
export const PUMPSWAP_PROTOCOL_FEE_BPS = 93n;
export const PUMPSWAP_CREATOR_FEE_BPS = 30n;

/** Historical Global.initialRealTokenReserves, used when Global cannot be read. */
export const DEFAULT_INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;

/** buy_exact_quote_in_v3. IDL checked 2026-11-09. */
export const BUY_EXACT_QUOTE_IN_V3 = Buffer.from([225, 247, 80, 30, 213, 179, 132, 136]);

/** sell_v3. */
export const SELL_V3 = Buffer.from([28, 146, 222, 119, 38, 196, 105, 213]);

/** PumpSwap buy_exact_quote_in_v2. */
export const AMM_BUY_EXACT_QUOTE_IN_V2 = Buffer.from([194, 171, 28, 70, 104, 77, 91, 47]);

/** PumpSwap sell_v2. */
export const AMM_SELL_V2 = Buffer.from([93, 246, 130, 60, 231, 233, 64, 178]);

export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;

export function isSolQuoteMint(mint: PublicKey): boolean {
  return mint.equals(PublicKey.default) || mint.equals(NATIVE_MINT);
}

/**
 * SOL pairs are not always token-base / SOL-quote. Canonical graduations are.
 * Other pools put WSOL on the base side. Return the non-SOL mint either way.
 */
export function orientSolPair(
  base: PublicKey,
  quote: PublicKey,
): { tokenMint: PublicKey; solMint: PublicKey; tokenIsBase: boolean } | null {
  const baseSol = isSolQuoteMint(base);
  const quoteSol = isSolQuoteMint(quote);
  if (quoteSol && !baseSol) {
    return { tokenMint: base, solMint: effectiveQuoteMint(quote), tokenIsBase: true };
  }
  if (baseSol && !quoteSol) {
    return { tokenMint: quote, solMint: effectiveQuoteMint(base), tokenIsBase: false };
  }
  return null;
}

export function effectiveQuoteMint(mint: PublicKey): PublicKey {
  return isSolQuoteMint(mint) ? NATIVE_MINT : mint;
}

export function quoteTokenProgram(): PublicKey {
  return TOKEN_PROGRAM_ID;
}
