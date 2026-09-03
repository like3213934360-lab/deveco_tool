/**
 * Process-local repositories for recording sessions and asynchronous flow jobs.
 *
 * They intentionally do not persist: recordings belong to one MCP connection, while completed
 * jobs have a short TTL. The named repositories keep lifecycle ownership in the infrastructure
 * boundary without introducing a database or a second on-disk format.
 */
export class RecordingSessionRepository extends Map {
  activeForDevice(deviceId) {
    return [...this.values()].find((session) => session.status === "recording" && session.deviceId === deviceId) ?? null;
  }
}

export class FlowJobRepository extends Map {
  finishedOldestFirst() {
    return [...this.values()].filter((job) => job.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt);
  }
}
