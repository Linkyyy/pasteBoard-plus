"""Import data only; never execute scripts shipped inside vocabulary archives."""
import gzip
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "vendor/vocabulary/TypeLingo-v1.zip"
with zipfile.ZipFile(SOURCE) as archive:
    for line in archive.read("checksums.sha256").decode().splitlines():
        if line.strip():
            expected, name = line.split(maxsplit=1)
            actual = hashlib.sha256(archive.read(name.lstrip("*"))).hexdigest()
            if actual != expected:
                raise ValueError(f"Vocabulary checksum mismatch: {name}")
    entries = [json.loads(line) for line in archive.read("entries.jsonl").decode().splitlines() if line]
    conflicts = [json.loads(line) for line in archive.read("ambiguous.jsonl").decode().splitlines() if line]
    data = {
        "entries": [[e["sourceLanguage"], e["targetLanguage"], e["sourceText"], e["translatedText"]] for e in entries if e["style"] == "natural"],
        "ambiguous": [[e["sourceLanguage"], e["targetLanguage"], e["sourceText"]] for e in conflicts if e["type"] == "conflict"],
        "count": len(entries),
    }
    target = ROOT / "public/vocabulary"
    target.mkdir(parents=True, exist_ok=True)
    content = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    (target / "typelingo.json.gz").write_bytes(gzip.compress(content, mtime=0))
    licenses = ROOT / "assets/vocabulary"
    licenses.mkdir(parents=True, exist_ok=True)
    for name in ["licenses/LICENSE.txt", "licenses/REFERENCES.md", "manifest.json"]:
        (licenses / Path(name).name).write_bytes(archive.read(name))
print(f"Imported {len(data['entries'])} records and {len(data['ambiguous'])} blocked ambiguity keys.")
