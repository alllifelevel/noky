/*
 * Site configuration.
 *
 * statsApi: URL of the deployed noky-stats worker (see workers/noky-stats/README.md), e.g.
 *   "https://noky-stats.<you>.workers.dev". Leave empty to turn download counts and likes off —
 *   the site then makes no stats requests at all.
 *
 * submitApi: the same worker; it turns a checked package into a pull request (POST /v1/submit).
 * turnstileSiteKey: site key of the Cloudflare Turnstile widget shown on create.html.
 *   Leave either empty to turn one-click submission off; the page then points to GitHub instead.
 */
window.NOKY_CONFIG = {
    statsApi: "https://noky-stats.alllifelevel.workers.dev",
    submitApi: "https://noky-stats.alllifelevel.workers.dev",
    turnstileSiteKey: "0x4AAAAAAGIsMmIQkAnsdqn1",
};
