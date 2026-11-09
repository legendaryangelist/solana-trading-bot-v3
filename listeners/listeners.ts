import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';
import { Connection, GetProgramAccountsFilter, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { EventEmitter } from 'events';
import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from '../pump/constants';
import { decodeProgramDataLogs, parseCreateEvent, parseCreatePoolEvent, parseTradeEvent } from '../pump/events';
import { BuyerTracker } from '../pump/tracking';
import { logger } from '../helpers/logger';

export class Listeners extends EventEmitter {
  private subscriptions: number[] = [];

  constructor(
    private readonly connection: Connection,
    private readonly buyers: BuyerTracker,
  ) {
    super();
  }

  public async start(config: {
    walletPublicKey: PublicKey;
    quoteToken: Token;
    autoSell: boolean;
    cacheNewMarkets: boolean;
    enableRaydium: boolean;
    enablePumpfun: boolean;
    enablePumpswap: boolean;
  }) {
    if (config.enableRaydium && config.cacheNewMarkets) {
      const openBookSubscription = await this.subscribeToOpenBookMarkets(config);
      this.subscriptions.push(openBookSubscription);
    }

    if (config.enableRaydium) {
      const raydiumSubscription = await this.subscribeToRaydiumPools(config);
      this.subscriptions.push(raydiumSubscription);
    }

    if (config.enablePumpfun) {
      const pumpSubscription = await this.subscribeToPumpCreates();
      this.subscriptions.push(pumpSubscription);
    }

    if (config.enablePumpswap) {
      const pumpSwapSubscription = await this.subscribeToPumpSwapPools();
      this.subscriptions.push(pumpSwapSubscription);
    }

    if (config.autoSell) {
      const walletSubscription = await this.subscribeToWalletChanges(config, TOKEN_PROGRAM_ID, true);
      this.subscriptions.push(walletSubscription);
      if (config.enablePumpfun || config.enablePumpswap) {
        const token2022Subscription = await this.subscribeToWalletChanges(config, TOKEN_2022_PROGRAM_ID, false);
        this.subscriptions.push(token2022Subscription);
      }
    }
  }

  private async subscribeToOpenBookMarkets(config: { quoteToken: Token }) {
    return this.connection.onProgramAccountChange(
      MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
      async (updatedAccountInfo) => {
        this.emit('market', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        { dataSize: MARKET_STATE_LAYOUT_V3.span },
        {
          memcmp: {
            offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
            bytes: config.quoteToken.mint.toBase58(),
          },
        },
      ],
    );
  }

  private async subscribeToRaydiumPools(config: { quoteToken: Token }) {
    return this.connection.onProgramAccountChange(
      MAINNET_PROGRAM_ID.AmmV4,
      async (updatedAccountInfo) => {
        this.emit('pool', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
            bytes: config.quoteToken.mint.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
            bytes: MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
            bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
          },
        },
      ],
    );
  }

  private async subscribeToPumpCreates() {
    return this.connection.onLogs(
      PUMP_PROGRAM_ID,
      (logs) => {
        if (logs.err) {
          return;
        }
        try {
          for (const data of decodeProgramDataLogs(logs.logs)) {
            const trade = parseTradeEvent(data);
            if (trade?.isBuy) {
              this.buyers.record(trade.mint.toBase58(), trade.user.toBase58());
            }
            const created = parseCreateEvent(data);
            if (created) {
              this.emit('pumpCreate', created);
            }
          }
        } catch (error) {
          logger.debug({ error }, 'Failed to parse pump.fun logs');
        }
      },
      this.connection.commitment,
    );
  }

  private async subscribeToPumpSwapPools() {
    return this.connection.onLogs(
      PUMP_AMM_PROGRAM_ID,
      (logs) => {
        if (logs.err) {
          return;
        }
        try {
          for (const data of decodeProgramDataLogs(logs.logs)) {
            const created = parseCreatePoolEvent(data);
            if (created) {
              this.emit('pumpPool', created);
            }
          }
        } catch (error) {
          logger.debug({ error }, 'Failed to parse PumpSwap logs');
        }
      },
      this.connection.commitment,
    );
  }

  private async subscribeToWalletChanges(
    config: { walletPublicKey: PublicKey },
    programId: PublicKey,
    fixedSize: boolean,
  ) {
    const filters: GetProgramAccountsFilter[] = [
      {
        memcmp: {
          offset: 32,
          bytes: config.walletPublicKey.toBase58(),
        },
      },
    ];
    if (fixedSize) {
      filters.unshift({ dataSize: 165 });
    }

    return this.connection.onProgramAccountChange(
      programId,
      async (updatedAccountInfo) => {
        this.emit('wallet', updatedAccountInfo);
      },
      this.connection.commitment,
      filters,
    );
  }

  public async stop() {
    for (let i = this.subscriptions.length - 1; i >= 0; i--) {
      const subscription = this.subscriptions[i];
      try {
        await this.connection.removeOnLogsListener(subscription);
      } catch (error) {
        logger.trace({ error }, 'Failed to remove logs listener');
      }
      try {
        await this.connection.removeAccountChangeListener(subscription);
      } catch (error) {
        logger.trace({ error }, 'Failed to remove account listener');
      }
      this.subscriptions.splice(i, 1);
    }
  }
}
