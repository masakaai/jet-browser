export function isFatalEngineFailure(error) {
  const message = String(error?.message || error || "");
  return error?.driverRestartRequired === true ||
    error?.driverReusable === false ||
    /(?:bridge|driver|engine).+(?:closed|exited|timed out)/i.test(message) ||
    /(?:invalid session id|no such session|session.+(?:not found|does not exist))/i.test(message);
}
