// Retry the initial connection only. Once connected, the MongoDB driver owns
// reconnection; starting another connect() on a disconnected event can race it.
export const startDatabaseConnection = ({
  connect,
  shouldRetry = () => true,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onRetry = () => {},
}) => {
  let stopped = false;
  let timer = null;
  let delay = 1000;

  const attempt = async () => {
    let connected = false;
    try {
      connected = await connect();
    } catch {
      // The caller may throw instead of returning false. Do not expose raw
      // database errors, which can contain connection/account information.
    }
    if (stopped || connected === true || !shouldRetry()) return;

    const retryDelay = delay;
    delay = Math.min(delay * 2, 30000);
    onRetry(retryDelay);
    timer = setTimer(() => {
      timer = null;
      if (!stopped) void attempt();
    }, retryDelay);
    timer?.unref?.();
  };

  void attempt();
  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
};
