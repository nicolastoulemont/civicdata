"""Rebuild the explicit AE geography map from official, saved inputs.

python3 docs/research/faostat/map.py /path/to/m49.html docs/research/faostat/AE.zip

Save https://unstats.un.org/unsd/methodology/m49/overview/ as the first input.
The output replaces packages/server/src/faostat.json; review it before use.
"""
import csv
import html
import io
import json
import re
import sys
import zipfile
from pathlib import Path

country = {}
for row in re.findall(r"<tr[^>]*>(.*?)</tr>", Path(sys.argv[1]).read_text(), re.S):
    cells = [
        html.unescape(re.sub(r"<[^>]+>", "", cell)).strip()
        for cell in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
    ]
    if len(cells) > 11 and re.fullmatch(r"[A-Z]{3}", cells[11]):
        country[cells[9]] = cells[11]

with zipfile.ZipFile(sys.argv[2]) as archive:
    data = archive.read("ASTI_Expenditures_E_AreaCodes.csv").decode("utf-8-sig")

areas = {}
for row in csv.DictReader(io.StringIO(data)):
    code = row["Area Code"]
    # Neither the FAO aggregate nor mainland definition is our China.
    national = None if code in {"41", "351"} else country.get(row["M49 Code"].lstrip("'"))
    areas[code] = {"m49": row["M49 Code"], "label": row["Area"], "country": national}

Path("packages/server/src/faostat.json").write_text(json.dumps(areas, indent=2) + "\n")
