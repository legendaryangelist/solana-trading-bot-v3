import {
  BlockhashWithExpiryBlockHeight,
  Connection,
  Keypair,
  SendTransactionError,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { TransactionExecutor } from './transaction-executor.interface';
import { logger } from '../helpers';
import { sleep } from '../helpers/promises';
import { buyFailureShouldStop, errorText, simulationFailure } from './tx-error';

export class DefaultTransactionExecutor implements TransactionExecutor {
  constructor(private readonly connection: Connection) {}

  public async executeAndConfirm(
    transaction: VersionedTransaction,
    _payer: Keypair,
    latestBlockhash: BlockhashWithExpiryBlockHeight,
  ): Promise<{ confirmed: boolean; signature?: string; error?: string; retryable?: boolean }> {
    const signature = bs58.encode(transaction.signatures[0]);
    logger.debug({ signature }, 'Executing transaction...');

    try {
      const simulation = await this.connection.simulateTransaction(transaction, {
        commitment: 'processed',
      });
      if (simulation.value.err) {
        const error = simulationFailure(simulation.value.err, simulation.value.logs);
        logger.error({ signature, error }, 'Transaction simulation failed');
        return { confirmed: false, signature, error, retryable: !buyFailureShouldStop(error) };
      }
      logger.debug({ signature, units: simulation.value.unitsConsumed }, 'Simulation succeeded');
    } catch (error) {
      logger.warn({ signature, error: errorText(error) }, 'Simulation RPC failed; sending the signed transaction anyway');
    }

    try {
      const sent = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 2,
      });
      logger.info({ signature: sent }, 'Transaction sent');
      return await this.confirm(sent, latestBlockhash);
    } catch (error) {
      const message = errorText(error);
      if (error instanceof SendTransactionError) {
        logger.error({ signature, error: message }, 'Sending transaction failed');
      } else {
        logger.error({ signature, error: message }, 'Sending transaction failed');
      }
      return { confirmed: false, signature, error: message, retryable: !buyFailureShouldStop(message) };
    }
  }

  private async confirm(signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
    const started = Date.now();
    while (Date.now() - started < 60_000) {
      const status = await this.connection.getSignatureStatuses([signature]);
      const value = status.value[0];
      if (value?.err) {
        const error = `landed with error ${JSON.stringify(value.err)}`;
        logger.error({ signature, error }, 'Transaction landed and failed');
        return { confirmed: false, signature, error, retryable: false as const };
      }
      if (value?.confirmationStatus === 'processed' || value?.confirmationStatus === 'confirmed' || value?.confirmationStatus === 'finalized') {
        logger.debug({ signature, status: value.confirmationStatus }, 'Transaction confirmed');
        return { confirmed: true, signature };
      }

      const height = await this.connection.getBlockHeight(this.connection.commitment).catch(() => 0);
      if (height > latestBlockhash.lastValidBlockHeight) {
        const again = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        const landed = again.value[0];
        if (landed && !landed.err) {
          return { confirmed: true, signature };
        }
        const error = landed?.err
          ? `landed with error ${JSON.stringify(landed.err)}`
          : `blockhash expired at height ${height}; last valid height was ${latestBlockhash.lastValidBlockHeight}`;
        logger.error({ signature, error }, 'Transaction was not confirmed');
        return { confirmed: false, signature, error, retryable: !landed?.err };
      }
      await sleep(500);
    }

    const error = 'confirmation timed out after 60s';
    logger.error({ signature, error }, 'Transaction confirmation timed out');
    return { confirmed: false, signature, error, retryable: true as const };
  }
}
