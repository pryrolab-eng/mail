/**
 * High-Speed Email Scraper - Rate Limiter
 */

export class RateLimiter {
  private requestsPerSecond: number;
  private requestsPerMinute: number;
  private secondWindow: number[] = [];
  private minuteWindow: number[] = [];

  constructor(maxPerSecond: number, maxPerMinute: number) {
    this.requestsPerSecond = maxPerSecond;
    this.requestsPerMinute = maxPerMinute;
  }

  /**
   * Wait until rate limit allows next request
   */
  async waitForSlot(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.cleanupWindows(now);

      const canProceed =
        this.secondWindow.length < this.requestsPerSecond &&
        this.minuteWindow.length < this.requestsPerMinute;

      if (canProceed) {
        this.secondWindow.push(now);
        this.minuteWindow.push(now);
        return;
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Remove old timestamps from windows
   */
  private cleanupWindows(now: number): void {
    const oneSecondAgo = now - 1000;
    const oneMinuteAgo = now - 60000;

    this.secondWindow = this.secondWindow.filter(t => t > oneSecondAgo);
    this.minuteWindow = this.minuteWindow.filter(t => t > oneMinuteAgo);
  }

  /**
   * Get current rate limit stats
   */
  getStats() {
    const now = Date.now();
    this.cleanupWindows(now);

    return {
      requestsLastSecond: this.secondWindow.length,
      requestsLastMinute: this.minuteWindow.length,
      maxPerSecond: this.requestsPerSecond,
      maxPerMinute: this.requestsPerMinute,
      availableSlots: {
        second: this.requestsPerSecond - this.secondWindow.length,
        minute: this.requestsPerMinute - this.minuteWindow.length,
      },
    };
  }

  /**
   * Reset rate limiter
   */
  reset(): void {
    this.secondWindow = [];
    this.minuteWindow = [];
  }
}
