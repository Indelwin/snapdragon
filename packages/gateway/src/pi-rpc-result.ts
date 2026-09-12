import type { PiRpcEventBuffer } from './pi-rpc-event-buffer.js';
import { summarize } from './pi-rpc-output.js';
import type { PiRpcRunProjection } from './pi-rpc-run-projection.js';
import type { PiRpcAgentRunResult } from './pi-rpc-types.js';

export function buildPiRpcResult(
  projection: PiRpcRunProjection,
  events: PiRpcEventBuffer,
  durationMs: number,
  observerErrors: number,
  traceSinkErrors: number,
): PiRpcAgentRunResult {
  const content = projection.content();
  const contentStats = projection.contentStats();
  const eventStats = events.stats();
  const stateStats = projection.stateStats();
  return {
    summary: summarize(content),
    content,
    events: events.values(),
    state: projection.state(),
    truncation: { content: contentStats, events: eventStats, state: stateStats },
    metrics: {
      duration_ms: durationMs,
      event_count: eventStats.originalCount,
      event_bytes: eventStats.originalBytes,
      retained_event_count: eventStats.retainedCount,
      retained_event_bytes: eventStats.retainedBytes,
      dropped_event_count: eventStats.originalCount - eventStats.retainedCount,
      projected_event_count: eventStats.projectedCount,
      content_bytes: contentStats.originalBytes,
      retained_content_bytes: contentStats.retainedBytes,
      state_bytes: stateStats.originalBytes,
      retained_state_bytes: stateStats.retainedBytes,
      observer_error_count: observerErrors,
      trace_sink_error_count: traceSinkErrors,
      extension_ui_requests: projection.extensionUiRequests(),
    },
  };
}
