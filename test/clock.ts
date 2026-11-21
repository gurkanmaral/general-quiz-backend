import type { Clock } from '../src/modules/lobbies';

/** A server clock the test moves by hand; timers fire only inside `advance` (AD-8 timing, deterministic). */
export class ManualClock implements Clock {
  private timers: { id: number; at: number; callback: () => void }[] = [];
  private nextId = 1;
  constructor(public time = Date.parse('2026-11-16T12:00:00Z')) {}

  now = () => this.time;

  setTimeout = (callback: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.time + ms, callback });
    return id;
  };

  clearTimeout = (handle: unknown) => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };

  get pending(): number {
    return this.timers.length;
  }

  /** Moves time forward, firing due timers in order and letting their work settle in between. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = due.at;
      due.callback();
      await settle();
    }
    this.time = target;
    await settle();
  }
}

/** Lets queued promise work and socket I/O run. */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}
