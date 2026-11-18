/*
 * Noky web keyboard renderer.
 *
 * A canvas port of the app's Compose renderer so a keyboard looks the same on the web as on the
 * phone. Keep it in sync with:
 *   app/src/main/java/app/allstudio/noky/ui/DynamicLayoutRenderer.kt  (rows, weights, scrolling)
 *   app/src/main/java/app/allstudio/noky/ui/DynamicKeyButton.kt       (key surface, colours, labels, icons)
 *   app/src/main/java/app/allstudio/noky/ui/KeyShapes.kt              (the 8 key shapes)
 *   app/src/main/java/app/allstudio/noky/engine/LayoutJson.kt         (normalize / validation)
 *   app/src/main/java/app/allstudio/noky/KeyboardPreferences.kt       (default settings)
 *   app/src/main/java/app/allstudio/noky/ui/theme/Color.kt            (default Cyan dark theme)
 *
 * Everything is drawn in dp; the canvas is scaled so 1dp = `scale` CSS px.
 */
(function (global) {
    "use strict";

    // Default "Cyan" dark colour scheme (ui/theme/Theme.kt + Color.kt).
    const THEME = {
        background: "#111114",
        surface: "#222228",
        surfaceVariant: "#1B1B20",
        surfaceContainer: "#1F1F24",
        surfaceContainerHigh: "#272730",
        surfaceContainerHighest: "#30303B",
        onSurface: "#ECECF0",
        onSurfaceVariant: "#9999A8",
        primary: "#00E5FF",
        onPrimary: "#00363C",
        primaryContainer: "#003D44",
        onPrimaryContainer: "#00E5FF",
    };

    // KeyboardSettings defaults (KeyboardPreferences.kt).
    const SETTINGS = {
        keyPaddingDp: 3,
        cornerRadiusDp: 8,
        keyElevationDp: 2,
        keyFontSizeSp: 16,
        keyIconSizeDp: 20,
        keyEmojiSizeSp: 20,
        keyBackgroundAlpha: 1,
        keyTextAlpha: 1,
        keyboardBackgroundAlpha: 1,
        portraitHeightMultiplier: 0.35,
        minKeyboardHeightDp: 180,
        keyPressAnimation: true,
        keyPressPopupEnabled: true,
        keyPopupShape: "ROUNDED_RECT",
        keyPopupWidthScale: 1.18,
        keyPopupHeightDp: 54,
        keyPopupFontSizeSp: 26,
        keyPopupCornerRadiusDp: 12,
        keyPopupOffsetYDp: 6,
        keyPopupElevationDp: 6,
        keyPopupBgAlpha: 1,
    };

    // Reference phone the preview is sized against (dp).
    const REF_SCREEN = { widthDp: 360, heightDp: 780 };

    // Icon table generated from resolveKeyIcon() in DynamicKeyButton.kt by tools/build_website_catalog.py
    // (key-icons.js). Read lazily so the page can load it in any order.
    const iconTable = () => window.NOKY_KEY_ICONS || { names: {}, labels: {} };

    const SHAPES = ["ROUNDED_RECT", "RECTANGLE", "PILL", "CIRCLE", "SQUIRCLE", "CUT_CORNERS", "HEXAGON", "DIAMOND"];
    const IMAGE_SCALES = ["FIT", "FILL", "TILE"];
    const OVERFLOW = ["ELLIPSIS", "SHRINK", "WRAP"];

    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

    // ── Colours ──────────────────────────────────────────────────────────────
    function parseColor(value) {
        if (value === undefined || value === null) return null;
        if (typeof value === "string") {
            let s = value.trim().replace(/^#|^0x/i, "");
            if (!/^[0-9a-f]+$/i.test(s)) return null;
            if (s.length === 6) s = "FF" + s;
            if (s.length !== 8) return null;
            value = parseInt(s, 16);
        }
        const n = Number(value);
        if (!isFinite(n)) return null;
        const u = n >>> 0;
        return { a: ((u >>> 24) & 0xff) / 255, r: (u >>> 16) & 0xff, g: (u >>> 8) & 0xff, b: u & 0xff };
    }
    function hexColor(hex) {
        return parseColor(hex);
    }
    // Compose `Color(x).copy(alpha = a)` replaces alpha; pass `alpha` to mirror that.
    function rgba(c, alpha) {
        const a = alpha === undefined ? c.a : alpha;
        return `rgba(${c.r}, ${c.g}, ${c.b}, ${clamp(a, 0, 1).toFixed(3)})`;
    }

    // ── LayoutJson.normalize port ────────────────────────────────────────────
    function sanitizeWeight(v) {
        v = num(v);
        if (v === null || v <= 0) return 1;
        return clamp(v, 0.05, 100);
    }
    function normalizeKeyStyle(style) {
        if (style.shape !== undefined && !SHAPES.includes(style.shape)) delete style.shape;
        if (style.backgroundImageScale !== undefined && !IMAGE_SCALES.includes(style.backgroundImageScale)) delete style.backgroundImageScale;
        if (style.backgroundGradient !== undefined && !Array.isArray(style.backgroundGradient)) delete style.backgroundGradient;
        ["offsetXDp", "offsetYDp"].forEach((f) => {
            if (style[f] === undefined) return;
            const v = num(style[f]);
            if (v === null) delete style[f];
            else style[f] = clamp(v, -120, 120);
        });
    }
    function normalizePopupStyle(p) {
        if (p.shape !== undefined && !SHAPES.includes(p.shape)) delete p.shape;
        if (p.bgGradient !== undefined && !Array.isArray(p.bgGradient)) delete p.bgGradient;
    }
    const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

    function normalize(input) {
        if (!isObj(input)) throw new Error("Keyboard data is not a JSON object");
        const root = JSON.parse(JSON.stringify(input));
        const id = typeof root.id === "string" ? root.id.trim() : "";
        if (!id) throw new Error("Keyboard has no id");
        if (id.length > 96) throw new Error("Keyboard id is too long");
        root.id = id;
        if (typeof root.name !== "string") root.name = "Imported keyboard";
        if (typeof root.description !== "string") root.description = "";
        if (typeof root.author !== "string") root.author = "";
        if (typeof root.locale !== "string") root.locale = "en";
        if (!isObj(root.defaultKeyStyle)) root.defaultKeyStyle = {};
        normalizeKeyStyle(root.defaultKeyStyle);
        if (root.popupStyle !== undefined) {
            if (!isObj(root.popupStyle)) delete root.popupStyle;
            else normalizePopupStyle(root.popupStyle);
        }
        if (!["ALLOW", "FORCE_OFF"].includes(root.numberRowPolicy)) root.numberRowPolicy = "ALLOW";
        if (typeof root.showSuggestionBar !== "boolean") root.showSuggestionBar = true;
        if (root.suggestionBarStyle !== undefined) {
            if (!isObj(root.suggestionBarStyle)) delete root.suggestionBarStyle;
            else ["toolbarItems", "backgroundGradient", "chipGradient", "highlightedChipGradient"].forEach((f) => {
                if (root.suggestionBarStyle[f] !== undefined && !Array.isArray(root.suggestionBarStyle[f])) delete root.suggestionBarStyle[f];
            });
        }

        if (!isObj(root.layers)) throw new Error("Keyboard has no layers");
        const layerKeys = Object.keys(root.layers);
        if (layerKeys.length === 0) throw new Error("Keyboard has no layers");
        if (layerKeys.length > 64) throw new Error("Keyboard has too many layers");

        layerKeys.forEach((lk) => {
            const layer = root.layers[lk];
            if (!isObj(layer)) throw new Error(`Layer "${lk}" is malformed`);
            if (typeof layer.id !== "string") layer.id = lk;
            if (typeof layer.name !== "string") layer.name = layer.id;
            if (!Array.isArray(layer.rows)) layer.rows = [];
            if (layer.rows.length > 200) throw new Error(`Layer "${lk}" has too many rows`);
            layer.rows.forEach((row, ri) => {
                if (!isObj(row)) throw new Error(`Layer "${lk}" has a malformed row`);
                row.rowWeight = sanitizeWeight(row.rowWeight);
                if (!Array.isArray(row.keys)) row.keys = [];
                if (row.keys.length > 40) throw new Error(`Layer "${lk}" has a row with too many keys`);
                row.keys.forEach((key, ki) => {
                    if (!isObj(key)) throw new Error(`Layer "${lk}" has a malformed key`);
                    if (typeof key.id !== "string" || !key.id.trim()) key.id = `k_${lk}_${ri}_${ki}`;
                    if (typeof key.label !== "string") key.label = "";
                    if (!isObj(key.action)) key.action = { type: "CommitText", text: key.label };
                    key.weight = sanitizeWeight(key.weight);
                    const hr = num(key.heightRatio);
                    key.heightRatio = hr === null || hr <= 0 ? 1 : clamp(hr, 0.05, 1);
                    if (!OVERFLOW.includes(key.overflowMode)) key.overflowMode = "ELLIPSIS";
                    const ml = num(key.maxLabelLines);
                    key.maxLabelLines = ml === null ? 2 : clamp(Math.trunc(ml), 1, 3);
                    if (key.popupAlternatives !== undefined && !Array.isArray(key.popupAlternatives)) delete key.popupAlternatives;
                    if (key.customStyle !== undefined) {
                        if (!isObj(key.customStyle)) delete key.customStyle;
                        else normalizeKeyStyle(key.customStyle);
                    }
                    if (key.popupStyle !== undefined) {
                        if (!isObj(key.popupStyle)) delete key.popupStyle;
                        else normalizePopupStyle(key.popupStyle);
                    }
                });
            });
        });
        if (typeof root.initialLayer !== "string" || !root.layers[root.initialLayer]) {
            root.initialLayer = root.layers.default ? "default" : layerKeys[0];
        }
        return root;
    }

    // ── Style resolution (KeyStyleConfig.resolveWithFallback) ───────────────
    function resolveStyle(custom, fallback) {
        const c = custom || {};
        const f = fallback || {};
        const out = {};
        new Set([...Object.keys(f), ...Object.keys(c)]).forEach((k) => {
            out[k] = c[k] !== undefined && c[k] !== null ? c[k] : f[k];
        });
        out.glowEffect = Boolean(c.glowEffect) || Boolean(f.glowEffect);
        return out;
    }
    function resolvePopup(custom, fallback) {
        const c = custom || {};
        const f = fallback || {};
        const out = Object.assign({}, f);
        Object.keys(c).forEach((k) => {
            if (c[k] !== undefined && c[k] !== null) out[k] = c[k];
        });
        return out;
    }

    // ── Labels & icons ───────────────────────────────────────────────────────
    function isEmojiLabel(label) {
        if (!label) return false;
        const cp = label.codePointAt(0);
        if (cp >= 0x1f300 && cp <= 0x1faff) return true;
        if (cp >= 0x2600 && cp <= 0x27bf) return true;
        if (cp >= 0x2190 && cp <= 0x21ff) return false;
        if (cp >= 0x2b00 && cp <= 0x2bff) return true;
        if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true;
        return cp === 0x2764;
    }
    function resolveIcon(iconName, label) {
        if (iconName !== undefined && iconName !== null) {
            return iconTable().names[String(iconName).toLowerCase()] || null;
        }
        return iconTable().labels[String(label || "").toUpperCase()] || null;
    }

    function fontStack(family) {
        if (!family || family === "System" || family === "Default") {
            return 'Roboto, "Segoe UI", system-ui, -apple-system, sans-serif';
        }
        return `"${family}", Roboto, "Segoe UI", system-ui, sans-serif`;
    }

    const requestedFonts = new Set();
    function ensureFont(family) {
        if (!family || family === "System" || family === "Default" || requestedFonts.has(family)) {
            return Promise.resolve();
        }
        requestedFonts.add(family);
        try {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
            document.head.appendChild(link);
            return new Promise((resolve) => {
                link.onload = () => document.fonts.load(`500 16px "${family}"`).then(resolve, resolve);
                link.onerror = resolve;
            });
        } catch (_) {
            return Promise.resolve();
        }
    }
    function layoutFonts(layout) {
        const set = new Set();
        if (layout.fontFamily) set.add(layout.fontFamily);
        if (layout.defaultKeyStyle && layout.defaultKeyStyle.fontFamily) set.add(layout.defaultKeyStyle.fontFamily);
        Object.values(layout.layers || {}).forEach((l) =>
            (l.rows || []).forEach((r) => (r.keys || []).forEach((k) => k.customStyle && k.customStyle.fontFamily && set.add(k.customStyle.fontFamily)))
        );
        return Array.from(set);
    }
    // ── Key icons, fetched on demand ─────────────────────────────────────────
    // Keys are drawn with only the glyphs they need. Every time a keyboard needs icons we don't have
    // yet, we fetch a Material Symbols subset with ALL icons needed so far under a fresh family name,
    // and switch to it once it has loaded — so already-drawn icons never flicker. FILL=1 matches
    // the app's Icons.Filled set.
    const KEY_ICON_CSS = "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,1,0";
    const keyIcons = { family: null, have: new Set(), queued: new Set(), inflight: null, seq: 0, failed: false };

    function layoutIconNames(layout) {
        const out = new Set();
        if (layout.showSuggestionBar !== false) {
            barStyle(layout).toolbar.forEach((t) => out.add(TOOLBAR_ICONS[t.type]));
            ["tune", "close"].forEach((n) => out.add(n));
        }
        Object.values(layout.layers || {}).forEach((l) =>
            (l.rows || []).forEach((r) =>
                (r.keys || []).forEach((k) => {
                    const name = resolveIcon(k.iconName, k.label);
                    if (name) out.add(name);
                })
            )
        );
        return out;
    }

    async function loadKeyIconFamily(names) {
        const family = `Noky Key Icons ${++keyIcons.seq}`;
        const resp = await fetch(`${KEY_ICON_CSS}&icon_names=${names.join(",")}&display=block`);
        if (!resp.ok) throw new Error(`icons ${resp.status}`);
        const css = await resp.text();
        const faces = (css.match(/@font-face\s*\{[^}]*\}/g) || []).map((f) => f.replace(/font-family:\s*'[^']*'/, `font-family: '${family}'`));
        if (!faces.length) throw new Error("no icon font");
        const style = document.createElement("style");
        style.dataset.nokyKeyIcons = family;
        style.textContent = faces.join("\n");
        document.head.appendChild(style);
        await document.fonts.load(`24px "${family}"`, names[0]);
        document.querySelectorAll("style[data-noky-key-icons]").forEach((el) => {
            if (el !== style) el.remove();
        });
        keyIcons.family = family;
        keyIcons.have = new Set(names);
    }

    /** Makes sure the given Material Symbols ligatures can be drawn; resolves when they can. */
    function ensureKeyIcons(names) {
        names.forEach((n) => {
            if (!keyIcons.have.has(n)) keyIcons.queued.add(n);
        });
        if (!keyIcons.queued.size || keyIcons.failed) return keyIcons.inflight || Promise.resolve();
        if (!keyIcons.inflight) {
            keyIcons.inflight = (async () => {
                await new Promise((r) => setTimeout(r, 0)); // batch requests from a whole page of keyboards
                while (keyIcons.queued.size) {
                    const all = Array.from(new Set([...keyIcons.have, ...keyIcons.queued])).sort();
                    keyIcons.queued.clear();
                    try {
                        await loadKeyIconFamily(all);
                    } catch (_) {
                        keyIcons.failed = true; // offline: keys fall back to their text labels
                        break;
                    }
                }
                keyIcons.inflight = null;
            })();
        }
        return keyIcons.inflight;
    }

    function ensureFonts(layout) {
        return Promise.all([...layoutFonts(layout).map(ensureFont), ensureKeyIcons(Array.from(layoutIconNames(layout)))]);
    }

    // ── Geometry (DynamicLayoutRenderer) ─────────────────────────────────────
    const isEmptyKey = (k) => (k.action && k.action.type) === "EmptySpace";
    const isOnlyEmptySpaceRow = (row) => row.keys.length > 0 && row.keys.every(isEmptyKey);
    function emptySpaceHeightScale(row) {
        if (!isOnlyEmptySpaceRow(row)) return 1;
        return Math.max(...row.keys.map((k) => (!(k.heightRatio > 0) ? 1 : clamp(k.heightRatio, 0.05, 1))));
    }
    const effectiveRowWeight = (row) => Math.max(sanitizeWeight(row.rowWeight) * emptySpaceHeightScale(row), 0.01);

    function activeLayer(layout, layerId) {
        const layers = layout.layers || {};
        return layers[layerId] || layers.default || Object.values(layers)[0] || null;
    }

    /**
     * Lays out one layer. Returns dp geometry plus the CSS scale.
     * opts: { width (CSS px), layerId, interactive, maxScale, maxHeight (CSS px) }
     */
    function computeModel(layout, opts) {
        const layer = activeLayer(layout, opts.layerId || layout.initialLayer);
        let rows = layer ? layer.rows || [] : [];
        const scrollable = Boolean(layer) && ((layer.scrollable && rows.length > 2) || rows.length > 6);
        if (!opts.interactive && scrollable && rows.length > 4) {
            rows = [rows[0], rows[1], rows[2], rows[rows.length - 1]];
        }

        const mult = num(layout.portraitHeightMultiplier) || SETTINGS.portraitHeightMultiplier;
        let baseH = Math.max(REF_SCREEN.heightDp * mult, SETTINGS.minKeyboardHeightDp);
        if (rows.length && rows.every(isOnlyEmptySpaceRow)) {
            baseH *= clamp(Math.max(...rows.map(emptySpaceHeightScale)), 0.05, 1);
        }

        const pad = SETTINGS.keyPaddingDp;
        const fixedRowH = (layer && num(layer.scrollRowHeightDp)) || 46;
        const useFixedRows = opts.interactive && scrollable;
        const rowHeights = useFixedRows
            ? rows.map((r) => fixedRowH * emptySpaceHeightScale(r))
            : null;
        const heightDp = useFixedRows ? rowHeights.reduce((a, b) => a + b, 0) + pad * 2 : baseH;

        const barDp = opts.showBar === false || layout.showSuggestionBar === false ? 0 : barStyle(layout).height;
        let scale = opts.width / REF_SCREEN.widthDp;
        if (opts.maxScale) scale = Math.min(scale, opts.maxScale);
        const capH = (useFixedRows ? baseH : heightDp) + barDp;
        if (opts.maxHeight && capH * scale > opts.maxHeight) scale = opts.maxHeight / capH;
        const widthDp = opts.width / scale;

        const innerW = widthDp - pad * 2;
        const innerH = heightDp - pad * 2;
        const totalRowWeight = rows.reduce((a, r) => a + effectiveRowWeight(r), 0) || 1;

        const cells = [];
        let y = pad;
        rows.forEach((row, ri) => {
            const rowH = useFixedRows ? rowHeights[ri] : innerH * (effectiveRowWeight(row) / totalRowWeight);
            const totalW = row.keys.reduce((a, k) => a + sanitizeWeight(k.weight), 0) || 1;
            let x = pad;
            row.keys.forEach((key, ki) => {
                const w = innerW * (sanitizeWeight(key.weight) / totalW);
                if (!isEmptyKey(key)) {
                    const style = resolveStyle(key.customStyle, layout.defaultKeyStyle);
                    const ox = clamp(num(style.offsetXDp) || 0, -120, 120);
                    const oy = clamp(num(style.offsetYDp) || 0, -120, 120);
                    const cx = x + ox;
                    const cy = y + oy;
                    const hr = key.heightRatio > 0 ? clamp(key.heightRatio, 0.05, 1) : 1;
                    const inset = Math.max((num(style.paddingDp) ?? SETTINGS.keyPaddingDp) / 2 + Math.max(num(style.marginDp) || 0, 0), 0);
                    const sh = rowH * hr;
                    const sy = cy + (rowH - sh) / 2;
                    cells.push({
                        key,
                        row: ri,
                        col: ki,
                        style,
                        raised: ox !== 0 || oy !== 0,
                        cell: { x: cx, y: cy, w, h: rowH },
                        surface: { x: cx + inset, y: sy + inset, w: Math.max(w - inset * 2, 0), h: Math.max(sh - inset * 2, 0) },
                    });
                }
                x += w;
            });
            y += rowH;
        });

        return { layer, layerId: layer ? layer.id : null, scale, widthDp, heightDp, barDp, cells, scrollable, barHits: [] };
    }

    // ── Shapes (KeyShapes.kt) ────────────────────────────────────────────────
    function shapePath(ctx, shape, x, y, w, h, radiusDp) {
        const m = Math.min(w, h);
        ctx.beginPath();
        switch (shape) {
            case "RECTANGLE":
                ctx.rect(x, y, w, h);
                break;
            case "PILL":
                ctx.roundRect(x, y, w, h, m / 2);
                break;
            case "CIRCLE":
                ctx.arc(x + w / 2, y + h / 2, m / 2, 0, Math.PI * 2);
                break;
            case "SQUIRCLE": {
                const r = clamp(Math.max(radiusDp, 10), m * 0.28, m * 0.48);
                const c = r * 0.15;
                ctx.moveTo(x + r, y);
                ctx.lineTo(x + w - r, y);
                ctx.bezierCurveTo(x + w - c, y, x + w, y + c, x + w, y + r);
                ctx.lineTo(x + w, y + h - r);
                ctx.bezierCurveTo(x + w, y + h - c, x + w - c, y + h, x + w - r, y + h);
                ctx.lineTo(x + r, y + h);
                ctx.bezierCurveTo(x + c, y + h, x, y + h - c, x, y + h - r);
                ctx.lineTo(x, y + r);
                ctx.bezierCurveTo(x, y + c, x + c, y, x + r, y);
                ctx.closePath();
                break;
            }
            case "CUT_CORNERS": {
                const k = Math.min(Math.max(radiusDp, 6), m / 2);
                ctx.moveTo(x + k, y);
                ctx.lineTo(x + w - k, y);
                ctx.lineTo(x + w, y + k);
                ctx.lineTo(x + w, y + h - k);
                ctx.lineTo(x + w - k, y + h);
                ctx.lineTo(x + k, y + h);
                ctx.lineTo(x, y + h - k);
                ctx.lineTo(x, y + k);
                ctx.closePath();
                break;
            }
            case "HEXAGON": {
                const i = Math.min(w * 0.22, h * 0.45);
                ctx.moveTo(x + i, y);
                ctx.lineTo(x + w - i, y);
                ctx.lineTo(x + w, y + h / 2);
                ctx.lineTo(x + w - i, y + h);
                ctx.lineTo(x + i, y + h);
                ctx.lineTo(x, y + h / 2);
                ctx.closePath();
                break;
            }
            case "DIAMOND":
                ctx.moveTo(x + w / 2, y);
                ctx.lineTo(x + w, y + h / 2);
                ctx.lineTo(x + w / 2, y + h);
                ctx.lineTo(x, y + h / 2);
                ctx.closePath();
                break;
            default:
                ctx.roundRect(x, y, w, h, Math.min(Math.max(radiusDp, 0), m / 2));
        }
    }

    function fillBrush(ctx, gradient, solid, alpha, x, y, w, h) {
        const stops = Array.isArray(gradient) ? gradient.map(parseColor).filter(Boolean) : [];
        if (stops.length >= 2) {
            const g = ctx.createLinearGradient(x, y, x + w, y + h);
            stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), rgba(c, alpha)));
            return g;
        }
        return rgba(solid, alpha);
    }

    // ── Text helpers ─────────────────────────────────────────────────────────
    function setFont(ctx, weight, size, family, italic) {
        ctx.font = `${italic ? "italic " : ""}${weight} ${size}px ${family}`;
    }
    function ellipsize(ctx, text, maxW) {
        if (ctx.measureText(text).width <= maxW) return text;
        const chars = Array.from(text);
        while (chars.length > 1) {
            chars.pop();
            const t = chars.join("") + "…";
            if (ctx.measureText(t).width <= maxW) return t;
        }
        return "…";
    }
    function autoSize(ctx, text, weight, family, italic, maxSize, minSize, maxW) {
        let size = maxSize;
        for (; size > minSize; size -= 0.5) {
            setFont(ctx, weight, size, family, italic);
            if (ctx.measureText(text).width <= maxW) return size;
        }
        setFont(ctx, weight, minSize, family, italic);
        return minSize;
    }
    function wrapLines(ctx, text, maxW, maxLines) {
        const words = text.split(/(\s+)/);
        const lines = [];
        let line = "";
        words.forEach((wd) => {
            const test = line + wd;
            if (ctx.measureText(test).width <= maxW || !line) line = test;
            else {
                lines.push(line.trim());
                line = wd.trimStart();
            }
        });
        if (line) lines.push(line.trim());
        // Break single words that are still too wide.
        const out = [];
        lines.forEach((l) => {
            let cur = "";
            Array.from(l).forEach((ch) => {
                if (ctx.measureText(cur + ch).width > maxW && cur) {
                    out.push(cur);
                    cur = ch;
                } else cur += ch;
            });
            if (cur) out.push(cur);
        });
        if (out.length > maxLines) {
            const kept = out.slice(0, maxLines);
            kept[maxLines - 1] = ellipsize(ctx, kept[maxLines - 1] + "…", maxW);
            return kept;
        }
        return out;
    }

    // ── Key drawing (DynamicKeyButton.kt) ────────────────────────────────────
    function modifierStateFor(key, state, layerId) {
        const a = key.action || {};
        if (a.type !== "ToggleModifier") return "INACTIVE";
        if (a.modifier === "FN") return state.modifiers.FN !== "INACTIVE" || layerId === "fn" ? "LOCKED" : "INACTIVE";
        return state.modifiers[a.modifier] || "INACTIVE";
    }

    function drawKey(ctx, model, entry, state, layout) {
        const { key, style: st, surface: r } = entry;
        const label = displayLabel(key, state);
        const iconName = resolveIcon(key.iconName, key.label);
        const special = (key.iconName !== undefined && key.iconName !== null) || (key.label || "").length > 1;
        const mod = modifierStateFor(key, state, model.layerId);

        const keyOpacity = clamp(num(st.opacity) ?? 1, 0.05, 1);
        const bgA = clamp((num(st.backgroundAlpha) ?? 1) * SETTINGS.keyBackgroundAlpha, 0, 1);
        const txA = clamp((num(st.textAlpha) ?? 1) * SETTINGS.keyTextAlpha, 0, 1);

        const bgCol =
            mod === "LOCKED" ? hexColor(THEME.primary)
                : mod === "ONCE" ? hexColor(THEME.primaryContainer)
                    : parseColor(st.backgroundColor) || hexColor(special ? THEME.surfaceVariant : THEME.surface);
        const txCol =
            mod === "LOCKED" ? hexColor(THEME.onPrimary)
                : mod === "ONCE" ? hexColor(THEME.onPrimaryContainer)
                    : parseColor(st.textColor) || hexColor(special ? THEME.onSurfaceVariant : THEME.onSurface);
        const textCss = rgba(txCol, txA);

        const radius = Math.max(num(st.cornerRadiusDp) ?? SETTINGS.cornerRadiusDp, 0);
        const shape = SHAPES.includes(st.shape) ? st.shape : "ROUNDED_RECT";
        const glow = Boolean(st.glowEffect);
        const primary = hexColor(THEME.primary);
        const pressScale = state.pressScale && state.pressScale.get(entry) ? state.pressScale.get(entry) : 1;

        ctx.save();
        ctx.globalAlpha = keyOpacity;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        ctx.translate(cx, cy);
        const rot = num(st.keyRotationDeg) || 0;
        if (rot) ctx.rotate((rot * Math.PI) / 180);
        if (pressScale !== 1) ctx.scale(pressScale, pressScale);
        ctx.translate(-cx, -cy);

        // Elevation / glow shadow
        const elev = Math.max(num(st.elevationDp) ?? SETTINGS.keyElevationDp, 0) + (glow ? 6 : 0);
        shapePath(ctx, shape, r.x, r.y, r.w, r.h, radius);
        const fill = fillBrush(ctx, mod === "INACTIVE" ? st.backgroundGradient : null, bgCol, bgA, r.x, r.y, r.w, r.h);
        if (elev > 0 && bgA > 0.05) {
            ctx.save();
            ctx.shadowColor = glow ? rgba(primary, 0.55) : "rgba(0, 0, 0, 0.32)";
            ctx.shadowBlur = elev * 1.4;
            ctx.shadowOffsetY = glow ? 0 : elev * 0.5;
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.restore();
        } else {
            ctx.fillStyle = fill;
            ctx.fill();
        }

        ctx.save();
        ctx.clip();

        // Border (drawn inside the shape like Compose's Modifier.border)
        const bw = num(st.borderWidthDp);
        if (bw && bw > 0) {
            ctx.lineWidth = bw * 2;
            ctx.strokeStyle = rgba(parseColor(st.borderColor) || primary);
            ctx.stroke();
        } else if (glow) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = rgba(primary, 0.72);
            ctx.stroke();
        }

        const family = fontStack(st.fontFamily || layout.fontFamily);
        const italic = st.fontStyle === "ITALIC";

        // Secondary / corner label
        if (key.secondaryLabel) {
            setFont(ctx, 700, 9, family, false);
            ctx.fillStyle = rgba(txCol, 0.55 * txA);
            ctx.textAlign = "right";
            ctx.textBaseline = "top";
            ctx.fillText(ellipsize(ctx, key.secondaryLabel, r.w - 8), r.x + r.w - 4, r.y + 2);
        }

        // Main content (rotated by contentRotationDeg)
        ctx.save();
        const crot = num(st.contentRotationDeg) || 0;
        if (crot) {
            ctx.translate(cx, cy);
            ctx.rotate((crot * Math.PI) / 180);
            ctx.translate(-cx, -cy);
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const iconReady = iconName && keyIcons.family && keyIcons.have.has(iconName);
        if (iconName && (iconReady || !keyIcons.failed)) {
            const size = clamp(num(st.iconSizeDp) ?? SETTINGS.keyIconSizeDp, 10, 48);
            const tint = parseColor(st.iconTint);
            ctx.fillStyle = tint && mod === "INACTIVE" ? rgba(tint, txA) : textCss;
            if (iconReady) {
                ctx.font = `${size}px "${keyIcons.family}"`;
                ctx.fillText(iconName, cx, cy);
            }
        } else if (key.id === "space" || key.label === "SPACE") {
            setFont(ctx, 500, 12, family, italic);
            ctx.fillStyle = textCss;
            const textH = 14;
            const total = textH + 2 + 1.5;
            const top = cy - total / 2 - 1;
            ctx.fillText(ellipsize(ctx, label, r.w - 4), cx, top + textH / 2);
            ctx.fillStyle = rgba(txCol, 0.6 * txA);
            ctx.fillRect(cx - 30, top + textH + 2, 60, 1.5);
        } else if (label) {
            const emoji = isEmojiLabel(label);
            let size;
            if (emoji && num(st.emojiSizeSp) !== null) size = st.emojiSizeSp;
            else if (num(st.fontSizeSp) !== null) size = st.fontSizeSp;
            else if (emoji) size = SETTINGS.keyEmojiSizeSp;
            else if (label.length > 1 && !key.iconName) size = SETTINGS.keyFontSizeSp * 0.75;
            else size = SETTINGS.keyFontSizeSp;

            const fw = st.fontWeight;
            const weight = fw >= 700 ? 700 : fw === 600 ? 600 : fw === undefined || fw === null ? (special || mod !== "INACTIVE" ? 700 : 500) : 400;
            const maxW = Math.max(r.w - 4, 1);
            ctx.fillStyle = textCss;

            if (key.overflowMode === "SHRINK") {
                autoSize(ctx, label, weight, family, italic, size, 7, maxW);
                ctx.fillText(label, cx, cy);
            } else if (key.overflowMode === "WRAP") {
                setFont(ctx, weight, size, family, italic);
                const lines = wrapLines(ctx, label, maxW, clamp(key.maxLabelLines || 2, 1, 3));
                const lh = size * 1.05;
                const startY = cy - ((lines.length - 1) * lh) / 2;
                lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lh));
            } else if (label.length > 1 && !emoji) {
                autoSize(ctx, label, weight, family, italic, Math.max(size, 9), 9, maxW);
                ctx.fillText(ellipsize(ctx, label, maxW), cx, cy);
            } else {
                setFont(ctx, weight, size, family, italic);
                ctx.fillText(ellipsize(ctx, label, r.w), cx, cy);
            }
        }
        ctx.restore(); // content rotation
        ctx.restore(); // clip
        ctx.restore(); // key transform
    }

    // The app never re-cases labels: Shift switches to the layout's own "shift" layer
    // (KeyboardAppScreen.kt), so a label is always drawn exactly as written.
    function displayLabel(key) {
        return key.label || "";
    }

    // ── Key press popup (KeyPressPreviewOverlay) ─────────────────────────────
    function popupEligible(key, layout) {
        const pop = resolvePopup(key.popupStyle, layout.popupStyle);
        if (pop.enabled === false || !SETTINGS.keyPressPopupEnabled) return false;
        if (key.id === "space" || String(key.label).toUpperCase() === "SPACE") return false;
        const a = key.action || {};
        const icon = resolveIcon(key.iconName, key.label);
        return (!icon || (key.popupStyle && key.popupStyle.enabled === true)) && Boolean((key.label || "").trim()) && (a.type === "CommitText" || a.type === "MultiTap");
    }

    function drawPopup(ctx, model, entry, state, layout) {
        const pop = resolvePopup(entry.key.popupStyle, layout.popupStyle);
        const label = state.popupLabel || displayLabel(entry.key, state);
        const widthScale = clamp(num(pop.widthScale) ?? SETTINGS.keyPopupWidthScale, 0.8, 2);
        const sf = widthScale / 1.18;
        const minW = clamp((label.length > 1 ? 56 : 46) * sf, 32, 110);
        const maxW = clamp(78 * sf, 48, 140);
        const h = clamp(num(pop.heightDp) ?? SETTINGS.keyPopupHeightDp, 36, 90);
        const w = clamp(entry.cell.w * widthScale, minW, maxW);
        const gap = clamp(num(pop.offsetYDp) ?? SETTINGS.keyPopupOffsetYDp, 0, 32);
        const left = clamp(entry.cell.x + entry.cell.w / 2 - w / 2, 4, Math.max(model.widthDp - w - 4, 4));
        const top = Math.max(entry.cell.y - h - gap, 4 - (model.barDp || 0));
        const radius = clamp(num(pop.cornerRadiusDp) ?? SETTINGS.keyPopupCornerRadiusDp, 0, 28);
        const shape = SHAPES.includes(pop.shape) ? pop.shape : SETTINGS.keyPopupShape;
        const bgA = clamp(num(pop.bgAlpha) ?? SETTINGS.keyPopupBgAlpha, 0.1, 1);
        const bg = parseColor(pop.bgColor) || hexColor(THEME.surfaceContainerHighest);
        const hasGrad = Array.isArray(pop.bgGradient) && pop.bgGradient.length >= 2;
        const fg = parseColor(pop.textColor) || (hasGrad ? hexColor("#FFFFFF") : hexColor(THEME.onSurface));
        const elev = clamp(num(pop.elevationDp) ?? SETTINGS.keyPopupElevationDp, 0, 16);

        ctx.save();
        ctx.globalAlpha = clamp(num(pop.opacity) ?? 1, 0.1, 1);
        shapePath(ctx, shape, left, top, w, h, radius);
        ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
        ctx.shadowBlur = elev * 1.6;
        ctx.shadowOffsetY = elev * 0.5;
        ctx.fillStyle = fillBrush(ctx, pop.bgGradient, bg, bgA, left, top, w, h);
        ctx.fill();
        ctx.shadowColor = "transparent";
        if ((num(pop.borderWidthDp) || 0) > 0 || pop.borderEnabled) {
            ctx.save();
            ctx.clip();
            ctx.lineWidth = (num(pop.borderWidthDp) || 1) * 2;
            ctx.strokeStyle = rgba(parseColor(pop.borderColor) || hexColor(THEME.primary), parseColor(pop.borderColor) ? undefined : 0.45 * bgA);
            ctx.stroke();
            ctx.restore();
        }
        const emoji = isEmojiLabel(label);
        let fs = clamp(emoji && num(pop.emojiSizeSp) !== null ? pop.emojiSizeSp : num(pop.fontSizeSp) ?? SETTINGS.keyPopupFontSizeSp, 14, 42);
        if (label.length > 1 && !emoji) fs = clamp(fs * 0.75, 12, 32);
        setFont(ctx, 700, fs, fontStack(entry.style.fontFamily || layout.fontFamily), false);
        ctx.fillStyle = rgba(fg);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ellipsize(ctx, label, w - 6), left + w / 2, top + h / 2);
        ctx.restore();
    }


    // ── Suggestion bar (ui/SuggestionBar.kt, model/ToolbarModels.kt) ─────────
    const DEFAULT_TOOLBAR = ["SETTINGS", "IME_PICKER", "CLIPBOARD", "COLLAPSE_TO_STRAP", "NEXT_KEYBOARD", "CURSOR_LEFT", "CURSOR_RIGHT", "COPY", "PASTE", "HIDE_KEYBOARD"];
    const TOOLBAR_ICONS = {
        SETTINGS: "settings", IME_PICKER: "language", CLIPBOARD: "content_paste", COLLAPSE_TO_STRAP: "keyboard_hide",
        NEXT_KEYBOARD: "view_agenda", SPECIFIC_KEYBOARD: "keyboard", CURSOR_LEFT: "keyboard_arrow_left",
        CURSOR_RIGHT: "keyboard_arrow_right", UNDO: "undo", REDO: "redo", SELECT_ALL: "select_all", COPY: "content_copy",
        PASTE: "content_paste_go", EMOJI: "emoji_emotions", HIDE_KEYBOARD: "keyboard_arrow_down", VOICE_INPUT: "mic",
    };
    const TOOLBAR_ALIASES = { IME: "IME_PICKER", NO_KEYBOARD: "COLLAPSE_TO_STRAP", LAYOUT_SWITCH: "NEXT_KEYBOARD" };

    /** ToolbarItemSpec.parse */
    function parseToolbarToken(token) {
        if (typeof token !== "string" || !token.trim()) return null;
        const t = token.trim();
        const i = t.indexOf(":");
        let type = (i >= 0 ? t.slice(0, i) : t).trim().toUpperCase();
        type = TOOLBAR_ALIASES[type] || type;
        if (!TOOLBAR_ICONS[type]) return null;
        const arg = i >= 0 ? t.slice(i + 1).trim() || null : null;
        return { type, target: type === "SPECIFIC_KEYBOARD" ? arg : null, token: t };
    }

    /** SuggestionBarStyleConfig.resolveWithFallback over the app's default settings. */
    function barStyle(layout) {
        const b = layout.suggestionBarStyle || {};
        const parsed = (Array.isArray(b.toolbarItems) && b.toolbarItems.length ? b.toolbarItems : DEFAULT_TOOLBAR).map(parseToolbarToken).filter(Boolean);
        return {
            raw: b,
            height: clamp(num(b.heightDp) ?? 46, 32, 72),
            textSize: clamp(num(b.textSizeSp) ?? 14, 10, 24),
            radius: clamp(num(b.cornerRadiusDp) ?? 8, 0, 28),
            useKeyboardFont: b.useKeyboardFont !== false,
            maxSuggestions: clamp(Math.trunc(num(b.maxSuggestions) ?? 3), 1, 5),
            showToolsToggle: b.showToolsToggle !== false,
            toolbar: parsed.length ? parsed : DEFAULT_TOOLBAR.map(parseToolbarToken),
        };
    }

    function drawBarIcon(ctx, name, cx, cy, size, color) {
        if (!keyIcons.family || !keyIcons.have.has(name)) return;
        ctx.font = `${size}px "${keyIcons.family}"`;
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(name, cx, cy);
    }

    /**
     * state.bar: { composing, suggestions: [], toolsOpen }.
     * With nothing being typed the app shows the toolbar; while typing it shows word chips.
     */
    function drawSuggestionBar(ctx, model, layout, state) {
        const H = model.barDp;
        const W = model.widthDp;
        const st = barStyle(layout);
        const b = st.raw;
        const hits = [];
        const bar = state.bar || {};
        const composing = bar.composing || "";
        const suggestions = bar.suggestions || [];
        const hasSuggestions = composing.length > 0 || suggestions.length > 0;

        // Background (keeps each colour's own alpha × keyboard alpha)
        const bgSolid = parseColor(b.backgroundColor);
        const grad = Array.isArray(b.backgroundGradient) ? b.backgroundGradient.map(parseColor).filter(Boolean) : [];
        if (grad.length >= 2) {
            const g = ctx.createLinearGradient(0, 0, W, H);
            grad.forEach((c, i) => g.addColorStop(i / (grad.length - 1), rgba(c, c.a * SETTINGS.keyboardBackgroundAlpha)));
            ctx.fillStyle = g;
        } else if (bgSolid) {
            ctx.fillStyle = rgba(bgSolid, bgSolid.a * SETTINGS.keyboardBackgroundAlpha);
        } else {
            ctx.fillStyle = THEME.surfaceContainer;
        }
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
        ctx.fillRect(0, H - 0.5, W, 0.5);

        const iconTint = parseColor(b.iconColor) ? rgba(parseColor(b.iconColor)) : rgba(hexColor(THEME.onSurfaceVariant), 0.7);
        const accentTint = parseColor(b.iconColor) ? rgba(parseColor(b.iconColor)) : THEME.primary;
        const family = st.useKeyboardFont ? fontStack(layout.fontFamily) : fontStack(null);

        if (!hasSuggestions || bar.toolsOpen) {
            // Toolbar row: 36dp buttons, 4dp apart; two trailing arrows are pinned right (3..7 items).
            const specs = st.toolbar;
            const isArrow = (t) => t.type === "CURSOR_LEFT" || t.type === "CURSOR_RIGHT";
            const split = specs.length >= 3 && specs.length <= 7 && specs.slice(-2).every(isArrow);
            const lead = split ? specs.slice(0, -2) : specs;
            const trail = split ? specs.slice(-2) : [];
            const cy = H / 2;
            let x = 8;
            const button = (name, tint, size, hit) => {
                if (x + 36 > W - 8 - trail.length * 40) return; // overflow scrolls in the app; clip here
                drawBarIcon(ctx, name, x + 18, cy, size, tint);
                hits.push(Object.assign({ x, y: cy - 18, w: 36, h: 36 }, hit));
                x += 40;
            };
            if (hasSuggestions) button("close", accentTint, 18, { kind: "closeTools" });
            lead.forEach((t) => button(TOOLBAR_ICONS[t.type], iconTint, isArrow(t) ? 20 : 18, { kind: "tool", tool: t }));
            let tx = W - 8 - trail.length * 40 + 4;
            trail.forEach((t) => {
                drawBarIcon(ctx, TOOLBAR_ICONS[t.type], tx + 18, cy, 20, iconTint);
                hits.push({ x: tx, y: cy - 18, w: 36, h: 36, kind: "tool", tool: t });
                tx += 40;
            });
        } else {
            // Word chips: padding 6/4, 6dp gaps, centre (or exact match) chip highlighted.
            let x = 6;
            const top = 4;
            const chipH = H - 8;
            if (st.showToolsToggle) {
                drawBarIcon(ctx, "tune", x + 18, H / 2, 18, accentTint);
                hits.push({ x, y: H / 2 - 18, w: 36, h: 36, kind: "openTools" });
                x += 36 + 6;
            }
            const slots = suggestions.slice(0, st.maxSuggestions);
            while (slots.length < st.maxSuggestions) slots.push("");
            const exact = composing ? slots.findIndex((w) => w && w.toLowerCase() === composing.toLowerCase()) : -1;
            const nonEmpty = slots.filter(Boolean).length;
            const chipW = (W - 6 - x - 6 * (slots.length - 1)) / slots.length;
            const normalBg = parseColor(b.chipColor);
            const hiBg = parseColor(b.highlightedChipColor);
            const txt = parseColor(b.textColor);
            slots.forEach((word, i) => {
                const cx0 = x + i * (chipW + 6);
                if (!word) return;
                const centre = exact >= 0 ? i === exact : i === 1 || (nonEmpty === 1 && i === 0);
                const gradStops = (centre ? b.highlightedChipGradient : b.chipGradient) || null;
                const solid = centre ? hiBg || hexColor(THEME.primaryContainer) : normalBg || null;
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(cx0, top, chipW, chipH, Math.min(st.radius, chipH / 2));
                const stops = Array.isArray(gradStops) ? gradStops.map(parseColor).filter(Boolean) : [];
                if (stops.length >= 2) {
                    const g = ctx.createLinearGradient(cx0, top, cx0 + chipW, top + chipH);
                    stops.forEach((c, k) => g.addColorStop(k / (stops.length - 1), rgba(c)));
                    ctx.fillStyle = g;
                } else {
                    ctx.fillStyle = solid ? rgba(solid) : rgba(hexColor(THEME.surfaceContainerHigh), 0.5);
                }
                ctx.fill();
                ctx.clip();
                ctx.fillStyle = txt ? rgba(txt) : centre ? THEME.onPrimaryContainer : THEME.onSurface;
                setFont(ctx, centre ? 700 : 500, st.textSize, family, false);
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(ellipsize(ctx, word, chipW - 8), cx0 + chipW / 2, top + chipH / 2);
                ctx.restore();
                hits.push({ x: cx0, y: top, w: chipW, h: chipH, kind: "chip", word });
            });
        }
        model.barHits = hits;
    }

    // ── Public draw ──────────────────────────────────────────────────────────
    /**
     * Draws `layout` into `canvas`. Returns the model (dp geometry + scale) for hit testing.
     * opts: { width, layerId, interactive, maxScale, maxHeight, state }
     * state: { modifiers: {SHIFT, CTRL, ALT, META, FN}, pressScale: Map(entry→scale), popup: entry, popupLabel, selected: entry }
     */
    function draw(canvas, layout, opts) {
        const model = computeModel(layout, opts);
        const state = Object.assign({ modifiers: {}, pressScale: null, popup: null, selected: null, bar: null }, opts.state || {});
        const head = model.barDp || 0;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const cssW = opts.width;
        const cssH = (model.heightDp + head) * model.scale;
        const pw = Math.round(cssW * dpr);
        const ph = Math.round(cssH * dpr);
        if (canvas.width !== pw) canvas.width = pw;
        if (canvas.height !== ph) canvas.height = ph;
        canvas.style.width = cssW + "px";
        canvas.style.height = cssH + "px";

        const ctx = canvas.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, pw, ph);
        ctx.scale(dpr * model.scale, dpr * model.scale);
        ctx.translate(0, head);

        // Keyboard canvas background (KeyboardAppScreen canvasBgModifier)
        const bgSolid = parseColor(layout.backgroundColor) || hexColor(THEME.background);
        ctx.fillStyle = fillBrush(ctx, layout.backgroundGradient, bgSolid, SETTINGS.keyboardBackgroundAlpha, 0, 0, model.widthDp, model.heightDp);
        ctx.fillRect(0, -head, model.widthDp, model.heightDp + head);

        if (head) {
            ctx.save();
            ctx.translate(0, -head);
            drawSuggestionBar(ctx, model, layout, state);
            ctx.restore();
        }

        // Normal keys first, offset keys above them (zIndex 1)
        model.cells.filter((c) => !c.raised).forEach((c) => drawKey(ctx, model, c, state, layout));
        model.cells.filter((c) => c.raised).forEach((c) => drawKey(ctx, model, c, state, layout));

        if (state.selected) {
            const r = state.selected.surface;
            ctx.save();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "rgba(167, 139, 250, 0.95)";
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
            ctx.restore();
        }
        if (state.popup) drawPopup(ctx, model, state.popup, state, layout);

        return model;
    }

    /** Topmost key under a CSS-pixel point (touch area = full cell, like the app). */
    function hitTest(model, xCss, yCss) {
        const x = xCss / model.scale;
        const yAll = yCss / model.scale;
        if (yAll < (model.barDp || 0)) {
            const h = (model.barHits || []).find((r) => x >= r.x && x < r.x + r.w && yAll >= r.y && yAll < r.y + r.h);
            return h ? Object.assign({ bar: true }, h) : null;
        }
        const y = yAll - (model.barDp || 0);
        const inside = (c) => x >= c.cell.x && x < c.cell.x + c.cell.w && y >= c.cell.y && y < c.cell.y + c.cell.h;
        const raised = model.cells.filter((c) => c.raised).reverse().find(inside);
        return raised || model.cells.filter((c) => !c.raised).find(inside) || null;
    }

    global.NokyRenderer = {
        THEME,
        SETTINGS,
        normalize,
        computeModel,
        draw,
        hitTest,
        ensureFonts,
        ensureKeyIcons,
        layoutIconNames,
        barStyle,
        popupEligible,
        resolveIcon,
        resolveStyle,
        displayLabel,
    };
})(window);
