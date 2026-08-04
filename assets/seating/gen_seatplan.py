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
          segment_align=None, x_offset=None, segment_shifts=None, segment_gap_units=None,
          live_stretch=None, live_shift=None, live_stretch2=None, wheelchair_seats=None,
          label_before_seat=None, live_fit=None, live_fit2=None):
    # segments: list of aisle-separated cluster widths, e.g. [2, 20, 3] for a row
    # split by two aisles — seat numbering stays continuous across the aisles
    # (matches the real Saalplan PDF), only the VISUAL rendering gets a gap.
    # align_reference_seat/align_target_seat/match_first_row_width/segment_align: optional
    # alignment metadata consumed by seat-picker.js's _fixupRowWidths (see
    # reference_sitzplan_riethsporthalle memory for the full mechanic). Kept as plain
    # pass-through kwargs here rather than re-deriving them, since they encode real,
    # hand-verified Fluchtpunkte from the technical Saalplan/live measurements — not
    # something this generator can compute from the segment widths alone.
    # wheelchair_seats: einzelne Sitznummern innerhalb der Reihe als Rollstuhlplatz
    # markieren (im Unterschied zu `wheelchair`, das die GANZE Reihe markiert, z.B.
    # Block D/E/F Reihe 6) — z.B. Block A Reihe 1, ein einzelner Rollstuhlplatz am Ende.
    wc_seats = set(wheelchair_seats or [])
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
        "seats": [mkseat(zone_id, row_number, n, category, wheelchair or n in wc_seats) for n in range(1, total + 1)]
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
    # (bisher Block A, jetzt auch B) — jeder Sitz bekommt eine ABSOLUTE Position in
    # Sitzbreiten-Einheiten relativ zu EINEM festen Zonen-Anker (s. build_zone("A", ...)),
    # statt sich per align_target_seat/segment_align auf eine andere Reihe zu beziehen.
    # x_offset gilt gleichmäßig für die ganze Reihe (= Position von Sitz 1 ohne Segment-
    # Verschiebung), segment_shifts verschiebt EIN Segment (0-indiziert, z.B. das
    # isolierte Randsegment vor der ersten Gang-Lücke) zusätzlich dazu, wenn es nicht
    # lückenlos am Nachbarsegment kleben soll, sondern an einem Sitz einer ANDEREN Reihe
    # fluchten muss.
    # match_first_row_width-Reihen (z.B. Block B Reihe 6-10) haben KEIN einheitliches
    # Sitzraster — sie werden per CSS auf die exakte gerenderte Breite von Reihe 1
    # gestreckt (s. seat-picker.js _applyAnchoredLayout), einzelne Sitze bekommen daher
    # bewusst KEIN x_units (das würde ein festes Sitzraster voraussetzen, das es hier
    # nicht gibt) — nur die Reihe selbst bekommt x_offset für ihre eigene Positionierung.
    if x_offset is not None:
        row["x_offset"] = x_offset
        if not match_first_row_width:
            seg_shifts = segment_shifts or {}
            seg_of = []
            for i, w in enumerate(segments):
                seg_of.extend([i] * w)
            for idx, seat in enumerate(row["seats"]):
                seat["x_units"] = x_offset + idx + seg_shifts.get(seg_of[idx], 0)
            # explicit_shift_segments: welche Segmente (Index) einen EIGENEN Fluchtpunkt-
            # Shift bekommen haben — auch wenn der resultierende Abstand zur Nachbarreihe
            # zufällig genau 0 Einheiten ergibt (z.B. wenn zwei benachbarte Segmente um
            # denselben Betrag verschoben werden, damit sie als ein Block zusammenbleiben,
            # s. Block B Reihe 11 Segment 0+1). Ohne diese Liste kann seat-picker.js nicht
            # unterscheiden, ob so ein Nulllücken-Übergang bewusst so gewollt ist oder ob
            # einfach GAR KEIN Shift angegeben wurde (dann greift die kleine Dekor-Lücke).
            if seg_shifts:
                row["explicit_shift_segments"] = sorted(seg_shifts.keys())
    # segment_gap_units: für match_first_row_width-Reihen MIT mehreren Segmenten (z.B.
    # Block B Reihe 10, [8,8]) reicht die normale kleine Gang-Lücke nicht — jedes Segment
    # wird UNABHÄNGIG vom anderen gestreckt (eigene Breite proportional zur Sitzzahl),
    # mit einer eigenen, in Einheiten skalierten Lücke dazwischen statt der pauschalen
    # 10px (s. seat-picker.js _applyAnchoredLayout). Ohne Angabe bleibt es bei der
    # normalen kleinen dekorativen Lücke (ein Segment reicht dafür sowieso nicht).
    if segment_gap_units is not None:
        row["segment_gap_units"] = segment_gap_units
    # live_stretch/live_shift: für Segmente, die an Sitzen einer match_first_row_width-
    # Reihe (z.B. Block B Reihe 10) ausgerichtet werden müssen — solche Sitze haben KEINE
    # x_units (kein festes Sitzraster, s.o.), ihre Position ist erst nach dem Rendern per
    # DOM-Messung bekannt (s. seat-picker.js _applyAnchoredLayout, Live-Ausrichtungs-Pass).
    # live_stretch staucht/streckt EIN Segment intern (gleichmäßig verteilt), sodass dessen
    # ERSTER und LETZTER Sitz exakt auf zwei live gemessene Zielsitze fluchten (z.B. Reihe
    # 11 Segment 2: Sitz 9-14 zusammengestaucht zwischen Sitz 11 und Sitz 16 der Reihe 10).
    # live_shift verschiebt ein Segment GLEICHMÄSSIG (wie segment_shifts), aber der nötige
    # Versatz kommt aus einer Live-Messung statt aus einer festen Einheiten-Zahl (z.B.
    # Reihe 12 Segment 4: Sitz 16-20 verschoben, bis Sitz 16 auf Sitz 14 der Reihe 11 liegt
    # — Reihe 11s Sitz 14 selbst ist ja gerade erst per live_stretch bestimmt worden).
    if live_stretch:
        row["live_stretch"] = live_stretch
    if live_shift:
        row["live_shift"] = live_shift
    # live_stretch2: wie live_stretch, läuft aber NACH live_shift statt davor — für Fälle,
    # in denen der Zielsitz selbst erst per live_shift bestimmt wird (z.B. Block B Reihe
    # 11 Segment 3 [Sitz 15-17], das an Reihe 12s Sitz 18/20 ausgerichtet wird — Reihe 12s
    # Sitze 16-20 hängen ihrerseits an Reihe 12s live_shift, der wiederum von Reihe 11s
    # SEGMENT-2-live_stretch abhängt). Reihenfolge im JS: stretch → shift → stretch2.
    if live_stretch2:
        row["live_stretch2"] = live_stretch2
    # live_fit/live_fit2: allgemeinerer Live-Ausrichtungs-Mechanismus als live_stretch —
    # mehrere "Pins" (Sitz N dieser Reihe = live gemessene Position von Sitz M einer
    # anderen Reihe) werden stückweise linear verbunden, statt nur zwischen genau ZWEI
    # Endpunkten zu interpolieren. extend_forward/reverse_extend setzen die Steigung des
    # äußersten Pin-Intervalls über dessen Rand hinaus fort. reverse_anchor ist ein davon
    # UNABHÄNGIGER zweiter Fixpunkt (eigene Live-Messung, nicht Teil der Pin-Kette) —
    # nötig für Reihen mit einer durchgehenden Sitzfolge, aber zwei unabhängigen
    # Fluchtpunkten aus verschiedenen Nachbarreihen (Block B Reihe 10, neunte Runde: Sitz
    # 1/6 aus Reihe 11 gepinnt, Sitz 16 unabhängig aus Reihe 9). live_fit läuft VOR
    # live_stretch, live_fit2 NACH live_shift (s. seat-picker.js _applyAnchoredLayout).
    if live_fit:
        row["live_fit"] = live_fit
    if live_fit2:
        row["live_fit2"] = live_fit2
    # label_before_seat: die RECHTE Reihennummer wird vor dem angegebenen Sitz eingefügt
    # statt ganz ans Ende der Reihe — z.B. Block A Reihe 1, wo ein zusätzlicher
    # Rollstuhlplatz hinter einer Lücke sitzt (Marko: die Reihennummer soll weiter mit
    # den anderen Reihennummern fluchten, nicht mit dem Zusatzsitz mitwandern).
    if label_before_seat is not None:
        row["label_before_seat"] = label_before_seat
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
#
# Nachschärfung 04.08.2026 (Marko, zweite Runde):
#   - Reihen 1-3: Randsegment 1-7 zusätzlich um -1 Einheit verschoben (segment_shifts=
#     {0:-1}), damit Sitz 1-7 exakt auf Sitz 1-7 der Reihe 6 fluchten (vorher lag das
#     Segment durchgängig 1 Einheit zu weit rechts, weil es nur dem einheitlichen
#     x_offset der ganzen Reihe folgte statt einem eigenen Fluchtpunkt).
#   - Reihe 11: Randsegment 23-25 zusätzlich um +2 Einheiten verschoben (Schlüssel 2 in
#     segment_shifts), Reihe 12: Randsegment 22-28 um +1 Einheit (Schlüssel 2). Marko
#     nannte für beide "ein Sitz nach rechts" — die exakte Fluchtpunkt-Vorgabe (Sitz
#     25/R11 = Sitz 28/R12; Sitz 22/R12 = Sitz 21/R11, unverschobenes Mittelsegment)
#     ergibt rechnerisch aber +2 für R11 und +1 für R12, weil beide Verschiebungen
#     gleichzeitig auf dieselbe Zielbeziehung wirken (mit +1/+1 bliebe der bisherige
#     1-Einheit-Versatz zwischen den beiden Sitzen bestehen) — volle Algebra im Memory.
block_A = [
    # Reihe 1 (Marko, 04.08.2026): zusätzlicher Rollstuhlplatz ganz rechts, mit einer
    # vollen Sitzbreite Lücke zu Sitz 19 (dort, wo bisher nur die Reihennummer stand) —
    # neues Segment [1] (Sitz 20). Shift 0 (nicht mehr +1, Marko-Korrektur): +1 ergab eine
    # ZWEI Einheiten breite Lücke (ein leerer Sitzplatz PLUS die Reihennummer obendrauf) —
    # "nur ein Platz als Lücke" heißt genau EINE Einheit Abstand (Standard-Sitzabstand),
    # in die die Reihennummer hineinpasst. Shift 0 bleibt trotzdem in explicit_shift_
    # segments (expliziter Eintrag, s. mkrow()) — unterdrückt die sonst greifende
    # 10px-Dekorlücke, die sonst oben draufkäme.
    (1, [7, 12, 1], KAT2, {"x_offset": -9, "segment_shifts": {0: -1, 2: 0}, "wheelchair_seats": [20],
        "label_before_seat": 20}),
    (2, [7, 12], KAT2, {"x_offset": -9, "segment_shifts": {0: -1}}),
    (3, [7, 12], KAT2, {"x_offset": -9, "segment_shifts": {0: -1}}),
    (4, [12], KAT2, {"x_offset": -2}),
    (5, [12], KAT2, {"x_offset": -2}),
    (6, [20], KAT2, {"x_offset": -10}),
    (7, [20], KAT2, {"x_offset": -10}),
    (8, [20], KAT2, {"x_offset": -10}),
    (9, [20], KAT2, {"x_offset": -10}),
    (10, [20], KAT2, {"x_offset": -10}),
    (11, [2, 20, 3], KAT2, {"x_offset": -12, "segment_shifts": {0: -3, 2: 2}}),
    (12, [7, 14, 7], KAT2, {"x_offset": -14, "segment_shifts": {0: -1, 2: 1}}),
]
# Block B auf absolutes Koordinaten-Layout umgestellt (04.08.2026, Marko): neuer Anker,
# weil B strukturell anders ist als A (die "Treppe" vorn + gestreckte Reihen 6-10 statt
# durchgehender 20er-Reihen). Anker: die Grenze zwischen Sitz 9 und Sitz 10 der Reihe 1
# (die Reihe 1 liegt damit horizontal zentriert im Block) = Einheit 0.
#   - Reihen 1-3 ([7,12], "die Treppe"): x_offset=-9, damit die Sitz9/10-Grenze bei jeder
#     der drei exakt auf Einheit 0 liegt. Segment 0 (Sitze 1-7) zusätzlich um -1 Einheit
#     verschoben (segment_shifts={0:-1}) — Marko, 04.08.2026 (zweite Runde): "zwischen
#     Platz 7 und 8 ist ein Platz [Sitzbreite] Space", ein echter Fluchtpunkt-Gang statt
#     der pauschalen kleinen Dekor-Lücke.
#   - Reihen 4-5 ([12]): x_offset=-2 — Marko korrigierte sich in einer dritten Runde
#     (04.08.2026): "Platz 1 liegt exakt über Platz 8 [der Reihe 3]" (der vorherige
#     Versuch, Sitz-für-Sitz mit der GANZEN Reihe 1-3 gleichzulaufen, war falsch — es ist
#     wieder das zweite Segment/die Rückreihe: Sitz 8 der Reihe 3 = -9+7+0 = -2).
#   - Reihen 6-10 (match_first_row_width): x_offset=-10 (NICHT -9) — Marko (dritte Runde):
#     "Reihe 6 bis 9: Platz 1 liegt exakt über Platz 1 der Reihe 1, Platz 16 über Platz 19
#     der Reihe 1." Reihe 1 hat durch ihren eigenen segment_shift (-1 auf Segment 0) ihren
#     Sitz 1 bei Einheit -10 (=-9-1), NICHT bei -9 — Reihen 6-10 müssen daher ebenfalls bei
#     -10 ansetzen, sonst liegt ihr Sitz 1 einen Einheit zu weit rechts.
#   - Reihe 10: "Abstand zwischen den Plätzen in Reihe 10 ist gut, auch die Lücke in der
#     Mitte" (Marko) — segment_gap_units bleibt unverändert, nur der Reihen-x_offset
#     wandert mit auf -10.
#   - Reihe 11: x_offset unverändert (-4), aber segment_shifts von {0:-7,1:-7} auf
#     {0:-8,1:-8} nachgezogen — reine Konsequenz aus Reihe 10s neuem x_offset (-10 statt
#     -9), damit "Sitz 3 fluchtet auf Sitz 1 der Reihe 10" weiter stimmt. Marko wollte im
#     nächsten Schritt noch grundsätzlich über Reihe 11 sprechen (Nachricht brach an der
#     Stelle ab) — hier nur die Konsistenz zu Reihe 10 gewahrt, keine neue Entscheidung.
#   - Reihe 12: Marko korrigierte die Fluchtpunkt-Angabe direkt im Anschluss (dritte
#     Runde): "Platz 6 [nicht 7] liegt über Platz 3 der Reihe 11" — deckt sich mit dem
#     Fluchtpunkt aus dem alten, vor-anchored System (dort: segment_align Sitz 6 → Reihe
#     11 Sitz 3). Sitz 3 Reihe 11 = -4 (x_offset) + 2 (Index) - 8 (Segment-Shift) = -10.
#     Sitz 6 Reihe 12 = x_offset + 5 (Index) - 2 (Segment-Shift) = x_offset + 3 → x_offset
#     = -13 (ersetzt den vorherigen "Sitz 7 = Sitz 7"-Versuch, der mit derselben
#     Segmentstruktur nicht gleichzeitig gelten kann — Sitz 6/7 liegen in Reihe 12 immer
#     genau 1 Einheit auseinander, Sitz 3/7 in Reihe 11 aber 4 Einheiten).
block_B = [
    (1, [7, 12], VIP, {"x_offset": -9, "segment_shifts": {0: -1}}),
    (2, [7, 12], VIP, {"x_offset": -9, "segment_shifts": {0: -1}}),
    (3, [7, 12], VIP, {"x_offset": -9, "segment_shifts": {0: -1}}),
    (4, [12], VIP, {"x_offset": -2}),
    (5, [12], VIP, {"x_offset": -2}),
    (6, [16], KAT1, {"match_first_row_width": True, "x_offset": -10}),
    (7, [16], KAT1, {"match_first_row_width": True, "x_offset": -10}),
    (8, [16], KAT1, {"match_first_row_width": True, "x_offset": -10}),
    (9, [16], KAT1, {"match_first_row_width": True, "x_offset": -10}),
    # Reihe 10 komplett neu (Marko, neunte Runde, ersetzt segment_gap_units-Ansatz): EIN
    # durchgehender Sitzabstand für die ganze Reihe, hergeleitet aus "Sitz 1-6 genau über
    # Sitz 3-8 der Reihe 11" (pins) — Sitz 7-8 laufen mit demselben Abstand weiter
    # (extend_forward). Sitz 16 liegt UNABHÄNGIG davon exakt auf Sitz 16 der Reihe 9
    # (reverse_anchor), Sitz 9-15 laufen davon rückwärts mit dem GLEICHEN, aus Sitz 1-6
    # hergeleiteten Abstand (reverse_extend) — nicht mit Reihe 11 verknüpft, wie Marko
    # explizit klargestellt hat.
    (10, [8, 8], KAT1, {"match_first_row_width": True, "x_offset": -10,
        "live_fit": {
            "pins": [{"seat": 1, "target": {"row": "11", "seat": 3}}, {"seat": 6, "target": {"row": "11", "seat": 8}}],
            "extend_forward": [7, 8],
            "reverse_anchor": {"seat": 16, "target": {"row": "9", "seat": 16}},
            "reverse_extend": [15, 14, 13, 12, 11, 10, 9]
        }}),
    # Reihe 11 (Marko, vierte Runde): Segment 0 (Sitze 1-2) NICHT mehr zusammen mit
    # Segment 1 (Sitze 3-8) verschoben, sondern eigenständig weiter nach links, sodass
    # Sitz 1/2 exakt auf Sitz 1/2 der Reihe 12 fluchten. Segment 1 behält seinen Shift
    # (-8, s.u. — hält weiterhin "Sitz 3 = Sitz 1 Reihe 10" aus der letzten Runde).
    # Sitz 1 Reihe 12 = -13 (x_offset) + 0 - 2 (Segment-Shift) = -15.
    # Unverschobener Sitz 1 Reihe 11 (x_offset=-4, Index 0) läge bei -4 → Shift=-15-(-4)=-11.
    # Segment 2 (Sitze 9-14, Marko fünfte Runde): Sitz 9 auf Sitz 11 der Reihe 10, Sitz 14
    # auf Sitz 16 der Reihe 10 — beides Sitze einer match_first_row_width-Reihe OHNE
    # x_units, also nicht aus der Datenlage berechenbar. live_stretch staucht die 6 Sitze
    # gleichmäßig verteilt zwischen die beiden live gemessenen Zielpositionen (s.
    # seat-picker.js).
    # Segment 3 (Sitze 15-17, Marko siebte Runde): Sitz 15 auf Sitz 18, Sitz 17 auf Sitz 20
    # der Reihe 12 (Sitz 16 auf Sitz 19 ergibt sich automatisch aus der gleichmäßigen
    # Verteilung dazwischen). Reihe 12s Sitz 18-20 hängen ihrerseits an deren live_shift
    # (s.u.), der wiederum von Reihe 11 Segment 2 (oben) abhängt — deshalb live_stretch2
    # (läuft NACH live_shift, nicht davor, s. mkrow()).
    (11, [2, 6, 6, 3], KAT1, {"x_offset": -4, "segment_shifts": {0: -11, 1: -8},
        "live_stretch": {2: {"first": {"row": "10", "seat": 11}, "last": {"row": "10", "seat": 16}}},
        "live_stretch2": {3: {"first": {"row": "12", "seat": 18}, "last": {"row": "12", "seat": 20}}}}),
    # Reihe 12 (Marko, fünfte Runde): Segment 1 (Sitze 8-10) einen Platz [Einheit] nach
    # links, damit Sitz 8 exakt auf Sitz 6 der Reihe 11 fluchtet.
    # Sitz 6 Reihe 11 (Segment 1, Shift -8) = -4 + 5 - 8 = -7.
    # Unverschobener Sitz 8 Reihe 12 (Segment 1, x_offset=-13, Index 7) = -13+7 = -6.
    # Shift = -7-(-6) = -1 (genau "ein Platz nach links", wie von Marko angegeben).
    # Neunte Runde (ersetzt die siebte/achte Runde komplett): ZWEI feste Segment-Verschiebungen
    # statt Pin-Interpolation — Marko bestätigte, dass Segment 2 (Sitz 11-13) UNGESTRECKT als
    # Block verschoben wird: "Sitz 12 ist direkt über Sitz 10 der Reihe 11, Sitz 13 direkt über
    # Sitz 11" — bei konstantem Versatz (kein Stretch) ergibt sich das automatisch, sobald nur
    # der erste Sitz (11) live auf Sitz 9 der Reihe 11 verschoben wird (Reihe 11 hat dort
    # dieselbe Sitzteilung/-breite wie Reihe 12, s. live_stretch oben). Segment 3+4 (Sitz
    # 14-20) analog als EIN Block ab Sitz 14 verschoben, bis Sitz 14 auf Sitz 13 der Reihe 11
    # liegt — "Sitz 14 bis 20 haben den gleichen Sitzabstand wie Sitz 11 bis 13", also normale,
    # ungestreckte Reihenfolge, kein Extra-Pin nötig. live_shift statt live_fit2, da Reihe 11s
    # Sitz 9/13 selbst erst durch Reihe 11s live_stretch (Segment 2) ihre finale Position
    # bekommen — läuft NACH live_stretch (s. mkrow()).
    # Zehnte Runde: Segment 4 (Sitz 16-20) bekam bisher zusätzlich zur normalen Steigung
    # noch die pauschale 10px-Dekorlücke an der Segmentgrenze (Sitz 16 hat keinen eigenen
    # live_shift/segment_shift-Eintrag, s. explicit_shift_segments-Logik in seat-picker.js)
    # — Marko: Abstand zwischen Sitz 15/16 muss GENAU der gleiche sein wie zwischen 14/15.
    # Fix: expliziter Shift 0 für Segment 4 unterdrückt die Dekorlücke, ohne die tatsächliche
    # Steigung zu ändern (Sitz 16 bleibt weiterhin 1 Einheit hinter Sitz 15, jetzt ohne
    # Zusatz-Px).
    (12, [7, 3, 3, 2, 5], KAT1, {"x_offset": -13, "segment_shifts": {0: -2, 1: -1, 4: 0},
        "live_shift": {
            2: {"anchor_seat": 11, "target_row": "11", "target_seat": 9},
            3: {"anchor_seat": 14, "target_row": "11", "target_seat": 13}
        }}),
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
        build_zone("B", "Block B", block_B, {"x": 350, "y": 600}, break_before={"6"}, layout="anchored"),
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
