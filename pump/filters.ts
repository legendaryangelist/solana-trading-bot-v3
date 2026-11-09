import { PublicKey } from '@solana/web3.js';
import { isSolQuoteMint } from './constants';
import { lamportsToSol, solToLamports } from './quotes';

export interface PumpFilterConfig {
  minCurveProgress: number;
  maxCurveProgress: number;
  minMarketCapSol: number;
  maxMarketCapSol: number;
  minDevBuySol: number;
  maxDevBuySol: number;
  maxCreatorHoldPercent: number;
  minUniqueBuyers: number;
  maxRealSol: number;
  skipMayhem: boolean;
  allowNonSolQuote: boolean;
}

export interface PumpFilterSnapshot {
  creator: PublicKey;
  quoteMint: PublicKey;
  mayhem: boolean;
  complete: boolean;
  progressPercent: number;
  marketCapLamports: bigint;
  devBuyLamports: bigint;
  creatorHoldPercent: number;
  uniqueBuyers: number;
  realQuoteLamports: bigint;
  blacklisted: boolean;
}

export function evaluatePumpFilters(config: PumpFilterConfig, snapshot: PumpFilterSnapshot): { ok: boolean; message?: string } {
  if (snapshot.blacklisted) {
    return { ok: false, message: 'Pump -> creator is blacklisted' };
  }
  if (snapshot.complete) {
    return { ok: false, message: 'Pump -> bonding curve is complete' };
  }
  if (config.skipMayhem && snapshot.mayhem) {
    return { ok: false, message: 'Pump -> mayhem mode' };
  }
  if (!config.allowNonSolQuote && !isSolQuoteMint(snapshot.quoteMint)) {
    return { ok: false, message: 'Pump -> quote mint is not SOL' };
  }
  if (config.maxCurveProgress > 0 && snapshot.progressPercent > config.maxCurveProgress) {
    return { ok: false, message: `Pump -> progress ${snapshot.progressPercent} > ${config.maxCurveProgress}` };
  }
  if (config.minCurveProgress > 0 && snapshot.progressPercent < config.minCurveProgress) {
    return { ok: false, message: `Pump -> progress ${snapshot.progressPercent} < ${config.minCurveProgress}` };
  }

  const marketCapSol = lamportsToSol(snapshot.marketCapLamports);
  if (config.minMarketCapSol > 0 && snapshot.marketCapLamports < solToLamports(config.minMarketCapSol)) {
    return { ok: false, message: `Pump -> market cap ${marketCapSol} < ${config.minMarketCapSol}` };
  }
  if (config.maxMarketCapSol > 0 && snapshot.marketCapLamports > solToLamports(config.maxMarketCapSol)) {
    return { ok: false, message: `Pump -> market cap ${marketCapSol} > ${config.maxMarketCapSol}` };
  }
  if (config.minDevBuySol > 0 && snapshot.devBuyLamports < solToLamports(config.minDevBuySol)) {
    return { ok: false, message: 'Pump -> creator holding is below min dev buy' };
  }
  if (config.maxDevBuySol > 0 && snapshot.devBuyLamports > solToLamports(config.maxDevBuySol)) {
    return { ok: false, message: 'Pump -> creator holding is above max dev buy' };
  }
  if (config.maxCreatorHoldPercent > 0 && snapshot.creatorHoldPercent > config.maxCreatorHoldPercent) {
    return { ok: false, message: `Pump -> creator holds ${snapshot.creatorHoldPercent}%` };
  }
  if (config.minUniqueBuyers > 0 && snapshot.uniqueBuyers < config.minUniqueBuyers) {
    return { ok: false, message: `Pump -> unique buyers ${snapshot.uniqueBuyers} < ${config.minUniqueBuyers}` };
  }
  if (config.maxRealSol > 0 && snapshot.realQuoteLamports > solToLamports(config.maxRealSol)) {
    return { ok: false, message: 'Pump -> curve already holds more SOL than PUMP_MAX_REAL_SOL' };
  }

  return { ok: true };
}
