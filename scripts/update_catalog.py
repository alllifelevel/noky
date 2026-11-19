#!/usr/bin/env python3
"""
Rebuilds catalog.json and catalog-data.js from the files in packages/.

Runs in the public site repo after a community submission is approved. Curated details of
keyboards already in the catalog (category, tags, featured, official, order, word pack
descriptions) are kept; new community keyboards are added under "Community".

Usage:  python3 scripts/update_catalog.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import noky_catalog as nc  # noqa: E402


def main():
    rules = nc.load_rules()
    existing = nc.read_catalog(nc.SITE_DIR)
    catalog = nc.build_catalog(nc.SITE_DIR, rules, **nc.metadata_from_catalog(existing))
    if existing and {k: v for k, v in existing.items() if k != "generatedAt"} == {k: v for k, v in catalog.items() if k != "generatedAt"}:
        print("Catalog already up to date.")
        return
    nc.write_catalog(nc.SITE_DIR, catalog, "scripts/update_catalog.py")
    print(f"Catalog updated: {len(catalog['keyboards'])} keyboards, {len(catalog['dictionaries'])} word packs.")


if __name__ == "__main__":
    main()
