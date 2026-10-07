const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function waitForFixtureDocument(send, target, {
  attempts = 30,
  intervalMs = 100,
  pause = sleep,
} = {}) {
  let lastState = null;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      lastState = await send({ op: 'document_state' });
      if (lastState?.url === target && ['interactive', 'complete'].includes(lastState.readyState)) {
        return lastState;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) await pause(intervalMs);
  }
  const detail = lastError?.message || `${lastState?.url || 'no URL'} (${lastState?.readyState || 'no state'})`;
  throw Error(`Fixture document did not become ready: ${detail}`);
}
