import json, uuid

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
          segment_align=None, x_offset=None, segment_shifts=None,
          live_stretch=None, live_shift=None, live_stretch2=None, wheelchair_seats=None,
          label_before_seat=None, live_fit=None, live_fit_gap=None, live_fit_scaled=None,
          segment_gap_seats=None, renumber_seats=None, trailing_gap_units=None,
          category_label=None):
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
    # live_fit: allgemeinerer Live-Ausrichtungs-Mechanismus als live_stretch — mehrere
    # "Pins" (Sitz N dieser Reihe = live gemessene Position von Sitz M einer anderen
    # Reihe) werden stückweise linear verbunden, statt nur zwischen genau ZWEI
    # Endpunkten zu interpolieren. extend_forward/reverse_extend setzen die Steigung des
    # äußersten Pin-Intervalls über dessen Rand hinaus fort. reverse_anchor ist ein davon
    # UNABHÄNGIGER zweiter Fixpunkt (eigene Live-Messung, nicht Teil der Pin-Kette) —
    # nötig für Reihen mit einer durchgehenden Sitzfolge, aber zwei unabhängigen
    # Fluchtpunkten aus verschiedenen Nachbarreihen (Block B Reihe 10, neunte Runde: Sitz
    # 1/6 aus Reihe 11 gepinnt, Sitz 16 unabhängig aus Reihe 9). live_fit läuft VOR
    # live_stretch (s. seat-picker.js _applyAnchoredLayout).
    if live_fit:
        row["live_fit"] = live_fit
    # live_fit_gap: einfacherer Spezialfall von live_fit für genau ZWEI live gemessene
    # Endpunkte (first/last) MIT einer einzelnen echten Lücke irgendwo dazwischen
    # (gap_before_seat/gap_units) — z.B. Block B Reihe 10: Sitz 1 = Reihe 9 Sitz 1, Sitz 16
    # = Reihe 9 Sitz 16, mit einer 4er-Lücke vor Sitz 9. live_fit selbst kann das nicht
    # ausdrücken (seine Pins interpolieren nur zwischen ECHTEN Zielsitzen anderer Reihen,
    # nicht zwischen einem Sitz und einer rein rechnerischen Zwischenposition). Der
    # resultierende Sitzabstand ist automatisch AUTOMATISCH kleiner als der von Reihe 9
    # selbst (19 statt 15 Einheiten über dieselbe Spannweite verteilt) — genau das von
    # Marko beobachtete "Reihe 10 hat einen geringeren Sitzabstand".
    if live_fit_gap:
        row["live_fit_gap"] = live_fit_gap
    # live_fit_scaled: wie live_fit_gap, aber für eine Spanne mit MEHREREN, unterschied-
    # lich großen Lücken (relative_units) statt einer einzelnen — die alte relative
    # Struktur wird proportional auf zwei neue Live-Anker gestreckt/gestaucht (s.
    # seat-picker.js runLiveFitScaled). Z.B. Block B Reihe 11 Sitz 3-17: die "8 Plätze"-
    # und "treppensepariert"-Lücke bleiben im VERHÄLTNIS zueinander erhalten, nur die
    # absolute Größe passt sich den neuen Fluchtpunkten an.
    if live_fit_scaled:
        row["live_fit_scaled"] = live_fit_scaled
    # label_before_seat: die RECHTE Reihennummer wird vor dem angegebenen Sitz eingefügt
    # statt ganz ans Ende der Reihe — z.B. Block A Reihe 1, wo ein zusätzlicher
    # Rollstuhlplatz hinter einer Lücke sitzt (Marko: die Reihennummer soll weiter mit
    # den anderen Reihennummern fluchten, nicht mit dem Zusatzsitz mitwandern).
    if label_before_seat is not None:
        row["label_before_seat"] = label_before_seat
    # segment_gap_seats: {segmentIndex: N} — fügt an einer Segmentgrenze eine echte,
    # in Sitzbreiten-Einheiten skalierende Lücke von N Sitzen ein, GENERISCH für jedes
    # Zonen-Layout (auch das alte align_edge/segment_align-System, z.B. Block C) — anders
    # als segment_shifts (nur für "layout":"anchored"-Zonen). Ersetzt die sonst greifende kleine, nicht
    # skalierende 10px-Dekorlücke an dieser Segmentgrenze (s. seat-picker.js
    # _applySegmentGapSeats).
    if segment_gap_seats:
        row["segment_gap_seats"] = segment_gap_seats
    # renumber_seats: {"originalNumber": "newNumber"} — vergibt einzelnen Sitzen NACH
    # der normalen, durchgehenden Nummerierung eine ANDERE Sitznummer (z.B. Block D
    # Reihe 6: 5 Rollstuhlplätze behalten ihre historischen, durchgehend-mit-Lücke
    # nummerierten Plätze 11/13/15/17/19 statt 11-15, weil "Platz 12/14/16/18/20"
    # dort physisch gar nicht existiert — s. segment_gap_seats für die zugehörige
    # echte Sitzbreiten-Lücke). seat_guid/uuid werden aus der NEUEN Nummer neu
    # berechnet (Identität hängt an der finalen, sichtbaren Sitznummer, nicht am
    # internen Zähler) — sonst würde ein künftiger Umbenennungs-Fall bestehende
    # Reservierungen unter der falschen Nummer weiterführen. segment_breaks wird
    # NACH demselben Mapping aktualisiert, sonst findet seat-picker.js (das die
    # sichtbare Sitznummer zum Abgleich nutzt, z.B. segment_gap_seats) die
    # umbenannten Sitze nicht mehr an ihrer Segmentgrenze.
    if renumber_seats:
        for seat in row["seats"]:
            new_num = renumber_seats.get(seat["seat_number"])
            if new_num is not None:
                seat["seat_number"] = new_num
                seat["seat_guid"] = stable_uuid(zone_id, row_number, new_num, "seat_guid")
                seat["uuid"] = stable_uuid(zone_id, row_number, new_num, "uuid")
        row["segment_breaks"] = [int(renumber_seats.get(str(b), b)) for b in row["segment_breaks"]]
    # trailing_gap_units: zusätzlicher Abstand (in Sitzbreiten-Einheiten) zwischen dem
    # letzten Sitz und der rechten Reihennummer — für Reihen, die durch echte
    # segment_gap_seats-Lücken (z.B. Rollstuhlplätze mit Zwischenraum) INSGESAMT weniger
    # Einheiten breit sind als die anderen Reihen der Zone, wodurch ihre rechte
    # Reihennummer sonst zu weit links landet (nicht auf einer Linie mit den anderen
    # Reihennummern, s. seat-picker.js _applyTrailingGapUnits).
    if trailing_gap_units:
        row["trailing_gap_units"] = trailing_gap_units
    # category_label: reine Anzeige-Beschriftung für die Website (Blockkachel/Detail-
    # Header), OHNE die tatsächliche `category` (= Preis/Produkt) zu ändern — für Gruppen,
    # deren Anzeigename vom Kategorienamen abweichen soll, deren Preis aber identisch
    # bleibt. Aktuell ungenutzt (Block C unten ist inzwischen eine echte eigene Kategorie
    # mit eigenem Preis, s. C_UNTEN). Nur auf der ERSTEN Reihe einer Gruppe gesetzt, s.
    # seat-picker.js _categoryGroups.
    if category_label:
        row["category_label"] = category_label
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
KAT3 = "Kategorie III"
FANBLOCK = "Fanblock"
C_UNTEN = "C unten"
VIP = "VIP"

# Nordtribüne: Reihe 6 (bzw. 7) ist die vorderste, am Spielfeld — das Spielfeld
# liegt im Layout UNTER den Nordblöcken, deshalb hier in umgekehrter Reihenfolge
# (14 zuerst / oben, 6 zuletzt / unten) im Array, damit Reihe 6 unten landet.
#
# Reihe 6 in D/E/F ist die vorderste, am Spielfeld gelegene Reihe und komplett
# Rollstuhlplätze (Korrektur 04.08.2026, Transkript) — visuell markiert (seat.wheelchair),
# aber ganz normal buchbar, keine Sonderbehandlung im Kaufprozess.
block_D = [
    # Reihe 14 (Marko): echte Ein-Platz-Lücken zwischen Sitz 7/8 und 21/22 (analog Block C
    # Reihe 12).
    (14, [7, 14, 7], KAT2, {"align_target_seat": 6, "segment_gap_seats": {1: 1, 2: 1}}),
    (13, [2, 20, 3], KAT2, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 26}}}),
    (12, [2, 20, 3], KAT2, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 26}}}),
    (11, [2, 20, 3], KAT2, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 26}}}),
    (10, [20], KAT2),
    (9, [20], KAT2),
    (8, [20], KAT2),
    (7, [20], KAT2),
    # Reihe 6 (Marko, Korrekturrunde): die bisherigen 10 Rollstuhlplätze werden normale
    # Sitze (1-10, wie gehabt). Danach 5 ECHTE Rollstuhlplätze OHNE normale Sitze
    # dazwischen — sie behalten ihre historischen Nummern 11/13/15/17/19 (12/14/16/18/20
    # existieren dort nicht mehr als Sitz), mit einer echten Ein-Platz-Lücke VOR jedem
    # von ihnen (auch vor Sitz 11, direkt nach Sitz 10) — "keine normalen Sitze mehr
    # dazwischen", aber "gleichverteilt über die verbleibende Breite der Plätze 11 bis
    # 20". Segmente: [10] normale Sitze, dann 5×[1] für die Rollstuhlplätze (zunächst
    # sequenziell 11-15 durchnummeriert, per renumber_seats auf 11/13/15/17/19
    # umbenannt). segment_gap_seats=1 vor JEDEM der 5 Segmente ergibt: Sitz "11" bei
    # Einheit 12, "13" bei 14, "15" bei 16, "17" bei 18, "19" bei 20 — Sitz "19" landet
    # damit exakt unter Sitz 20 der Reihe 7 (Marko: "Rollstuhlplatz 19 direkt unter
    # Platz 20 der Reihe 7").
    (6, [10, 1, 1, 1, 1, 1], KAT2, {
        "align_reference_seat": True,
        "wheelchair_seats": [11, 12, 13, 14, 15],
        "segment_gap_seats": {1: 1, 2: 1, 3: 1, 4: 1, 5: 1},
        "renumber_seats": {"12": "13", "13": "15", "14": "17", "15": "19"}
    }),
]
    # Reihe 12/13/14 (Marko, Korrekturrunde 05.08.2026 — ursprünglich fälschlich auf
    # Block F angewendet, dort zurückgerollt): durchgehende Bestuhlung in der Mitte —
    # zwischen (dem bis dahin durchgehend nummerierten) Platz 10 und 11 fehlten bisher
    # Sitze gegenüber der Realität. Eingefügt: Reihe 12 +4, Reihe 13/14 je +6 (Reihe 11
    # bleibt unverändert, von Marko nicht genannt). Bei Reihe 12/14 liegt die Einfügestelle
    # GENAU auf einer bestehenden Segmentgrenze (Sitz 10 = Ende eines Segments, Sitz 11 =
    # Anfang des nächsten) — die neuen Sitze verlängern dort das VORDERE Segment. Bei
    # Reihe 13 liegt Sitz 10/11 MITTEN in Segment 3 (9-14) — das Segment selbst wächst.
    # Jede Einfügung verschiebt ALLE nachfolgenden Sitznummern DERSELBEN Reihe um den
    # Einfüge-Betrag — deshalb müssen ALLE `segment_align`-Keys (eigene Segment-
    # Startnummern) UND referenzierten Zielsitze in ANDEREN Reihen von Block E neu
    # berechnet werden (die Reihen hängen hier enger ineinander als in Block F: Reihe 14
    # referenziert 12+13, Reihe 13 referenziert 12, Reihe 12 referenziert 11). Reihe 11
    # bekommt selbst keine neuen Sitze, aber ihr Verweis auf Reihe 14 Sitz 18 muss trotzdem
    # auf 24 aktualisiert werden (der physische Zielsitz in Reihe 14 hat sich verschoben).
    # Reihe 13/14: die Segment-Fluchtpunkte "8"→Reihe 13/6 (Reihe 14) bzw. "1"→Reihe 14/1
    # (Reihe 13) erzeugten je eine überflüssige, sichtbare Lücke (Sitz 7/8 in Reihe 14 um
    # 1 Einheit, Sitz 2/3 in Reihe 13 um 4 Einheiten zu breit) — Marko: "durchgehende
    # Bestuhlung", diese Lücken müssen geschlossen werden. Entfernt (Reihe 11/12 behalten
    # ihre analogen "1"-Einträge unverändert, waren nicht Teil der Rückmeldung).
block_E = [
    (14, [7, 14, 7], KAT1, {"align_target_seat": 6, "segment_gap_seats": {1: 1, 2: 1}}),
    (13, [2, 6, 14, 3], KAT1, {"align_target_seat": 3, "segment_align": {"1": {"row": "12", "seat": 1}, "9": {"row": "12", "seat": 9}, "23": {"row": "14", "seat": 26}}}),
    (12, [2, 12, 8, 3], KAT1, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "15": {"row": "11", "seat": 15}, "23": {"row": "14", "seat": 26}}}),
    (11, [2, 20, 3], KAT1, {"align_target_seat": 3, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 26}}}),
    (10, [20], KAT1, {"align_reference_seat": True}),
    (9, [20], KAT1),
    (8, [20], KAT1),
    (7, [20], KAT1),
    # Reihe 6 (Marko, Korrekturrunde): weiterhin 10 Rollstuhlplätze insgesamt, aber jetzt
    # mit einer echten Ein-Platz-Lücke ZWISCHEN jeweils zweien (nicht vor dem ersten) —
    # 10 Einzel-Segmente, segment_gap_seats vor Segment 1-9 (nicht vor Segment 0/Sitz 1).
    # Die 9 eingefügten Lücken machen die Reihe insgesamt nur 19 statt 20 Einheiten breit
    # (10 Sitze + 9×1 Lücke = 19) — ohne Korrektur landet die rechte Reihennummer dadurch
    # 1 Einheit zu weit links (nicht auf einer Linie mit Reihe 7-10, von Marko live
    # gefunden: "Zeilennummer 6 rutscht in den Platzbereich"). trailing_gap_units=1
    # gleicht das aus.
    (6, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], KAT1, {
        "wheelchair": True,
        "segment_gap_seats": {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1},
        "trailing_gap_units": 1
    }),
]
    # Reihe 14 (Marko, 05.08.2026): Sitz 1-5 rücken nach links, sodass Sitz 5 direkt über
    # Sitz 3 der Reihe 13 liegt (Sitz 5 wird dafür zum Segment-Anfang, s. segment_align
    # "5") — Sitz 1-4 sind Teil des NEUEN Sitz-5-7-Segments-Vorgängers und bleiben an
    # ihrer bisherigen Position (nicht explizit mitverschoben, da segment_align nur
    # Segment-ANFÄNGE ausrichten kann; bei Bedarf mit Marko live nachschärfen, falls das
    # falsch aussieht). Echte Ein-Platz-Lücken zwischen Sitz 7/8 und 21/22 (beides schon
    # bestehende Segmentgrenzen, jetzt über segment_gap_seats statt der kleinen
    # Dekorlücke).
block_F = [
    (14, [4, 3, 14, 7], KAT2, {"align_target_seat": 23, "segment_gap_seats": {1: 0, 2: 1, 3: 1}}),
    (13, [2, 20, 2], KAT2, {"align_target_seat": 22, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 27}}}),
    (12, [2, 20, 2], KAT2, {"align_target_seat": 22, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 27}}}),
    (11, [2, 20, 2], KAT2, {"align_target_seat": 22, "segment_align": {"1": {"row": "14", "seat": 1}, "23": {"row": "14", "seat": 27}}}),
    (10, [20], KAT2, {"align_reference_seat": True}),
    (9, [20], KAT2),
    (8, [20], KAT2),
    (7, [20], KAT2),
    # Reihe 6 (Marko, mehrfach nachgeschärft): die bisherigen 10 Rollstuhlplätze werden
    # normale Sitze, NUMMERIERT 1-10 (nicht 6-15!) — davor (physisch links) kommen 5 NEUE
    # Rollstuhlplätze (unnummeriert dargestellt, s. site-weite Regel), physisch zuerst
    # generiert (Sitz 1-5) und per renumber_seats auf die finalen Nummern der Reihe
    # verschoben: die letzten 10 (physisch 6-15) werden zu "1".."10". Die ersten 5
    # (physisch 1-5, Rollstuhl) werden BEWUSST MIT auf 11-15 umbenannt statt bei ihrer
    # rohen Nummer 1-5 zu bleiben — sonst kollidiert ihre (unsichtbare) Nummer mit den
    # NEUEN Nummern der Normalsitze: seat_guid wird aus der finalen Nummer berechnet (s.
    # renumber_seats-Docstring), zwei Sitze derselben Reihe mit derselben finalen Nummer
    # bekämen sonst denselben guid (Buchung des einen würde den anderen mitbuchen!). Da
    # Rollstuhlplätze ohnehin unnummeriert dargestellt werden, ist 11-15 rein intern.
    # Fluchtpunkte (beide von Marko explizit gefordert): erster Rollstuhlplatz unter Sitz 1
    # der Reihe 7, UND Sitz "10" (letzter normaler Sitz) unter Sitz 20 der Reihe 7 — macht
    # die Reihe exakt so breit (19 Einheiten Spannweite) wie die 20er-Reihen. Echte
    # Ein-Platz-Lücke zwischen JEDEM der 5 Rollstuhlplätze UND zwischen dem letzten
    # Rollstuhlplatz und dem ersten normalen Sitz (segment_gap_seats vor Segment 1-5) —
    # ergibt rechnerisch genau die passende Gesamtbreite, kein trailing_gap_units mehr
    # nötig.
    (6, [1, 1, 1, 1, 1, 10], KAT2, {
        "wheelchair_seats": [1, 2, 3, 4, 5],
        "segment_gap_seats": {1: 1, 2: 1, 3: 1, 4: 1, 5: 1},
        "renumber_seats": {
            "1": "11", "2": "12", "3": "13", "4": "14", "5": "15",
            "6": "1", "7": "2", "8": "3", "9": "4", "10": "5",
            "11": "6", "12": "7", "13": "8", "14": "9", "15": "10",
        },
    }),
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
    # Kategorie/Fanblock-Split (Marko, 09.08.2026, korrigiert 09.08.2026 nach Rückfrage):
    # Reihe 1-5 ist Fanblock, Reihe 6-12 (bereits per break_before={"6"} optisch abgesetzt)
    # ist Kategorie III — zwei eigene Produkte statt beide Kategorie II. Ursprünglich
    # hatte ich das vertauscht (Reihe 1-5 als Kategorie III, Reihe 6-12 als Fanblock) —
    # Marko: "Block A 1 bis 5 ist Fanblock." Geometrie/Sitzdaten bleiben unverändert, nur
    # die category-Zuordnung.
    # Reihe 1 (Marko, 04.08.2026): zusätzlicher Rollstuhlplatz ganz rechts, mit einer
    # vollen Sitzbreite Lücke zu Sitz 19 (dort, wo bisher nur die Reihennummer stand) —
    # neues Segment [1] (Sitz 20). Shift 0 (nicht mehr +1, Marko-Korrektur): +1 ergab eine
    # ZWEI Einheiten breite Lücke (ein leerer Sitzplatz PLUS die Reihennummer obendrauf) —
    # "nur ein Platz als Lücke" heißt genau EINE Einheit Abstand (Standard-Sitzabstand),
    # in die die Reihennummer hineinpasst. Shift 0 bleibt trotzdem in explicit_shift_
    # segments (expliziter Eintrag, s. mkrow()) — unterdrückt die sonst greifende
    # 10px-Dekorlücke, die sonst oben draufkäme.
    (1, [7, 12, 1], FANBLOCK, {"x_offset": -9, "segment_shifts": {0: -1, 2: 0}, "wheelchair_seats": [20],
        "label_before_seat": 20}),
    (2, [7, 12], FANBLOCK, {"x_offset": -9, "segment_shifts": {0: -1}}),
    (3, [7, 12], FANBLOCK, {"x_offset": -9, "segment_shifts": {0: -1}}),
    (4, [12], FANBLOCK, {"x_offset": -2}),
    (5, [12], FANBLOCK, {"x_offset": -2}),
    (6, [20], KAT3, {"x_offset": -10}),
    (7, [20], KAT3, {"x_offset": -10}),
    (8, [20], KAT3, {"x_offset": -10}),
    (9, [20], KAT3, {"x_offset": -10}),
    (10, [20], KAT3, {"x_offset": -10}),
    (11, [2, 20, 3], KAT3, {"x_offset": -12, "segment_shifts": {0: -3, 2: 2}}),
    (12, [7, 14, 7], KAT3, {"x_offset": -14, "segment_shifts": {0: -1, 2: 1}}),
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
    # Reihe 6-12 (Marko, 10.08.2026, vierte Korrektur): Reihe 10 ist der FESTE Referenz-
    # punkt und bleibt unangetastet ("in Reihe 10 darfst du den Abstand weder vergrößern
    # noch verkleinern"). Stattdessen werden Reihe 6-9 (bisher match_first_row_width, an
    # Reihe 1 gekoppelt) jetzt live an Reihe 10 gekoppelt (Sitz 1/16 exakt fluchtend) —
    # das ERGIBT automatisch einen größeren Sitzabstand als Reihe 10 (Reihe 10 hat wegen
    # der 4er-Lücke 19 statt 15 Einheiten über dieselbe Spannweite verteilt, also einen
    # ENGEREN Abstand) — exakt das von Marko beobachtete Verhältnis, nur mit vertauschten
    # Rollen (Reihe 6-9 zieht sich an Reihe 10, nicht umgekehrt).
    (6, [16], KAT1, {"x_offset": -10,
        "live_stretch": {0: {"first": {"row": "10", "seat": 1}, "last": {"row": "10", "seat": 16}}}}),
    (7, [16], KAT1, {"x_offset": -10,
        "live_stretch": {0: {"first": {"row": "10", "seat": 1}, "last": {"row": "10", "seat": 16}}}}),
    (8, [16], KAT1, {"x_offset": -10,
        "live_stretch": {0: {"first": {"row": "10", "seat": 1}, "last": {"row": "10", "seat": 16}}}}),
    (9, [16], KAT1, {"x_offset": -10,
        "live_stretch": {0: {"first": {"row": "10", "seat": 1}, "last": {"row": "10", "seat": 16}}}}),
    # Reihe 10 (Marko-Diktat, unverändert seit der Korrektur — NICHT mehr anfassen):
    # "1-8, 4er-Lücke, dann 9-16", reines festes Einheiten-Raster, keine Live-Messung.
    (10, [8, 8], KAT1, {"x_offset": -10, "segment_shifts": {0: -3.5, 1: 0.5}}),
    # Reihe 11 (Marko, 10.08.2026): "Platz 3 liegt genau über Platz 1 der Reihen 6-10,
    # Platz 16 genau über Platz 16 der Reihen 6-10." Segment 0 (Sitz 1-2, Shift -11)
    # unverändert (Fluchtpunkt zu Reihe 12 Sitz 1/2, nicht Teil dieser Korrektur). Sitz
    # 3-17 laufen jetzt per live_fit_scaled (s. seat-picker.js): relative_units ist die
    # aus der VORHERIGEN Runde (Shifts {1:-8,2:0,3:2}, s. Git-Historie) errechnete
    # Referenz-Struktur (Sitz 3=0, ..., Sitz 8=5, Sitz 9=14 ["8 Plätze Lücke"], ...,
    # Sitz 14=19, Sitz 15=22 ["treppensepariert"], Sitz 16=23, Sitz 17=24) — wird
    # PROPORTIONAL auf die neue Spannweite (Sitz3→Reihe10/Sitz1, Sitz16→Reihe10/Sitz16)
    # gestreckt/gestaucht, damit beide neuen Fluchtpunkte exakt erfüllt sind, OHNE die
    # relativen Lückengrößen zueinander willkürlich zu verwerfen.
    (11, [2, 6, 6, 3], KAT1, {"x_offset": -4, "segment_shifts": {0: -11, 1: -8, 2: 0, 3: 2},
        "live_fit_scaled": {
            "first": {"row": "10", "seat": 1}, "last": {"row": "10", "seat": 16},
            "anchor_first_seat": 3, "anchor_last_seat": 16,
            "relative_units": {3: 0, 4: 1, 5: 2, 6: 3, 7: 4, 8: 5, 9: 14, 10: 15, 11: 16,
                                12: 17, 13: 18, 14: 19, 15: 22, 16: 23, 17: 24}
        }}),
    # Reihe 12 (Marko, 10.08.2026): "Verschiebe Platz 11 bis Platz 20 so, dass Platz 20
    # über Platz 17 der Reihe 11 liegt." Segment 0/1 (Sitz 1-10, Shifts -2/-1) unverändert
    # (Fluchtpunkt Sitz 6=Sitz3 Reihe 11, nicht Teil dieser Korrektur). Segmente 2-4 (Sitz
    # 11-20) behalten ihre ALTEN relativen Shifts (0/1/1, s. Git-Historie) als Ausgangs-
    # basis — live_shift verschiebt diesen kompletten Block (anchor_seat=11) NACHTRÄGLICH
    # als starre Einheit, bis via_seat=20 exakt auf Reihe 11 Sitz 17 liegt (der seinerseits
    # erst durch Reihe 11s live_fit_scaled, s.o., seine finale Position bekommt — daher
    # Reihenfolge im JS: live_fit_scaled läuft VOR live_shift).
    (12, [7, 3, 3, 2, 5], KAT1, {"x_offset": -13, "segment_shifts": {0: -2, 1: -1, 2: 0, 3: 1, 4: 1},
        "live_shift": {2: {"anchor_seat": 11, "via_seat": 20, "target_row": "11", "target_seat": 17}}}),
]
block_C = [
    # Produkt-Split (Marko, 09.08.2026, korrigiert 09.08.2026 nach Rückfrage): Reihe 1-5
    # ist "C unten" (eigenes Produkt, eigener Preis: 75,00 € Einzelticket, kein Ermäßigt-
    # Tarif, wie VIP behandelt, s. opts.prices in tickets/einzelticket.html und
    # CATEGORY_META in seat-picker.js), Reihe 6-12 (bereits per break_before={"6"} optisch
    # abgesetzt) bleibt "Kategorie II". Ursprünglich hatte ich das vertauscht (Reihe 1-5
    # als Kategorie II, Reihe 6-12 als C unten) — Marko: "Block C 1 bis 5 ist Block C
    # unten."
    # Reihe 1-3 (Marko): echte Ein-Platz-Lücke zwischen Sitz 12 und 13 (Segment 1 beginnt
    # bei Sitz 13, s. segments [12,7]).
    (1, [12, 7], C_UNTEN, {"segment_gap_seats": {1: 1}}),
    (2, [12, 7], C_UNTEN, {"segment_gap_seats": {1: 1}}),
    (3, [12, 7], C_UNTEN, {"segment_gap_seats": {1: 1}}),
    (4, [12], C_UNTEN),
    (5, [12], C_UNTEN),
    (6, [20], KAT2),
    (7, [20], KAT2),
    (8, [20], KAT2),
    (9, [20], KAT2),
    (10, [20], KAT2, {"align_reference_seat": True}),
    (11, [2, 20, 2], KAT2, {"align_target_seat": 3, "segment_align": {"1": {"row": "12", "seat": 1}, "23": {"row": "12", "seat": 27}}}),
    # Reihe 12 (Marko): echte Ein-Platz-Lücken zwischen Sitz 7/8 (Segment 1) und 21/22
    # (Segment 2).
    (12, [7, 14, 7], KAT2, {"align_target_seat": 6, "segment_gap_seats": {1: 1, 2: 1}}),
]

plan = {
    "name": "Riethsporthalle Erfurt",
    "categories": [
        {"name": "Kategorie I", "color": "#E87722"},
        {"name": "Kategorie II", "color": "#1D3557"},
        {"name": "Kategorie III", "color": "#2A9D8F"},
        {"name": "Fanblock", "color": "#F4A300"},
        {"name": "C unten", "color": "#8E44AD"},
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

# Stehplatz (Marko, 05.08.2026): kein Sitzblock, sondern ein reiner Mengen-Bereich ohne
# Einzelplatz-Nummerierung (entspricht der Realität — Stehplätze haben keine feste
# Position) — deshalb bewusst KEINE eigene Zone im seatbasierten Pretix-Schema, sondern
# ein einzelnes Top-Level-Feld. Kapazität wird aus der Ziel-Gesamtkapazität der Halle
# (1.500) abzüglich der tatsächlichen Sitzplatzzahl berechnet, nicht hart codiert —
# ändert sich die Sitzplatzzahl künftig (z.B. weitere Korrekturen wie in dieser Session),
# bleibt die Gesamtkapazität automatisch bei 1.500, ohne dass diese Zahl von Hand
# nachgezogen werden muss. `available:0`: Stehplätze sind aktuell bewusst blockiert/
# reserviert (noch nicht verkaufbar, s. seat-picker.js _renderMobileOverview/
# _renderOccupancy) — zählen aber schon zur Gesamtkapazität.
TOTAL_CAPACITY_TARGET = 1500
seat_total = sum(len(r["seats"]) for z in plan["zones"] for r in z["rows"])
plan["standing"] = {
    "name": "Stehplatz",
    "capacity": TOTAL_CAPACITY_TARGET - seat_total,
    "available": 0
}

out_path = "/Users/marko/Documents/claude/Projects/website/assets/seating/riethsporthalle-seatingplan.json"
with open(out_path, "w") as f:
    json.dump(plan, f, ensure_ascii=False, indent=2)

# Pretix-taugliche Variante: Pretix' Sitzplan-Schema ist strikt (additionalProperties:
# false auf jeder Ebene) und kennt nur eine Handvoll Felder pro Ebene (empirisch gegen den
# tatsaechlich live in pretix gespeicherten Plan geprueft: zone_id/uuid/name/position/rows,
# row_number/row_number_position/uuid/position/seats, seat_number/seat_guid/uuid/position/
# category). Alle eigenen Layout-Hilfsfelder (align_edge, segment_align, live_fit, section_break,
# wheelchair, ...) sind Pretix unbekannt und muessen fuer einen echten Upload raus — deshalb hier
# ein Allowlist-Rebuild statt einer Pop-Liste. seat_guid/uuid bleiben unveraendert, damit beide
# Dateien dieselben Sitze referenzieren. "standing" kennt Pretix ebenfalls nicht (nur seatbasierte
# Zonen) und entfaellt komplett.
def pretix_seat(seat):
    return {k: seat[k] for k in ("seat_number", "seat_guid", "uuid", "position", "category")}

def pretix_row(row):
    return {k: row[k] for k in ("uuid", "position", "row_number", "row_number_position") if k in row} | {
        "seats": [pretix_seat(s) for s in row["seats"]]
    }

def pretix_zone(zone):
    return {k: zone[k] for k in ("zone_id", "uuid", "name", "position") if k in zone} | {
        "rows": [pretix_row(r) for r in zone["rows"]]
    }

pretix_plan = {
    "name": plan["name"],
    "categories": plan["categories"],
    "size": plan["size"],
    "zones": [pretix_zone(z) for z in plan["zones"]]
}

pretix_out_path = "/Users/marko/Documents/claude/Projects/website/assets/seating/riethsporthalle-seatingplan.pretix.json"
with open(pretix_out_path, "w") as f:
    json.dump(pretix_plan, f, ensure_ascii=False, indent=2)

totals = {}
for z in plan["zones"]:
    for r in z["rows"]:
        for s in r["seats"]:
            totals[s["category"]] = totals.get(s["category"], 0) + 1
print("Seat totals per category:", totals)
print("Stehplatz:", plan["standing"], "-> Gesamtkapazität:", seat_total + plan["standing"]["capacity"])
print("Zones:", [(z["zone_id"], len(z["rows"]), sum(len(r["seats"]) for r in z["rows"])) for z in plan["zones"]])
