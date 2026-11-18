/*
 * Site configuration.
 *
 * statsApi: URL of the deployed noky-stats worker (see workers/noky-stats/README.md), e.g.
 *   "https://noky-stats.<you>.workers.dev". Leave empty to turn download counts and likes off —
 *   the site then makes no stats requests at all.
 */
window.NOKY_CONFIG = {
    statsApi: "https://noky-stats.alllifelevel.workers.dev",
};
