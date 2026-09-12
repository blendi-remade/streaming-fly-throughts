import test from "node:test";
import assert from "node:assert/strict";
import { DirectorScheduler, directionKey } from "../lib/director-scheduling";
import { interpretBrain } from "../lib/cinematic";
import { EMPTY_BRAIN } from "../lib/types";

test("a new measured state cuts ahead of the steady cadence after admission", () => {
  const scheduler = new DirectorScheduler();
  scheduler.observe("rest:none", 1_000);
  assert.deepEqual(scheduler.next(1_000), { kind: "change", waitMs: 0 });
  scheduler.sent(1, "rest:none", 1_010);
  scheduler.accepted(1, 1_100);
  scheduler.observe("escape:none", 2_000);
  assert.deepEqual(scheduler.next(2_000), { kind: "change", waitMs: 0 });
  scheduler.sent(2, "escape:none", 2_000);
  assert.equal(scheduler.latency.observedToSentMs, 0);
});

test("pending direction permits no second send and coalesces to the newest state", () => {
  const scheduler = new DirectorScheduler();
  scheduler.observe("rest:none", 0);
  scheduler.sent(1, "rest:none", 0);
  scheduler.observe("feed:none", 100);
  scheduler.observe("escape:none", 300);
  assert.equal(scheduler.next(1_000), null);
  assert.throws(() => scheduler.sent(2, "escape:none", 1_000), /already awaiting admission/);
  scheduler.accepted(1, 1_100);
  assert.equal(scheduler.latestKey, "escape:none");
  assert.deepEqual(scheduler.next(1_100), { kind: "change", waitMs: 0 });
  assert.throws(() => scheduler.sent(2, "feed:none", 1_100), /superseded/);
});

test("jitter cannot exceed the 800ms send rate, while identical state waits 12s", () => {
  const scheduler = new DirectorScheduler();
  scheduler.observe("feed:none", 1_000);
  scheduler.sent(1, "feed:none", 1_000);
  scheduler.accepted(1, 1_020);
  scheduler.observe("escape:none", 1_100);
  assert.deepEqual(scheduler.next(1_100), { kind: "change", waitMs: 700 });
  scheduler.observe("feed:none", 1_200);
  assert.deepEqual(scheduler.next(1_200), { kind: "continuation", waitMs: 11_800 });
  // Frequent telemetry does not slide the deadline forward indefinitely.
  scheduler.observe("feed:none", 12_990);
  assert.deepEqual(scheduler.next(13_000), { kind: "continuation", waitMs: 0 });
});

test("stale pending/ACK events do not clear or resurrect a newer pending direction", () => {
  const scheduler = new DirectorScheduler();
  scheduler.observe("feed:none", 0); scheduler.sent(1, "feed:none", 0);
  scheduler.accepted(1, 20); scheduler.pending(1);
  assert.equal(scheduler.pendingVersion, 0);
  scheduler.observe("escape:none", 1_000); scheduler.sent(2, "escape:none", 1_000);
  scheduler.accepted(1, 1_100); scheduler.generated(1, 1_200);
  assert.equal(scheduler.pendingVersion, 2);
  scheduler.rejected(2); scheduler.pending(2);
  assert.equal(scheduler.pendingVersion, 0);
});

test("latency is measured from matching versions and only their first output", () => {
  const scheduler = new DirectorScheduler();
  scheduler.observe("escape:none", 1_000);
  scheduler.sent(1, "escape:none", 1_120);
  scheduler.accepted(1, 1_200);
  scheduler.generated(1, 4_000);
  const result = scheduler.latency;
  assert.equal(result.observedToSentMs, 120);
  assert.equal(result.sentToAcceptedMs, 80);
  assert.equal(result.sentToGeneratedMs, 2_880);
  assert.equal(result.observedToGeneratedMs, 3_000);
  scheduler.generated(1, 14_000);
  assert.deepEqual(scheduler.latency, result);
  scheduler.observe("escape:none", 13_110);
  scheduler.sent(2, "escape:none", 13_120);
  assert.equal(scheduler.latency.observedToSentMs, 10, "continuation uses fresh evidence rather than inflating reaction latency");
});

test("generated output releases a lost admission ACK, but reveals no browser presentation time", () => {
  const scheduler = new DirectorScheduler();
  scheduler.observe("rest:odor", 10); scheduler.sent(1, "rest:odor", 20);
  scheduler.generated(1, 4_000);
  assert.equal(scheduler.pendingVersion, 0);
  assert.equal(scheduler.latency.sentToAcceptedMs, null);
  assert.equal(scheduler.latency.lastGeneratedAt, 4_000);
});

test("sensory motifs count as changes; template variants progress without fabricated neural changes", () => {
  assert.notEqual(directionKey({ drive: "rest", sensoryTheme: "odor" }), directionKey({ drive: "rest", sensoryTheme: "bitter" }));
  const first = interpretBrain(EMPTY_BRAIN, false, 0);
  const second = interpretBrain(EMPTY_BRAIN, false, 1);
  assert.notEqual(first.prompt, second.prompt);
  assert.equal(directionKey(first), directionKey(second));
  assert.deepEqual(first.evidence, second.evidence);
});
