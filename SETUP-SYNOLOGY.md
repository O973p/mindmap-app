# Mindmap-App auf dem Synology-NAS einrichten

Ziel: Die App läuft dauerhaft auf dem NAS („speichy"). PC und Handy öffnen dieselbe
Adresse im Browser und arbeiten auf denselben Maps — der PC kann ausbleiben.

## Schritt 1: Zugangsschlüssel festlegen

Öffne `docker-compose.yml` in diesem Ordner und ersetze
`BITTE-AENDERN-langer-geheimer-schluessel` durch einen eigenen, langen Schlüssel
(z. B. 3–4 zufällige Wörter mit Zahlen). Diesen Schlüssel gibst du später
einmalig am PC und am Handy ein.

## Schritt 2: Ordner aufs NAS kopieren

Kopiere den kompletten Ordner `mindmap_app` auf dein NAS, z. B. einfach nach
`H:\mindmap_app` (das ist auf dem NAS dann `/homes/<dein-benutzer>/mindmap_app`).

## Schritt 3: Container Manager installieren und Projekt starten

1. DSM im Browser öffnen: `http://speichy:5000`
2. **Paket-Zentrum** → nach **„Container Manager"** suchen → installieren.
   (Auf älteren DSM-Versionen heißt das Paket **„Docker"** — gleiche Funktion.
   Falls beides nicht angeboten wird, unterstützt dein Modell kein Docker —
   dann sag Bescheid, es gibt einen Plan B.)
3. Container Manager öffnen → **Projekt** → **Erstellen**:
   - Projektname: `mindmap`
   - Pfad: den kopierten Ordner `mindmap_app` auswählen
   - Die `docker-compose.yml` wird automatisch erkannt → Weiter → Fertigstellen
4. Das Projekt starten. Beim ersten Start lädt das NAS einmalig das
   Python-Image herunter (~50 MB).

**Test im Heim-WLAN:** `http://speichy:8123` am PC oder Handy öffnen →
Schlüssel eingeben → fertig. Beide Geräte sehen jetzt dieselben Maps.

## Schritt 4: Zugriff von unterwegs (ohne VPN)

Wichtig: **Niemals Port 8123 direkt im Router freigeben** — das wäre
unverschlüsseltes HTTP. Stattdessen die Synology-Bordmittel nutzen (HTTPS):

1. **DDNS einrichten:** DSM → Systemsteuerung → **Externer Zugriff** → **DDNS**
   → Hinzufügen → Anbieter „Synology" → Wunschname wählen, z. B.
   `meinname.synology.me` (kostenlos, Synology-Konto nötig).
2. **Zertifikat holen:** Systemsteuerung → **Sicherheit** → **Zertifikat** →
   Hinzufügen → **Let's Encrypt** → deine DDNS-Adresse eintragen.
3. **Reverse Proxy anlegen:** Systemsteuerung → **Anmeldeportal** → **Erweitert**
   → **Reverse Proxy** → Erstellen:
   - Quelle: Protokoll `HTTPS`, Hostname `meinname.synology.me`, Port `8443`
   - Ziel: Protokoll `HTTP`, Hostname `localhost`, Port `8123`
4. **Router-Portweiterleitung:** In der Fritzbox (o. ä.) TCP-Port `8443` an das
   NAS (`192.168.178.34`) weiterleiten. Nur diesen einen Port!
5. Am Handy von unterwegs: `https://meinname.synology.me:8443` öffnen,
   Schlüssel eingeben.

Tipp fürs Handy: Seite öffnen → Browser-Menü → **„Zum Startbildschirm
hinzufügen"** — dann startet die App wie eine normale App mit eigenem Icon.

## Empfohlene Absicherung (5 Minuten)

- Systemsteuerung → Sicherheit → **Firewall**: Zugriff auf Port 8443 z. B. auf
  Deutschland beschränken (Geo-Blocking) — filtert 95 % der Scan-Bots weg.
- **Automatische Blockierung** aktivieren (Systemsteuerung → Sicherheit → Konto).
- Einen langen, einmaligen Zugangsschlüssel verwenden.

## Wo liegen meine Daten?

Jede Map ist eine JSON-Datei in `mindmap_app/server/data/` auf dem NAS.
Wenn dein NAS-Backup (z. B. Hyper Backup) diesen Ordner mitsichert, sind die
Maps automatisch im Backup. Zusätzlich gibt es weiterhin den
Export/Import-Button in der App.

## Bekannte Grenze

Nicht dieselbe Map **gleichzeitig** auf zwei Geräten bearbeiten — es gewinnt,
wer zuletzt speichert. Nacheinander (PC, dann Handy) ist völlig problemlos.
