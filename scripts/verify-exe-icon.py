"""Prove an executable embeds the brand icon, by parsing its PE resources.

The operator's ask was that the Portable launcher wear the browser's icon, and the previous
defect was invisible to a glance: NSIS compiled its own default mark into the launcher while
the shell inside carried the brand. So this does not use `ExtractAssociatedIcon` — that API
resamples whatever it finds, which makes a digest comparison meaningless and would pass a wrong
icon that merely looks similar.

It walks the PE resource directory instead and compares each `RT_ICON` frame byte-for-byte
against the frames of `assets/brand/nulltrace-icon.ico`. A launcher is correct when every frame
it carries is one of the brand frames, and the brand `.ico` sizes are all present.

Usage:
    python scripts/verify-exe-icon.py <exe> [<exe> ...]

Exit status is non-zero when a file carries a frame that is not the brand mark, or is missing
a size the brand `.ico` provides.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

BRAND_ICO = "assets/brand/nulltrace-icon.ico"
RT_ICON = 3
RT_GROUP_ICON = 14
RESOURCE_DIRECTORY = 2


def brand_frames() -> dict[bytes, int]:
    """Map every image payload in the brand `.ico` to its width (0 means 256)."""
    data = Path(BRAND_ICO).read_bytes()
    reserved, image_type, count = struct.unpack_from("<HHH", data, 0)
    if reserved != 0 or image_type != 1:
        raise ValueError(f"{BRAND_ICO} is not an ICO container")

    frames: dict[bytes, int] = {}
    for index in range(count):
        entry = 6 + index * 16
        width, _height, _colors, _reserved, _planes, _bpp, length, offset = struct.unpack_from(
            "<BBBBHHII", data, entry
        )
        frames[data[offset : offset + length]] = width
    return frames


def iter_sections(data: bytes) -> list[tuple[int, int, int]]:
    """(virtual address, raw offset, raw size) for every PE section."""
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe_offset : pe_offset + 4] != b"PE\0\0":
        raise ValueError("not a PE file")

    section_count = struct.unpack_from("<H", data, pe_offset + 6)[0]
    optional_size = struct.unpack_from("<H", data, pe_offset + 20)[0]
    section_table = pe_offset + 24 + optional_size

    sections = []
    for index in range(section_count):
        base = section_table + index * 40
        virtual_size, virtual_address, raw_size, raw_offset = struct.unpack_from(
            "<IIII", data, base + 8
        )
        sections.append((virtual_address, raw_offset, max(virtual_size, raw_size)))
    return sections


def rva_to_offset(sections: list[tuple[int, int, int]], rva: int) -> int | None:
    for virtual_address, raw_offset, size in sections:
        if virtual_address <= rva < virtual_address + size:
            return raw_offset + (rva - virtual_address)
    return None


def resource_leaves(data: bytes) -> dict[int, list[bytes]]:
    """Every `RT_ICON` payload in a PE file, keyed by resource type."""
    sections = iter_sections(data)
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    optional_size = struct.unpack_from("<H", data, pe_offset + 20)[0]
    optional = pe_offset + 24
    magic = struct.unpack_from("<H", data, optional)[0]
    # Where the data directories begin: fixed for each optional-header flavour.
    directories = optional + (112 if magic == 0x20B else 96)
    # IMAGE_DIRECTORY_ENTRY_RESOURCE is index 2, and each entry is 8 bytes of (RVA, size).
    resource_rva = struct.unpack_from("<I", data, directories + RESOURCE_DIRECTORY * 8)[0]
    if resource_rva == 0:
        return {}

    root = rva_to_offset(sections, resource_rva)
    if root is None:
        return {}

    found: dict[int, list[bytes]] = {}

    def walk(entry_offset: int, level: int, type_id: int | None) -> None:
        # An IMAGE_RESOURCE_DIRECTORY is 16 bytes; its entry count follows the header fields.
        named, ids = struct.unpack_from("<HH", data, entry_offset + 12)
        for index in range(named + ids):
            base = entry_offset + 16 + index * 8
            name_or_id, child = struct.unpack_from("<II", data, base)
            current_type = type_id if level else name_or_id

            if child & 0x80000000:
                walk(root + (child & 0x7FFFFFFF), level + 1, current_type)
                continue

            # A leaf: (data RVA, size) inside IMAGE_RESOURCE_DATA_ENTRY.
            entry = root + child
            data_rva, data_size = struct.unpack_from("<II", data, entry)
            offset = rva_to_offset(sections, data_rva)
            if offset is None or current_type is None:
                continue
            found.setdefault(current_type, []).append(data[offset : offset + data_size])

    walk(root, 0, None)
    return found


def report(exe: str, brand: dict[bytes, int]) -> int:
    path = Path(exe)
    if not path.exists():
        print(f"{path.name}: MISSING")
        return 1

    data = path.read_bytes()
    leaves = resource_leaves(data)
    icons = leaves.get(RT_ICON, [])
    groups = leaves.get(RT_GROUP_ICON, [])

    # The group directory is what names the entry Windows shows; a launcher has exactly one.
    group_sizes: list[int] = []
    for group in groups:
        if len(group) < 6:
            continue
        count = struct.unpack_from("<H", group, 4)[0]
        for index in range(count):
            entry = 6 + index * 14
            if entry + 14 > len(group):
                break
            group_sizes.append(struct.unpack_from("<B", group, entry)[0])

    size_mb = len(data) / 1_048_576
    print(f"{path.name}  ({size_mb:.1f} MB)")
    print(f"  RT_ICON frames: {len(icons)}   group entries: {group_sizes or '(none)'}")

    if not icons:
        print("  FAIL — no RT_ICON frames at all")
        return 1

    unknown = [frame for frame in icons if frame not in brand]
    known_sizes = sorted({brand[frame] or 256 for frame in icons if frame in brand})
    print(f"  brand frames matched: {known_sizes}")
    if unknown:
        # The frames differ from the CURRENT brand file. That is either a wrong icon (NSIS's
        # default, another product's mark) or an older revision of this one — the sizes it
        # carries tell them apart, and the caller sees which sizes matched.
        print(f"  FAIL — {len(unknown)} frame(s) differ from the current brand mark")
        return 1

    brand_sizes = sorted(w or 256 for w in brand.values())
    missing = [size for size in brand_sizes if size not in known_sizes]
    if missing:
        print(f"  FAIL — brand sizes absent from the executable: {missing}")
        return 1

    print("  OK — every frame is the brand mark, at every size the brand provides")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    brand = brand_frames()
    print(f"brand: {BRAND_ICO} carries {len(brand)} frames, sizes "
          f"{sorted(w or 256 for w in brand.values())}")
    print()

    failures = sum(report(exe, brand) for exe in sys.argv[1:])
    print()
    print("PASS — all files carry the brand icon" if not failures
          else f"FAIL — {failures} file(s) do not")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
