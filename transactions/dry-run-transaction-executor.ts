import { BlockhashWithExpiryBlockHeight, Keypair, VersionedTransaction } from '@solana/web3.js';
import { TransactionExecutor } from './transaction-executor.interface';
import { logger } from '../helpers';

/**
 * Signs nothing extra and does not broadcast. The caller already signed
 * the transaction locally; this executor only records that it would have
 * been sent.
 */
export class DryRunTransactionExecutor implements TransactionExecutor {
  public async executeAndConfirm(
    transaction: VersionedTransaction,
    _payer: Keypair,
    _latestBlockhash: BlockhashWithExpiryBlockHeight,
  ): Promise<{ confirmed: boolean; signature?: string; error?: string }> {
    let bytes = 0;
    try {
      bytes = transaction.serialize().length;
    } catch (error) {
      logger.debug({ error }, 'DRY_RUN: transaction could not be serialized');
      return { confirmed: false, signature: 'dry-run', error: 'serialize failed' };
    }

    logger.info({ bytes }, 'DRY_RUN simulated transaction built and not broadcast');
    return { confirmed: true, signature: 'dry-run' };
  }
}
