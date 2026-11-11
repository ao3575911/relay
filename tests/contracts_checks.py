"""Validate exported configuration fixtures against JSON Schema 2020-12."""

from copy import deepcopy
from pathlib import Path
import json

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
schema = json.loads((ROOT / "contracts/harness.schema.json").read_text())
example = json.loads((ROOT / "contracts/harness.example.json").read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
validator.validate(example)
checks = 1

for mode in ("simple", "advanced"):
    for cap in (50, 100, 200):
        config = deepcopy(example)
        config["mode"] = mode
        config["policy"]["runBudgetCents"] = cap
        config["tools"]["webRead"] = True
        config["policy"]["allowedDomains"] = ["docs.example.org"]
        validator.validate(config)
        checks += 1

bad_cases = [
    ("unknown root field", lambda c: c.update(secret="not allowed")),
    ("unknown tool", lambda c: c["tools"].update(shell=True)),
    ("bypass approval", lambda c: c["policy"].update(approvalMode="never")),
    ("negative budget", lambda c: c["policy"].update(runBudgetCents=-1)),
    ("web without allowlist", lambda c: c["tools"].update(webRead=True)),
    ("private hostname", lambda c: c["policy"].update(allowedDomains=["host.local"])),
    ("IP address", lambda c: c["policy"].update(allowedDomains=["127.0.0.1"])),
    ("URL", lambda c: c["policy"].update(allowedDomains=["https://example.org"])),
    ("duplicate domains", lambda c: c["policy"].update(allowedDomains=["example.org", "example.org"])),
    ("blank instructions", lambda c: c["agent"].update(instructions="  ")),
    ("invalid mode", lambda c: c.update(mode="unrestricted")),
    ("null tools", lambda c: c.update(tools=None)),
]
for name, mutate in bad_cases:
    config = deepcopy(example)
    mutate(config)
    assert list(validator.iter_errors(config)), f"Accepted {name}"
    checks += 1

report = {"passed": checks, "failed": 0, "schema_draft": "2020-12"}
(ROOT / "evidence/contracts-results.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
