import { isFatalEngineFailure } from "./engine-failure.mjs";

async function optionalDocumentState(engine, timeoutMs) {
  try {
    return await engine.documentState(timeoutMs);
  } catch (error) {
    if (isFatalEngineFailure(error)) throw error;
    return null;
  }
}

export async function createNavigatedEngine({
  create,
  prepare,
  navigate,
  target,
  attempts = 2,
  timeoutMs = Infinity,
  pause = () => Promise.resolve(),
}) {
  let failure;
  const deadline = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : Infinity;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (Date.now() >= deadline) break;
    let engine;
    try {
      engine = await create();
      if (prepare) {
        await prepare(engine, target, {
          attempt,
          remainingMs: Math.max(1, deadline - Date.now()),
        });
      }
      await navigate(engine, target, {
        attempt,
        remainingMs: Math.max(1, deadline - Date.now()),
      });
      return engine;
    } catch (error) {
      failure = error;
      if (!engine && error.driverReusable === false) throw error;
      if (engine) {
        try {
          await engine.close();
        } catch (cleanupError) {
          if (engine.sessionId !== null) {
            cleanupError.driverReusable = false;
            throw cleanupError;
          }
        }
        // A command timeout kills the bridge and leaves the WebDriver slot in
        // an unknown state. Do not spend the remaining startup budget creating
        // more sessions on that same slot; let the worker switch this request
        // to its independent fallback slot immediately.
        if (error.driverRestartRequired) {
          error.driverReusable = false;
          throw error;
        }
        error.driverReusable = true;
      }
      if (attempt + 1 < attempts && Date.now() < deadline)
        await pause(Math.min(500 * (attempt + 1), Math.max(0, deadline - Date.now())));
    }
  }
  throw failure;
}

export async function beginNavigationWithWait(
  engine,
  target,
  {
    timeoutMs = 20_000,
    pollMs = 250,
    stablePolls = 2,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = {},
) {
  new URL(target);
  const deadline = now() + timeoutMs;
  const navigationStarted = now();
  let stable = 0;
  let lastHref = "";
  const previousUrl = String(await engine.url());
  const documentProbesEnabled =
    typeof engine.documentState === "function" &&
    engine.documentStateDuringNavigation !== false;
  const previousDocument = documentProbesEnabled
    ? await optionalDocumentState(engine, Math.min(5_000, Math.max(1, timeoutMs)))
    : null;
  let targetHref;
  try { targetHref = new URL(target).href; } catch { targetHref = String(target); }
  const sameUrlNavigation = previousUrl === targetHref;
  const sameFragmentNavigation = sameUrlNavigation && new URL(targetHref).hash.length > 0;
  let fallbackIssued = false;
  let documentTransitionObserved = false;
  let urlTransitionObserved = false;
  await engine.beginNavigation(target, Math.min(5_000, Math.max(1, timeoutMs)));
  while (now() < deadline) {
    await pause(pollMs);
    let loaded;
    let currentDocument = null;
    try {
      loaded = new URL(await engine.url());
      if (loaded.href !== previousUrl) urlTransitionObserved = true;
      if (documentProbesEnabled) {
        // A destination can have a long server TTFB while the WebDriver and
        // compositor remain healthy (arXiv has been observed between 4–30s
        // from the worker region). Give the commit probe the navigation
        // budget instead of quarantining a healthy slot after five seconds.
        currentDocument = await optionalDocumentState(engine,
          Math.min(40_000, Math.max(1, deadline - now())));
        if (
          previousDocument &&
          currentDocument &&
          Number(currentDocument.timeOrigin) > 0 &&
          Number(currentDocument.timeOrigin) !== Number(previousDocument.timeOrigin)
        ) documentTransitionObserved = true;
        if (previousDocument && currentDocument?.url !== previousDocument.url)
          documentTransitionObserved = true;
      }
    } catch (error) {
      // Preserve bridge failure metadata so the worker can quarantine the
      // broken engine instead of turning it into an ordinary readiness miss.
      if (isFatalEngineFailure(error)) throw error;
      stable = 0;
      continue;
    }
    if (
      !fallbackIssued &&
      now() - navigationStarted >= 1_500 &&
      (
        loaded.href === previousUrl ||
        !["http:", "https:"].includes(loaded.protocol) ||
        (currentDocument && !["http:", "https:"].includes(new URL(currentDocument.url).protocol))
      )
    ) {
      fallbackIssued = true;
      await engine.navigate(target, Math.min(5_000, Math.max(1, deadline - now())));
      stable = 0;
      lastHref = "";
      continue;
    }
    // Page scripts may forbid eval through CSP (X does), and readyState may
    // stay loading on SPAs. WebDriver's typed URL command is CSP-independent;
    // a short grace plus the same final redirect URL on consecutive polls is
    // the portable readiness boundary.
    const ready = now() - navigationStarted >= 1_500;
    let documentCommitted = true;
    if (currentDocument) {
      try { documentCommitted = new URL(currentDocument.url).href === loaded.href; }
      catch { documentCommitted = false; }
    }
    const navigationObserved = currentDocument
      ? documentTransitionObserved || (sameUrlNavigation && fallbackIssued && sameFragmentNavigation)
      : urlTransitionObserved || (sameUrlNavigation && fallbackIssued && !previousDocument);
    if (!ready || !navigationObserved || !documentCommitted || !["http:", "https:"].includes(loaded.protocol)) {
      stable = 0;
      lastHref = "";
      continue;
    }
    if (loaded.href !== lastHref) {
      lastHref = loaded.href;
      stable = 1;
    } else {
      stable++;
    }
    if (stable >= stablePolls) return { loaded_async: true, url: loaded.href };
  }
  throw Error(
    `Initial navigation readiness timed out (${lastHref || "no committed URL"})`,
  );
}
