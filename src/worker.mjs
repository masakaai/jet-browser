// Compatibility entrypoint. The Chromium/Storage preview worker was removed;
// all supported launches use the WPE realtime worker.
await import('./wpe-worker.mjs');
