/*
 * Anonymous download & like counters (client for workers/noky-stats).
 * Sends only {event, kind, id}. Which keyboards *you* liked is remembered in this browser only.
 */
(function () {
    "use strict";

    const cfg = window.NOKY_CONFIG || {};
    const API = String(cfg.statsApi || "").replace(/\/+$/, "");
    const LIKES_KEY = "noky_likes_v1";
    const listeners = new Set();
    let data = { keyboards: {}, dictionaries: {} };
    let loaded = false;

    function likedSet() {
        try {
            return new Set(JSON.parse(localStorage.getItem(LIKES_KEY) || "[]"));
        } catch (_) {
            return new Set();
        }
    }
    function saveLiked(set) {
        try {
            localStorage.setItem(LIKES_KEY, JSON.stringify(Array.from(set)));
        } catch (_) {
            /* private mode — the like still counts, it just isn't remembered */
        }
    }
    function bucket(kind) {
        return kind === "dictionary" ? data.dictionaries : data.keyboards;
    }
    function entry(kind, id) {
        const b = bucket(kind);
        b[id] = Object.assign({ downloads: 0, likes: 0 }, b[id]);
        return b[id];
    }
    function emit() {
        listeners.forEach((fn) => {
            try {
                fn();
            } catch (_) {}
        });
    }

    async function load() {
        if (!API) return data;
        try {
            const resp = await fetch(`${API}/v1/stats`);
            if (resp.ok) {
                const json = await resp.json();
                data = { keyboards: json.keyboards || {}, dictionaries: json.dictionaries || {} };
                loaded = true;
                emit();
            }
        } catch (_) {
            /* offline or not deployed yet */
        }
        return data;
    }

    function send(event, kind, id) {
        if (!API) return;
        // text/plain keeps this a "simple" request: no CORS preflight, and keepalive lets it
        // finish even when the click starts a download or navigation.
        fetch(`${API}/v1/event`, {
            method: "POST",
            body: JSON.stringify({ event, kind, id }),
            headers: { "Content-Type": "text/plain" },
            keepalive: true,
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((res) => {
                if (!res) return;
                const e = entry(kind, id);
                e.downloads = res.downloads;
                e.likes = res.likes;
                emit();
            })
            .catch(() => {});
    }

    function get(kind, id) {
        return bucket(kind)[id] || { downloads: 0, likes: 0 };
    }

    function download(kind, id) {
        if (!API || !id) return;
        entry(kind, id).downloads += 1;
        emit();
        send("download", kind, id);
    }

    function isLiked(id) {
        return likedSet().has(id);
    }

    function toggleLike(id) {
        const set = likedSet();
        const was = set.has(id);
        if (was) set.delete(id);
        else set.add(id);
        saveLiked(set);
        const e = entry("keyboard", id);
        e.likes = Math.max(0, e.likes + (was ? -1 : 1));
        emit();
        send(was ? "unlike" : "like", "keyboard", id);
        return !was;
    }

    function score(id) {
        const s = get("keyboard", id);
        return s.downloads + s.likes * 3;
    }

    function format(n) {
        n = Number(n) || 0;
        if (n < 1000) return String(n);
        if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
        if (n < 1e6) return Math.round(n / 1000) + "K";
        return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    }

    window.NokyStats = {
        enabled: Boolean(API),
        get loaded() {
            return loaded;
        },
        load,
        get,
        download,
        toggleLike,
        isLiked,
        score,
        format,
        onChange(fn) {
            listeners.add(fn);
        },
    };
})();
