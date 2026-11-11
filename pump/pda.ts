import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID } from './constants';

export function pumpGlobalPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('global')], PUMP_PROGRAM_ID)[0];
}

export function bondingCurvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP_PROGRAM_ID)[0];
}

export function userVolumePda(user: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('user_volume_accumulator'), user.toBuffer()], programId)[0];
}

export function eventAuthorityPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], programId)[0];
}

export function pumpFeeConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('fee_config'), PUMP_PROGRAM_ID.toBuffer()],
    PUMP_FEE_PROGRAM_ID,
  )[0];
}

export function pumpAmmFeeConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('fee_config'), PUMP_AMM_PROGRAM_ID.toBuffer()],
    PUMP_FEE_PROGRAM_ID,
  )[0];
}

export function pumpAmmGlobalConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('global_config')], PUMP_AMM_PROGRAM_ID)[0];
}

/** PDA that creates the canonical graduation pool. Seeds from the migrate instruction. */
export function pumpPoolAuthorityPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('pool-authority'), mint.toBuffer()], PUMP_PROGRAM_ID)[0];
}

/** Canonical SOL PumpSwap pool: ["pool", index 0, pool-authority, mint, WSOL]. */
export function canonicalPumpPoolPda(mint: PublicKey): PublicKey {
  const authority = pumpPoolAuthorityPda(mint);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), Buffer.from([0, 0]), authority.toBuffer(), mint.toBuffer(), NATIVE_MINT.toBuffer()],
    PUMP_AMM_PROGRAM_ID,
  )[0];
}
