import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  RawAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Percent, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { MarketCache, PoolCache, SnipeListCache } from './cache';
import { PoolFilters } from './filters';
import { TransactionExecutor } from './transactions';
import { createPoolKeys, logger, NETWORK, sleep } from './helpers';
import { buyFailureShouldStop } from './transactions/tx-error';
import { watchAccountUntil } from './helpers/price-watch';
import BN from 'bn.js';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';
import { TOKEN_ACCOUNT_RENT_LAMPORTS } from './pump/constants';
import { CreatePoolEvent, PumpCreateEvent } from './pump/events';
import { PumpFilterConfig } from './pump/filters';
import { PositionBook } from './pump/positions';
import { BuyerTracker, CreatorBlacklist } from './pump/tracking';
import { PumpTrader } from './pump/trader';
import { sellSlippageForAttempt } from './pump/quotes';

export interface BotConfig {
  wallet: Keypair;
  checkRenounced: boolean;
  checkFreezable: boolean;
  checkBurned: boolean;
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  quoteToken: Token;
  quoteAmount: TokenAmount;
  quoteAta: PublicKey;
  oneTokenAtATime: boolean;
  useSnipeList: boolean;
  autoSell: boolean;
  autoBuyDelay: number;
  autoSellDelay: number;
  maxBuyRetries: number;
  maxSellRetries: number;
  unitLimit: number;
  unitPrice: number;
  takeProfit: number;
  stopLoss: number;
  buySlippage: number;
  sellSlippage: number;
  priceCheckInterval: number;
  priceCheckDuration: number;
  filterCheckInterval: number;
  filterCheckDuration: number;
  consecutiveMatchCount: number;
  dryRun: boolean;
  closeEmptyTokenAccounts: boolean;
  retryBackoffMs: number;
  sellSlippageStep: number;
  priceCheckWebsocket: boolean;
  checkMutable: boolean;
  enableRaydium: boolean;
  enablePumpfun: boolean;
  enablePumpswap: boolean;
  pumpFilters: PumpFilterConfig;
  pumpBuyerWaitMs: number;
  blacklist: CreatorBlacklist;
  buyers: BuyerTracker;
}

export class Bot {
  private readonly poolFilters: PoolFilters;

  // snipe list
  private readonly snipeListCache?: SnipeListCache;

  // one token at the time
  private sellExecutionCount = 0;
  private openPositionMint: string | null = null;
  private readonly positions = new PositionBook();
  private readonly pumpTrader: PumpTrader;
  public readonly isWarp: boolean = false;
  public readonly isJito: boolean = false;

  constructor(
    private readonly connection: Connection,
    private readonly marketStorage: MarketCache,
    private readonly poolStorage: PoolCache,
    private readonly txExecutor: TransactionExecutor,
    readonly config: BotConfig,
  ) {
    this.isWarp = txExecutor instanceof WarpTransactionExecutor;
    this.isJito = txExecutor instanceof JitoTransactionExecutor;

    this.poolFilters = new PoolFilters(connection, {
      quoteToken: this.config.quoteToken,
      minPoolSize: this.config.minPoolSize,
      maxPoolSize: this.config.maxPoolSize,
    });

    if (this.config.useSnipeList) {
      this.snipeListCache = new SnipeListCache();
      this.snipeListCache.init();
    }

    this.pumpTrader = new PumpTrader(
      connection,
      txExecutor,
      {
        wallet: config.wallet,
        quoteLamports: BigInt(config.quoteAmount.raw.toString()),
        buySlippage: config.buySlippage,
        sellSlippage: config.sellSlippage,
        sellSlippageStep: config.sellSlippageStep,
        maxBuyRetries: config.maxBuyRetries,
        maxSellRetries: config.maxSellRetries,
        retryBackoffMs: config.retryBackoffMs,
        unitLimit: config.unitLimit,
        unitPrice: config.unitPrice,
        takeProfit: config.takeProfit,
        stopLoss: config.stopLoss,
        priceCheckInterval: config.priceCheckInterval,
        priceCheckDuration: config.priceCheckDuration,
        priceCheckWebsocket: config.priceCheckWebsocket,
        dryRun: config.dryRun,
        closeEmptyTokenAccounts: config.closeEmptyTokenAccounts,
        autoSellDelay: config.autoSellDelay,
        buyerWaitMs: config.pumpBuyerWaitMs,
        filters: config.pumpFilters,
        checkRenounced: config.checkRenounced,
        checkFreezable: config.checkFreezable,
        checkMutable: config.checkMutable,
      },
      this.positions,
      config.buyers,
      config.blacklist,
    );
  }

  async validate() {
    const quoteAtoms = BigInt(this.config.quoteAmount.raw.toString());
    if (this.config.quoteToken.symbol === 'WSOL' && quoteAtoms < TOKEN_ACCOUNT_RENT_LAMPORTS) {
      logger.warn(
        'QUOTE_AMOUNT is smaller than a token-account rent exemption (~0.00203928 SOL). A buy this small cannot be profitable after rent.',
      );
    }

    if (this.config.dryRun) {
      logger.info('DRY_RUN is on. Transactions are signed locally and are not broadcast.');
      return true;
    }

    if (this.config.enableRaydium) {
      try {
        await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
      } catch (error) {
        logger.error(
          `${this.config.quoteToken.symbol} token account not found in wallet: ${this.config.wallet.publicKey.toString()}`,
        );
        return false;
      }
    }

    if (this.config.enablePumpfun || this.config.enablePumpswap) {
      const balance = BigInt(await this.connection.getBalance(this.config.wallet.publicKey, this.connection.commitment));
      if (balance < quoteAtoms + 6_000_000n) {
        logger.error(
          `Wallet SOL balance is below the buy size plus about 0.006 SOL for the token account, pump volume account, and fees. Need ${quoteAtoms + 6_000_000n} lamports, have ${balance}.`,
        );
        return false;
      }
    }

    return true;
  }

  public async buy(accountId: PublicKey, poolState: LiquidityStateV4) {
    logger.trace({ mint: poolState.baseMint }, `Processing new pool...`);

    if (this.config.useSnipeList && !this.snipeListCache?.isInList(poolState.baseMint.toString())) {
      logger.debug({ mint: poolState.baseMint.toString() }, `Skipping buy because token is not in a snipe list`);
      return;
    }

    if (this.config.autoBuyDelay > 0) {
      logger.debug({ mint: poolState.baseMint }, `Waiting for ${this.config.autoBuyDelay} ms before buy`);
      await sleep(this.config.autoBuyDelay);
    }

    const [market, mintAta] = await Promise.all([
      this.marketStorage.get(poolState.marketId.toString()),
      getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey),
    ]);
    const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);

    if (!this.config.useSnipeList) {
      const match = await this.filterMatch(poolKeys);

      if (!match) {
        logger.trace({ mint: poolKeys.baseMint.toString() }, `Skipping buy because pool doesn't match filters`);
        return;
      }
    }

    const mint = poolState.baseMint.toString();
    if (!this.beginPosition(mint)) {
      return;
    }

    try {
      let confirmed = false;
      for (let i = 0; i < this.config.maxBuyRetries; i++) {
        if (i > 0 && this.config.retryBackoffMs > 0) {
          await sleep(this.config.retryBackoffMs * i);
        }
        try {
          logger.info(
            { mint: poolState.baseMint.toString() },
            `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
          );
          const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
          const result = await this.swap(
            poolKeys,
            this.config.quoteAta,
            mintAta,
            this.config.quoteToken,
            tokenOut,
            this.config.quoteAmount,
            this.config.buySlippage,
            this.config.wallet,
            'buy',
          );

          if (result.confirmed) {
            confirmed = true;
            logger.info(
              {
                mint: poolState.baseMint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              this.config.dryRun ? 'DRY_RUN simulated Raydium buy' : `Confirmed buy tx`,
            );

            break;
          }

          logger.error(
            {
              mint: poolState.baseMint.toString(),
              signature: result.signature,
              error: result.error,
              attempt: i + 1,
            },
            'Raydium buy attempt failed',
          );
          if (result.retryable === false || buyFailureShouldStop(result.error)) {
            break;
          }
        } catch (error) {
          logger.error({ mint: poolState.baseMint.toString(), error, attempt: i + 1 }, 'Raydium buy attempt threw');
        }
      }
    } catch (error) {
      logger.error({ mint: poolState.baseMint.toString(), error }, `Failed to buy token`);
    } finally {
      this.endPosition(mint);
    }
  }

  public async sell(accountId: PublicKey, rawAccount: RawAccount, tokenProgramId: PublicKey = TOKEN_PROGRAM_ID) {
    let trackedSell = false;
    try {
      logger.trace({ mint: rawAccount.mint }, `Processing new token...`);
      const amount = BigInt(rawAccount.amount.toString());
      if (amount === 0n) {
        if (this.config.closeEmptyTokenAccounts) {
          await this.closeEmptyTokenAccount(accountId, tokenProgramId);
        } else {
          logger.info({ mint: rawAccount.mint.toString() }, `Empty balance, can't sell`);
        }
        return;
      }
      if (this.config.oneTokenAtATime) {
        this.sellExecutionCount++;
        trackedSell = true;
      }

      const position = this.positions.get(rawAccount.mint.toString());
      if (position?.venue === 'pump') {
        await this.pumpTrader.sellPump(position, amount);
        return;
      }
      if (position?.venue === 'pumpswap') {
        await this.pumpTrader.sellPumpSwap(position, amount);
        return;
      }

      const poolData = await this.poolStorage.get(rawAccount.mint.toString());

      if (!poolData) {
        logger.trace({ mint: rawAccount.mint.toString() }, `Token pool data is not found, can't sell`);
        return;
      }

      const tokenIn = new Token(TOKEN_PROGRAM_ID, poolData.state.baseMint, poolData.state.baseDecimal.toNumber());
      const tokenAmountIn = new TokenAmount(tokenIn, new BN(amount.toString()), true);

      if (this.config.autoSellDelay > 0) {
        logger.debug({ mint: rawAccount.mint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
        await sleep(this.config.autoSellDelay);
      }

      const market = await this.marketStorage.get(poolData.state.marketId.toString());
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);

      await this.priceMatch(tokenAmountIn, poolKeys);

      for (let i = 0; i < this.config.maxSellRetries; i++) {
        if (i > 0 && this.config.retryBackoffMs > 0) {
          await sleep(this.config.retryBackoffMs * i);
        }
        const slippage = sellSlippageForAttempt(
          i,
          this.config.maxSellRetries,
          this.config.sellSlippage,
          this.config.sellSlippageStep,
        );
        const includeClose = this.config.closeEmptyTokenAccounts && i < this.config.maxSellRetries - 2;
        try {
          logger.info(
            { mint: rawAccount.mint },
            `Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries} (slippage ${slippage}%)`,
          );

          const result = await this.swap(
            poolKeys,
            accountId,
            this.config.quoteAta,
            tokenIn,
            this.config.quoteToken,
            tokenAmountIn,
            slippage,
            this.config.wallet,
            'sell',
            tokenProgramId,
            includeClose,
          );

          if (result.confirmed) {
            logger.info(
              {
                dex: `https://dexscreener.com/solana/${rawAccount.mint.toString()}?maker=${this.config.wallet.publicKey}`,
                mint: rawAccount.mint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed sell tx`,
            );
            break;
          }

          logger.error(
            {
              mint: rawAccount.mint.toString(),
              signature: result.signature,
              error: result.error,
              attempt: i + 1,
            },
            'Sell attempt failed',
          );
          if (/insufficient lamports|insufficient funds/i.test(result.error || '')) {
            break;
          }
        } catch (error) {
          logger.error({ mint: rawAccount.mint.toString(), error, attempt: i + 1 }, 'Sell attempt threw');
        }
      }
    } catch (error) {
      logger.error({ mint: rawAccount.mint.toString(), error }, `Failed to sell token`);
    } finally {
      if (trackedSell) {
        this.sellExecutionCount--;
      }
    }
  }

  // noinspection JSUnusedLocalSymbols
  private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: PublicKey,
    ataOut: PublicKey,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
    direction: 'buy' | 'sell',
    tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
    includeClose = true,
  ) {
    const slippagePercent = new Percent(slippage, 100);
    const poolInfo = await Liquidity.fetchInfo({
      connection: this.connection,
      poolKeys,
    });

    const computedAmountOut = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: tokenOut,
      slippage: slippagePercent,
    });

    const latestBlockhash = await this.connection.getLatestBlockhash();
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: ataIn,
          tokenAccountOut: ataOut,
          owner: wallet.publicKey,
        },
        amountIn: amountIn.raw,
        minAmountOut: computedAmountOut.minAmountOut.raw,
      },
      poolKeys.version,
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ...(this.isWarp || this.isJito
          ? []
          : [
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
              ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
            ]),
        ...(direction === 'buy'
          ? [
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                ataOut,
                wallet.publicKey,
                tokenOut.mint,
              ),
            ]
          : []),
        ...innerTransaction.instructions,
        ...(direction === 'sell' && includeClose
          ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey, [], tokenProgramId)]
          : []),
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
  }

  private async filterMatch(poolKeys: LiquidityPoolKeysV4) {
    if (this.config.filterCheckInterval === 0 || this.config.filterCheckDuration === 0) {
      return true;
    }

    const timesToCheck = this.config.filterCheckDuration / this.config.filterCheckInterval;
    let timesChecked = 0;
    let matchCount = 0;

    do {
      try {
        const shouldBuy = await this.poolFilters.execute(poolKeys);

        if (shouldBuy) {
          matchCount++;

          if (this.config.consecutiveMatchCount <= matchCount) {
            logger.debug(
              { mint: poolKeys.baseMint.toString() },
              `Filter match ${matchCount}/${this.config.consecutiveMatchCount}`,
            );
            return true;
          }
        } else {
          matchCount = 0;
        }

        await sleep(this.config.filterCheckInterval);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    return false;
  }

  private async priceMatch(amountIn: TokenAmount, poolKeys: LiquidityPoolKeysV4) {
    if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
      return;
    }

    const profitFraction = this.config.quoteAmount.mul(this.config.takeProfit).numerator.div(new BN(100));
    const profitAmount = new TokenAmount(this.config.quoteToken, profitFraction, true);
    const takeProfit = this.config.quoteAmount.add(profitAmount);

    const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
    const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
    const stopLoss = this.config.quoteAmount.subtract(lossAmount);
    const slippage = new Percent(this.config.sellSlippage, 100);

    await watchAccountUntil(
      this.connection,
      poolKeys.quoteVault,
      this.config.priceCheckInterval,
      this.config.priceCheckDuration,
      this.config.priceCheckWebsocket,
      async () => {
        const poolInfo = await Liquidity.fetchInfo({
          connection: this.connection,
          poolKeys,
        });

        const amountOut = Liquidity.computeAmountOut({
          poolKeys,
          poolInfo,
          amountIn: amountIn,
          currencyOut: this.config.quoteToken,
          slippage,
        }).amountOut;

        logger.debug(
          { mint: poolKeys.baseMint.toString() },
          `Take profit: ${takeProfit.toFixed()} | Stop loss: ${stopLoss.toFixed()} | Current: ${amountOut.toFixed()}`,
        );

        return amountOut.lt(stopLoss) || amountOut.gt(takeProfit);
      },
    );
  }

  public async buyPump(event: PumpCreateEvent) {
    const mint = event.mint.toBase58();
    if (this.config.useSnipeList && !this.snipeListCache?.isInList(mint)) {
      logger.debug({ mint }, 'Skipping pump buy because token is not in a snipe list');
      return;
    }
    if (this.positions.get(mint)) {
      return;
    }
    if (this.config.autoBuyDelay > 0) {
      await sleep(this.config.autoBuyDelay);
    }

    const screened = await this.pumpTrader.screenCreate(event);
    if (!screened) {
      return;
    }
    if (!this.beginPosition(mint)) {
      return;
    }

    try {
      const result = await this.pumpTrader.commitCreate(screened);
      if (!result) {
        return;
      }
      logger.info(
        { mint, tokensOut: result.tokensOut.toString(), spendLamports: this.config.quoteAmount.raw.toString() },
        this.config.dryRun ? 'DRY_RUN simulated buy' : 'Pump buy submitted',
      );
      if (this.config.dryRun && this.config.autoSell) {
        logger.info(
          { mint, priceCheckDurationMs: this.config.priceCheckDuration },
          'DRY_RUN simulated position is open. Watching price until take-profit, stop-loss, or the price-check duration, then simulating the sell.',
        );
        const sold = await this.pumpTrader.sellPump(result.position, result.tokensOut);
        logger.info({ mint, sold }, 'DRY_RUN simulated sell');
      }
    } catch (error) {
      logger.error({ mint, error }, 'Failed to buy pump token');
    } finally {
      this.endPosition(mint);
    }
  }

  public async buyPumpSwap(event: CreatePoolEvent) {
    if (
      this.config.useSnipeList &&
      !this.snipeListCache?.isInList(event.baseMint.toBase58()) &&
      !this.snipeListCache?.isInList(event.quoteMint.toBase58())
    ) {
      logger.debug(
        { baseMint: event.baseMint.toBase58(), quoteMint: event.quoteMint.toBase58() },
        'Skipping PumpSwap buy because token is not in a snipe list',
      );
      return;
    }
    if (this.config.autoBuyDelay > 0) {
      await sleep(this.config.autoBuyDelay);
    }

    const screened = await this.pumpTrader.screenPool(event);
    if (!screened) {
      return;
    }
    const mint = screened.position.mint.toBase58();
    if (this.positions.get(mint) || !this.beginPosition(mint)) {
      return;
    }

    try {
      const result = await this.pumpTrader.commitPool(screened);
      if (!result) {
        return;
      }
      logger.info(
        {
          mint,
          tokensOut: result.tokensOut.toString(),
          tokenIsBase: result.position.tokenIsBase,
          spendLamports: this.config.quoteAmount.raw.toString(),
        },
        this.config.dryRun ? 'DRY_RUN simulated buy' : 'PumpSwap buy submitted',
      );
      if (this.config.dryRun && this.config.autoSell) {
        logger.info(
          { mint, priceCheckDurationMs: this.config.priceCheckDuration },
          'DRY_RUN simulated position is open. Watching price until take-profit, stop-loss, or the price-check duration, then simulating the sell.',
        );
        const sold = await this.pumpTrader.sellPumpSwap(result.position, result.tokensOut);
        logger.info({ mint, sold }, 'DRY_RUN simulated sell');
      }
    } catch (error) {
      logger.error({ mint, error }, 'Failed to buy PumpSwap token');
    } finally {
      this.endPosition(mint);
    }
  }

  private beginPosition(mint: string): boolean {
    if (!this.config.oneTokenAtATime) {
      return true;
    }
    if (this.openPositionMint !== null || this.sellExecutionCount > 0) {
      logger.debug(
        { mint, holding: this.openPositionMint },
        'Skipping buy because one token at a time is on and a position is already open',
      );
      return false;
    }
    this.openPositionMint = mint;
    return true;
  }

  private endPosition(mint: string) {
    if (!this.config.oneTokenAtATime || this.openPositionMint !== mint) {
      return;
    }
    this.openPositionMint = null;
  }

  private async closeEmptyTokenAccount(account: PublicKey, tokenProgramId: PublicKey) {
    try {
      const latestBlockhash = await this.connection.getLatestBlockhash(this.connection.commitment);
      const message = new TransactionMessage({
        payerKey: this.config.wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          ...(this.isWarp || this.isJito
            ? []
            : [
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
                ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
              ]),
          createCloseAccountInstruction(account, this.config.wallet.publicKey, this.config.wallet.publicKey, [], tokenProgramId),
        ],
      }).compileToV0Message();
      const transaction = new VersionedTransaction(message);
      transaction.sign([this.config.wallet]);
      const result = await this.txExecutor.executeAndConfirm(transaction, this.config.wallet, latestBlockhash);
      logger.info({ signature: result.signature, confirmed: result.confirmed }, 'Closed empty token account');
    } catch (error) {
      logger.debug({ error }, 'Failed to close empty token account');
    }
  }
}
