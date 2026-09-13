# SOTE-Aufgaben in SONE

Die neue Verbindung steht unter **Einstellungen → Verbundene Anwendungen**. Die Administration registriert zunächst die SONE-Basisadresse in SOTE und hinterlegt anschließend SOTE-Adresse, Client-ID und Geheimnis in SONE. `SONE_PUBLIC_URL` muss der verwendeten öffentlichen Adresse entsprechen; beide Server müssen einander über HTTPS erreichen können.

Jede Person verbindet ihr eigenes SOTE-Konto und erlaubt ausgewählte Projekte mit Lese- oder Schreibzugriff. Diese persönliche Freigabe gilt 30 Tage und kann erneuert oder widerrufen werden. Eine neue Freigabe ersetzt ältere Freigaben nicht automatisch: nicht mehr benötigte Freigaben in SOTE trennen.

Die Arbeitsbereichsverwaltung ordnet erlaubte Projekte zu. Dafür werden Verwaltungsrechte auf beiden Seiten benötigt. Innerhalb eines SONE-Arbeitsbereichs können mehrere Projekte desselben SOTE-Arbeitsbereichs verwendet werden.

Im Editor stehen `/sote` → **SOTE-Aufgabe** und **SOTE-Aufgabenliste** bereit. Möglich sind neue Aufgaben, bestehende Einzelaufgaben, Titel, Beschreibung, Datum/Uhrzeit, Ganztägig, Dauer, Erledigen und Wiederöffnen. Die normalen SOTE-Regeln einschließlich Wiederholungen gelten weiter. Aufgabenlinks öffnen SOTE; neu angelegte Aufgaben verweisen auf den Ursprungsblock in SONE.

Die Schnittstelle prüft Seitenrechte, Seitensperre, gespeicherten Block, Zuordnung und persönliche SOTE-Freigabe vor jedem Zugriff. Anonyme Seitenfreigaben erhalten keine Daten. Das Notizdokument enthält ausschließlich Referenzen; keine Tokens, Titel oder Aufgabenbeschreibungen. Exporte und Wiederherstellungen bleiben deshalb neutrale Referenzblöcke. Entfernen einer Notiz oder Verbindung löscht keine Aufgaben.

Sichtbare Tabs gleichen ungefähr alle 15 Sekunden ab. Gleichzeitige Änderungen verlangen eine Prüfung des aktuellen Stands. Anlagevorgänge sind idempotent; im Sitzungsspeicher bleibt lediglich die Vorgangs-ID für eine Wiederaufnahme. Ungespeicherter Formulartext wird nicht dauerhaft gespeichert.

Migration **0079_sote_integration** ergänzt die Verbindungstabellen; Dokumentformat **5** schützt die neuen Editor-Blöcke vor alten Clients. Zuerst SOTE mit Migration 0047, dann SONE aktualisieren und Browser-Tabs neu laden. Es werden keine neuen Umgebungsvariablen benötigt. SONE verschlüsselt Zugangsdaten mit dem vorhandenen `SONE_SECRET_KEY`.

Der private Freigabeablauf nutzt einen einmaligen Code, S256-PKCE und eine sitzungsgebundene Rückkehr. Er ist kein allgemeiner OAuth-/OpenID-Provider. Automatische Token-Erneuerung, Webhooks, zusätzliche Filter, mehrere Quellen, Rückvorschauen und Offline-Schreiben folgen später. Geschützte Abschnitte sind noch nicht unterstützt. Beim Entfernen der Instanz auch deren Registrierung in SOTE widerrufen.

Die zugehörige ausführliche Anleitung befindet sich im SOTE-Repository unter `docs/sone-verbindung.md`; das Gesamtkonzept unter `claude/sone-sote-verbindung.md`.
