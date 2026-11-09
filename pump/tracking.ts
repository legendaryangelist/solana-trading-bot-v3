import fs from 'fs';
import { logger } from '../helpers/logger';

export class CreatorBlacklist {
  private mtime = -1;
  private values = new Set<string>();

  constructor(private readonly file: string) {}

  has(creator: string): boolean {
    this.refresh();
    return this.values.has(creator);
  }

  private refresh() {
    try {
      const stat = fs.statSync(this.file);
      if (stat.mtimeMs === this.mtime) {
        return;
      }
      const data = fs.readFileSync(this.file, 'utf8');
      this.values = new Set(
        data
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('#')),
      );
      this.mtime = stat.mtimeMs;
      logger.info(`Loaded ${this.values.size} blacklisted pump creators`);
    } catch {
      this.values = new Set();
      this.mtime = -1;
    }
  }
}

export class BuyerTracker {
  private readonly byMint = new Map<string, Set<string>>();

  record(mint: string, user: string) {
    let buyers = this.byMint.get(mint);
    if (!buyers) {
      buyers = new Set();
      this.byMint.set(mint, buyers);
    }
    buyers.add(user);
  }

  count(mint: string): number {
    return this.byMint.get(mint)?.size ?? 0;
  }
}
