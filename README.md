# wt-tactical-map

Ein leichtgewichtiges, Desktop-basiertes Overlay für War Thunder, das Live-Telemetriedaten und taktische Informationen flugbegleitend darstellt. Die Anwendung basiert auf dem **Electron-Framework** und nutzt die offiziellen Webschnittstellen des Spiels, um Latenzen zu minimieren und eine vollständige Kompatibilität mit Easy Anti-Cheat (EAC) zu gewährleisten.

## Features

* **EAC-sicherer Betrieb:** Keine Code-Injection oder Speicher-Hooks. Alle Daten werden über die lokale Webschnittstelle (`localhost:8111`) bezogen.
* **Live-Telemetrie:** Echtzeit-Anzeige kritischer Flugparameter wie Geschwindigkeit, Höhe, Anstellwinkel (aoa), Triebwerksdaten (rpm, Temperatur) und Treibstoffverbrauch.
* **Taktische Übersicht:** Visualisierung von Positionsdaten und Kontakten basierend auf der dynamischen In-Game-Minimap.

## Technische Funktionsweise

Die Anwendung nutzt eine zweigleisige Architektur zur Datenerfassung:

1. **State- & Indikatoren-Abfrage:** Periodische HTTP-Requests an die JSON-Endpunkte `/state` und `/indicators` für rein physikalische und systemtechnische Telemetrie.
2. **Karten- & Kontaktextraktion:** Ein im Hintergrund laufendes, unsichtbares `BrowserWindow` (Headless) lädt die Weboberfläche des Spiels, um Positionsdaten aus `/map_obj.json` zu verarbeiten und komplexe UI-Elemente wie das Radar-Overlay direkt aus dem DOM/Canvas-Kontext der lokalen Instanz zu extrahieren.

---

## Installation & Entwicklung

### Voraussetzungen

* **Node.js** (aktuelle LTS-Version empfohlen)
* **npm** oder **yarn**
* Eine aktive Instanz von **War Thunder** (während der Ausführung)

### Repository klonen und Abhängigkeiten installieren

```bash
git clone https://github.com/Tjorven-Liebe/wt-tactical-map.git
cd wt-tactical-map
npm install
```

### Anwendung im Entwicklungsmodus starten

```bash
npm start electron
```

## Konfiguration

Standardmäßig lauscht die Anwendung auf der offiziellen War Thunder-Schnittstelle unter `http://localhost:8111`. Sollte der Port im Spiel geändert worden sein, kann dies in den Konfigurationsdateien des Projekts angepasst werden.

## Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert. Siehe `LICENSE` für Details.
