#!/usr/bin/env python3
"""QR-Code mit Löwe (Marko 27.11.2026, Postkarten-Übergabe qr_loewe.py; Gegenstück im Browser: js/qr-loewe.js).

Fehlerkorrektur H, Modulfarbe #00122D, Löwe in der Mitte (5,4 von 26 mm ≈ 21 % der Kantenlänge) mit hauchdünnem
weißem Rand, ein Modul weißer Rand rundum. Ergebnis: SVG mit eingebettetem PNG (SVG-Pfade mit Bild werden im Druck
sonst unterschiedlich dargestellt). Nur für Werbe- und Link-Codes (Schilder, Aufkleber, Aushänge); Einlass-Codes
(pretix, Wallet) und GiroCodes bleiben ohne Löwe.

    from qr_loewe import qr_loewe_svg
    svg = qr_loewe_svg("https://basketball-loewen.com/g/K7P2X9", mm=26)
"""
import base64
import io
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFilter

LOEWE = Path(__file__).resolve().parent.parent / "assets" / "postkarte" / "loewe.png"


def qr_loewe_svg(inhalt, mm=26.0, loewe_anteil=5.4 / 26, rand_anteil=0.2 / 26, farbe=(0, 18, 45), px=24):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=1, border=1)
    q.add_data(inhalt)
    q.make(fit=True)
    matrix = q.get_matrix()            # mit Rand
    n = len(matrix)
    S = n * px
    im = Image.new("RGB", (S, S), (255, 255, 255))
    d = ImageDraw.Draw(im)
    for y, zeile in enumerate(matrix):
        for x, dunkel in enumerate(zeile):
            if dunkel:
                d.rectangle([x * px, y * px, (x + 1) * px - 1, (y + 1) * px - 1], fill=farbe)
    innen = S - 2 * px                 # Kantenlänge ohne Rand, darauf bezieht sich die Löwengröße
    L = Image.open(LOEWE).convert("RGBA")
    h = int(innen * loewe_anteil)
    w = int(h * L.width / L.height)
    L = L.resize((w, h), Image.LANCZOS)
    r = max(1, int(innen * rand_anteil))
    alpha = L.getchannel("A").filter(ImageFilter.MaxFilter(2 * r + 1))
    ox, oy = (S - w) // 2, (S - h) // 2
    im.paste(Image.new("RGB", (w, h), (255, 255, 255)), (ox, oy), alpha)
    im.paste(L, (ox, oy), L)
    puffer = io.BytesIO()
    im.save(puffer, "PNG", optimize=True)
    b = base64.b64encode(puffer.getvalue()).decode("ascii")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{mm}mm" height="{mm}mm" viewBox="0 0 {mm} {mm}">'
            f'<image width="{mm}" height="{mm}" xlink:href="data:image/png;base64,{b}"/></svg>\n')


if __name__ == "__main__":
    import sys
    sys.stdout.write(qr_loewe_svg(sys.argv[1] if len(sys.argv) > 1 else "https://basketball-loewen.com/g/K7P2X9"))
