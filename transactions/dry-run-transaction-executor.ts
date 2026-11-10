import { BlockhashWithExpiryBlockHeight, Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { TransactionExecutor } from './transaction-executor.interface';
import { logger } from '../helpers';
import { buyFailureShouldStop, errorText, simulationFailure } from './tx-error';

/**
 * Simulates the signed transaction and does not broadcast it.
 * A successful simulation is a successful attempt: the caller must not retry it.
 */
export class DryRunTransactionExecutor implements TransactionExecutor {
  constructor(private readonly connection: Connection) {}

  public async executeAndConfirm(
    transaction: VersionedTransaction,
    _payer: Keypair,
    _latestBlockhash: BlockhashWithExpiryBlockHeight,
  ): Promise<{ confirmed: boolean; signature?: string; error?: string; retryable?: boolean }> {
    let signature = 'dry-run';
    try {
      signature = bs58.encode(transaction.signatures[0]);
    } catch {
      signature = 'dry-run';
    }

    try {
      transaction.serialize();
    } catch (error) {
      const message = errorText(error);
      logger.error({ signature, error: message }, 'DRY_RUN transaction could not be serialized');
      return { confirmed: false, signature, error: message, retryable: false };
    }

    try {
      const simulation = await this.connection.simulateTransaction(transaction, {
        commitment: 'processed',
      });
      if (simulation.value.err) {
        const error = simulationFailure(simulation.value.err, simulation.value.logs);
        logger.error({ signature, error }, 'DRY_RUN simulation failed');
        return { confirmed: false, signature, error, retryable: !buyFailureShouldStop(error) };
      }
      logger.info(
        { signature, units: simulation.value.unitsConsumed },
        'DRY_RUN simulation succeeded; transaction was not broadcast',
      );
      return { confirmed: true, signature };
    } catch (error) {
      const message = errorText(error);
      logger.error({ signature, error: message }, 'DRY_RUN simulation RPC failed');
      return { confirmed: false, signature, error: message, retryable: true };
    }
  }
}
