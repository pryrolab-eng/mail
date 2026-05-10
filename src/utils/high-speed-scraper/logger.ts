/**
 * High-Speed Email Scraper - Logger
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(prefix: string = 'Scraper', level: LogLevel = LogLevel.INFO) {
    this.prefix = prefix;
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[${this.prefix}] [DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.info(`[${this.prefix}] [INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[${this.prefix}] [WARN] ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[${this.prefix}] [ERROR] ${message}`, ...args);
    }
  }

  progress(current: number, total: number, message?: string): void {
    if (this.level <= LogLevel.INFO) {
      const percent = ((current / total) * 100).toFixed(1);
      const bar = this.createProgressBar(current, total);
      const msg = message ? ` - ${message}` : '';
      console.info(`[${this.prefix}] ${bar} ${percent}% (${current}/${total})${msg}`);
    }
  }

  private createProgressBar(current: number, total: number, width: number = 30): string {
    const filled = Math.floor((current / total) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  stats(stats: Record<string, any>): void {
    if (this.level <= LogLevel.INFO) {
      console.info(`[${this.prefix}] [STATS]`, stats);
    }
  }
}

// Default logger instance
export const logger = new Logger('HighSpeedScraper', LogLevel.INFO);
