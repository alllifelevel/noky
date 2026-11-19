"""
Noky package rules and catalog builder — one copy, used in two places:

  * the private app repo's tools/build_website_catalog.py (full site build), and
  * the public site repo's GitHub Actions (checking community submissions and
    updating the catalog after a submission is approved).

The rules mirror the Noky app:
  engine/KeyboardIds.kt            — ID format, reserved namespaces, built-in keyboards
  engine/KeyboardPackageCodec.kt   — package structure, digests, signatures, size limits
  engine/KeyboardPackageExporter.kt — what the app does with each keyboard on import
  engine/LayoutJson.kt             — the layout shapes the app accepts

The app-derived values (reserved names, built-in IDs, official public keys) live in
.github/noky-rules.json, which the private build regenerates from the Kotlin sources.

Standard library only (plus the `openssl` CLI for signature checks), so it runs on a stock
GitHub Actions runner without installing anything.
"""

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone

SITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULES_PATH = os.path.join(SITE_DIR, ".github", "noky-rules.json")

# KeyboardPackageCodec limits (the catalog is stricter on total size: these are tiny files).
MAX_ENTRIES = 300
MAX_KEYBOARDS = 24
MAX_LAYOUT_JSON_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 48 * 1024 * 1024
MAX_CATALOG_PACKAGE_BYTES = 2 * 1024 * 1024
ASSET_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
ASSET_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
DIR_PATTERN = re.compile(r"keyboards/[0-9]{1,3}")
ID_PART = re.compile(r"[A-Za-z0-9_]+")
DICT_CODE = re.compile(r"[a-z0-9_-]{1,32}")


class PackageError(Exception):
    """A package the app would refuse, with a message fit to show the submitter."""


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ── Rules ───────────────────────────────────────────────────────────────────
def load_rules(path: str = RULES_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        rules = json.load(f)
    rules["reservedNamespaces"] = {n.lower() for n in rules.get("reservedNamespaces", [])}
    rules["studioNamespaces"] = {n.lower() for n in rules.get("studioNamespaces", [])}
    rules["builtInIds"] = set(rules.get("builtInIds", []))
    rules["officialAliases"] = {k.lower(): v for k, v in rules.get("officialAliases", {}).items()}
    return rules


def canonical_id(kid: str, rules: dict) -> str:
    return rules["officialAliases"].get(kid.strip().lower(), kid)


def is_reserved_id(kid: str, rules: dict) -> bool:
    t = kid.strip()
    if t.lower().startswith("preset_"):
        return True
    return "-" in t and t.split("-", 1)[0].lower() in rules["reservedNamespaces"]


def validate_user_id(kid: str, rules: dict):
    """KeyboardIds.validateUserId → (ok, reason)."""
    t = (kid or "").strip()
    if not t:
        return False, "The keyboard ID is empty."
    if is_reserved_id(t, rules):
        return False, "This ID is reserved and can't be used."
    dash = t.find("-")
    if dash <= 0 or dash != t.rfind("-") or dash == len(t) - 1:
        return False, "Use the form `YourName-KeyboardName` with exactly one dash."
    ns, name = t[:dash], t[dash + 1:]
    if not ID_PART.fullmatch(ns) or not ID_PART.fullmatch(name):
        return False, "Only letters, digits and `_` are allowed on each side of the dash."
    if len(ns) < 2 or len(name) < 2:
        return False, "Both parts of the ID need at least 2 characters."
    if len(ns) > 24:
        return False, "The part before the dash can be at most 24 characters."
    if len(name) > 32:
        return False, "The part after the dash can be at most 32 characters."
    return True, "Valid ID."


def import_status(kid: str, signed: bool, rules: dict) -> str:
    """KeyboardPackageExporter.classify, minus the 'already installed' cases."""
    if canonical_id(kid, rules) in rules["builtInIds"]:
        return "REJECTED_BUILT_IN"
    if is_reserved_id(kid, rules):
        return "OFFICIAL" if signed else "REJECTED_NOT_SIGNED"
    return "NEW"


# ── Signatures ──────────────────────────────────────────────────────────────
def verify_signature(manifest_bytes: bytes, signature: bytes, rules: dict) -> bool:
    """ECDSA P-256 / SHA-256 over manifest.json (same as the app). Fails closed."""
    if not signature or not shutil.which("openssl"):
        return False
    for b64 in rules.get("publicKeys", []):
        with tempfile.TemporaryDirectory() as tmp:
            pem = os.path.join(tmp, "pub.pem")
            sig = os.path.join(tmp, "sig.der")
            data = os.path.join(tmp, "manifest.json")
            with open(pem, "w") as f:
                f.write("-----BEGIN PUBLIC KEY-----\n" + b64 + "\n-----END PUBLIC KEY-----\n")
            with open(sig, "wb") as f:
                f.write(signature)
            with open(data, "wb") as f:
                f.write(manifest_bytes)
            res = subprocess.run(["openssl", "dgst", "-sha256", "-verify", pem, "-signature", sig, data], capture_output=True)
            if res.returncode == 0:
                return True
    return False


# ── Layout shape (LayoutJson.normalize: the parts that make the app refuse a keyboard) ──
def check_layout(layout) -> dict:
    if not isinstance(layout, dict):
        raise PackageError("The keyboard data is not a JSON object.")
    kid = layout.get("id")
    if not isinstance(kid, str) or not kid.strip():
        raise PackageError("The keyboard has no ID.")
    if len(kid.strip()) > 96:
        raise PackageError("The keyboard ID is too long.")
    layers = layout.get("layers")
    if not isinstance(layers, dict) or not layers:
        raise PackageError("The keyboard has no layers.")
    if len(layers) > 64:
        raise PackageError("The keyboard has too many layers.")
    for lk, layer in layers.items():
        if not isinstance(layer, dict):
            raise PackageError(f'Layer "{lk}" is malformed.')
        rows = layer.get("rows", [])
        if not isinstance(rows, list):
            raise PackageError(f'Layer "{lk}" has malformed rows.')
        if len(rows) > 200:
            raise PackageError(f'Layer "{lk}" has too many rows.')
        for row in rows:
            if not isinstance(row, dict):
                raise PackageError(f'Layer "{lk}" has a malformed row.')
            keys = row.get("keys", [])
            if not isinstance(keys, list):
                raise PackageError(f'Layer "{lk}" has a malformed row.')
            if len(keys) > 40:
                raise PackageError(f'Layer "{lk}" has a row with too many keys.')
            if any(not isinstance(k, dict) for k in keys):
                raise PackageError(f'Layer "{lk}" has a malformed key.')
    return layout


# ── Behaviour (does the keyboard actually work once installed?) ─────────────
# Action shapes from model/KeyboardLayoutConfig.kt and the deserializer in LayoutRepository.kt.
# The app accepts almost anything on import (unknown actions silently become "type nothing",
# a missing layer makes a key do nothing), so these checks catch keyboards that would install
# but be partly broken.
ACTION_TYPES = {"CommitText", "KeyCode", "Combo", "SwitchLayer", "ToggleModifier", "SwitchMode", "SwitchLayout",
                "OpenImePicker", "OpenSettings", "HideKeyboard", "VoiceInput", "MoveCursor", "SelectText",
                "Clipboard", "MultiTap", "GoBack", "EmptySpace", "MousePad"}
MODIFIERS = {"SHIFT", "CTRL", "ALT", "META", "FN"}
CLIPBOARD_OPS = {"COPY", "PASTE", "CUT", "SELECT_ALL"}
MODES = {"NORMAL", "HACKER", "NO_KEYBOARD"}
DIRECTIONS = {-2, -1, 1, 2}
SHAPES = {"ROUNDED_RECT", "RECTANGLE", "PILL", "CIRCLE", "SQUIRCLE", "CUT_CORNERS", "HEXAGON", "DIAMOND"}
TOOLBAR_ITEMS = {"SETTINGS", "IME_PICKER", "CLIPBOARD", "COLLAPSE_TO_STRAP", "NEXT_KEYBOARD", "SPECIFIC_KEYBOARD",
                 "CURSOR_LEFT", "CURSOR_RIGHT", "UNDO", "REDO", "SELECT_ALL", "COPY", "PASTE", "EMOJI",
                 "HIDE_KEYBOARD", "VOICE_INPUT", "IME", "NO_KEYBOARD", "LAYOUT_SWITCH"}


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def check_action(action, layers: dict, package_ids: set, rules: dict, where: str, errors: list, warnings: list, depth=0):
    if not isinstance(action, dict):
        errors.append(f"{where}: the key has no valid action.")
        return
    t = action.get("type", "CommitText")
    if t not in ACTION_TYPES:
        errors.append(f"{where}: unknown action `{t}` — the key would do nothing in Noky.")
    elif t == "CommitText":
        if not isinstance(action.get("text"), str) or action.get("text") == "":
            errors.append(f"{where}: types nothing (empty text).")
    elif t == "KeyCode":
        if not _is_int(action.get("keyCode")) or action.get("keyCode") <= 0:
            errors.append(f"{where}: key code is missing or invalid.")
    elif t == "SwitchLayer":
        target = action.get("targetLayer")
        if target not in layers:
            errors.append(f"{where}: switches to layer `{target}`, which doesn't exist in this keyboard.")
    elif t == "ToggleModifier":
        if action.get("modifier") not in MODIFIERS:
            errors.append(f"{where}: unknown modifier `{action.get('modifier')}` (use SHIFT, CTRL, ALT, META or FN).")
    elif t == "Clipboard":
        if action.get("operation") not in CLIPBOARD_OPS:
            errors.append(f"{where}: unknown clipboard action `{action.get('operation')}`.")
    elif t in ("MoveCursor", "SelectText"):
        if action.get("direction") not in DIRECTIONS:
            errors.append(f"{where}: cursor direction must be -2, -1, 1 or 2.")
    elif t == "SwitchMode":
        if action.get("targetMode") not in MODES:
            errors.append(f"{where}: unknown mode `{action.get('targetMode')}`.")
    elif t == "MultiTap":
        seq = action.get("sequence")
        if not isinstance(seq, list) or not seq or not all(isinstance(x, str) and x for x in seq):
            errors.append(f"{where}: multi-tap needs a list of characters to cycle through.")
    elif t == "Combo":
        acts = action.get("actions")
        if not isinstance(acts, list) or not acts:
            errors.append(f"{where}: combo key has no actions.")
        elif depth < 4:
            for a in acts:
                check_action(a, layers, package_ids, rules, where, errors, warnings, depth + 1)
    elif t == "SwitchLayout":
        target = action.get("targetLayoutId")
        if target and target not in package_ids and canonical_id(target, rules) not in rules["builtInIds"] \
                and not str(target).startswith("preset_"):
            warnings.append(f"{where}: opens keyboard `{target}`, which isn't in this file — it only works if that keyboard is installed.")


def check_keyboard_behaviour(layout: dict, package_ids: set, rules: dict):
    """→ (errors, warnings) for a layout that already passed check_layout()."""
    errors, warnings = [], []
    layers = layout["layers"]
    initial = layout.get("initialLayer") if layout.get("initialLayer") in layers else ("default" if "default" in layers else next(iter(layers)))

    def usable(layer):
        return sum(1 for r in layer.get("rows", []) for k in r.get("keys", [])
                   if (k.get("action") or {}).get("type") != "EmptySpace")

    if usable(layers[initial]) == 0:
        errors.append(f"The first layer (`{initial}`) has no keys.")
    for lid, layer in layers.items():
        if lid != initial and usable(layer) == 0:
            warnings.append(f"Layer `{lid}` has no keys.")
        seen = set()
        for ri, row in enumerate(layer.get("rows", [])):
            for k in row.get("keys", []):
                kid = k.get("id") or "?"
                where = f"Layer `{lid}`, key `{k.get('label') or kid}`"
                if (k.get("action") or {}).get("type") == "EmptySpace":
                    continue
                check_action(k.get("action"), layers, package_ids, rules, where, errors, warnings)
                if k.get("longPressAction") is not None:
                    check_action(k["longPressAction"], layers, package_ids, rules, where + " (hold)", errors, warnings)
                if kid in seen:
                    warnings.append(f"Layer `{lid}` has more than one key with id `{kid}`.")
                seen.add(kid)
                shape = (k.get("customStyle") or {}).get("shape")
                if shape is not None and shape not in SHAPES:
                    warnings.append(f"{where}: unknown key shape `{shape}` — Noky will use the default shape.")

    rules_cfg = layout.get("scenarioRules") or {}
    for field in ("numberLayer", "phoneLayer", "dateTimeLayer", "emailLayer", "uriLayer", "passwordLayer", "postalLayer", "searchLayer"):
        target = rules_cfg.get(field)
        if target not in (None, "", "none") and target not in layers:
            warnings.append(f"Auto-switch `{field}` points to layer `{target}`, which doesn't exist.")
    bar = layout.get("suggestionBarStyle")
    if isinstance(bar, dict):
        for token in bar.get("toolbarItems") or []:
            if not isinstance(token, str) or token.split(":", 1)[0].strip().upper() not in TOOLBAR_ITEMS:
                warnings.append(f"Suggestion bar tool `{token}` is unknown and will be skipped.")
    return errors, warnings


# ── Packages ────────────────────────────────────────────────────────────────
def _open_zip(data: bytes, what: str) -> zipfile.ZipFile:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise PackageError(f"This is not a valid {what} file.")
    infos = zf.infolist()
    if len(infos) > MAX_ENTRIES:
        raise PackageError("The file contains too many entries.")
    if sum(i.file_size for i in infos) > MAX_TOTAL_BYTES:
        raise PackageError("The file is too large once unpacked.")
    for i in infos:
        n = i.filename
        if n.startswith("/") or "\\" in n or ".." in n.split("/"):
            raise PackageError("The file contains an unsafe path.")
    return zf


def read_keyboard_package(data: bytes, rules: dict) -> dict:
    """KeyboardPackageCodec.readV2 → {layouts, signed, hasSignature}. Raises PackageError."""
    if len(data) > MAX_CATALOG_PACKAGE_BYTES:
        raise PackageError("The file is larger than 2 MB. Catalog keyboards should be small; remove large images.")
    zf = _open_zip(data, ".nokyboard")
    names = set(zf.namelist())
    if "manifest.json" not in names:
        raise PackageError("This is not a Noky keyboard file (manifest.json is missing). Export it again with **Export .nokyboard**.")
    manifest_bytes = zf.read("manifest.json")
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise PackageError("The keyboard file has a damaged manifest.")
    if not isinstance(manifest, dict) or manifest.get("packageType") != "noky_keyboard_package":
        raise PackageError("This is not a Noky keyboard file.")
    try:
        fmt = int(manifest.get("formatVersion", 1))
    except (TypeError, ValueError):
        fmt = 1
    if fmt < 2:
        raise PackageError("This keyboard file uses an old format. Export it again from a current version of Noky.")
    entries = manifest.get("keyboards")
    if not isinstance(entries, list) or not entries:
        raise PackageError("The keyboard file lists no keyboards.")
    if len(entries) > MAX_KEYBOARDS:
        raise PackageError("The file contains too many keyboards.")

    digests = manifest.get("files") if isinstance(manifest.get("files"), dict) else None
    covered = [digests is not None]

    def checked(path):
        if path not in names:
            return None
        blob = zf.read(path)
        expected = digests.get(path) if digests else None
        if not isinstance(expected, str):
            covered[0] = False
        elif expected.lower() != sha256_hex(blob):
            raise PackageError(f"The keyboard file is damaged or was modified ({path}).")
        return blob

    layouts = []
    for item in entries:
        kdir = item.get("dir") if isinstance(item, dict) else None
        if not isinstance(kdir, str) or not DIR_PATTERN.fullmatch(kdir):
            raise PackageError("The keyboard file has a malformed manifest.")
        layout_bytes = checked(f"{kdir}/layout.json")
        if layout_bytes is None:
            raise PackageError(f"The keyboard file is incomplete ({kdir}/layout.json is missing).")
        if len(layout_bytes) > MAX_LAYOUT_JSON_BYTES:
            raise PackageError("A keyboard in the file is too large.")
        for path in sorted(names):
            if path.startswith(f"{kdir}/assets/"):
                name = path[len(kdir) + 8:]
                if ASSET_NAME.fullmatch(name) and ".." not in name and name.rsplit(".", 1)[-1].lower() in ASSET_EXTENSIONS:
                    checked(path)
        try:
            layout = json.loads(layout_bytes.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise PackageError(f"{kdir}/layout.json is not valid JSON.")
        layouts.append(check_layout(layout))

    has_sig = "signature.sig" in names
    sig_ok = has_sig and verify_signature(manifest_bytes, zf.read("signature.sig"), rules)
    return {"layouts": layouts, "signed": bool(sig_ok and covered[0]), "hasSignature": has_sig, "manifest": manifest}


def read_dictionary_package(data: bytes) -> dict:
    if len(data) > MAX_CATALOG_PACKAGE_BYTES:
        raise PackageError("The file is larger than 2 MB.")
    zf = _open_zip(data, ".nokydict")
    names = set(zf.namelist())
    if "manifest.json" not in names:
        raise PackageError("This is not a Noky word pack (manifest.json is missing).")
    try:
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise PackageError("The word pack has a damaged manifest.")
    if not isinstance(manifest, dict) or manifest.get("packageType") not in ("noky_dictionary_package", "nokydict"):
        raise PackageError("This is not a Noky word pack.")
    words = "words.txt" if "words.txt" in names else ("dictionary.txt" if "dictionary.txt" in names else None)
    if not words:
        raise PackageError("The word pack has no words.txt.")
    code = manifest.get("code")
    if not isinstance(code, str) or not DICT_CODE.fullmatch(code):
        raise PackageError("The word pack needs a short `code` in its manifest (lowercase letters, digits, `_` or `-`).")
    return {"manifest": manifest, "words": zf.read(words).decode("utf-8", errors="replace")}


# ── Catalog entries ─────────────────────────────────────────────────────────
def keyboard_entry(filename: str, data: bytes, pkg: dict, meta: dict = None) -> dict:
    layout = pkg["layouts"][0]
    layers = layout.get("layers", {})
    initial = layers.get(layout.get("initialLayer", "default")) or next(iter(layers.values()), {"rows": []})
    rows = initial.get("rows", [])
    key_count = 0
    shapes = {(layout.get("defaultKeyStyle") or {}).get("shape", "ROUNDED_RECT")}
    has_offsets = False
    for r in rows:
        for k in r.get("keys", []):
            if (k.get("action") or {}).get("type", "CommitText") != "EmptySpace":
                key_count += 1
            cs = k.get("customStyle") or {}
            if cs.get("shape"):
                shapes.add(cs["shape"])
            if (cs.get("offsetXDp") or 0) != 0 or (cs.get("offsetYDp") or 0) != 0:
                has_offsets = True
    default_shape = (layout.get("defaultKeyStyle") or {}).get("shape", "ROUNDED_RECT")
    meta = meta or {}
    return {
        "id": layout["id"],
        "name": layout.get("name") or filename.rsplit(".", 1)[0],
        "author": layout.get("author") or "Community",
        "description": layout.get("description") or "Custom keyboard layout for Noky Keyboard.",
        "locale": layout.get("locale", "en"),
        "languages": layout.get("languages", ["en"]),
        "version": layout.get("version", 1),
        "category": meta.get("category", "Community"),
        "tags": meta.get("tags", [str(layout.get("locale", "en")).upper(), default_shape.replace("_", " ").title()]),
        "featured": bool(meta.get("featured", False)),
        # "official" = curated by the maintainers or signed by Noky — never what the file claims.
        "official": bool(meta.get("official")) or pkg["signed"],
        "signed": pkg["signed"],
        "rowCount": len(rows),
        "keyCount": key_count,
        "layerCount": len(layers),
        "shapesUsed": sorted(shapes),
        "hasOffsets": has_offsets,
        "fileName": filename,
        "downloadUrl": f"./packages/keyboards/{filename}",
        "fileSize": len(data),
        "sha256": sha256_hex(data),
        "previewLayout": layout,
    }


def dictionary_entry(filename: str, data: bytes, pkg: dict, meta: dict = None) -> dict:
    manifest = pkg["manifest"]
    word_count = bigram_count = 0
    samples = []
    mode = "WORDS"
    for raw in pkg["words"].splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        if line.upper().startswith("#WORDS"):
            mode = "WORDS"
            continue
        if line.upper().startswith("#BIGRAMS"):
            mode = "BIGRAMS"
            continue
        if line.startswith("#"):
            continue
        if mode == "WORDS":
            word_count += 1
            if len(samples) < 10:
                word = line.split("\t")[0].split()[0].strip()
                if word and len(word) >= 2:
                    samples.append(word)
        else:
            bigram_count += 1
    code = manifest["code"]
    meta = meta or {}
    return {
        "code": code,
        "displayName": manifest.get("displayName", code.upper()),
        "nativeName": manifest.get("nativeName", manifest.get("displayName", code.upper())),
        "category": manifest.get("category", "LANGUAGE"),
        "version": manifest.get("version", 1),
        "description": meta.get("description", f"Offline predictive dictionary pack ({word_count:,} words) for Noky Keyboard."),
        "wordCount": word_count,
        "bigramCount": bigram_count,
        "sampleWords": samples[:8],
        "fileName": filename,
        "downloadUrl": f"./packages/dictionaries/{filename}",
        "fileSize": len(data),
        "sha256": sha256_hex(data),
    }


# ── Whole catalog ───────────────────────────────────────────────────────────
def metadata_from_catalog(catalog: dict) -> dict:
    """Keeps curated fields (category, tags, featured, official, descriptions, order) across rebuilds."""
    kb_meta, dict_meta = {}, {}
    for k in (catalog or {}).get("keyboards", []):
        kb_meta[k["fileName"]] = {f: k[f] for f in ("category", "tags", "featured", "official") if f in k}
    for d in (catalog or {}).get("dictionaries", []):
        dict_meta[d["code"]] = {"description": d.get("description")} if d.get("description") else {}
    return {
        "keyboard_meta": kb_meta,
        "dictionary_meta": dict_meta,
        "keyboard_order": [k["fileName"] for k in (catalog or {}).get("keyboards", [])],
        "dictionary_order": [d["code"] for d in (catalog or {}).get("dictionaries", [])],
    }


def build_catalog(site_dir: str, rules: dict, keyboard_meta=None, dictionary_meta=None,
                  keyboard_order=None, dictionary_order=None, log=print) -> dict:
    keyboard_meta = keyboard_meta or {}
    dictionary_meta = dictionary_meta or {}
    kb_dir = os.path.join(site_dir, "packages", "keyboards")
    dict_dir = os.path.join(site_dir, "packages", "dictionaries")

    keyboards = []
    for fname in sorted(os.listdir(kb_dir)) if os.path.isdir(kb_dir) else []:
        if not fname.endswith(".nokyboard"):
            continue
        with open(os.path.join(kb_dir, fname), "rb") as f:
            data = f.read()
        try:
            pkg = read_keyboard_package(data, rules)
            kid = pkg["layouts"][0]["id"]
            status = import_status(kid, pkg["signed"], rules)
            if status.startswith("REJECTED"):
                raise PackageError(f"'{kid}' is reserved or built-in and the file is not signed by Noky")
        except PackageError as err:
            log(f"SKIPPED {fname}: {err}")
            continue
        keyboards.append(keyboard_entry(fname, data, pkg, keyboard_meta.get(fname)))

    dictionaries = []
    for fname in sorted(os.listdir(dict_dir)) if os.path.isdir(dict_dir) else []:
        if not fname.endswith(".nokydict"):
            continue
        with open(os.path.join(dict_dir, fname), "rb") as f:
            data = f.read()
        try:
            pkg = read_dictionary_package(data)
        except PackageError as err:
            log(f"SKIPPED {fname}: {err}")
            continue
        dictionaries.append(dictionary_entry(fname, data, pkg, dictionary_meta.get(pkg["manifest"]["code"])))

    ko = {f: i for i, f in enumerate(keyboard_order or [])}
    keyboards.sort(key=lambda k: (ko.get(k["fileName"], len(ko)), k["name"].lower()))
    do = {c: i for i, c in enumerate(dictionary_order or [])}
    dictionaries.sort(key=lambda d: (do.get(d["code"], len(do)), d["displayName"].lower()))

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z"),
        "repositoryUrl": "https://github.com/alllifelevel/noky",
        "siteUrl": "https://noky.allstudio.app",
        "playStoreUrl": "https://play.google.com/store/apps/details?id=app.allstudio.noky",
        "keyboards": keyboards,
        "dictionaries": dictionaries,
    }


def write_catalog(site_dir: str, catalog: dict, generator: str):
    with open(os.path.join(site_dir, "catalog.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(site_dir, "catalog-data.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(f"// Auto-generated by {generator} — do not edit by hand\n")
        f.write("window.NOKY_CATALOG_DATA = ")
        json.dump(catalog, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")


def read_catalog(site_dir: str) -> dict:
    path = os.path.join(site_dir, "catalog.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)
