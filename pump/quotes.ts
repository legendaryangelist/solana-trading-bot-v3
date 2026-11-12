import {
  BONDING_CURVE_CREATOR_FEE_BPS,
  BONDING_CURVE_PROTOCOL_FEE_BPS,
  PUMPSWAP_CREATOR_FEE_BPS,
  PUMPSWAP_LP_FEE_BPS,
  PUMPSWAP_PROTOCOL_FEE_BPS,
} from './constants';

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * SOL → tokens quote from the buy_exact_sol_in docs in pump-public-docs:
 * net quote is the spendable amount after protocol and creator fees,
 * then tokens_out = floor((net - 1) * virtualToken / (virtualQuote + net - 1)).
 */
export function quoteBondingCurveBuy(
  spendableQuoteIn: bigint,
  virtualTokenReserves: bigint,
  virtualQuoteReserves: bigint,
  protocolFeeBps = BONDING_CURVE_PROTOCOL_FEE_BPS,
  creatorFeeBps = BONDING_CURVE_CREATOR_FEE_BPS,
): bigint {
  const totalFeeBps = protocolFeeBps + creatorFeeBps;
  if (spendableQuoteIn <= 0n || virtualTokenReserves <= 1n || virtualQuoteReserves <= 0n || totalFeeBps < 0n) {
    return 0n;
  }

  let net = (spendableQuoteIn * 10_000n) / (10_000n + totalFeeBps);
  const fees = ceilDiv(net * protocolFeeBps, 10_000n) + ceilDiv(net * creatorFeeBps, 10_000n);
  if (net + fees > spendableQuoteIn) {
    net -= net + fees - spendableQuoteIn;
  }
  if (net <= 1n) {
    return 0n;
  }

  return ((net - 1n) * virtualTokenReserves) / (virtualQuoteReserves + net - 1n);
}

/** Tokens → quote. Fees are taken out of the constant-product output. */
export function quoteBondingCurveSell(
  tokenAmountIn: bigint,
  virtualTokenReserves: bigint,
  virtualQuoteReserves: bigint,
  protocolFeeBps = BONDING_CURVE_PROTOCOL_FEE_BPS,
  creatorFeeBps = BONDING_CURVE_CREATOR_FEE_BPS,
): bigint {
  if (tokenAmountIn <= 0n || virtualTokenReserves <= 0n || virtualQuoteReserves <= 0n) {
    return 0n;
  }

  const gross = (tokenAmountIn * virtualQuoteReserves) / (virtualTokenReserves + tokenAmountIn);
  const fee = ceilDiv(gross * protocolFeeBps, 10_000n) + ceilDiv(gross * creatorFeeBps, 10_000n);
  return gross > fee ? gross - fee : 0n;
}

export function quotePumpSwapBuy(
  spendableQuoteIn: bigint,
  baseReserve: bigint,
  quoteReserve: bigint,
  totalFeeBps = PUMPSWAP_LP_FEE_BPS + PUMPSWAP_PROTOCOL_FEE_BPS + PUMPSWAP_CREATOR_FEE_BPS,
): bigint {
  if (spendableQuoteIn <= 0n || baseReserve <= 0n || quoteReserve <= 0n) {
    return 0n;
  }
  const net = (spendableQuoteIn * 10_000n) / (10_000n + totalFeeBps);
  if (net <= 0n) {
    return 0n;
  }
  return (baseReserve * net) / (quoteReserve + net);
}

export function quotePumpSwapSell(
  baseAmountIn: bigint,
  baseReserve: bigint,
  quoteReserve: bigint,
  totalFeeBps = PUMPSWAP_LP_FEE_BPS + PUMPSWAP_PROTOCOL_FEE_BPS + PUMPSWAP_CREATOR_FEE_BPS,
): bigint {
  if (baseAmountIn <= 0n || baseReserve <= 0n || quoteReserve <= 0n) {
    return 0n;
  }
  const gross = (quoteReserve * baseAmountIn) / (baseReserve + baseAmountIn);
  const fee = ceilDiv(gross * totalFeeBps, 10_000n);
  return gross > fee ? gross - fee : 0n;
}

export function applySlippage(amount: bigint, slippagePercent: number): bigint {
  const pct = Math.min(100, Math.max(0, Math.floor(slippagePercent)));
  return (amount * BigInt(100 - pct)) / 100n;
}

/** Last attempt accepts any output. Earlier attempts step up from the configured sell slippage. */
export function sellSlippageForAttempt(attempt: number, maxAttempts: number, base: number, step: number): number {
  if (maxAttempts > 0 && attempt >= maxAttempts - 1) {
    return 100;
  }
  return Math.min(99, base + attempt * Math.max(0, step));
}

export function marketCapLamports(virtualQuote: bigint, virtualToken: bigint, supply: bigint): bigint {
  if (virtualToken <= 0n || supply <= 0n) {
    return 0n;
  }
  return (virtualQuote * supply) / virtualToken;
}

export function curveProgressPercent(initialRealToken: bigint, realToken: bigint, complete: boolean): number {
  if (complete) {
    return 100;
  }
  if (initialRealToken <= 0n || realToken >= initialRealToken) {
    return 0;
  }
  return Number(((initialRealToken - realToken) * 10_000n) / initialRealToken) / 100;
}

export function solToLamports(sol: number): bigint {
  if (!Number.isFinite(sol) || sol <= 0) {
    return 0n;
  }
  return BigInt(Math.round(sol * 1_000_000_000));
}

export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / 1_000_000_000;
}

export function higherFee(configured: bigint, floor: bigint): bigint {
  return configured > floor ? configured : floor;
}
