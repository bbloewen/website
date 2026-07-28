import json, uuid, copy

# Feste Namespace-UUID für deterministische seat_guid/uuid-Vergabe: dieselbe Reihe/
# derselbe Sitz bekommt bei jedem Skriptlauf exakt dieselbe ID, statt bei jeder
# Regenerierung neu zu würfeln. Wichtig für die künftige Reservierung (Data Table/
# Pretix Seats API referenzieren Sitze dauerhaft über seat_guid) — ein zufälliger
# uuid4() bei jedem Lauf würde alle bestehenden Reservierungen verwaisen lassen.
NAMESPACE = uuid.UUID("d3b8a6d0-3f1a-4a5a-9c9a-8e6f6b6a1a10")

def stable_uuid(*parts):
    return str(uuid.uuid5(NAMESPACE, "-".join(str(p) for p in parts)))

def mkseat(zone_id, row_number, n, category):
    return {
        "seat_number": str(n),
        "seat_guid": stable_uuid(zone_id, row_number, n, "seat_guid"),
        "uuid": stable_uuid(zone_id, row_number, n, "uuid"),
        "position": {"x": (n - 1) * 25, "y": 0},
        "category": category
    }

def mkrow(zone_id, row_number, segments, category, y, section_break=False):
    # segments: list of aisle-separated cluster widths, e.g. [2, 20, 3] for a row
    # split by two aisles — seat numbering stays continuous across the aisles
    # (matches the real Saalplan PDF), only the VISUAL rendering gets a gap.
    total = sum(segments)
    breaks = []
    acc = 0
    for w in segments[:-1]:
        acc += w
        breaks.append(acc + 1)  # seat_number where the next cluster starts
    return {
        "uuid": stable_uuid(zone_id, row_number, "row_uuid"),
        "position": {"x": 0, "y": y},
        "row_number": str(row_number),
        "row_number_position": "both",
        "section_break": section_break,
        "segment_breaks": breaks,
        "seats": [mkseat(zone_id, row_number, n, category) for n in range(1, total + 1)]
    }

def build_zone(zone_id, name, row_specs, position, break_before=None):
    # row_specs: list of (row_number, [segment_widths], category), front-to-back order.
    # break_before: set of row_numbers (as strings) that get a purely visual gap
    # before them, independent of category — echoes the original plan's structural
    # split (e.g. Block A/B/C front block vs. back block) even where price/category
    # doesn't actually change (A/C are one Kategorie-II group throughout).
    # position: {"x", "y"} — Zonen-Verortung auf der Gesamt-Saalplan-Fläche, für
    # Pretix' eigenen Schema-Viewer/Sitzplan-Editor (unsere Website ignoriert das,
    # sie rendert Block-für-Block über eigenes CSS-Flex-Layout).
    break_before = break_before or set()
    rows = [mkrow(zone_id, rn, segs, cat, i * 40, section_break=(str(rn) in break_before))
            for i, (rn, segs, cat) in enumerate(row_specs)]
    return {
        "zone_id": zone_id,
        "uuid": stable_uuid(zone_id, "zone_uuid"),
        "name": name,
        "position": position,
        "rows": rows
    }

# Real per-row seat counts AND aisle-segment structure extracted from the official
# technical Saalplan PDF (230726_Ticketing Saison 2023 2024_Technischer Saalplan.pdf),
# read directly at 400dpi (every block's crop viewed and re-verified row by row,
# including exact aisle break positions — navy/dark-blue tags are row labels, never
# counted as seats). Categories are the REAL business assignment (per Marko,
# 27.-28.07.2026):
# - Block D (Gästeblock/Gästefans in the plan): unlocked for public sale as Kategorie II
#   (the plan itself marks it VIP/"nicht buchbar", overridden deliberately).
# - Block E: Kategorie I (matches plan).
# - Block F: Kategorie II (matches plan).
# - Blocks A/C: front rows are VIP/"nicht buchbar" in the plan, unlocked to Kategorie II
#   throughout (no VIP product in A/C) — everything stays bookable, no permanent
#   non-bookable state (a future per-game block is a separate concern, not modeled here).
# - Block B: ALL rows are VIP in the original plan (confirmed by direct inspection,
#   not just the front 5 rows) — the only real VIP product on the site.

KAT1 = "Kategorie I"
KAT2 = "Kategorie II"
VIP = "VIP"

# Nordtribüne: Reihe 6 (bzw. 7) ist die vorderste, am Spielfeld — das Spielfeld
# liegt im Layout UNTER den Nordblöcken, deshalb hier in umgekehrter Reihenfolge
# (14 zuerst / oben, 6 zuletzt / unten) im Array, damit Reihe 6 unten landet.
block_D = [
    (14, [7, 14, 7], KAT2),
    (13, [2, 20, 3], KAT2),
    (12, [2, 20, 3], KAT2),
    (11, [2, 20, 3], KAT2),
    (10, [20], KAT2),
    (9, [20], KAT2),
    (8, [20], KAT2),
    (7, [20], KAT2),
    (6, [10], KAT2),
]
block_E = [
    (14, [7, 3, 3, 7], KAT1),
    (13, [2, 6, 6, 3], KAT1),
    (12, [2, 8, 8, 3], KAT1),
    (11, [2, 20, 3], KAT1),
    (10, [20], KAT1),
    (9, [20], KAT1),
    (8, [20], KAT1),
    (7, [20], KAT1),
]
block_F = [
    (14, [7, 14, 7], KAT2),
    (13, [2, 20, 2], KAT2),
    (12, [2, 20, 2], KAT2),
    (11, [2, 20, 2], KAT2),
    (10, [20], KAT2),
    (9, [20], KAT2),
    (8, [20], KAT2),
    (7, [20], KAT2),
    (6, [10], KAT2),
]
block_A = [
    (1, [7, 12], KAT2),
    (2, [7, 12], KAT2),
    (3, [7, 12], KAT2),
    (4, [12], KAT2),
    (5, [12], KAT2),
    (6, [20], KAT2),
    (7, [20], KAT2),
    (8, [20], KAT2),
    (9, [20], KAT2),
    (10, [20], KAT2),
    (11, [2, 20, 3], KAT2),
    (12, [7, 14, 7], KAT2),
]
block_B = [
    (1, [7, 12], VIP),
    (2, [7, 12], VIP),
    (3, [7, 12], VIP),
    (4, [12], VIP),
    (5, [12], VIP),
    (6, [16], KAT1),
    (7, [16], KAT1),
    (8, [16], KAT1),
    (9, [16], KAT1),
    (10, [20], KAT1),
    (11, [2, 20, 3], KAT1),
    (12, [7, 14, 7], KAT1),
]
block_C = [
    (1, [12, 7], KAT2),
    (2, [12, 7], KAT2),
    (3, [12, 7], KAT2),
    (4, [12], KAT2),
    (5, [12], KAT2),
    (6, [20], KAT2),
    (7, [20], KAT2),
    (8, [20], KAT2),
    (9, [20], KAT2),
    (10, [20], KAT2),
    (11, [2, 20, 2], KAT2),
    (12, [7, 14, 7], KAT2),
]

plan = {
    "name": "Riethsporthalle Erfurt",
    "categories": [
        {"name": "Kategorie I", "color": "#E87722"},
        {"name": "Kategorie II", "color": "#1D3557"},
        {"name": "VIP", "color": "#8E44AD"}
    ],
    # Gesamt-Canvas für Pretix' eigenen Sitzplan-Editor/-Viewer (nur dort relevant —
    # unsere Website rendert weiterhin block-für-block über eigenes CSS-Flex-Layout
    # und ignoriert size/zone-position komplett).
    "size": {"width": 1050, "height": 1200},
    "zones": [
        build_zone("D", "Block D", block_D, {"x": 0, "y": 0}),
        build_zone("E", "Block E", block_E, {"x": 350, "y": 0}),
        build_zone("F", "Block F", block_F, {"x": 700, "y": 0}),
        build_zone("A", "Block A", block_A, {"x": 0, "y": 600}, break_before={"6"}),
        build_zone("B", "Block B", block_B, {"x": 350, "y": 600}, break_before={"6"}),
        build_zone("C", "Block C", block_C, {"x": 700, "y": 600}, break_before={"6"}),
    ]
}

out_path = "/Users/marko/Documents/claude/Projects/website/assets/seating/riethsporthalle-seatingplan.json"
with open(out_path, "w") as f:
    json.dump(plan, f, ensure_ascii=False, indent=2)

# Pretix-taugliche Variante: Pretix' Sitzplan-Schema ist strikt (additionalProperties:
# false auf jeder Ebene) — section_break/segment_breaks sind unsere eigenen, für Pretix
# unbekannten Felder und müssen für einen echten Upload raus. Alles andere bleibt exakt
# gleich (gleiche seat_guid/uuid-Werte, damit beide Dateien dieselben Sitze referenzieren).
pretix_plan = copy.deepcopy(plan)
for z in pretix_plan["zones"]:
    for r in z["rows"]:
        r.pop("section_break", None)
        r.pop("segment_breaks", None)

pretix_out_path = "/Users/marko/Documents/claude/Projects/website/assets/seating/riethsporthalle-seatingplan.pretix.json"
with open(pretix_out_path, "w") as f:
    json.dump(pretix_plan, f, ensure_ascii=False, indent=2)

totals = {}
for z in plan["zones"]:
    for r in z["rows"]:
        for s in r["seats"]:
            totals[s["category"]] = totals.get(s["category"], 0) + 1
print("Seat totals per category:", totals)
print("Zones:", [(z["zone_id"], len(z["rows"]), sum(len(r["seats"]) for r in z["rows"])) for z in plan["zones"]])
