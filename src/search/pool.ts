/**
 * Worker pool. Spins up one worker per logical CPU and fans the seed space
 * out across them, streaming matches back as they are found.
 */

import type { Match, SearchConfig, WorkerOut } from './types';

export interface PoolEvents {
  onMatch(matches: Match[]): void;
  onProgress(scanned: number, stage2: number, matches: number): void;
  onDone(): void;
  onError(message: string): void;
}

export function suggestedWorkerCount(): number {
  const n = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(16, n));
}

export class SearchPool {
  private workers: Worker[] = [];
  private scannedPerLane: number[] = [];
  private stage2PerLane: number[] = [];
  private finished = 0;
  private matchCount = 0;
  private active = false;
  private paused = false;
  private matchLimit = 0;

  constructor(
    private readonly events: PoolEvents,
    private readonly lanes = suggestedWorkerCount(),
  ) {}

  get workerCount(): number {
    return this.lanes;
  }

  get isRunning(): boolean {
    return this.active;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get scanned(): number {
    return this.scannedPerLane.reduce((a, b) => a + b, 0);
  }

  start(config: SearchConfig): void {
    this.stop();
    this.active = true;
    this.paused = false;
    this.finished = 0;
    this.matchCount = 0;
    this.matchLimit = config.matchLimit;
    this.scannedPerLane = new Array<number>(this.lanes).fill(0);
    this.stage2PerLane = new Array<number>(this.lanes).fill(0);

    // Each lane caps its own match count, so divide the global budget.
    const perLaneLimit =
      config.matchLimit > 0 ? Math.max(1, Math.ceil(config.matchLimit / this.lanes)) : 0;

    for (let lane = 0; lane < this.lanes; lane++) {
      const worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<WorkerOut>) => this.handle(lane, ev.data);
      worker.onerror = (ev) => this.events.onError(ev.message || 'Worker failed to start.');
      this.workers.push(worker);
      worker.postMessage({
        type: 'start',
        config: { ...config, matchLimit: perLaneLimit },
        lane,
        lanes: this.lanes,
      });
    }
  }

  /** Suspends every lane without losing its place. */
  pause(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    for (const w of this.workers) w.postMessage({ type: 'pause' });
  }

  resume(): void {
    if (!this.active || !this.paused) return;
    this.paused = false;
    for (const w of this.workers) w.postMessage({ type: 'resume' });
  }

  stop(): void {
    for (const w of this.workers) {
      w.postMessage({ type: 'stop' });
      w.terminate();
    }
    this.workers = [];
    this.paused = false;
    if (this.active) {
      this.active = false;
      this.events.onDone();
    }
  }

  private handle(lane: number, msg: WorkerOut): void {
    switch (msg.type) {
      case 'ready':
        break;
      case 'progress':
        this.scannedPerLane[lane] = msg.scanned;
        this.stage2PerLane[lane] = msg.stage2;
        this.emitProgress();
        break;
      case 'matches': {
        this.scannedPerLane[lane] = msg.scanned;
        this.stage2PerLane[lane] = msg.stage2;
        const room =
          this.matchLimit > 0 ? Math.max(0, this.matchLimit - this.matchCount) : msg.matches.length;
        const accepted = msg.matches.slice(0, room);
        if (accepted.length > 0) {
          this.matchCount += accepted.length;
          this.events.onMatch(accepted);
        }
        this.emitProgress();
        if (this.matchLimit > 0 && this.matchCount >= this.matchLimit) this.stop();
        break;
      }
      case 'done':
        this.scannedPerLane[lane] = msg.scanned;
        this.finished++;
        if (this.finished >= this.workers.length) this.stop();
        break;
      case 'error':
        this.events.onError(msg.message);
        this.stop();
        break;
    }
  }

  private emitProgress(): void {
    const scanned = this.scannedPerLane.reduce((a, b) => a + b, 0);
    const stage2 = this.stage2PerLane.reduce((a, b) => a + b, 0);
    this.events.onProgress(scanned, stage2, this.matchCount);
  }
}
