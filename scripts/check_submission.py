#!/usr/bin/env python3
"""
Checks a community pull request against the catalog rules and writes a Markdown report.

It never runs anything from the pull request: the GitHub Action passes in the list of
changed paths (from the GitHub API) and the submitted files as plain data.

Checks:
  * the pull request only ADDS files, and only under packages/keyboards/*.nokyboard or
    packages/dictionaries/*.nokydict — no website code, no edits, no deletions;
  * every file is a valid package the Noky app would install (structure, digests, layout shape);
  * every keyboard ID follows Namespace-Name, isn't reserved or built-in, isn't the studio's
    own namespace, and isn't already in the catalog (or used twice in the same request);
  * file names match the IDs, so each keyboard lives at a predictable address.

Usage:
  python3 scripts/check_submission.py --changes changes.json --files <dir> --report report.md [--summary summary.json]
Exit code 0 = ready for review, 1 = needs changes.
"""

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import noky_catalog as nc  # noqa: E402

KB_PATH = re.compile(r"packages/keyboards/([A-Za-z0-9_-]{1,100})\.nokyboard")
DICT_PATH = re.compile(r"packages/dictionaries/([a-z0-9_-]{1,32})\.nokydict")
MAX_FILES = 10
SITE = "https://noky.allstudio.app"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--changes", required=True, help="JSON list of {filename, status} from the GitHub API")
    ap.add_argument("--files", required=True, help="Folder holding the submitted files at their repo paths")
    ap.add_argument("--report", required=True)
    ap.add_argument("--summary")
    args = ap.parse_args()

    rules = nc.load_rules()
    catalog = nc.read_catalog(nc.SITE_DIR)
    known_ids = {nc.canonical_id(k["id"], rules).lower() for k in catalog.get("keyboards", [])}
    known_codes = {d["code"].lower() for d in catalog.get("dictionaries", [])}

    with open(args.changes, encoding="utf-8") as f:
        changes = json.load(f)

    problems = []       # blocking
    notes = []          # non-blocking
    sections = []       # per-package report blocks
    accepted_ids = []

    # 1. Only new package files.
    packages = []
    for ch in changes:
        path, status = ch.get("filename", ""), ch.get("status", "")
        is_pkg = KB_PATH.fullmatch(path) or DICT_PATH.fullmatch(path)
        if not is_pkg:
            problems.append(f"`{path}` — only keyboard (`packages/keyboards/*.nokyboard`) and word pack (`packages/dictionaries/*.nokydict`) files can be submitted. Please remove this change.")
        elif status != "added":
            problems.append(f"`{path}` — existing files can't be changed or removed in a submission ({status}). Submit a new file instead.")
        else:
            packages.append(path)
    if not changes:
        problems.append("This pull request doesn't change any files.")
    elif not packages and not problems:
        problems.append("No keyboard or word pack files were added.")
    if len(packages) > MAX_FILES:
        problems.append(f"Please submit at most {MAX_FILES} files per pull request.")

    # 2. Each package.
    seen_ids = set()
    for path in packages:
        lines = []
        ok = True
        local = os.path.join(args.files, *path.split("/"))
        try:
            with open(local, "rb") as f:
                data = f.read()
        except OSError:
            problems.append(f"`{path}` — the file could not be read.")
            continue

        if path.endswith(".nokyboard"):
            stem = KB_PATH.fullmatch(path).group(1)
            try:
                pkg = nc.read_keyboard_package(data, rules)
            except nc.PackageError as err:
                sections.append(f"#### ❌ `{path}`\n- {err}")
                problems.append(f"`{path}` — {err}")
                continue
            lines.append(f"- ✅ Valid Noky keyboard file · {len(pkg['layouts'])} keyboard(s) · {len(data) / 1024:.1f} KB")
            for i, layout in enumerate(pkg["layouts"]):
                kid = layout["id"].strip()
                label = f"`{kid}`" + (f" — {layout.get('name')}" if layout.get("name") else "")
                status = nc.import_status(kid, pkg["signed"], rules)
                valid, reason = nc.validate_user_id(kid, rules)
                ns = kid.split("-", 1)[0].lower() if "-" in kid else ""
                canon = nc.canonical_id(kid, rules).lower()
                if status == "REJECTED_BUILT_IN" or status == "REJECTED_NOT_SIGNED":
                    lines.append(f"- ❌ {label}: this ID is reserved and can't be used. Pick another one, like `YourName-{kid.split('-')[-1] or 'Keyboard'}`.")
                    ok = False
                elif status != "OFFICIAL" and not valid:
                    lines.append(f"- ❌ {label}: {reason}")
                    ok = False
                elif ns in rules["studioNamespaces"] and not pkg["signed"]:
                    lines.append(f"- ❌ {label}: the `{kid.split('-', 1)[0]}` name is used for ALLStudio's own keyboards. Please use your own name, like `YourName-{kid.split('-', 1)[1]}`.")
                    ok = False
                elif canon in known_ids:
                    lines.append(f"- ❌ {label}: a keyboard with this ID is already in the catalog. Choose a different name.")
                    ok = False
                elif canon in seen_ids:
                    lines.append(f"- ❌ {label}: this ID is used twice in this pull request.")
                    ok = False
                else:
                    lines.append(f"- ✅ {label}: new, unique ID")
                    accepted_ids.append(kid)
                seen_ids.add(canon)
                if i == 0 and stem != kid:
                    lines.append(f"- ❌ The file should be named `{kid}.nokyboard` (it is `{stem}.nokyboard`).")
                    ok = False
                # Does it actually work once installed? (layer links, actions, keys, auto-switch, toolbar)
                package_ids = {l["id"].strip() for l in pkg["layouts"]}
                errs, warns = nc.check_keyboard_behaviour(layout, package_ids, rules)
                layer_count = len(layout["layers"])
                key_count = sum(1 for l in layout["layers"].values() for r in l.get("rows", []) for k in r.get("keys", [])
                                if (k.get("action") or {}).get("type") != "EmptySpace")
                if errs:
                    ok = False
                    lines.append(f"- ❌ {label}: {len(errs)} thing(s) wouldn't work in Noky:")
                    lines.extend(f"  - {e}" for e in errs[:8])
                    if len(errs) > 8:
                        lines.append(f"  - …and {len(errs) - 8} more like these.")
                else:
                    lines.append(f"- ✅ {label}: works in Noky — {layer_count} layer(s), {key_count} keys, every key and layer link checked")
                for w in warns[:5]:
                    lines.append(f"- ⚠️ {w}")
                if len(warns) > 5:
                    lines.append(f"- ⚠️ …and {len(warns) - 5} more notes like these.")
                if not (layout.get("description") or "").strip():
                    lines.append(f"- ⚠️ {label} has no description. Adding one helps people find it (optional).")
                    notes.append("missing description")
            if pkg["hasSignature"] and not pkg["signed"]:
                lines.append("- ⚠️ The file carries a signature that isn't Noky's; it will be treated as unsigned.")
            sections.append(f"#### {'✅' if ok else '❌'} `{path}`\n" + "\n".join(lines))
            if not ok:
                problems.append(f"`{path}` needs changes (details below).")
        else:
            stem = DICT_PATH.fullmatch(path).group(1)
            try:
                pkg = nc.read_dictionary_package(data)
            except nc.PackageError as err:
                sections.append(f"#### ❌ `{path}`\n- {err}")
                problems.append(f"`{path}` — {err}")
                continue
            code = pkg["manifest"]["code"]
            lines.append(f"- ✅ Valid Noky word pack · `{code}` · {len(data) / 1024:.1f} KB")
            if code.lower() in known_codes or code.lower() in seen_ids:
                lines.append(f"- ❌ A word pack with code `{code}` already exists. Choose a different code.")
                ok = False
            if stem != code:
                lines.append(f"- ❌ The file should be named `{code}.nokydict` (it is `{stem}.nokydict`).")
                ok = False
            seen_ids.add(code.lower())
            sections.append(f"#### {'✅' if ok else '❌'} `{path}`\n" + "\n".join(lines))
            if not ok:
                problems.append(f"`{path}` needs changes (details below).")

    ready = not problems
    out = ["<!-- noky-submission-check -->"]
    if ready:
        out.append("## ✅ Ready for review\n\nThanks for your submission! Everything checks out. A maintainer will take a look soon.")
    else:
        out.append("## 🛠️ A few things to fix\n\nThanks for your submission! Please fix the items below and push the update to this pull request — this check runs again automatically.")
        out.append("\n".join(f"- {p}" for p in dict.fromkeys(problems)))
    if sections:
        out.append("### Files\n\n" + "\n\n".join(sections))
    out.append(f"<sub>Tip: you can check a file yourself before submitting at {SITE}/create.html</sub>")
    out.append("<details><summary>For maintainers</summary>\n\nComment one of:\n\n"
               "- `/approve` — merge, add to the catalog and publish\n"
               "- `/changes <what to fix>` — ask for changes\n"
               "- `/reject <reason>` — close the request\n</details>")
    report = "\n\n".join(out) + "\n"
    with open(args.report, "w", encoding="utf-8") as f:
        f.write(report)
    if args.summary:
        with open(args.summary, "w", encoding="utf-8") as f:
            json.dump({"ready": ready, "ids": accepted_ids, "problems": problems}, f)
    print(report)
    sys.exit(0 if ready else 1)


if __name__ == "__main__":
    main()
