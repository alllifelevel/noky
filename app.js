(function () {
    "use strict";

    const GITHUB_REPO = "https://github.com/alllifelevel/noky";
    const R = window.NokyRenderer;

    let catalog = window.NOKY_CATALOG_DATA || { keyboards: [], dictionaries: [] };
    let activeKbdCategory = "ALL";
    let kbdSearchQuery = "";
    let activeDictCategory = "ALL";

    let currentPreviewKeyboard = null;
    let lastInspectedEntry = null;
    let lastFocusedBeforeModal = null;
    let stage = null;
    let sheetPushed = false;
    let kbdSort = "popular";
    const S = window.NokyStats || { enabled: false, get: () => ({ downloads: 0, likes: 0 }), score: () => 0, onChange() {}, load: async () => {}, download() {}, isLiked: () => false, toggleLike: () => false, format: String };

    const CATEGORY_STYLE = {
        "Aesthetic": { tray: "cat-aesthetic", icon: "c-pink", glyph: "auto_awesome" },
        "Coding & Dev": { tray: "cat-code", icon: "c-ink", glyph: "terminal" },
        "Custom Shapes": { tray: "cat-shapes", icon: "c-purple", glyph: "hexagon" },
        "Ergonomic & Split": { tray: "cat-ergo", icon: "c-blue", glyph: "back_hand" },
        "Gaming & Macros": { tray: "cat-macro", icon: "c-pink", glyph: "bolt" },
        "STEM & Math": { tray: "cat-stem", icon: "c-amber", glyph: "function" },
    };
    const DEFAULT_STYLE = { tray: "cat-other", icon: "c-purple", glyph: "keyboard" };
    const DICT_COLORS = ["c-blue", "c-pink", "c-purple", "c-green", "c-amber"];

    function brandName(name) {
        return name === "AllStudio" ? "ALLStudio" : name;
    }

    function catStyle(category) {
        return CATEGORY_STYLE[category] || DEFAULT_STYLE;
    }

    function formatBytes(bytes) {
        if (!bytes) return "0 KB";
        if (bytes < 1024) return bytes + " B";
        return (bytes / 1024).toFixed(1) + " KB";
    }

    function escapeHtml(str) {
        return String(str ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    // ── Toasts ───────────────────────────────────────────────────────────────
    let toastTimer = 0;
    function toast(message, icon) {
        const el = document.getElementById("toast");
        if (!el) return;
        el.innerHTML = `<span class="material-symbols-rounded">${icon || "check_circle"}</span><span>${escapeHtml(message)}</span>`;
        el.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
    }

    async function copyText(text, message) {
        try {
            await navigator.clipboard.writeText(text);
            toast(message || "Copied to clipboard");
        } catch (_) {
            toast("Couldn't copy — select and copy it manually", "error");
        }
    }

    // ── Hero mini keyboards (decorative) ─────────────────────────────────────
    function buildMiniKeyboards() {
        const rows = [
            ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
            ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
            ["⇧:w", "z", "x", "c", "v", "b", "n", "m", "⌫:w"],
            ["?123:w", "</>", ":sp", ".", "⏎:w hot"],
        ];
        document.querySelectorAll("[data-mini]").forEach((el) => {
            el.innerHTML = rows
                .map((row, i) => {
                    const keys = row
                        .map((k) => {
                            const [label, cls] = k.split(":");
                            return `<i${cls ? ` class="${cls}"` : ""}>${escapeHtml(label)}</i>`;
                        })
                        .join("");
                    return `<div class="r${i === 1 ? " p" : ""}">${keys}</div>`;
                })
                .join("");
        });
    }

    // ── Catalog helpers ──────────────────────────────────────────────────────
    function layoutOf(kbd) {
        if (kbd._layout === undefined) {
            try {
                kbd._layout = R.normalize(kbd.previewLayout);
            } catch (err) {
                kbd._layout = null;
                kbd._layoutError = err.message;
            }
        }
        return kbd._layout;
    }

    function findKeyboard(id) {
        return (catalog.keyboards || []).find((k) => k.id === id);
    }

    function verifiedMark(kbd) {
        return kbd.official
            ? `<span class="material-symbols-rounded filled verified" title="Official ALLStudio package">verified</span>`
            : "";
    }

    // ── Thumbnails (same renderer as the app) ────────────────────────────────
    function paintThumbnails(root) {
        (root || document).querySelectorAll("canvas[data-thumb-id]").forEach((canvas) => {
            const kbd = findKeyboard(canvas.getAttribute("data-thumb-id"));
            const layout = kbd && layoutOf(kbd);
            const box = canvas.parentElement;
            if (!layout || !box) return;
            const cs = getComputedStyle(box);
            const width = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            if (width > 0) R.draw(canvas, layout, { width, interactive: false });
        });
    }

    // ── Featured rail ────────────────────────────────────────────────────────
    function renderFeatured() {
        const rail = document.getElementById("featuredRail");
        if (!rail) return;
        const featured = (catalog.keyboards || []).filter((k) => k.featured).slice(0, 3);
        const list = featured.length ? featured : (catalog.keyboards || []).slice(0, 3);
        rail.innerHTML = list
            .map((kbd) => {
                const s = catStyle(kbd.category);
                return `
                <article class="feature-card" data-open-id="${escapeHtml(kbd.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(kbd.name)}">
                    <div class="tray ${s.tray}"><canvas data-thumb-id="${escapeHtml(kbd.id)}" aria-hidden="true"></canvas></div>
                    <div class="fc-body">
                        <div class="fc-text">
                            <div class="eyebrow">${escapeHtml(kbd.category)}</div>
                            <h3>${escapeHtml(kbd.name)}</h3>
                            <p>${escapeHtml(kbd.description)}</p>
                        </div>
                        <a class="get-btn" href="${escapeHtml(kbd.downloadUrl)}" download="${escapeHtml(kbd.fileName)}" data-stop data-dl="${escapeHtml(kbd.fileName)}" data-kind="keyboard" data-id="${escapeHtml(kbd.id)}">Get</a>
                    </div>
                </article>`;
            })
            .join("");
        bindOpeners(rail);
        paintThumbnails(rail);
    }

    // ── Keyboards grid ───────────────────────────────────────────────────────
    function filteredKeyboards() {
        const q = kbdSearchQuery.trim().toLowerCase();
        const list = (catalog.keyboards || []).filter((kbd) => {
            if (activeKbdCategory !== "ALL" && kbd.category !== activeKbdCategory) return false;
            if (!q) return true;
            const hay = [kbd.id, kbd.name, kbd.author, kbd.description, kbd.category, ...(kbd.tags || []), ...(kbd.shapesUsed || [])]
                .join(" ")
                .toLowerCase();
            return hay.includes(q);
        });
        return sortKeyboards(list, kbdSort);
    }

    function sortKeyboards(list, mode) {
        const order = new Map((catalog.keyboards || []).map((k, i) => [k.id, i]));
        const byOrder = (a, b) => order.get(a.id) - order.get(b.id);
        const out = list.slice();
        if (mode === "name") return out.sort((a, b) => a.name.localeCompare(b.name));
        if (!S.enabled) return out.sort(byOrder);
        if (mode === "liked") return out.sort((a, b) => S.get("keyboard", b.id).likes - S.get("keyboard", a.id).likes || byOrder(a, b));
        return out.sort((a, b) => S.score(b.id) - S.score(a.id) || byOrder(a, b));
    }

    function statBits(kind, id) {
        if (!S.enabled) return "";
        const st = S.get(kind, id);
        // A brand-new item showing "0 downloads" reads badly; only show counts once there are some.
        if (!st.downloads && !st.likes && !(kind === "keyboard" && S.isLiked(id))) return "";
        const likes = kind === "keyboard" ? ` <span class="mstat${S.isLiked(id) ? " liked" : ""}"><span class="material-symbols-rounded filled">favorite</span>${S.format(st.likes)}</span>` : "";
        return ` <span class="mstat"><span class="material-symbols-rounded">download</span>${S.format(st.downloads)}</span>${likes}`;
    }

    function renderKeyboardsGrid() {
        const grid = document.getElementById("keyboardsGrid");
        if (!grid) return;
        const q = kbdSearchQuery.trim();
        const filtered = filteredKeyboards();
        setText("kbdResultCount", filtered.length === 1 ? "1 keyboard" : `${filtered.length} keyboards`);

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="empty">
                    <span class="material-symbols-rounded">search_off</span>
                    <strong>No keyboards match${q ? ` “${escapeHtml(q)}”` : ""}</strong>
                    <p>Try another search, or ask the community to build it.</p>
                    <a href="#create" class="btn btn-ink btn-sm" data-goto-pane="request">Request a layout</a>
                </div>`;
            bindPaneLinks(grid);
            return;
        }

        grid.innerHTML = filtered.map(tileHtml).join("");

        bindOpeners(grid);
        paintThumbnails(grid);
    }

    function tileHtml(kbd) {
            const s = catStyle(kbd.category);
            return `
            <article class="kbd-tile" data-open-id="${escapeHtml(kbd.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(kbd.name)}">
                <div class="tray ${s.tray}"><canvas data-thumb-id="${escapeHtml(kbd.id)}" aria-hidden="true"></canvas></div>
                <div class="tile-body">
                    <div class="tile-text">
                        <h3>${escapeHtml(kbd.name)}</h3>
                        <div class="tile-meta">${escapeHtml(brandName(kbd.author))} ${verifiedMark(kbd)}</div>
                        <div class="tile-meta">${statBits("keyboard", kbd.id) || `${escapeHtml(kbd.category)} · ${formatBytes(kbd.fileSize)}`}</div>
                    </div>
                    <a class="get-btn" href="${escapeHtml(kbd.downloadUrl)}" download="${escapeHtml(kbd.fileName)}" data-stop data-dl="${escapeHtml(kbd.fileName)}" data-kind="keyboard" data-id="${escapeHtml(kbd.id)}">Get</a>
                </div>
            </article>`;
    }

    // Home page: most popular (or, without stats, the keyboards that aren't featured).
    function renderPopular() {
        const grid = document.getElementById("popularGrid");
        if (!grid) return;
        const all = catalog.keyboards || [];
        const list = S.enabled ? sortKeyboards(all, "popular").slice(0, 6) : all.filter((k) => !k.featured).slice(0, 6);
        const sec = grid.closest("section");
        if (sec && !S.enabled) {
            const h = sec.querySelector("h2");
            const p = sec.querySelector(".section-head p");
            if (h) h.textContent = "More keyboards";
            if (p) p.textContent = "Fresh layouts to try live";
        }
        grid.innerHTML = list.map(tileHtml).join("");
        bindOpeners(grid);
        paintThumbnails(grid);
    }

    function bindDownloadFeedback(root) {
        root.querySelectorAll("[data-dl]").forEach((a) =>
            a.addEventListener("click", () => {
                S.download(a.dataset.kind || "keyboard", a.dataset.id);
                toast(`Downloading ${a.getAttribute("data-dl")} — open it on your phone to install`, "download_done");
            })
        );
    }

    function bindOpeners(root) {
        root.querySelectorAll("[data-stop]").forEach((a) => a.addEventListener("click", (e) => e.stopPropagation()));
        bindDownloadFeedback(root);
        root.querySelectorAll("[data-open-id]").forEach((el) => {
            const open = () => {
                const kbd = findKeyboard(el.getAttribute("data-open-id"));
                if (kbd) openPreviewModal(kbd, { push: true });
            };
            el.addEventListener("click", open);
            el.addEventListener("keydown", (e) => {
                if ((e.key === "Enter" || e.key === " ") && e.target === el) {
                    e.preventDefault();
                    open();
                }
            });
        });
    }

    // ── Dictionaries ─────────────────────────────────────────────────────────
    function renderDictionariesGrid() {
        const grid = document.getElementById("dictionariesGrid");
        if (!grid) return;

        const filtered = (catalog.dictionaries || []).filter(
            (d) => activeDictCategory === "ALL" || d.category === activeDictCategory
        );

        const limit = Number(grid.dataset.limit) || 0;
        grid.innerHTML = (limit ? filtered.slice(0, limit) : filtered)
            .map((dict, i) => {
                const color = dict.category === "SPECIALTY" ? "c-ink" : DICT_COLORS[i % DICT_COLORS.length];
                const sample = (dict.sampleWords || [])
                    .slice(0, 5)
                    .map((w) => String(w).split("=")[0])
                    .join(" · ");
                return `
                <article class="dict-tile">
                    <span class="squircle ${color}${String(dict.code).length > 2 ? " long" : ""}">${escapeHtml(dict.code)}</span>
                    <div class="tile-text">
                        <h3>${escapeHtml(dict.displayName)}</h3>
                        <div class="dmeta">${Number(dict.wordCount).toLocaleString()} words · ${formatBytes(dict.fileSize)}${statBits("dictionary", dict.code)}</div>
                        <div class="dsample">${escapeHtml(sample)}</div>
                    </div>
                    <a class="get-btn" href="${escapeHtml(dict.downloadUrl)}" download="${escapeHtml(dict.fileName)}" data-dl="${escapeHtml(dict.fileName)}" data-kind="dictionary" data-id="${escapeHtml(dict.code)}" aria-label="Download ${escapeHtml(dict.displayName)}">Get</a>
                </article>`;
            })
            .join("");
        bindDownloadFeedback(grid);
    }

    // ── Interactive keyboard stage ───────────────────────────────────────────
    const KEYCODE_NAMES = { 111: "Esc", 112: "Del", 122: "Home", 123: "End", 92: "PgUp", 93: "PgDn", 19: "↑", 20: "↓", 21: "←", 22: "→" };
    const CURSOR_NAMES = { "-1": "←", "1": "→", "-2": "↑", "2": "↓" };

    const COMMON_WORDS = ("the be to of and a in that have it for not on with he as you do at this but his by from they we say her she or " +
        "an will my one all would there their what so up out if about who get which go me when make can like time no just him know " +
        "take people into year your good some could them see other than then now look only come its over think also back after use " +
        "two how our work first well way even new want because any these give day most us hello thanks thank please great awesome " +
        "keyboard keys layout typing tomorrow today tonight later love nice cool sure okay yes maybe really right before after where why").split(" ");
    const TOOL_NOTES = {
        SETTINGS: "Opens Noky settings", IME_PICKER: "Keyboard picker", CLIPBOARD: "Opens the clipboard",
        COLLAPSE_TO_STRAP: "Collapses to the no-keyboard strap", NEXT_KEYBOARD: "Next keyboard", CURSOR_LEFT: "Cursor ←",
        CURSOR_RIGHT: "Cursor →", UNDO: "Undo", REDO: "Redo", SELECT_ALL: "Select all", COPY: "Copy", PASTE: "Paste",
        EMOJI: "Emoji keyboard", HIDE_KEYBOARD: "Hides the keyboard", VOICE_INPUT: "Voice input",
    };

    function createStage(canvas, layout, hooks) {
        const st = {
            modifiers: { SHIFT: "INACTIVE", CTRL: "INACTIVE", ALT: "INACTIVE", META: "INACTIVE", FN: "INACTIVE" },
            pressScale: new Map(),
            popup: null,
            popupLabel: null,
            selected: null,
            bar: { composing: "", suggestions: [], toolsOpen: false },
        };
        let layerId = layout.initialLayer;
        const history = [];
        let model = null;
        let pressed = null;
        let longTimer = 0;
        let repeatTimer = 0;
        let popupTimer = 0;
        let longFired = false;
        let repeated = false;
        let buffer = "";
        let multi = { id: null, idx: 0, t: 0 };

        function render() {
            const box = canvas.parentElement;
            const width = box.clientWidth;
            if (!width) return;
            model = R.draw(canvas, layout, {
                width,
                layerId,
                interactive: true,
                maxScale: 1.6,
                maxHeight: Math.min(460, window.innerHeight * 0.52),
                state: st,
            });
        }

        function animatePress(entry, to) {
            const from = st.pressScale.get(entry) ?? 1;
            if (!R.SETTINGS.keyPressAnimation || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            const t0 = performance.now();
            const step = (now) => {
                const p = Math.min((now - t0) / 80, 1);
                const v = from + (to - from) * p;
                if (v === 1) st.pressScale.delete(entry);
                else st.pressScale.set(entry, v);
                render();
                if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        }

        // Suggestion bar: word chips while a word is being typed, the toolbar otherwise.
        const barCfg = R.barStyle(layout);
        const wordList = Array.from(new Set([...(layout.customKeywords || []), ...COMMON_WORDS]));
        function suggest(prefix) {
            const p = prefix.toLowerCase();
            const hits = wordList.filter((w) => w.toLowerCase().startsWith(p) && w.toLowerCase() !== p).sort((a, b) => a.length - b.length);
            // A real word you've finished typing is offered (and highlighted) as-is; otherwise the best
            // completion sits in the highlighted middle chip, like the app.
            const exact = wordList.some((w) => w.toLowerCase() === p) ? [prefix] : [];
            const best = [...exact, ...hits].slice(0, barCfg.maxSuggestions);
            if (!exact.length && best.length >= 2) [best[0], best[1]] = [best[1], best[0]];
            return best.length ? best : [prefix];
        }
        function updateBar() {
            const m = buffer.match(/[\p{L}\p{N}_'-]+$/u);
            st.bar.composing = m ? m[0] : "";
            st.bar.suggestions = st.bar.composing ? suggest(st.bar.composing) : [];
            if (!st.bar.composing) st.bar.toolsOpen = false;
        }

        function emit(note) {
            updateBar();
            hooks.onBuffer(buffer, note);
        }

        function barTap(hit) {
            if (hit.kind === "chip") {
                buffer = buffer.slice(0, buffer.length - st.bar.composing.length) + hit.word + " ";
                emit();
            } else if (hit.kind === "openTools") {
                st.bar.toolsOpen = true;
            } else if (hit.kind === "closeTools") {
                st.bar.toolsOpen = false;
            } else if (hit.kind === "tool") {
                const t = hit.tool;
                const target = t.target ? t.target.replace(/^preset_/, "").replace(/_/g, " ") : "";
                emit(t.type === "SPECIFIC_KEYBOARD" ? `Opens the ${target.replace(/\b\w/g, (c) => c.toUpperCase())} keyboard` : TOOL_NOTES[t.type] || t.type);
            }
            render();
        }

        function consumeOnce() {
            ["SHIFT", "CTRL", "ALT", "META"].forEach((m) => {
                if (st.modifiers[m] === "ONCE") st.modifiers[m] = "INACTIVE";
            });
        }

        function commit(text) {
            const ctrl = st.modifiers.CTRL !== "INACTIVE";
            const alt = st.modifiers.ALT !== "INACTIVE";
            if (ctrl || alt) {
                const combo = `${ctrl ? "Ctrl+" : ""}${alt ? "Alt+" : ""}${text.toUpperCase()}`;
                consumeOnce();
                emit(combo);
                return;
            }
            buffer += text;
            consumeOnce();
            syncShiftLayer();
            emit();
        }

        // Mirrors KeyboardAppScreen.kt: Shift flips between the "default" and "shift" layers
        // when the layout has a "shift" layer; otherwise it is only a modifier.
        function syncShiftLayer() {
            if (!layout.layers.shift) return;
            const on = st.modifiers.SHIFT !== "INACTIVE";
            if (on && layerId === "default") {
                layerId = "shift";
                hooks.onLayer(layerId);
            } else if (!on && layerId === "shift") {
                layerId = "default";
                hooks.onLayer(layerId);
            }
        }

        function setLayer(id, remember) {
            if (!layout.layers[id] || id === layerId) return;
            if (remember) history.push(layerId);
            layerId = id;
            st.selected = null;
            hooks.onLayer(layerId);
        }

        function fire(entry, actionOverride) {
            const key = entry.key;
            const a = actionOverride || key.action || { type: "CommitText", text: key.label };
            switch (a.type) {
                case "CommitText":
                    commit(a.text !== undefined ? a.text : key.label || "");
                    break;
                case "MultiTap": {
                    const seq = a.sequence || [];
                    if (!seq.length) break;
                    const now = performance.now();
                    if (multi.id === key.id && now - multi.t < 900) {
                        multi.idx = (multi.idx + 1) % seq.length;
                        buffer = buffer.slice(0, -Array.from(seq[(multi.idx - 1 + seq.length) % seq.length]).length) + seq[multi.idx];
                        emit();
                    } else {
                        multi = { id: key.id, idx: 0, t: now };
                        commit(seq[0]);
                    }
                    multi.t = now;
                    break;
                }
                case "KeyCode":
                    if (a.keyCode === 67) {
                        buffer = Array.from(buffer).slice(0, -1).join("");
                        emit();
                    } else if (a.keyCode === 66) commit("\n");
                    else if (a.keyCode === 62) commit(" ");
                    else if (a.keyCode === 61) commit("\t");
                    else {
                        emit(KEYCODE_NAMES[a.keyCode] || key.label || `Key ${a.keyCode}`);
                        consumeOnce();
                    }
                    break;
                case "ToggleModifier": {
                    const m = a.modifier;
                    if (m === "FN") {
                        if (layout.layers.fn) setLayer(layerId === "fn" ? history.pop() || layout.initialLayer : "fn", layerId !== "fn");
                        else st.modifiers.FN = st.modifiers.FN === "INACTIVE" ? "LOCKED" : "INACTIVE";
                    } else {
                        st.modifiers[m] = st.modifiers[m] === "INACTIVE" ? "ONCE" : "INACTIVE";
                        if (m === "SHIFT") syncShiftLayer();
                    }
                    emit(st.modifiers[m] && st.modifiers[m] !== "INACTIVE" ? `${m[0]}${m.slice(1).toLowerCase()} on` : null);
                    break;
                }
                case "SwitchLayer":
                    setLayer(a.targetLayer, true);
                    break;
                case "GoBack":
                    if (history.length) setLayer(history.pop(), false);
                    else emit("Back to previous keyboard");
                    break;
                case "MoveCursor":
                    emit(`Cursor ${CURSOR_NAMES[String(a.direction)] || ""}`);
                    break;
                case "SelectText":
                    emit(`Select ${CURSOR_NAMES[String(a.direction)] || ""}`);
                    break;
                case "Clipboard":
                    emit({ COPY: "Copy", PASTE: "Paste", CUT: "Cut", SELECT_ALL: "Select all" }[a.operation] || "Clipboard");
                    break;
                case "Combo":
                    (a.actions || []).forEach((sub) => fire(entry, sub));
                    break;
                case "VoiceInput":
                    emit("Voice input");
                    break;
                case "SwitchLayout":
                case "SwitchMode":
                    emit("Switch keyboard");
                    break;
                case "OpenImePicker":
                    emit("Keyboard picker");
                    break;
                case "OpenSettings":
                    emit("Settings");
                    break;
                case "HideKeyboard":
                    emit("Hide keyboard");
                    break;
                default:
                    emit(a.type);
            }
            render();
        }

        function pointFor(e) {
            const rect = canvas.getBoundingClientRect();
            return [e.clientX - rect.left, e.clientY - rect.top];
        }

        function release(fireIt) {
            clearTimeout(longTimer);
            clearTimeout(repeatTimer);
            if (!pressed) return;
            const entry = pressed;
            pressed = null;
            animatePress(entry, 1);
            if (fireIt && !longFired && !repeated) fire(entry);
            clearTimeout(popupTimer);
            popupTimer = setTimeout(() => {
                st.popup = null;
                st.popupLabel = null;
                render();
            }, 65);
        }

        canvas.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            const hit = model && R.hitTest(model, ...pointFor(e));
            if (!hit) return;
            e.preventDefault();
            if (hit.bar) {
                barTap(hit);
                return;
            }
            try {
                canvas.setPointerCapture(e.pointerId);
            } catch (_) {}
            pressed = hit;
            longFired = false;
            repeated = false;
            clearTimeout(popupTimer);
            st.selected = hit;
            st.popup = R.popupEligible(hit.key, layout) ? hit : null;
            st.popupLabel = null;
            hooks.onInspect(hit, layout);
            animatePress(hit, 0.86);
            render();

            longTimer = setTimeout(() => {
                const key = hit.key;
                if (key.longPressAction) {
                    longFired = true;
                    st.popup = null;
                    fire(hit, key.longPressAction);
                } else if ((key.action || {}).type === "ToggleModifier" && key.action.modifier !== "FN") {
                    longFired = true;
                    st.modifiers[key.action.modifier] = "LOCKED";
                    if (key.action.modifier === "SHIFT") syncShiftLayer();
                    emit(`${key.action.modifier[0]}${key.action.modifier.slice(1).toLowerCase()} locked`);
                    render();
                } else if (Array.isArray(key.popupAlternatives) && key.popupAlternatives.length) {
                    longFired = true;
                    hooks.onAlternatives(key.popupAlternatives, (alt) => {
                        commit(alt);
                        render();
                    });
                }
            }, 450);

            if (hit.key.repeatOnHold) {
                repeatTimer = setTimeout(function rep() {
                    repeated = true;
                    fire(hit);
                    repeatTimer = setTimeout(rep, 50);
                }, 400);
            }
        });
        canvas.addEventListener("pointerup", () => release(true));
        canvas.addEventListener("pointercancel", () => release(false));
        canvas.addEventListener("lostpointercapture", () => release(false));
        canvas.addEventListener("pointermove", (e) => {
            if (pressed || !model || e.pointerType !== "mouse") return;
            canvas.style.cursor = R.hitTest(model, ...pointFor(e)) ? "pointer" : "default";
        });
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        const ro = new ResizeObserver(() => render());
        ro.observe(canvas.parentElement);

        return {
            render,
            get layerId() {
                return layerId;
            },
            setLayer(id) {
                setLayer(id, true);
                render();
            },
            clear() {
                buffer = "";
                emit();
            },
            destroy() {
                ro.disconnect();
                clearTimeout(longTimer);
                clearTimeout(repeatTimer);
            },
        };
    }

    // ── Details sheet ────────────────────────────────────────────────────────
    function shareUrlFor(kbd) {
        const dir = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "");
        return `${dir}keyboards.html?k=${encodeURIComponent(kbd.id)}`;
    }

    function openPreviewModal(kbdEntry, opts = {}) {
        const layout = kbdEntry._layout !== undefined ? kbdEntry._layout : layoutOf(kbdEntry);
        currentPreviewKeyboard = kbdEntry;

        const s = catStyle(kbdEntry.category);
        const icon = document.getElementById("previewModalIcon");
        if (icon) {
            icon.className = `squircle lg ${s.icon}`;
            icon.innerHTML = `<span class="material-symbols-rounded filled">${s.glyph}</span>`;
        }
        setText("previewModalTitle", kbdEntry.name || (layout && layout.name) || "Keyboard");
        setText("previewModalAuthorBadge", brandName(kbdEntry.author || (layout && layout.author) || "Community"));
        setText("previewModalCategory", kbdEntry.category || "Community");
        setText("previewModalDesc", kbdEntry.description || (layout && layout.description) || "");
        setText("previewModalIdBadge", kbdEntry.id || (layout && layout.id) || "—");
        setText("previewModalFile", kbdEntry.fileName || "—");
        setText("previewModalSha", kbdEntry.sha256 || "—");
        const verified = document.getElementById("previewModalVerified");
        if (verified) verified.hidden = !kbdEntry.official;

        const layerCount = kbdEntry.layerCount || (layout ? Object.keys(layout.layers).length : 1);
        const stats = document.getElementById("previewModalStats");
        if (stats) {
            stats.innerHTML = [
                [kbdEntry.keyCount ?? "—", "Keys"],
                S.enabled && kbdEntry.downloadUrl && S.get("keyboard", kbdEntry.id).downloads > 0 ? [S.format(S.get("keyboard", kbdEntry.id).downloads), "Downloads"] : [kbdEntry.rowCount ?? "—", "Rows"],
                [layerCount, layerCount === 1 ? "Layer" : "Layers"],
                [formatBytes(kbdEntry.fileSize), "Size"],
            ]
                .map(([v, l]) => `<div class="stat"><strong${l === "Downloads" ? ' data-stat="downloads"' : ""}>${escapeHtml(v)}</strong><span>${l}</span></div>`)
                .join("");
        }

        const tags = document.getElementById("previewModalTags");
        if (tags) {
            tags.innerHTML =
                (kbdEntry.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("") +
                (kbdEntry.shapesUsed || []).map((t) => `<span class="tag mono">${escapeHtml(t)}</span>`).join("");
        }

        const dlBtn = document.getElementById("previewModalDownloadBtn");
        if (dlBtn) {
            dlBtn.hidden = !kbdEntry.downloadUrl;
            if (kbdEntry.downloadUrl) {
                dlBtn.href = kbdEntry.downloadUrl;
                dlBtn.setAttribute("download", kbdEntry.fileName || `${kbdEntry.id}.nokyboard`);
                dlBtn.setAttribute("data-dl", kbdEntry.fileName || `${kbdEntry.id}.nokyboard`);
                dlBtn.dataset.kind = "keyboard";
                dlBtn.dataset.id = kbdEntry.id;
            }
        }
        updateLikeButton();
        const shareWrap = document.getElementById("shareWrap");
        if (shareWrap) shareWrap.hidden = !kbdEntry.downloadUrl;
        closeShareMenu();

        setText("modalKeyInspector", "Tap or hold a key to see what it does.");
        hideAlternatives();

        const backdrop = document.getElementById("previewModalBackdrop");
        if (backdrop.hidden) lastFocusedBeforeModal = document.activeElement;
        backdrop.hidden = false;
        document.body.classList.add("no-scroll");
        backdrop.querySelector(".sheet").scrollTop = 0;

        if (stage) stage.destroy();
        stage = null;
        const stageEl = document.getElementById("modalKeyboardStage");
        stageEl.innerHTML = "";
        if (!layout) {
            stageEl.innerHTML = `<div class="stage-error"><span class="material-symbols-rounded">error</span>${escapeHtml(kbdEntry._layoutError || "This keyboard can't be previewed.")}</div>`;
        } else {
            const canvas = document.createElement("canvas");
            canvas.className = "stage-canvas";
            canvas.setAttribute("role", "img");
            canvas.setAttribute("aria-label", `Interactive preview of ${kbdEntry.name}`);
            stageEl.appendChild(canvas);
            stage = createStage(canvas, layout, {
                onBuffer: updateSandbox,
                onInspect: inspectKey,
                onLayer: () => renderModalLayerTabs(layout),
                onAlternatives: showAlternatives,
            });
            renderModalLayerTabs(layout);
            stage.render();
            R.ensureFonts(layout).then(() => stage && stage.render());
        }
        updateSandbox("", null);

        if (opts.push && kbdEntry.downloadUrl) {
            const url = shareUrlFor(kbdEntry);
            if (sheetPushed) history.replaceState({ k: kbdEntry.id }, "", url);
            else history.pushState({ k: kbdEntry.id }, "", url);
            sheetPushed = true;
        }
        document.getElementById("closePreviewModalBtn")?.focus({ preventScroll: true });
    }

    function closePreviewModal(fromHistory) {
        const backdrop = document.getElementById("previewModalBackdrop");
        if (!backdrop || backdrop.hidden) return;
        backdrop.hidden = true;
        document.body.classList.remove("no-scroll");
        closeShareMenu();
        if (stage) stage.destroy();
        stage = null;
        if (!fromHistory && sheetPushed) history.back();
        else if (!fromHistory && /[?&]k=/.test(location.search)) history.replaceState(null, "", location.href.split(/[?#]/)[0]);
        sheetPushed = false;
        if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) lastFocusedBeforeModal.focus({ preventScroll: true });
    }

    function renderModalLayerTabs(layout) {
        const tabs = document.getElementById("modalLayerTabs");
        if (!tabs || !layout) return;
        const ids = Object.keys(layout.layers);
        tabs.hidden = ids.length <= 1;
        if (ids.length <= 1) {
            tabs.innerHTML = "";
            return;
        }
        const current = stage ? stage.layerId : layout.initialLayer;
        tabs.innerHTML = ids
            .map((lid) => `<button type="button" class="chip ${lid === current ? "active" : ""}" data-layer-id="${escapeHtml(lid)}">${escapeHtml(layout.layers[lid].name || lid)}</button>`)
            .join("");
        tabs.querySelectorAll("button").forEach((btn) => {
            btn.addEventListener("click", () => {
                if (stage) stage.setLayer(btn.getAttribute("data-layer-id"));
                renderModalLayerTabs(layout);
            });
        });
    }

    function updateSandbox(buffer, note) {
        const el = document.getElementById("modalSandboxText");
        if (el) {
            const shown = buffer.replace(/\n/g, "⏎").replace(/\t/g, "⇥");
            el.classList.toggle("placeholder", !buffer);
            el.textContent = buffer ? shown : "Tap the keys below…";
            el.scrollLeft = buffer ? el.scrollWidth : 0;
        }
        const noteEl = document.getElementById("modalSandboxNote");
        if (noteEl) {
            noteEl.textContent = note || "";
            noteEl.hidden = !note;
            if (note) {
                noteEl.classList.remove("pop");
                void noteEl.offsetWidth;
                noteEl.classList.add("pop");
            }
        }
    }

    function describeAction(a) {
        switch (a.type) {
            case "CommitText": return `Types “${a.text === " " ? "space" : a.text === "\t" ? "tab" : a.text}”`;
            case "KeyCode": return { 67: "Backspace", 66: "Enter", 62: "Space", 61: "Tab" }[a.keyCode] || `Key code ${a.keyCode}${KEYCODE_NAMES[a.keyCode] ? ` (${KEYCODE_NAMES[a.keyCode]})` : ""}`;
            case "ToggleModifier": return `${a.modifier} modifier — hold to lock`;
            case "SwitchLayer": return `Switches to layer “${a.targetLayer}”`;
            case "MoveCursor": return `Moves the cursor ${CURSOR_NAMES[String(a.direction)] || ""}`;
            case "SelectText": return `Extends the selection ${CURSOR_NAMES[String(a.direction)] || ""}`;
            case "Clipboard": return `Clipboard: ${String(a.operation || "").replace("_", " ").toLowerCase()}`;
            case "GoBack": return "Returns to the previous keyboard";
            case "MultiTap": return `Multi-tap: ${(a.sequence || []).join(" ")}`;
            default: return a.type;
        }
    }

    function inspectKey(entry) {
        const inspector = document.getElementById("modalKeyInspector");
        if (!inspector) return;
        const key = entry.key;
        const c = entry.style;
        const a = key.action || {};
        const extras = [];
        if (key.longPressAction) extras.push(`Hold: ${describeAction(key.longPressAction)}`);
        if (key.repeatOnHold) extras.push("Repeats while held");
        if (Array.isArray(key.popupAlternatives) && key.popupAlternatives.length) extras.push(`Hold for ${key.popupAlternatives.join(" ")}`);
        inspector.innerHTML = `
            <div class="ki-head"><strong>${escapeHtml(key.label || key.iconName || key.id)}</strong><span>${escapeHtml(describeAction(a))}</span></div>
            ${extras.length ? `<div class="ki-extra">${extras.map(escapeHtml).join(" · ")}</div>` : ""}
            <div class="tag-row" style="margin: 0;">
                <span class="tag mono">${escapeHtml(c.shape || "ROUNDED_RECT")}</span>
                <span class="tag mono">weight ${Number(key.weight || 1).toFixed(2)}</span>
                <span class="tag mono">height ${Number(key.heightRatio || 1).toFixed(2)}</span>
                ${c.offsetXDp || c.offsetYDp ? `<span class="tag mono">offset ${c.offsetXDp || 0}, ${c.offsetYDp || 0} dp</span>` : ""}
                ${c.keyRotationDeg ? `<span class="tag mono">rotated ${c.keyRotationDeg}°</span>` : ""}
            </div>`;
    }

    function showAlternatives(list, onPick) {
        const el = document.getElementById("altPopover");
        if (!el) return;
        el.innerHTML = list.map((alt) => `<button type="button" class="alt-key">${escapeHtml(alt)}</button>`).join("");
        el.hidden = false;
        el.querySelectorAll("button").forEach((b, i) =>
            b.addEventListener("click", () => {
                onPick(list[i]);
                hideAlternatives();
            })
        );
    }
    function hideAlternatives() {
        const el = document.getElementById("altPopover");
        if (el) el.hidden = true;
    }

    // ── Likes ────────────────────────────────────────────────────────────────
    function updateLikeButton() {
        const btn = document.getElementById("likeKeyboardBtn");
        const kbd = currentPreviewKeyboard;
        if (!btn) return;
        const show = S.enabled && kbd && kbd.downloadUrl;
        btn.hidden = !show;
        if (!show) return;
        const liked = S.isLiked(kbd.id);
        btn.classList.toggle("liked", liked);
        btn.setAttribute("aria-pressed", String(liked));
        btn.setAttribute("aria-label", liked ? "Unlike this keyboard" : "Like this keyboard");
        btn.querySelector(".like-count").textContent = S.format(S.get("keyboard", kbd.id).likes);
        const dl = document.querySelector('#previewModalStats [data-stat="downloads"]');
        if (dl) dl.textContent = S.format(S.get("keyboard", kbd.id).downloads);
    }

    function initLikes() {
        const btn = document.getElementById("likeKeyboardBtn");
        if (!btn) return;
        btn.addEventListener("click", () => {
            const kbd = currentPreviewKeyboard;
            if (!kbd) return;
            const liked = S.toggleLike(kbd.id);
            btn.classList.remove("burst");
            void btn.offsetWidth;
            if (liked) btn.classList.add("burst");
            toast(liked ? `You liked ${kbd.name}` : "Like removed", liked ? "favorite" : "heart_minus");
        });
    }

    // ── Sharing ──────────────────────────────────────────────────────────────
    function shareData(kbd) {
        const url = shareUrlFor(kbd);
        return {
            url,
            title: `${kbd.name} — Noky Keyboard`,
            text: `Try the “${kbd.name}” keyboard for Noky Keyboard on Android:`,
        };
    }

    function closeShareMenu() {
        const menu = document.getElementById("shareMenu");
        const btn = document.getElementById("shareKeyboardBtn");
        if (menu) menu.hidden = true;
        if (btn) btn.setAttribute("aria-expanded", "false");
    }

    function openShareMenu() {
        const kbd = currentPreviewKeyboard;
        const menu = document.getElementById("shareMenu");
        if (!kbd || !menu) return;
        const d = shareData(kbd);
        const u = encodeURIComponent(d.url);
        const t = encodeURIComponent(d.text);
        const links = {
            whatsapp: `https://wa.me/?text=${encodeURIComponent(`${d.text} ${d.url}`)}`,
            telegram: `https://t.me/share/url?url=${u}&text=${t}`,
            x: `https://x.com/intent/post?text=${t}&url=${u}`,
            reddit: `https://www.reddit.com/submit?url=${u}&title=${encodeURIComponent(d.title)}`,
            email: `mailto:?subject=${encodeURIComponent(d.title)}&body=${encodeURIComponent(`${d.text}\n${d.url}`)}`,
        };
        menu.querySelector("[data-share-url]").textContent = d.url.replace(/^https?:\/\//, "");
        Object.entries(links).forEach(([k, href]) => {
            const a = menu.querySelector(`[data-share="${k}"]`);
            if (a) a.href = href;
        });
        menu.hidden = false;
        document.getElementById("shareKeyboardBtn")?.setAttribute("aria-expanded", "true");
    }

    async function onShareClick() {
        const kbd = currentPreviewKeyboard;
        if (!kbd) return;
        const menu = document.getElementById("shareMenu");
        if (menu && !menu.hidden) {
            closeShareMenu();
            return;
        }
        const d = shareData(kbd);
        const touch = matchMedia("(pointer: coarse)").matches;
        if (touch && navigator.share) {
            try {
                await navigator.share(d);
                return;
            } catch (err) {
                if (err && err.name === "AbortError") return;
            }
        }
        openShareMenu();
    }

    function initShare() {
        document.getElementById("shareKeyboardBtn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            onShareClick();
        });
        const menu = document.getElementById("shareMenu");
        if (!menu) return;
        menu.addEventListener("click", (e) => e.stopPropagation());
        menu.querySelector("[data-copy-link]")?.addEventListener("click", () => {
            if (currentPreviewKeyboard) copyText(shareData(currentPreviewKeyboard).url, "Link copied — anyone with it can open this keyboard");
            closeShareMenu();
        });
        menu.querySelector("[data-copy-file]")?.addEventListener("click", () => {
            const kbd = currentPreviewKeyboard;
            if (kbd && kbd.downloadUrl) copyText(new URL(kbd.downloadUrl, location.href).href, "Download link copied");
            closeShareMenu();
        });
        menu.querySelectorAll("a[data-share]").forEach((a) => a.addEventListener("click", () => closeShareMenu()));
        document.addEventListener("click", () => closeShareMenu());
    }

    // ── Client-side package checker ──────────────────────────
    async function sha256HexBuffer(arrayBuffer) {
        const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
        return Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }

    async function parseZipEntries(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const bytes = new Uint8Array(arrayBuffer);

        let eocdOffset = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (view.getUint32(i, true) === 0x06054b50) {
                eocdOffset = i;
                break;
            }
        }
        if (eocdOffset < 0) {
            throw new Error("Not a valid ZIP archive (.nokyboard / .nokydict)");
        }

        const totalEntries = view.getUint16(eocdOffset + 10, true);
        const cdOffset = view.getUint32(eocdOffset + 16, true);

        const entries = {};
        let ptr = cdOffset;
        const decoder = new TextDecoder("utf-8");

        for (let i = 0; i < totalEntries; i++) {
            if (view.getUint32(ptr, true) !== 0x02014b50) break;
            const compression = view.getUint16(ptr + 10, true);
            const compSize = view.getUint32(ptr + 20, true);
            const nameLen = view.getUint16(ptr + 28, true);
            const extraLen = view.getUint16(ptr + 30, true);
            const commentLen = view.getUint16(ptr + 32, true);
            const localHeaderOffset = view.getUint32(ptr + 42, true);

            const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
            ptr += 46 + nameLen + extraLen + commentLen;

            if (name.endsWith("/")) continue;

            const localNameLen = view.getUint16(localHeaderOffset + 26, true);
            const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
            const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
            const compBytes = bytes.subarray(dataStart, dataStart + compSize);

            if (compression === 0) {
                entries[name] = compBytes;
            } else if (compression === 8) {
                const ds = new DecompressionStream("deflate-raw");
                const writer = ds.writable.getWriter();
                writer.write(compBytes);
                writer.close();
                const decompressedBuf = await new Response(ds.readable).arrayBuffer();
                entries[name] = new Uint8Array(decompressedBuf);
            } else {
                throw new Error(`Unsupported ZIP compression method (${compression}) for ${name}`);
            }
        }
        return entries;
    }

    // ── Keyboard ID rules — port of app/.../engine/KeyboardIds.kt ────────────
    const KeyboardIds = (() => {
        const PRESET_PREFIX = "preset_";
        // Near-miss spellings are reserved too (KeyboardIds.reservedNamespaces).
        const RESERVED = new Set(["nokyofficial", "nokyoffical", "noky"]);
        // Built-in keyboard → official alias (KeyboardIds.presetToOfficial).
        const PRESET_TO_OFFICIAL = {
            preset_qwerty: "NokyOfficial-Qwerty",
            preset_old_qwerty: "NokyOfficial-QwertyClassic",
            preset_hacker: "NokyOfficial-Hacker",
            preset_hacker_compact: "NokyOfficial-HackerCompact",
            preset_emoji: "NokyOfficial-Emoji",
            preset_big_four: "NokyOfficial-BigFour",
            preset_t9: "NokyOfficial-T9",
            preset_gamepad: "NokyOfficial-Gamepad",
            preset_programmer: "NokyOfficial-Programmer",
            preset_spanish: "NokyOfficial-Spanish",
            preset_french: "NokyOfficial-French",
            preset_german: "NokyOfficial-German",
            preset_russian: "NokyOfficial-Russian",
            preset_hindi: "NokyOfficial-Hindi",
            preset_portuguese: "NokyOfficial-Portuguese",
            preset_italian: "NokyOfficial-Italian",
            preset_turkish: "NokyOfficial-Turkish",
            preset_indonesian: "NokyOfficial-Indonesian",
        };
        const OFFICIAL_TO_PRESET = Object.fromEntries(Object.entries(PRESET_TO_OFFICIAL).map(([p, o]) => [o.toLowerCase(), p]));
        const BUILT_IN = new Set(Object.keys(PRESET_TO_OFFICIAL));
        const PART = /^[A-Za-z0-9_]+$/;

        const canonical = (id) => OFFICIAL_TO_PRESET[String(id).trim().toLowerCase()] || id;
        function isReserved(id) {
            const t = String(id).trim();
            if (t.toLowerCase().startsWith(PRESET_PREFIX)) return true;
            const dash = t.indexOf("-");
            return dash > 0 && RESERVED.has(t.slice(0, dash).toLowerCase());
        }
        /** KeyboardIds.validateUserId — what the editor (and this catalog) requires. */
        function validateUserId(id) {
            const t = String(id || "").trim();
            if (!t) return { ok: false, reason: "The ID is empty." };
            if (isReserved(t)) return { ok: false, reserved: true, reason: "This ID is reserved for Noky." };
            const dash = t.indexOf("-");
            if (dash <= 0 || dash !== t.lastIndexOf("-") || dash === t.length - 1) {
                return { ok: false, reason: "Use the form Namespace-Name with exactly one dash, e.g. YourName-ErgoPad." };
            }
            const ns = t.slice(0, dash);
            const name = t.slice(dash + 1);
            if (!PART.test(ns) || !PART.test(name)) return { ok: false, reason: "Only letters, digits and _ are allowed on each side of the dash." };
            if (ns.length < 2 || name.length < 2) return { ok: false, reason: "Namespace and Name need at least 2 characters each." };
            if (ns.length > 24) return { ok: false, reason: "The namespace can be at most 24 characters." };
            if (name.length > 32) return { ok: false, reason: "The name can be at most 32 characters." };
            return { ok: true, reason: "Valid Namespace-Name ID." };
        }
        /** KeyboardIds.isAcceptableImportedId — wider: older ID shapes still import as-is. */
        function isAcceptableImportedId(id) {
            const t = String(id || "").trim();
            if (!t || t.length > 96 || isReserved(t)) return false;
            return /^[\p{L}\p{N}_-]+$/u.test(t);
        }
        /** KeyboardPackageExporter.classify — what the app does with each keyboard on import. */
        function importStatus(id, signedByNoky) {
            if (BUILT_IN.has(canonical(id))) return "REJECTED_BUILT_IN";
            if (isReserved(id)) return signedByNoky ? "OFFICIAL" : "REJECTED_NOT_SIGNED";
            if (!isAcceptableImportedId(id)) return "NEW_ID_REQUIRED";
            return "NEW";
        }
        return { isReserved, validateUserId, importStatus, canonical };
    })();

    // ── Package signature — port of KeyboardPackageCodec + OfficialKeys.kt ──
    // Public key only (the private key never leaves the maintainer's machine). Keep in sync with
    // app/src/main/java/app/allstudio/noky/engine/OfficialKeys.kt.
    const OFFICIAL_PUBLIC_KEYS = [
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEk1i8h7I2jt2svj+TSv5yBUw6YfQW0C6fzTFmcDKQ0BxtWrFKe8rzruBqf6T3zXDEuE5LTcSRvw+PnH/gF6hT6Q==",
    ];
    const MAX_KEYBOARDS = 24;
    const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
    const ASSET_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

    function b64ToBytes(b64) {
        const bin = atob(b64);
        return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    }

    /** Java's SHA256withECDSA writes a DER SEQUENCE{r, s}; WebCrypto wants raw r‖s (64 bytes). */
    function derToRawSignature(der) {
        let i = 0;
        if (der[i++] !== 0x30) return null;
        let len = der[i++];
        if (len & 0x80) i += len & 0x7f;
        const readInt = () => {
            if (der[i++] !== 0x02) return null;
            const n = der[i++];
            let v = der.slice(i, i + n);
            i += n;
            while (v.length > 32 && v[0] === 0) v = v.slice(1);
            if (v.length > 32) return null;
            const out = new Uint8Array(32);
            out.set(v, 32 - v.length);
            return out;
        };
        const r = readInt();
        const s = readInt();
        if (!r || !s) return null;
        const raw = new Uint8Array(64);
        raw.set(r, 0);
        raw.set(s, 32);
        return raw;
    }

    async function verifyNokySignature(manifestBytes, signatureBytes) {
        if (!signatureBytes || !crypto.subtle) return false;
        const raw = derToRawSignature(signatureBytes);
        if (!raw) return false;
        for (const b64 of OFFICIAL_PUBLIC_KEYS) {
            try {
                const key = await crypto.subtle.importKey("spki", b64ToBytes(b64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
                if (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, manifestBytes)) return true;
            } catch (_) {
                /* try the next key */
            }
        }
        return false;
    }

    const bytesOf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

    /** KeyboardPackageCodec.readV2: digests, structure, and whether Noky's signature covers it all. */
    async function readKeyboardPackage(entries) {
        const decoder = new TextDecoder("utf-8");
        const manifestBytes = entries["manifest.json"];
        const manifest = JSON.parse(decoder.decode(manifestBytes));
        if (manifest.packageType !== "noky_keyboard_package") throw new Error("This is not a Noky keyboard file.");
        if (!(Number(manifest.formatVersion) >= 2)) throw new Error("This is an old (format 1) keyboard file. Export it again from a current version of Noky.");
        const list = Array.isArray(manifest.keyboards) ? manifest.keyboards : [];
        if (!list.length) throw new Error("The keyboard file lists no keyboards.");
        if (list.length > MAX_KEYBOARDS) throw new Error("The file contains too many keyboards.");

        const digests = manifest.files && typeof manifest.files === "object" ? manifest.files : null;
        let everythingCovered = Boolean(digests);
        async function checked(path) {
            const bytes = entries[path];
            if (!bytes) return null;
            const expected = digests ? digests[path] : undefined;
            if (typeof expected !== "string") everythingCovered = false;
            else if (expected.toLowerCase() !== (await sha256HexBuffer(bytesOf(bytes)))) {
                throw new Error(`The keyboard file is damaged or was modified (${path}).`);
            }
            return bytes;
        }

        const layouts = [];
        for (const item of list) {
            const dir = item && typeof item.dir === "string" ? item.dir : "";
            if (!/^keyboards\/[0-9]{1,3}$/.test(dir)) throw new Error("The keyboard file has a malformed manifest.");
            const layoutBytes = await checked(`${dir}/layout.json`);
            if (!layoutBytes) throw new Error(`The keyboard file is incomplete (${dir}/layout.json is missing).`);
            const prefix = `${dir}/assets/`;
            for (const path of Object.keys(entries)) {
                if (!path.startsWith(prefix)) continue;
                const name = path.slice(prefix.length);
                const ext = name.split(".").pop().toLowerCase();
                if (ASSET_NAME.test(name) && !name.includes("..") && ASSET_EXT.has(ext)) await checked(path);
            }
            let layout;
            try {
                layout = R.normalize(JSON.parse(decoder.decode(layoutBytes)));
            } catch (err) {
                throw new Error(`Noky would reject ${dir}/layout.json: ${err.message}`);
            }
            layouts.push(layout);
        }

        const hasSignature = Boolean(entries["signature.sig"]);
        const signatureValid = hasSignature && (await verifyNokySignature(manifestBytes, entries["signature.sig"]));
        return { layouts, hasSignature, signatureValid, everythingCovered, signedByNoky: signatureValid && everythingCovered };
    }

    async function inspectUploadedFile(file) {
        const reportEl = document.getElementById("inspectorReport");
        const jsonEl = document.getElementById("generatedCatalogJson");
        const previewBtn = document.getElementById("previewInspectedBtn");

        try {
            const buf = await file.arrayBuffer();
            const fileSha = await sha256HexBuffer(buf);
            const decoder = new TextDecoder("utf-8");
            const uint8 = new Uint8Array(buf);
            const isZip = uint8.length >= 4 && uint8[0] === 0x50 && uint8[1] === 0x4b;

            if (!isZip) {
                // A bare layout JSON (the editor's "Export JSON"). It can never carry a signature.
                let layout;
                try {
                    layout = R.normalize(JSON.parse(decoder.decode(uint8)));
                } catch (err) {
                    throw new Error(err instanceof SyntaxError ? "This file is not valid JSON." : `Noky would reject this layout: ${err.message}`);
                }
                renderKeyboardInspectionReport(file.name, file.size, fileSha, [layout], { kind: "json", signedByNoky: false, hasSignature: false });
                return;
            }

            const entries = await parseZipEntries(buf);
            if (!entries["manifest.json"]) {
                throw new Error("Missing manifest.json inside package archive.");
            }
            const manifest = JSON.parse(decoder.decode(entries["manifest.json"]));
            const pkgType = manifest.packageType || "";

            if (pkgType === "noky_dictionary_package" || pkgType === "nokydict" || file.name.endsWith(".nokydict")) {
                const wordsBytes = entries["words.txt"] || entries["dictionary.txt"];
                if (!wordsBytes) throw new Error("Missing words.txt inside .nokydict archive.");
                const wordsTxt = decoder.decode(wordsBytes);
                const lines = wordsTxt.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("//"));
                const dictEntry = {
                    code: manifest.code || "custom",
                    displayName: manifest.displayName || manifest.name || "Custom Dictionary",
                    nativeName: manifest.nativeName || manifest.displayName || "Custom",
                    category: manifest.category || "LANGUAGE",
                    version: manifest.version || 1,
                    wordCount: lines.length,
                    fileName: file.name,
                    downloadUrl: `./packages/dictionaries/${file.name}`,
                    fileSize: file.size,
                    sha256: fileSha,
                };
                populateInspectorWithDict(dictEntry);
                return;
            }

            const pkg = await readKeyboardPackage(entries);
            renderKeyboardInspectionReport(file.name, file.size, fileSha, pkg.layouts, Object.assign({ kind: "package" }, pkg));
        } catch (err) {
            if (previewBtn) previewBtn.hidden = true;
            if (reportEl) {
                reportEl.innerHTML = statusRow("err", "error", `<strong>Validation failed:</strong> ${escapeHtml(err.message || String(err))}`);
            }
            if (jsonEl) jsonEl.textContent = JSON.stringify({ error: err.message || String(err) }, null, 2);
        }
    }

    function statusRow(kind, icon, html) {
        return `<div class="status-row ${kind}"><span class="material-symbols-rounded">${icon}</span><span>${html}</span></div>`;
    }

    const IMPORT_OUTCOME = {
        NEW: ["ok", "check_circle", "Noky installs it as a new keyboard."],
        NEW_ID_REQUIRED: ["warn", "warning", "Noky will install it but give it a new ID, which breaks links to it from other keyboards."],
        OFFICIAL: ["ok", "verified", "Official Noky keyboard."],
        REJECTED_NOT_SIGNED: ["err", "block", "This ID is reserved and can't be used. Pick another one."],
        REJECTED_BUILT_IN: ["err", "block", "This ID is reserved and can't be used. Pick another one."],
    };

    /**
     * pkg: { kind: "package"|"json"|"sample", signedByNoky, hasSignature, signatureValid, everythingCovered }
     */
    function renderKeyboardInspectionReport(fileName, fileSize, fileSha, layouts, pkg) {
        const reportEl = document.getElementById("inspectorReport");
        const jsonEl = document.getElementById("generatedCatalogJson");
        const previewBtn = document.getElementById("previewInspectedBtn");
        const issueBtn = document.getElementById("openGithubIssueSubmitBtn");
        const prBtn = document.getElementById("openGithubPrBtn");

        const layout = layouts[0];
        const layers = layout.layers || {};
        const initLayer = layers[layout.initialLayer] || Object.values(layers)[0] || { rows: [] };
        const rows = initLayer.rows || [];
        let keyCount = 0;
        const shapes = new Set([(layout.defaultKeyStyle || {}).shape || "ROUNDED_RECT"]);
        Object.values(layers).forEach((l) =>
            (l.rows || []).forEach((r) =>
                (r.keys || []).forEach((k) => {
                    if (k.customStyle && k.customStyle.shape) shapes.add(k.customStyle.shape);
                })
            )
        );
        rows.forEach((r) => (r.keys || []).forEach((k) => (k.action && k.action.type) !== "EmptySpace" && keyCount++));

        const signed = Boolean(pkg.signedByNoky);
        const safeFile = fileName.endsWith(".nokyboard") ? fileName : `${layout.id || "custom"}.nokyboard`;
        const catalogEntry = {
            id: layout.id,
            name: layout.name || "Custom Keyboard",
            author: layout.author || "Community",
            description: layout.description || "Custom keyboard layout for Noky Keyboard.",
            locale: layout.locale || "en",
            category: "Community",
            tags: [layout.locale || "en", ...Array.from(shapes)],
            // "official" is set by the maintainers when a package is curated; never self-declared.
            official: false,
            signed,
            rowCount: rows.length,
            keyCount: keyCount,
            layerCount: Object.keys(layers).length,
            shapesUsed: Array.from(shapes),
            fileName: safeFile,
            downloadUrl: `./packages/keyboards/${safeFile}`,
            fileSize: fileSize,
            sha256: fileSha,
        };
        lastInspectedEntry = Object.assign({}, catalogEntry, { previewLayout: layout, downloadUrl: null });

        // Integrity + signature rows
        const rowsHtml = [];
        if (pkg.kind === "json") {
            rowsHtml.push(statusRow("warn", "info", "<strong>Layout file</strong> — the catalog needs a <code>.nokyboard</code> file. In Noky, open the keyboard and tap <em>Export .nokyboard</em>."));
        } else if (pkg.kind === "package") {
            rowsHtml.push(statusRow("ok", "verified", `<strong>File is intact</strong> · ${layouts.length} keyboard${layouts.length === 1 ? "" : "s"}`));
        }
        if (pkg.kind === "package") {
            if (signed) rowsHtml.push(statusRow("ok", "workspace_premium", "<strong>Signed</strong> by Noky."));
            else if (pkg.hasSignature) rowsHtml.push(statusRow("warn", "gpp_maybe", "<strong>Signature</strong> not recognised — the file will be treated as unsigned."));
        }

        // Per keyboard: what the app does on import, and whether the catalog accepts the ID
        let catalogOk = pkg.kind !== "json";
        layouts.forEach((l) => {
            const status = KeyboardIds.importStatus(l.id, signed);
            const [kind, icon, text] = IMPORT_OUTCOME[status];
            let v = KeyboardIds.validateUserId(l.id);
            // Same catalog rules as the automatic pull request check (scripts/check_submission.py).
            if (v.ok && pkg.kind !== "sample") {
                const ns = l.id.split("-")[0].toLowerCase();
                const taken = (catalog.keyboards || []).some((k) => KeyboardIds.canonical(k.id).toLowerCase() === KeyboardIds.canonical(l.id).toLowerCase());
                if (ns === "allstudio" && !signed) v = { ok: false, reason: `The ${l.id.split("-")[0]} name is used for ALLStudio's own keyboards. Please use your own name, like YourName-${l.id.split("-")[1]}.` };
                else if (taken) v = { ok: false, reason: "A keyboard with this ID is already in the catalog. Choose a different name." };
            }
            const fine = status === "OFFICIAL" || v.ok;
            if (!fine || kind === "err") catalogOk = false;
            const catalogNote = status === "OFFICIAL" || kind === "err" || v.ok ? "" : ` For the catalog: ${escapeHtml(v.reason)}`;
            rowsHtml.push(statusRow(kind === "ok" && !fine ? "warn" : kind, kind === "ok" && !fine ? "warning" : icon, `<strong>${escapeHtml(l.name || l.id)}</strong> <code>${escapeHtml(l.id)}</code> — ${escapeHtml(text)}${catalogNote}`));
        });
        rowsHtml.push(
            catalogOk
                ? statusRow("ok", "task_alt", "<strong>Ready to submit</strong> to the catalog.")
                : statusRow("warn", "edit_note", "<strong>Not ready yet</strong> — fix the items above, export again and re-check.")
        );
        if (reportEl) reportEl.innerHTML = rowsHtml.join("");

        if (jsonEl) jsonEl.textContent = JSON.stringify(catalogEntry, null, 2);

        if (previewBtn) {
            previewBtn.hidden = false;
            previewBtn.onclick = () => openPreviewModal(lastInspectedEntry);
        }
        // The public repo is the site itself, so packages live at packages/… (not website/noky/…).
        if (prBtn) prBtn.href = `${GITHUB_REPO}/upload/main/packages/keyboards`;
        if (issueBtn) {
            const title = `Keyboard submission: ${catalogEntry.name} (${catalogEntry.id})`;
            const body = [
                `**⬇️ Attach your file:** drag \`${catalogEntry.fileName}\` into this box, then click **Create**.`,
                ``,
                `---`,
                ``,
                `**Keyboard:** ${catalogEntry.name} (\`${catalogEntry.id}\`)`,
                `**Made by:** ${catalogEntry.author}`,
                `**About it:** ${catalogEntry.description}`,
                ``,
                `<!-- Checked on noky.allstudio.app · ${catalogEntry.layerCount} layer(s), ${catalogEntry.keyCount} keys · sha256 ${catalogEntry.sha256} -->`,
            ].join("\n");
            issueBtn.href = `${GITHUB_REPO}/issues/new?labels=package-submission&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
        }
    }

    function populateInspectorWithDict(dictEntry) {
        const reportEl = document.getElementById("inspectorReport");
        const jsonEl = document.getElementById("generatedCatalogJson");
        const previewBtn = document.getElementById("previewInspectedBtn");
        const issueBtn = document.getElementById("openGithubIssueSubmitBtn");
        const prBtn = document.getElementById("openGithubPrBtn");

        if (previewBtn) previewBtn.hidden = true;
        if (reportEl) {
            reportEl.innerHTML = [
                statusRow("ok", "check_circle", `<strong>Word pack</strong> <code>${escapeHtml(dictEntry.displayName)}</code> (<code>${escapeHtml(dictEntry.code)}</code>)`),
                statusRow("ok", "check_circle", `<strong>Vocabulary</strong> ${Number(dictEntry.wordCount || 0).toLocaleString()} words · ${escapeHtml(dictEntry.category)}`),
                statusRow("ok", "task_alt", "<strong>Ready to submit</strong> to the catalog."),
            ].join("");
        }
        if (jsonEl) jsonEl.textContent = JSON.stringify(dictEntry, null, 2);
        if (prBtn) prBtn.href = `${GITHUB_REPO}/upload/main/packages/dictionaries`;
        if (issueBtn) {
            const title = `Word pack submission: ${dictEntry.displayName} (${dictEntry.code})`;
            const body = [
                `**⬇️ Attach your file:** drag \`${dictEntry.fileName}\` into this box, then click **Create**.`,
                ``,
                `---`,
                ``,
                `**Word pack:** ${dictEntry.displayName} — ${dictEntry.nativeName} (\`${dictEntry.code}\`)`,
                `**Words:** ${Number(dictEntry.wordCount || 0).toLocaleString()}`,
                ``,
                `<!-- Checked on noky.allstudio.app · sha256 ${dictEntry.sha256 || ""} -->`,
            ].join("\n");
            issueBtn.href = `${GITHUB_REPO}/issues/new?labels=dictionary-submission&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
        }
    }

    // ── Create section: inspector + request form ─────────────────────────────
    function flash(btn, text) {
        const orig = btn.textContent;
        btn.textContent = text;
        setTimeout(() => (btn.textContent = orig), 1600);
    }

    function initInspectorAndRequestForm() {
        const dropzone = document.getElementById("packageDropzone");
        const fileInput = document.getElementById("packageFileInput");

        if (dropzone && fileInput) {
            dropzone.addEventListener("click", () => fileInput.click());
            dropzone.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInput.click();
                }
            });
            dropzone.addEventListener("dragover", (e) => {
                e.preventDefault();
                dropzone.classList.add("dragover");
            });
            dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
            dropzone.addEventListener("drop", (e) => {
                e.preventDefault();
                dropzone.classList.remove("dragover");
                const file = e.dataTransfer?.files?.[0];
                if (file) inspectUploadedFile(file);
            });
            fileInput.addEventListener("change", () => {
                const file = fileInput.files?.[0];
                if (file) inspectUploadedFile(file);
            });
        }

        document.getElementById("loadSampleInspectorBtn")?.addEventListener("click", () => {
            const sample = (catalog.keyboards || [])[1] || (catalog.keyboards || [])[0];
            if (!sample) return;
            renderKeyboardInspectionReport(sample.fileName, sample.fileSize, sample.sha256, [R.normalize(sample.previewLayout)], { kind: "sample", signedByNoky: Boolean(sample.signed) });
        });

        const copyJsonBtn = document.getElementById("copyCatalogJsonBtn");
        copyJsonBtn?.addEventListener("click", () => {
            copyText(document.getElementById("generatedCatalogJson")?.textContent || "", "Details copied");
        });

        function buildRequestData() {
            const type = document.getElementById("reqType")?.value || "Keyboard Layout (.nokyboard)";
            const name = document.getElementById("reqName")?.value.trim() || "New Community Layout";
            const cat = document.getElementById("reqCategory")?.value || "Language / Regional";
            const shapes = document.getElementById("reqShapes")?.value || "ROUNDED_RECT";
            const details = document.getElementById("reqDetails")?.value.trim() || "Standard rows and modifiers.";
            const title = `[Request] ${type}: ${name}`;
            const markdown = [
                `### Community Package Request`,
                `- **Request Type:** ${type}`,
                `- **Layout / Language Name:** ${name}`,
                `- **Category:** ${cat}`,
                `- **Preferred Key Geometry:** ${shapes}`,
                ``,
                `### Specification & Notes`,
                details,
            ].join("\n");
            return { title, markdown };
        }

        document.getElementById("layoutRequestForm")?.addEventListener("submit", (e) => {
            e.preventDefault();
            const { title, markdown } = buildRequestData();
            window.open(`${GITHUB_REPO}/issues/new?labels=layout-request&title=${encodeURIComponent(title)}&body=${encodeURIComponent(markdown)}`, "_blank", "noopener,noreferrer");
        });

        const feedback = document.getElementById("requestFeedbackMsg");
        document.getElementById("copyRequestMarkdownBtn")?.addEventListener("click", () => {
            copyText(buildRequestData().markdown, "Request copied as Markdown");
        });
    }

    // ── Create section tabs ──────────────────────────────────────────────────
    function showPane(name) {
        document.querySelectorAll(".seg[data-pane]").forEach((b) => {
            const on = b.dataset.pane === name;
            b.classList.toggle("active", on);
            b.setAttribute("aria-selected", String(on));
        });
        document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === name));
    }

    function bindPaneLinks(root) {
        root.querySelectorAll("[data-goto-pane]").forEach((a) => a.addEventListener("click", () => showPane(a.dataset.gotoPane)));
    }

    function syncPaneFromHash() {
        const h = location.hash.replace("#", "");
        if (h === "publish" || h === "request") {
            showPane(h);
            document.getElementById("create")?.scrollIntoView();
        }
    }

    // ── Controls ─────────────────────────────────────────────────────────────
    function initControls() {
        const searchInput = document.getElementById("kbdSearchInput");
        if (searchInput) {
            let scrolled = false;
            searchInput.addEventListener("input", () => {
                kbdSearchQuery = searchInput.value || "";
                renderKeyboardsGrid();
                if (!scrolled && kbdSearchQuery) {
                    const grid = document.getElementById("keyboards");
                    if (grid && grid.getBoundingClientRect().top > window.innerHeight * 0.6) grid.scrollIntoView({ behavior: "smooth" });
                    scrolled = true;
                }
                if (!kbdSearchQuery) scrolled = false;
            });
            searchInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    if (!document.getElementById("keyboardsGrid")) {
                        location.href = `./keyboards.html${searchInput.value.trim() ? `?q=${encodeURIComponent(searchInput.value.trim())}` : ""}`;
                        return;
                    }
                    document.getElementById("keyboards")?.scrollIntoView({ behavior: "smooth" });
                }
                if (e.key === "Escape") {
                    searchInput.value = "";
                    kbdSearchQuery = "";
                    renderKeyboardsGrid();
                    searchInput.blur();
                }
            });
            document.addEventListener("keydown", (e) => {
                const tag = (e.target && e.target.tagName) || "";
                const bd = document.getElementById("previewModalBackdrop");
                if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(tag) && (!bd || bd.hidden)) {
                    e.preventDefault();
                    searchInput.focus();
                }
            });
        }

        document.querySelectorAll("#kbdCategoryPills .chip").forEach((pill) => {
            pill.addEventListener("click", () => {
                document.querySelectorAll("#kbdCategoryPills .chip").forEach((p) => {
                    p.classList.remove("active");
                    p.setAttribute("aria-selected", "false");
                });
                pill.classList.add("active");
                pill.setAttribute("aria-selected", "true");
                activeKbdCategory = pill.getAttribute("data-category") || "ALL";
                renderKeyboardsGrid();
            });
        });

        document.querySelectorAll("#dictCategoryPills .chip").forEach((pill) => {
            pill.addEventListener("click", () => {
                document.querySelectorAll("#dictCategoryPills .chip").forEach((p) => {
                    p.classList.remove("active");
                    p.setAttribute("aria-selected", "false");
                });
                pill.classList.add("active");
                pill.setAttribute("aria-selected", "true");
                activeDictCategory = pill.getAttribute("data-dict-cat") || "ALL";
                renderDictionariesGrid();
            });
        });

        document.querySelectorAll(".seg[data-pane]").forEach((b) => b.addEventListener("click", () => showPane(b.dataset.pane)));
        bindPaneLinks(document);

        const sortSel = document.getElementById("kbdSort");
        if (sortSel) {
            if (!S.enabled) {
                sortSel.querySelector('option[value="popular"]').textContent = "Featured";
                sortSel.querySelector('option[value="liked"]')?.remove();
            }
            sortSel.addEventListener("change", () => {
                kbdSort = sortSel.value;
                renderKeyboardsGrid();
            });
        }

        // Deep links into the Keyboards page: ?q=search and ?cat=Category
        const params = new URLSearchParams(location.search);
        if (params.get("q") && searchInput) {
            searchInput.value = params.get("q");
            kbdSearchQuery = searchInput.value;
        }
        const cat = params.get("cat");
        if (cat) {
            const pill = Array.from(document.querySelectorAll("#kbdCategoryPills .chip")).find((p) => p.dataset.category === cat);
            if (pill) {
                document.querySelectorAll("#kbdCategoryPills .chip").forEach((p) => p.classList.remove("active"));
                pill.classList.add("active");
                activeKbdCategory = cat;
            }
        }
        window.addEventListener("hashchange", syncPaneFromHash);

        const backdrop = document.getElementById("previewModalBackdrop");
        document.getElementById("closePreviewModalBtn")?.addEventListener("click", () => closePreviewModal(false));
        backdrop?.addEventListener("click", (e) => {
            if (e.target === backdrop) closePreviewModal(false);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || !backdrop || backdrop.hidden) return;
            const menu = document.getElementById("shareMenu");
            if (menu && !menu.hidden) closeShareMenu();
            else closePreviewModal(false);
        });
        // Keep keyboard focus inside the open sheet.
        backdrop?.addEventListener("keydown", (e) => {
            if (e.key !== "Tab") return;
            const focusables = Array.from(backdrop.querySelectorAll("a[href]:not([hidden]), button:not([disabled]):not([hidden])")).filter((el) => el.offsetParent !== null);
            if (!focusables.length) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        });
        document.getElementById("modalSandboxClearBtn")?.addEventListener("click", () => stage && stage.clear());
        bindDownloadFeedback(document.querySelector(".sheet-head") || document);

        window.addEventListener("popstate", (e) => {
            const id = e.state && e.state.k;
            const kbd = id && findKeyboard(id);
            if (kbd) openPreviewModal(kbd, { push: false });
            else closePreviewModal(true);
        });

        let resizeTimer = 0;
        let lastWidth = window.innerWidth;
        window.addEventListener("resize", () => {
            if (window.innerWidth === lastWidth) return;
            lastWidth = window.innerWidth;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => paintThumbnails(document), 120);
        });
    }

    function openFromQuery() {
        const id = new URLSearchParams(location.search).get("k");
        if (!id) return;
        const kbd = findKeyboard(id);
        if (kbd) {
            history.replaceState({ k: kbd.id }, "", location.href);
            openPreviewModal(kbd, { push: false });
        } else {
            toast("That keyboard isn't in the catalog anymore", "info");
            history.replaceState(null, "", location.href.split(/[?#]/)[0]);
        }
    }

    async function loadCatalog() {
        try {
            const resp = await fetch("./catalog.json", { cache: "no-cache" });
            if (!resp.ok) throw new Error(String(resp.status));
            catalog = await resp.json();
        } catch (_) {
            // file:// previews can't fetch; load the bundled copy instead (only in that case).
            await new Promise((resolve) => {
                const s = document.createElement("script");
                s.src = "./catalog-data.js";
                s.onload = s.onerror = resolve;
                document.head.appendChild(s);
            });
            catalog = window.NOKY_CATALOG_DATA || catalog;
        }
        renderFeatured();
        renderPopular();
        renderKeyboardsGrid();
        renderDictionariesGrid();
        openFromQuery();

        if (S.enabled) {
            let pending = 0;
            S.onChange(() => {
                cancelAnimationFrame(pending);
                pending = requestAnimationFrame(() => {
                    renderPopular();
                    renderKeyboardsGrid();
                    renderDictionariesGrid();
                    updateLikeButton();
                });
            });
            S.load();
        }

        // Repaint once custom fonts and the icon font are ready so labels and icons match the app.
        Promise.all((catalog.keyboards || []).map((k) => (layoutOf(k) ? R.ensureFonts(layoutOf(k)) : null))).then(() => {
            paintThumbnails(document);
            if (stage) stage.render();
        });

        // Grids render after the browser's initial anchor jump; re-apply it.
        const target = location.hash.length > 1 && document.getElementById(location.hash.slice(1));
        if (target) {
            if (target.classList.contains("pane")) syncPaneFromHash();
            else target.scrollIntoView();
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        buildMiniKeyboards();
        initControls();
        initShare();
        initLikes();
        initInspectorAndRequestForm();
        syncPaneFromHash();
        loadCatalog();
    });
})();
