# e33-mapped-verses-form.py — evidence for epic #33, issue #15.
#
# The Copenhagen Alliance versification schema declares mappedVerses values as a
# SINGLE bcvRange:
#     "mappedVerses": {"propertyNames": {"$ref": "#/definitions/bcvRange"},
#                      "additionalProperties": {"$ref": "#/definitions/bcvRange"}}
# i.e. one source range -> one target range.
#
# The Pankosmia maintainer's fork (2026-08-24: "Proskomma and burritos use my fork...
# It's one minor change to allow one more many to many scenario") permits an ARRAY of
# bcvRange as the value — one source range -> MANY target ranges.
#
# Proskomma implements the fork: preSuccinctVerseMapping accepts string OR array
# ('if (typeof toSpecs === "string") toSpecs = [toSpecs]'), and reverseVersification
# requires an array.
#
# This script measures which form real data actually uses.
#
# Run: python3 docs/evidence/e33-mapped-verses-form.py

import base64
import glob
import json
import os
import urllib.request

SCHEMES = os.environ.get("VRS_DIR", "../../../dev-env/app-resources/templates/content_templates/vrs/")


def survey(name, doc):
    table = doc.get("mappedVerses", {})
    arrays = [k for k, v in table.items() if isinstance(v, list)]
    multi = [k for k, v in table.items() if isinstance(v, list) and len(v) > 1]
    print(
        f"  {name:12} entries={len(table):4}  array-valued={len(arrays):4}  multi-target={len(multi)}"
    )
    return multi


print("platform bundled schemes:")
for path in sorted(glob.glob(SCHEMES + "*.json")):
    survey(path.split("/")[-1], json.load(open(path)))

print("\nreal burritos (git.door43.org/BurritoTruck):")
for repo in ["grc_sept", "fr_psle"]:
    url = f"https://git.door43.org/api/v1/repos/BurritoTruck/{repo}/contents/ingredients/vrs.json"
    blob = json.load(urllib.request.urlopen(url))
    survey(repo, json.loads(base64.b64decode(blob["content"]).decode()))
