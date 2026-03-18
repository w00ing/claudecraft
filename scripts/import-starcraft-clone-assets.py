#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

try:
    from PIL import Image
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Missing dependency: Pillow. Install with `python3 -m pip install pillow`."
    ) from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPO_DIR = REPO_ROOT / "assets" / "external" / "StarCraft"
DEFAULT_OUT_DIR = REPO_ROOT / "assets" / "starcraft-local-from-clone"

BLACK_KEY_THRESHOLD = 14


def load_rgba(path: Path, key_black: bool = False) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    if not key_black:
        return image
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if r <= BLACK_KEY_THRESHOLD and g <= BLACK_KEY_THRESHOLD and b <= BLACK_KEY_THRESHOLD:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def find_components(image: Image.Image, min_area: int = 20) -> list[tuple[int, int, int, int, int]]:
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    opaque = [1 if value > 0 else 0 for value in alpha]
    visited = [0] * (width * height)
    boxes: list[tuple[int, int, int, int, int]] = []

    for y in range(height):
        for x in range(width):
            idx = y * width + x
            if not opaque[idx] or visited[idx]:
                continue
            queue = deque([idx])
            visited[idx] = 1
            min_x = max_x = x
            min_y = max_y = y
            area = 0

            while queue:
                cur = queue.popleft()
                cy, cx = divmod(cur, width)
                area += 1
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)

                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < width and 0 <= ny < height:
                        nidx = ny * width + nx
                        if opaque[nidx] and not visited[nidx]:
                            visited[nidx] = 1
                            queue.append(nidx)

            if area >= min_area:
                boxes.append((min_x, min_y, max_x + 1, max_y + 1, area))

    boxes.sort(key=lambda item: (item[1], item[0]))
    return boxes


def crop_component(image: Image.Image, index: int, min_area: int = 20, padding: int = 2) -> Image.Image:
    components = find_components(image, min_area=min_area)
    if index < 0 or index >= len(components):
        raise ValueError(f"component index {index} out of range (count={len(components)})")
    x0, y0, x1, y1, _area = components[index]
    x0 = max(0, x0 - padding)
    y0 = max(0, y0 - padding)
    x1 = min(image.width, x1 + padding)
    y1 = min(image.height, y1 + padding)
    return image.crop((x0, y0, x1, y1))


def save(image: Image.Image, name: str, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    image.save(out_dir / name)


def extract_blue_mineral_patch(map_image: Image.Image) -> Image.Image:
    width, height = map_image.size
    rgba = map_image.convert("RGBA")
    pixels = rgba.load()

    mask = [0] * (width * height)
    for y in range(height):
        for x in range(width):
            r, g, b, _a = pixels[x, y]
            if b > 120 and b > g + 25 and b > r + 35:
                mask[y * width + x] = 1

    visited = [0] * (width * height)
    best_box = None
    best_area = 0

    for y in range(height):
        for x in range(width):
            idx = y * width + x
            if not mask[idx] or visited[idx]:
                continue
            queue = deque([idx])
            visited[idx] = 1
            min_x = max_x = x
            min_y = max_y = y
            area = 0

            while queue:
                cur = queue.popleft()
                cy = cur // width
                cx = cur % width
                area += 1
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < width and 0 <= ny < height:
                        nidx = ny * width + nx
                        if mask[nidx] and not visited[nidx]:
                            visited[nidx] = 1
                            queue.append(nidx)

            if area > best_area:
                best_area = area
                best_box = (min_x, min_y, max_x + 1, max_y + 1)

    if not best_box:
        return map_image.crop((0, 0, 96, 96)).convert("RGBA")

    x0, y0, x1, y1 = best_box
    pad = 14
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(width, x1 + pad)
    y1 = min(height, y1 + pad)
    return rgba.crop((x0, y0, x1, y1))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate agentcraft starcraft-local assets from the raydogg779/StarCraft repo."
    )
    parser.add_argument(
        "--repo-dir",
        type=Path,
        default=DEFAULT_REPO_DIR,
        help=f"Path to cloned StarCraft repo (default: {DEFAULT_REPO_DIR})"
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"Output directory for generated assets (default: {DEFAULT_OUT_DIR})"
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    src_root = args.repo_dir / "img"
    out_dir = args.out_dir

    if not src_root.exists():
        raise SystemExit(f"Missing source directory: {src_root}")

    scv = load_rgba(src_root / "Charas" / "SCV.png", key_black=True)
    probe = load_rgba(src_root / "Charas" / "Probe.png", key_black=True)
    drone = load_rgba(src_root / "Charas" / "Drone.png", key_black=True)
    marine = load_rgba(src_root / "Charas" / "Marine.png", key_black=True)
    tank = load_rgba(src_root / "Charas" / "Tank.png", key_black=True)
    terran_building = load_rgba(src_root / "Charas" / "TerranBuilding.png", key_black=True)
    mud = load_rgba(src_root / "Charas" / "Mud.png", key_black=True)
    cmd_icons = load_rgba(src_root / "Menu" / "CmdIcons.png", key_black=True)
    control_panel = load_rgba(src_root / "Menu" / "ControlPanel.png", key_black=False)
    map_grass = Image.open(src_root / "Maps" / "Map_Grass.jpg").convert("RGBA")

    # Unit/building style assets
    save(crop_component(scv, 0, min_area=20), "worker.png", out_dir)
    # Command Center-like frame (replaces depot-like frame)
    save(crop_component(terran_building, 39, min_area=20, padding=4), "base.png", out_dir)
    save(extract_blue_mineral_patch(map_grass), "mineral-patch.png", out_dir)
    save(crop_component(marine, 0, min_area=20), "unit-light.png", out_dir)
    save(crop_component(tank, 0, min_area=20), "unit-heavy.png", out_dir)
    save(crop_component(cmd_icons, 227, min_area=40, padding=2), "queue.png", out_dir)

    # Terrain textures: single large world crop to avoid visible tile seams
    save(map_grass.crop((128, 1024, 1152, 1516)), "terrain-tile.png", out_dir)
    save(mud.crop((0, 0, 220, 108)), "terrain-creep.png", out_dir)

    # HUD slices (control panel source contains zerg/protoss/terran strips left->right)
    def crop_ui(x0: int, x1: int, y0: int, y1: int) -> Image.Image:
        return control_panel.crop((x0, y0, x1, y1))

    save(crop_ui(0, 555, 0, 56), "ui-top-zerg.png", out_dir)
    save(crop_ui(0, 555, 36, 192), "ui-bottom-zerg.png", out_dir)
    save(crop_ui(555, 1110, 0, 56), "ui-top-protoss.png", out_dir)
    save(crop_ui(555, 1110, 36, 192), "ui-bottom-protoss.png", out_dir)
    save(crop_ui(1110, 1665, 0, 56), "ui-top-terran.png", out_dir)
    save(crop_ui(1110, 1665, 36, 192), "ui-bottom-terran.png", out_dir)

    save(control_panel.crop((1110, 22, 1328, 190)), "minimap-frame.png", out_dir)

    # Icons/portraits/command cards
    save(crop_component(cmd_icons, 83, min_area=40, padding=2), "icon-minerals.png", out_dir)
    save(crop_component(cmd_icons, 239, min_area=40, padding=2), "icon-supply.png", out_dir)

    save(crop_component(scv, 0, min_area=20), "portrait-worker-terran.png", out_dir)
    save(crop_component(probe, 0, min_area=20), "portrait-worker-protoss.png", out_dir)
    save(crop_component(drone, 0, min_area=20), "portrait-worker-zerg.png", out_dir)

    save(crop_component(cmd_icons, 271, min_area=40, padding=2), "command-move.png", out_dir)
    save(crop_component(cmd_icons, 142, min_area=40, padding=2), "command-stop.png", out_dir)
    save(crop_component(cmd_icons, 166, min_area=40, padding=2), "command-hold.png", out_dir)

    print(f"Generated starcraft-local pack at: {out_dir}")
    for target in sorted(p.name for p in out_dir.glob("*.png")):
        print(f" - {target}")


if __name__ == "__main__":
    main()
