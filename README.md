# wt-tactical-map

Ein leichtgewichtiges, Desktop-basiertes Overlay für War Thunder, das Live-Telemetriedaten und taktische Informationen flugbegleitend darstellt. Die Anwendung basiert auf dem **Electron-Framework** und nutzt die offiziellen Webschnittstellen des Spiels, um Latenzen zu minimieren und eine vollständige Kompatibilität mit Easy Anti-Cheat (EAC) zu gewährleisten.

## Features

### Taktische Karte & Navigation
* **Echtzeit-Kartenvisualisierung:** Darstellung der operativen Karte inklusive taktischer Gitter, Flugpfad-Historie (Trails) sowie dynamischer Einheiten-Marker und Tags.
* **Kategorie-Filter:** Dedizierte Toggles zum Filtern von Kartenelementen (Luft, Boden, See, Basen) oder zum vollständigen Ausblenden aller Markierungen per Klick.
* **Integrierter Navigationskompass:** Modulares Kompassband mit selektiver Anzeige für aktive Bedrohungen/Locks, feindliche und freundliche Flugzeuge, Bombenbasen sowie Flugplätze.
* **Fullscreen-Modus:** Die taktische Karte lässt sich bei Bedarf auf die vollständige Fenstergröße maximieren.

### Cockpit Audio & Voice Warning System (VWS)
* **Akustische Warnmeldungen:** Integrierte Audio-Trigger bei kritischen Flugzuständen.
* **Text-to-Speech (TTS) Sprachausgabe:** Unterstützung systemeigener TTS-Stimmen zur akustischen Warnung vor taktischen und systemtechnischen Gefahren:
  * Kritischer Treibstoffstand (Low & Mid Fuel)
  * Unmittelbare Luftnahkämpfe (Hostile Merge - Tail/Front)
  * Radarerfassung (Radar Lock-on / Warning Lock)
  * Triebwerksüberhitzung (Redline Temperature)
  * Triebwerksausfall (Engine Failure / Shutdown)
  * Bodennähe-Warnsystem (GPWS Pull Up)

### Anpassung & UI-Konfiguration
* **Modulares Widget-Framework:** Volle Drag-and-Drop-Unterstützung. Alle Telemetrie- und Anzeige-Widgets können frei verschoben und im Workspace positioniert werden.
* **Granulare Steuerung der Daten-Sichtbarkeit:** Unwichtige Elemente können über das Konfigurationsmenü flexibel ein- und ausgeblendet werden:
  * *HUD-Panels:* Flugtelemetrie, 3D-Lageanzeige (Attitude Display), Hydraulik-Indikatoren, Radar-Telemetrie, Navigationskompass, Taktischer Kampf-Log, 2D-Künstlicher-Horizont und Treibstoff-Rundinstrument.
  * *Statistik-Karten:* Separate Toggles für IAS, TAS, Flughöhe (MSL), Steigrate, Gashebel-Stellung (%), G-Last, Anstellwinkel ($aoa$) und Mach-Geschwindigkeit.
  * *Systemzustände:* Fahrwerkstatus, Klappenstellung, Luftbremsen-Aktivierung, Triebwerksdrehzahl ($rpm$) sowie Öl- und Wassertemperaturen.
* **Custom Themes & Icons:** Vollständige Anpassung der visuellen Designs und Symbole der Benutzeroberfläche.

### Hardware- & Multi-Monitor-Support
* **Multi-Monitor-Layouts:** Optimierte Unterstützung für den Betrieb auf Sekundärbildschirmen oder separaten Cockpit-Monitoren.
* **Globale HOTAS-Hotkeys:** Direkte Erkennung von Hardware-Eingaben (Flight Sticks und Throttles). Die Hotkeys fangen Steuerbefehle global ab und funktionieren zuverlässig im Hintergrund, während der War Thunder-Client im Vordergrund fokussiert ist.

---

## Technische Funktionsweise

Die Anwendung nutzt eine zweigleisige Architektur zur Datenerfassung:
1. **State- & Indikatoren-Abfrage:** Periodische HTTP-Requests an die JSON-Endpunkte `/state` und `/indicators` für rein physikalische und systemtechnische Telemetrie.
2. **Karten- & Kontaktextraktion:** Ein im Hintergrund laufendes, unsichtbares `BrowserWindow` (Headless) lädt die Weboberfläche des Spiels, um Positionsdaten aus `/map_obj.json` zu verarbeiten und komplexe UI-Elemente direkt aus dem DOM/Canvas-Kontext der lokalen Instanz zu extrahieren.

Da die Daten rein lesend aus der Rendering-Engine des eigenen Chromium-Prozesses gezogen werden, bleibt die Anwendung zu 100 % EAC-konform.

---

## Installation & Entwicklung

### Voraussetzungen
* **Node.js** (aktuelle LTS-Version empfohlen)
* **npm** oder **yarn**
* Eine aktive Instanz von **War Thunder** (während der Ausführung)

### Repository klonen und Abhängigkeiten installieren
```bash
git clone [https://github.com/Tjorven-Liebe/wt-tactical-map.git](https://github.com/Tjorven-Liebe/wt-tactical-map.git)
cd wt-tactical-map
npm install
npm run electron
