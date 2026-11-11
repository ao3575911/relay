"""Create a portable handoff archive and source checksums with Python stdlib."""

from hashlib import sha256
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {"node_modules", ".venv", ".ruff_cache", "__pycache__", ".git"}


def files():
    return sorted(
        p
        for p in ROOT.rglob("*")
        if p.is_file()
        and not EXCLUDED.intersection(p.relative_to(ROOT).parts)
        and p.name not in {"SHA256SUMS", "browser-failure.png", ".DS_Store"}
        and not p.name.startswith(".env")
        and p.suffix != ".pyc"
    )


manifest = ROOT / "SHA256SUMS"
manifest.write_text(
    "".join(
        f"{sha256(p.read_bytes()).hexdigest()}  {p.relative_to(ROOT).as_posix()}\n"
        for p in files()
    )
)
archive = ROOT.parent / "relay-telegram.zip"
with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=9) as bundle:
    for file in [*files(), manifest]:
        bundle.write(file, f"relay-telegram/{file.relative_to(ROOT).as_posix()}")

checksum = sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(".zip.sha256").write_text(f"{checksum}  {archive.name}\n")
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None, "Archive integrity check failed"
print(f"Packaged {len(files()) + 1} files into {archive.name} ({archive.stat().st_size} bytes)")
