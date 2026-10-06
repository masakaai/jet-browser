# Browser infrastructure comparison

This comparison is for integration planning. It separates verified public capabilities from locally measured performance and was checked on 2026-10-06.

| Area | MASAKA Jet Browser | Browser Use Cloud browser | Kernel browser |
| --- | --- | --- | --- |
| Primary role | WPE browser infrastructure plus MASAKA control/data plane | Managed Chromium browser infrastructure; also offers a separate hosted agent | Managed Chromium browser infrastructure and execution APIs |
| Engine | WPE WebKit 2.54 | Chromium | Chromium |
| Automation | MASAKA ordered session/action API | CDP for Playwright/Puppeteer | CDP, WebDriver BiDi, hosted Playwright execution, and computer controls |
| Human view/control | Visual or Live DOM preview; explicit take/release control | Live preview and human-in-the-loop flows | Live view and computer controls |
| Persistent state | Encrypted cookies, local/session storage, IndexedDB, and CacheStorage | Cloud profiles; local-to-cloud sync has its own documented scope | Profiles and Managed Auth |
| Tabs and downloads | Tabs, bounded downloads, authenticated retrieval | Tabs through CDP; managed downloads | Tabs through browser protocols; browser filesystem APIs |
| Current MASAKA differentiator | WPE resource profile, semantic preview option, direct session WSS, explicit agent/human epoch fencing | Mature Chromium compatibility, stealth/proxy/CAPTCHA options, agent ecosystem | Mature Chromium compatibility, pools, auth, telemetry/replay, broad protocol surface |
| Current MASAKA gap | No public CDP/Chromium-extension tier; preview FPS and large-scale concurrency need broader published distributions | Not applicable | Not applicable |

Browser Use is also an agent framework, while Jet Browser is browser infrastructure. A Browser Use agent can conceptually run above a browser provider; comparing its task score directly with Jet Browser startup latency is a category error.

## Performance status

| Metric | MASAKA | Browser Use | Kernel |
| --- | ---: | ---: | ---: |
| Same-harness local result | Available in `benchmarks/results` | Run `npm run benchmark` with `BROWSER_USE_API_KEY` | Run `npm run benchmark` with `KERNEL_API_KEY` |
| Published here without same-harness credentials | Yes, dated raw MASAKA sample | Not measured | Not measured |

No external provider is assigned a zero, estimated number, or copied marketing number. Run the included harness from one client and publish all three raw result sets before making a speed claim.

## Sources

- [Browser Use browser infrastructure quickstart](https://docs.browser-use.com/cloud/browser/quickstart)
- [Browser Use API v4 browser sessions](https://docs.browser-use.com/cloud/api-v4/browsers/create-browser-session)
- [Browser Use open-source repository](https://github.com/browser-use/browser-use)
- [Browser Use benchmark repository](https://github.com/browser-use/benchmark)
- [Kernel browser session API](https://www.kernel.sh/docs/api-reference/browsers/list-browser-sessions)
- [Kernel product and protocol overview](https://www.kernel.sh/)
- [Kernel Images browser runtime](https://github.com/kernel/kernel-images)
- [Kernel TypeScript SDK](https://github.com/kernel/kernel-node-sdk)
- [Kernel Browser Loop tool catalog](https://github.com/kernel/browser-loop)
- [Kernel remote browser benchmark](https://github.com/kernel/browserbench)
- [Lightpanda repository and benchmark method](https://github.com/lightpanda-io/browser)
- [Steel Browser repository](https://github.com/steel-dev/steel-browser)

External products change frequently. Re-check their official documentation before publishing a dated comparison.
