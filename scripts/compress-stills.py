"""Write compressed JPEG copies of selected stills. Does not touch originals."""
from pathlib import Path
from PIL import Image

root = Path(r"C:\Users\MH\Desktop\Nuhara-protofilo")
out = root / "site" / "public" / "stills"
out.mkdir(parents=True, exist_ok=True)

interior = None
for folder in (root / "projects").iterdir():
    candidate = folder / "renders final"
    if candidate.is_dir():
        interior = candidate
        break

if interior is None:
    raise SystemExit("Interior renders folder was not found")

jobs = [
    (root / "projects" / "Hospital" / "renders" / "Copy of 12 day.png", "hope-street.jpg"),
    (root / "projects" / "Hospital" / "renders" / "Copy of 4.png", "hope-court.jpg"),
    (root / "projects" / "Hospital" / "renders" / "Copy of 5.png", "hope-axis.jpg"),
    (interior / "10.png", "interior-living.jpg"),
    (interior / "20 IN DAY.png", "interior-kitchen.jpg"),
    (interior / "14 DETAIL.png", "interior-detail.jpg"),
    (interior / "8.png", "interior-evening.jpg"),
]

for src, name in jobs:
    image = Image.open(src).convert("RGB")
    image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    dest = out / name
    image.save(dest, "JPEG", quality=80, optimize=True, progressive=True)
    print(f"{name} {image.size[0]}x{image.size[1]} {dest.stat().st_size // 1024}KB")
