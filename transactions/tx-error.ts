import { SendTransactionError } from '@solana/web3.js';

export function errorText(error: unknown): string {
  if (error instanceof SendTransactionError) {
    const logs = error.logs?.slice(-12).join(' | ');
    return logs ? `${error.message} | ${logs}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function simulationFailure(err: unknown, logs: string[] | null | undefined): string {
  const tail = (logs || []).slice(-15).join(' | ');
  const summary = `simulation failed: ${JSON.stringify(err)}`;
  return tail ? `${summary} | ${tail}` : summary;
}

/** Buy retries cannot fix these. Sell retries still run so slippage can increase. */
export function buyFailureShouldStop(error?: string): boolean {
  if (!error) {
    return false;
  }
  return /insufficient lamports|custom program error|InstructionError|AccountNotFound|insufficient funds/i.test(error);
}
