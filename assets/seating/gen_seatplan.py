import json, uuid, copy

# Feste Namespace-UUID für deterministische seat_guid/uuid-Vergabe: dieselbe Reihe/
# derselbe Sitz bekommt bei jedem Skriptlauf exakt dieselbe ID, statt bei jeder
# Regenerierung neu zu würfeln. Wichtig für die künftige Reservierung (Data Table/
# Pretix Seats API referenzieren Sitze dauerhaft über seat_guid) — ein zufälliger
# uuid4() bei jedem Lauf würde alle bestehenden Reservierungen verwaisen lassen.
NAMESPACE = uuid.UUID("d3b8a6d0-3f1a-4a5a-9c9a-8e6f6b6a1a10")

def stable_uuid(*parts):
    return str(uuid.uuid5(NAMESPACE, "-".join(str(p) for p in parts)))

def mkseat(zone_id, row_number, n, category, wheelchair=False):
    seat = {
        "seat_number": str(n),
        "seat_guid": stable_uuid(zone_id, row_number, n, "seat_guid"),
        "uuid": stable_uuid(zone_id, row_number, n, "uuid"),
        "position": {"x": (n - 1) * 25, "y": 0},
        "category": category
    }
    if wheelchair:
        seat["wheelchair"] = True
    return seat

def mkrow(zone_id, row_number, segments, category, y, section_break=False, wheelchair=False,
          align_reference_seat=None, align_target_seat=None, match_first_row_width=None,
          segment_align=None, x_offset=None, segment_shifts=None):
    # segments: list of aisle-separated cluster widths, e.g. [2, 20, 3] for a row
    # split by two aisles — seat numbering stays continuous across the aisles
    # (matches the real Saalplan PDF), only the VISUAL rendering gets a gap.
    # align_reference_seat/align_target_seat/match_first_row_width/segment_align: optional
    # alignment metadata consumed by seat-picker.js's _fixupRowWidths (see
    # reference_sitzplan_riethsporthalle memory for the full mechanic). Kept as plain
    # pass-through kwargs here rather than re-deriving them, since they encode real,
    # hand-verified Fluchtpunkte from the technical Saalplan/live measurements — not
    # something this generator can compute from the segment widths alone.
    total = sum(segments)
    breaks = []
    acc = 0
    for w in segments[:-1]:
        acc += w
        breaks.append(acc + 1)  # seat_number where the next cluster starts
    row = {
        "uuid": stable_uuid(zone_id, row_number, "row_uuid"),
        "position": {"x": 0, "y": y},
        "row_number": str(row_number),
        "row_number_position": "both",
        "section_break": section_break,
        "segment_breaks": breaks,
        "seats": [mkseat(zone_id, row_number, n, category, wheelchair) for n in range(1, total + 1)]
    }
    if align_reference_seat:
        row["align_reference_seat"] = True
    if align_target_seat is not None:
        row["align_target_seat"] = align_target_seat
    if match_first_row_width:
        row["match_first_row_width"] = True
    if segment_align:
        row["segment_align"] = segment_align
    # x_offset/segment_shifts: neues Koordinatensystem für Zonen mit "layout":"anchored"
    # (bisher nur Block A) — jeder Sitz bekommt eine ABSOLUTE Position in Sitzbreiten-
    # Einheiten relativ zu EINEM festen Zonen-Anker (s. build_zone("A", ...)), statt sich
    # per align_target_seat/segment_align auf eine andere Reihe zu beziehen. x_offset gilt
    # gleichmäßig für die ganze Reihe (= Position von Sitz 1 ohne Segment-Verschiebung),
    # segment_shifts verschiebt EIN Segment (0-indiziert, z.B. das isolierte Randsegment
    # vor der ersten Gang-Lücke) zusätzlich dazu, wenn es nicht lückenlos am Nachbar-
    # segment kleben soll, sondern an einem Sitz einer ANDEREN Reihe fluchten muss.
    if x_offset is not None:
        seg_shifts = segment_shifts or {}
        seg_of = []
        for i, w in enumerate(segments):
            seg_of.extend([i] * w)
        for idx, seat in enumerate(row["seats"]):
            seat["x_units"] = x_offset + idx + seg_shifts.get(seg_of[idx], 0)
    return row

def build_zone(zone_id, name, row_specs, position, break_before=None, align_edge=None, layout=None):
    # row_specs: list of (row_number, [segment_widths], category), front-to-back order.
    # break_before: set of row_numbers (as strings) that get a purely visual gap
    # before them, independent of category — echoes the original plan's structural
    # split (e.g. Block A/B/C front block vs. back block) even where price/category
    # doesn't actually change (A/C are one Kategorie-II group throughout).
    # position: {"x", "y"} — Zonen-Verortung auf der Gesamt-Saalplan-Fläche, für
    # Pretix' eigenen Schema-Viewer/Sitzplan-Editor (unsere Website ignoriert das,
    # sie rendert Block-für-Block über eigenes CSS-Flex-Layout).
    break_before = break_before or set()
    rows = [mkrow(zone_id, rn, segs, cat, i * 40, section_break=(str(rn) in break_before), **(extra or {}))
            for i, (rn, segs, cat, *rest) in enumerate(row_specs)
            for extra in [rest[0] if rest else None]]
    zone = {
        "zone_id": zone_id,
        "uuid": stable_uuid(zone_id, "zone_uuid"),
        "name": name,
        "position": position,
        "rows": rows
    }
    if align_edge:
        zone["align_edge"] = align_edge
    if layout:
        zone["layout"] = layout
    return zone

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
#
# Reihe 6 in D/E/F ist die vorderste, am Spielfeld gelegene Reihe und komplett
# Rollstuhlplätze (Korrektur 04.08.2026, Transkript) — visuell markiert (seat.wheelchair),
# aber ganz normal buchbar, keine Sonderbehandlung im Kaufprozess.
block_D = [
    (14, [7, 14, 7], KAT2, {"align_target_seat": 6}),
    (13, [2, 20, 3], KAT2, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 26}}}),
    (12, [2, 20, 3], KAT2, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 26}}}),
    (11, [2, 20, 3], KAT2, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 26}}}),
    (10, [20], KAT2),
    (9, [20], KAT2),
    (8, [20], KAT2),
    (7, [20], KAT2),
    (6, [10], KAT2, {"wheelchair": True, "align_reference_seat": True}),
]
block_E = [
    (14, [7, 3, 3, 7], KAT1, {"align_target_seat": 6, "segment_align": {"8": {"row": "13", "seat": 6}, "11": {"row": "12", "seat": 13}, "14": {"row": "13", "seat": 13}}}),
    (13, [2, 6, 6, 3], KAT1, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "9": {"row": "12", "seat": 13}, "15": {"row": "14", "seat": 18}}}),
    (12, [2, 8, 8, 3], KAT1, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "11": {"row": "11", "seat": 15}, "19": {"row": "14", "seat": 18}}}),
    (11, [2, 20, 3], KAT1, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 18}}}),
    (10, [20], KAT1, {"align_reference_seat": True}),
    (9, [20], KAT1),
    (8, [20], KAT1),
    (7, [20], KAT1),
    # Neu 04.08.2026 (Transkript): Reihe 6 fehlte bisher komplett, analog zu D/F die
    # vorderste Reihe am Spielfeld, komplett Rollstuhlplätze. Seatzahl (10, wie D/F)
    # ist eine Annahme mangels expliziter Angabe — bei Bedarf korrigieren.
    (6, [10], KAT1, {"wheelchair": True}),
]
block_F = [
    (14, [7, 14, 7], KAT2, {"align_target_seat": 23}),
    (13, [2, 20, 2], KAT2, {"align_target_seat": 22, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 27}}}),
    (12, [2, 20, 2], KAT2, {"align_target_seat": 22, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 27}}}),
    (11, [2, 20, 2], KAT2, {"align_target_seat": 22, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 27}}}),
    (10, [20], KAT2, {"align_reference_seat": True}),
    (9, [20], KAT2),
    (8, [20], KAT2),
    (7, [20], KAT2),
    (6, [10], KAT2, {"wheelchair": True}),
]
# Block A komplett auf absolute Koordinaten umgestellt (04.08.2026, Marko): EIN fester
# Anker statt Reihen-zu-Reihen-Fluchtpunkten, die seat-picker.js zur Laufzeit aus dem
# DOM misst. Anker: die Grenze zwischen Sitz 10 und Sitz 11 der Reihe 6 (die vorderste,
# durchgehende 20er-Reihe, praktisch in der Blockmitte) = Einheit 0. Jede Reihe bekommt
# einen x_offset (Sitzbreiten-Einheiten, positiv=rechts), aus dem sich die Position
# JEDES Sitzes direkt ergibt (x_offset + Sitzindex + ggf. segment_shifts) — hergeleitet
# so, dass die vorher live verifizierte rechtsbündige Flucht exakt erhalten bleibt:
#   - Reihen 6-10 (durchgehend 20 Sitze): x_offset=-10 → rechte Kante bei Einheit 10.
#   - Reihen 1-3 ([7,12], 19 Sitze) und 4-5 ([12]): rechte Kante ebenfalls auf Einheit 10
#     ausgerichtet (x_offset=-9 bzw. -2) — Reihen 1-3s zweites Segment (12 Sitze) deckt
#     sich dadurch exakt mit Reihe 4/5.
#   - Reihe 11 ([2,20,3]): Mittelsegment (Sitze 3-22) deckungsgleich mit Reihen 6-10
#     (Einheit -10 bis 10), x_offset=-12. Randsegment 1-2 zusätzlich um -3 Einheiten
#     verschoben (segment_shifts={0:-3}), damit Sitz 1 exakt auf Sitz 1 der Reihe 12
#     fluchtet (Marko, live nachgeschärft 04.08.2026).
#   - Reihe 12 ([7,14,7]): Mittel-/Endsegment x_offset=-14 (Sitz 24 auf Einheit 10, wie
#     zuvor per align_target_seat). Segment 1-7 zusätzlich um -1 Einheit verschoben
#     (segment_shifts={0:-1}), damit Sitz 7 exakt auf Sitz 4 der Reihe 11 fluchtet.
# Herleitung/Algebra vollständig in reference_sitzplan_riethsporthalle-Memory dokumentiert.
block_A = [
    (1, [7, 12], KAT2, {"x_offset": -9}),
    (2, [7, 12], KAT2, {"x_offset": -9}),
    (3, [7, 12], KAT2, {"x_offset": -9}),
    (4, [12], KAT2, {"x_offset": -2}),
    (5, [12], KAT2, {"x_offset": -2}),
    (6, [20], KAT2, {"x_offset": -10}),
    (7, [20], KAT2, {"x_offset": -10}),
    (8, [20], KAT2, {"x_offset": -10}),
    (9, [20], KAT2, {"x_offset": -10}),
    (10, [20], KAT2, {"x_offset": -10}),
    (11, [2, 20, 3], KAT2, {"x_offset": -12, "segment_shifts": {0: -3}}),
    (12, [7, 14, 7], KAT2, {"x_offset": -14, "segment_shifts": {0: -1}}),
]
block_B = [
    (1, [7, 12], VIP),
    (2, [7, 12], VIP),
    (3, [7, 12], VIP),
    (4, [12], VIP),
    (5, [12], VIP),
    (6, [16], KAT1, {"match_first_row_width": True}),
    (7, [16], KAT1, {"match_first_row_width": True}),
    (8, [16], KAT1, {"match_first_row_width": True}),
    (9, [16], KAT1, {"match_first_row_width": True}),
    (10, [8, 8], KAT1, {"match_first_row_width": True, "align_reference_seat": True}),
    # Kein segment_align auf Sitz 3 (→ Reihe 10, Sitz 1): Reihe 10 ist die globale
    # Bezugsreihe (align_reference_seat) und hat selbst KEIN align_target_seat, das
    # deltaToAnchor()/segment_align aber zwingend braucht — der Verweis liefe ins
    # Leere und wuerde die 10px-Segmentluecke vor Sitz 3 stillschweigend auf 0 setzen,
    # ohne einen Ersatzwert zu berechnen (live verifiziert 04.08.2026). Primaerer Anker
    # (align_target_seat=14) reicht fuer eine korrekte Grundausrichtung der Reihe.
    (11, [2, 6, 6, 3], KAT1, {"align_target_seat": 14}),
    (12, [7, 3, 3, 2, 5], KAT1, {"align_target_seat": 15, "segment_align": {"6": {"row": "11", "seat": 3}}}),
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
    (10, [20], KAT2, {"align_reference_seat": True}),
    (11, [2, 20, 2], KAT2, {"align_target_seat": 3, "segment_align": {"1": {"row": "12", "seat": 1}, "23": {"row": "12", "seat": 27}}}),
    (12, [7, 14, 7], KAT2, {"align_target_seat": 6}),
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
        build_zone("D", "Block D", block_D, {"x": 0, "y": 0}, align_edge="leading"),
        build_zone("E", "Block E", block_E, {"x": 350, "y": 0}, align_edge="leading"),
        build_zone("F", "Block F", block_F, {"x": 700, "y": 0}, align_edge="trailing"),
        build_zone("A", "Block A", block_A, {"x": 0, "y": 600}, break_before={"6"}, layout="anchored"),
        build_zone("B", "Block B", block_B, {"x": 350, "y": 600}, break_before={"6"}, align_edge="trailing"),
        build_zone("C", "Block C", block_C, {"x": 700, "y": 600}, break_before={"6"}, align_edge="leading"),
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
