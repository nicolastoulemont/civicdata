"""Extract only reviewed V16 fields; no estimates or intervals are calculated."""
import hashlib
import json
import sys
from pathlib import Path

import pandas
import pyreadr

archive, output = map(Path, sys.argv[1:])
expected = "39b412d39a061c18f20c98e4ad4d6355b05a0441df31be4ee9aec420dc3d95ea"
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise ValueError("Not the pinned V16 archive")
data = pyreadr.read_r(str(archive))["vdem"]
fields = ["country_name", "country_text_id", "country_id", "year", "v2x_polyarchy", "v2x_polyarchy_codelow", "v2x_polyarchy_codehigh"]
with output.open("w") as target:
    for values in data[fields].itertuples(index=False, name=None):
        row = {key: None if pandas.isna(value) else value for key, value in zip(fields, values)}
        target.write(json.dumps(row, allow_nan=False) + "\n")
