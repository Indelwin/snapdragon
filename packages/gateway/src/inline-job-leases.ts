import { assertActiveLease } from './inline-job-fence.js';
import { sortLeases } from './inline-job-helpers.js';
import { cloneLease } from './inline-job-snapshots.js';
import type { GatewayJobStatus, GatewayLease, GatewayLeaseFence } from './types.js';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export class InlineJobLeases {
  #leases = new Map<string, GatewayLease>();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #closed = false;

  constructor(private readonly onExpired: (lease: GatewayLease) => void) {}

  add(lease: GatewayLease): void {
    this.#leases.set(lease.id, lease);
    this.#schedule(lease);
  }

  renew(job: GatewayJobStatus, fence: GatewayLeaseFence, leaseMs: number): GatewayLease {
    const lease = this.#leases.get(fence.leaseId);
    assertActiveLease(job, lease, fence);
    lease.expiresAtMs = Date.now() + leaseMs;
    this.#schedule(lease);
    return lease;
  }

  clear(job: GatewayJobStatus): GatewayLease | undefined {
    const lease = job.leaseId ? this.#leases.get(job.leaseId) : undefined;
    if (!job.leaseId) return lease;
    this.#leases.delete(job.leaseId);
    const timer = this.#timers.get(job.leaseId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(job.leaseId);
    return lease;
  }

  assert(job: GatewayJobStatus, fence: GatewayLeaseFence): GatewayLease {
    const lease = this.#leases.get(fence.leaseId);
    assertActiveLease(job, lease, fence);
    return lease;
  }

  active(): GatewayLease[] {
    return sortLeases(this.#leases.values()).map(cloneLease);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  #schedule(lease: GatewayLease): void {
    if (this.#closed) return;
    const current = this.#timers.get(lease.id);
    if (current) clearTimeout(current);
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, lease.expiresAtMs - Date.now()));
    const timer = setTimeout(() => this.#expire(lease.id, lease.attempt), delay);
    timer.unref?.();
    this.#timers.set(lease.id, timer);
  }

  #expire(leaseId: string, attempt: number): void {
    if (this.#closed) return;
    const lease = this.#leases.get(leaseId);
    if (!lease || lease.attempt !== attempt) return;
    if (lease.expiresAtMs > Date.now()) {
      this.#schedule(lease);
      return;
    }
    this.#leases.delete(leaseId);
    this.#timers.delete(leaseId);
    this.onExpired(cloneLease(lease));
  }
}
