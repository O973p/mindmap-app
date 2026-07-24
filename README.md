# Mindmap-App

Eine kleine lokale Mindmap-App im Browser — ohne Abhängigkeiten, ohne Build-Schritt, ohne Server-Zwang.

## Als App installieren (PWA)

Die App ist eine Progressive Web App: Wird sie über **HTTPS** (oder localhost)
geöffnet, lässt sie sich installieren — mit eigenem Icon, Vollbild und
Offline-Start:

- **Android/Chrome:** Menü (⋮) → „App installieren" bzw. „Zum Startbildschirm hinzufügen"
- **iPhone/Safari:** Teilen-Symbol → „Zum Home-Bildschirm"
- **PC/Chrome/Edge:** Install-Symbol rechts in der Adressleiste

Wichtig: Über unverschlüsseltes HTTP im Heimnetz (z. B. `http://speichy:8123`)
erlauben Browser keine Installation und keinen Offline-Modus — die App läuft
dort trotzdem normal im Browser-Tab.

## Starten

**Empfohlen (Server-Modus):** Die App auf dem NAS betreiben — siehe
[SETUP-SYNOLOGY.md](SETUP-SYNOLOGY.md). Dann arbeiten PC und Handy auf denselben
Maps, gespeichert als JSON-Dateien in `server/data/`.

Lokal am PC (z. B. zum Entwickeln):

```bash
python server/server.py
```

und dann http://localhost:8123 öffnen. Ohne `MINDMAP_KEY`-Umgebungsvariable
läuft der Server ohne Schlüsselschutz (fürs lokale Testen okay).

**Fallback:** Öffnet man die App ohne erreichbaren Server (per `file://` oder
`python -m http.server`), speichert sie automatisch lokal in der IndexedDB des
Browsers — dann sind die Maps aber an genau diesen Browser gebunden.

## Datei-Modus (z. B. mit Google Drive)

Maps können auch direkt als `.mindmap.json`-Datei bearbeitet werden — unabhängig
vom Speicher der App:

- **„Datei öffnen"** (Startbildschirm): Datei auswählen und direkt darin
  arbeiten. Der Dateiname wird oben im Editor angezeigt.
- **„Als Datei…"** (Editor): die aktuelle Map in eine Datei speichern und ab
  dann dort weiterarbeiten.

**Am PC (Chrome/Edge):** Die App speichert automatisch direkt in die Datei.
Liegt die Datei im Ordner von „Google Drive für Desktop", synchronisiert Drive
sie von selbst — kein manueller Schritt nötig.

**Am Handy:** Browser dürfen Dateien nur lesen, nicht direkt zurückschreiben.
Ablauf dort: Datei öffnen → bearbeiten → **„Speichern"** lädt die geänderte
Datei herunter → im Drive die alte Version ersetzen (Drive-App → hochladen).
Der Punkt (•) am Dateinamen zeigt ungespeicherte Änderungen an; beim Verlassen
warnt die App davor.

**Achtung:** Bearbeite die Datei nicht auf zwei Geräten gleichzeitig — und
ersetze nach dem Handy-Bearbeiten die Drive-Datei sofort, sonst arbeitest du
am PC später mit dem alten Stand weiter.

## Bedienung

| Aktion | So geht's |
|---|---|
| Neuer Text-Knoten | Doppelklick auf freie Fläche |
| Text bearbeiten | Doppelklick auf den Knoten |
| Verschieben | Knoten ziehen |
| Verbinden | Vom farbigen Punkt am Knotenrand zum Ziel-Knoten ziehen |
| Bild einfügen | Bilddatei auf die Fläche ziehen oder Strg+V |
| Bild-/Textgröße ändern | Knoten auswählen, Griff unten rechts ziehen (klassischer Modus) |
| Größe zurücksetzen | Knoten auswählen → Pfeile-nach-innen-Symbol in der Leiste (klassischer Modus) |
| Hauptknoten festlegen | Knoten auswählen → Stern-Symbol in der Leiste |
| Größenmodus | Blitz-Symbol in der Kopfzeile: klassisch (manuell) oder dynamisch — im dynamischen Modus wachsen Knoten mit der Größe ihres Astes (ausgehend von den Hauptknoten), mit fester Obergrenze |
| Linienfarbe | Ergibt sich automatisch aus den Farben der verbundenen Knoten |
| Zoomen | Mausrad (zoomt zum Mauszeiger) |
| Bewegen (Pan) | Hintergrund ziehen (oder mittlere Maustaste) |
| Löschen | Knoten/Verbindung auswählen, dann `Entf` |
| Farbe ändern | Knoten auswählen, Farbe in der schwebenden Leiste wählen |
| Undo / Redo | `Strg+Z` / `Strg+Y` |
| Backup | „Exportieren" (JSON-Datei), auf dem Startbildschirm wieder importierbar |

Alle Änderungen werden automatisch gespeichert.
