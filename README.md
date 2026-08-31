# Basketball Löwen Erfurt — Website (Redesign 2026)

Plain HTML/CSS/JS-Neubau der Vereinswebsite, auf Basis des Basketball-Löwen-Designsystems
(`Projects/brand`). Kein Build-Schritt, keine Frameworks — direkt statisch hostbar.

## Lokale Vorschau

```
python3 -m http.server 4179
```
dann `http://localhost:4179/` öffnen. (Läuft auch über den Claude-Code-Preview-Server
`website-preview`, siehe `.claude/launch.json` im Repo-Root `Projects/claude`.)

## Struktur

- `index.html` — Startseite
- `verein/`, `saison/`, `trainieren/`, `loewenpark/`, `partner/`, `news/`, `fans/` — Hauptnav-Bereiche
- `kontakt.html`, `impressum.html`, `datenschutz.html`, `tickets.html`, `fanshop.html`,
  `mitglied-werden.html`, `spenden.html` — Footer/Utility-Seiten
- `partials/header.html`, `partials/footer.html` — werden zur Laufzeit per `js/include.js`
  in jede Seite eingefügt (Platzhalter-Divs `#site-header-placeholder` / `#site-footer-placeholder`)
- `css/colors_and_type.css` — Design-Tokens (Farben/Typo) aus dem Designsystem
- `css/site.css` — Layout & Komponenten (Nav, Hero, Cards, Formulare, Footer, Responsive)
- `js/nav.js` — Dropdown-/Hamburger-/„Mehr"-Interaktionen
- `js/include.js` — lädt Header/Footer-Partials, setzt aktiven Nav-Punkt
- `js/season-config.js` — ein Schalter für die Hero-CTAs (Saison / Nebensaison)
- `data/*.json` — Trainingszeiten, Teams, News, Sponsoren, Ansprechpartner (Pflegbarkeit:
  hier ändern statt im HTML zu suchen)

## Bekannte Baustellen (bewusst offen für die nächste Ausbaustufe)

- Probetraining-Formular ist aktuell eine einfache Infoseite ohne die geplante
  Geburtsjahr→Trainingszeit-Automatik (Konzept + JS-Skelett liegt in `js/probetraining.js`
  bereit, aber noch nicht verdrahtet).
- Hero-Bild auf der Startseite ist ein Platzhalter-Verlauf, kein echtes Foto.
- Impressum/Datenschutz enthalten TODO-Markierungen für Angaben, die vor Livegang
  rechtlich/inhaltlich vom Verein bestätigt werden müssen (USt-IdNr, exakter Rechtstext).
- Einzelne Sponsor-/Kontakt-/Datumsangaben (z. B. Löwenpark-Eröffnung) sind auf der
  Altseite widersprüchlich — im Zweifel vorsichtig formuliert, nicht hart behauptet.
