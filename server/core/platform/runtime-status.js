const state = {
  cleanup: {
    running: false,
    lastRunAt: null,
    lastDurationMs: null,
    lastDeletedTotal: null,
    lastSummary: null,
    lastError: null,
  },
};

function markCleanupStarted() {
  state.cleanup.running = true;
  state.cleanup.lastError = null;
  return Date.now();
}

function markCleanupFinished(startedAt, summary = {}) {
  state.cleanup.running = false;
  state.cleanup.lastRunAt = new Date().toISOString();
  state.cleanup.lastDurationMs = Math.max(0, Date.now() - startedAt);
  state.cleanup.lastDeletedTotal = Number(summary.total) || 0;
  state.cleanup.lastSummary = summary;
}

function markCleanupFailed(startedAt, error) {
  state.cleanup.running = false;
  state.cleanup.lastRunAt = new Date().toISOString();
  state.cleanup.lastDurationMs = Math.max(0, Date.now() - startedAt);
  state.cleanup.lastError = error?.message || String(error || "Cleanup failed");
}

function getRuntimeStatus() {
  return {
    cleanup: { ...state.cleanup },
  };
}

module.exports = {
  getRuntimeStatus,
  markCleanupFailed,
  markCleanupFinished,
  markCleanupStarted,
};
