# Report-/Dokument-Vorlagen bauen (Template-Engine, Weg 1)

Reproduzierbarer Bau der gebrandeten Google-Docs-Vorlagen, die `doc_template`/`doc_materialize`
mit `{{ANKER}}` füllen. Alle Vorlagen teilen **eine Basis-Chrome** (a×s-Logo im Header auf jeder
Seite, Seitenzahlen „X/Y" + dynamische Fusszeile `{{FOOTER}}`).

## Basis-Pattern

Zwei Elemente der Basis sind **nicht per API setzbar** und darum **manuell** in der Basis-Vorlage
gepflegt (danach vererben sie sich über `files.copy` an jede abgeleitete Vorlage):

- **Logo im Header** — die Organisation sperrt script-basierte öffentliche Bilder
  (`publishOutNotPermitted`), `insertInlineImage` braucht aber eine öffentliche URI.
- **Seitenzahlen in der Fusszeile** — die Docs-API kann Auto-Seitenzahl-Felder weder einfügen
  noch lesen.

Die Basis heisst **„AXS Report-Basis (Grundlage)"** (Doc-ID via `RUBICON_TEMPLATE_BASE`, Default in
den Buildern). Sie trägt: Ränder 50 pt · rechtsbündigen Header mit Logo · Fusszeile mit `{{FOOTER}}`
+ Seitenzahl-Autofeld · Body-Platzhalter `{{BODY}}`. `build_base_template.py` legt Ränder/Header/
Footer/Body an — **Logo + Seitenzahlen setzt man danach von Hand** in der Doc-UI.

## Scripts

Alle laufen als Bot `rubicon@axs.aero` via keyless-DWD:

```bash
export RUBICON_WORKSPACE_SA=rubicon-workspace@aixs-260106.iam.gserviceaccount.com
export RUBICON_IMPERSONATE_SUBJECT=rubicon@axs.aero
# ADC als admin@did-it.ch mit serviceAccountTokenCreator auf die Workspace-SA (gauth)

python3 scripts/templates_build/build_base_template.py                 # Basis (danach Logo+Seitenzahlen manuell)
python3 scripts/templates_build/build_report_templates.py <woche|monat|vr>
python3 scripts/templates_build/build_fixed_templates.py  [traktanden|entscheide|briefings|fuehrungsrhythmus|all]
```

Jeder Build **kopiert die Basis** und ersetzt `{{BODY}}` durch die typ-spezifische Struktur
(Überschriften + Anker), wendet das Marken-Styling an und rendert ein Sample nach `/tmp`. Header/
Footer/Seitenzahlen werden **nicht** neu erzeugt — sie kommen aus der Basis-Kopie.

Ergebnis liegt im Iterations-Ordner (`RUBICON_TEMPLATE_BUILD_FOLDER`). **Finalisieren** =
in den Templates-Ordner kopieren und die neue Doc-ID in `scripts/_tools/rubicon_templates.json`
je Typ eintragen (der Server liest die ID über `doc_materialize.template_id`). `_render_hash`
schliesst die template_id ein → eine neue ID rendert alle betroffenen Server-Docs neu.

## Anker-Manifest (MUSS 1:1 zu den Consumern passen)

Consumer: `gen_report.report_spec` (Reporte) und `_docmap.*_spec` (Fix-Struktur-Docs). Der
`test_report_spec.py`-Anker-Test hält die Report-Parität fest.

**Reporte** — alle: `{{TITEL}}`, `{{UNTERTITEL}}`, `{{PROGRAMM_AMPEL}}`, `{{STAND}}`, `{{FOOTER}}`,
`{{KI_NARRATIV}}`, `{{KI_BEGRUENDUNGEN}}`.

- **vr**: `{{KENNZAHLEN}}` (Kern-Ende/Hard-Edge/Meilensteine), `{{CHAIRMAN_STATEMENT}}`,
  `{{PHASEN_TABELLE}}`, `{{GATES_TABELLE}}`, `{{ENTSCHEIDUNGSBEDARF_TABELLE}}` (Entscheid/Quelle),
  `{{RISIKEN_TABELLE}}` (MS/Risiko/Verzug), `{{WS_TABELLE}}`.
- **monat**: `{{PHASEN_TABELLE}}`, `{{WS_TABELLE}}`, `{{BEWEGUNGEN}}`, `{{FORTSCHRITT_TABELLE}}`,
  `{{WS_KOMMENTARE}}`, `{{COMMITMENTS_TABELLE}}`, `{{OFFENE_ENTSCHEIDE}}`, `{{KOMMENTAR}}`.
- **woche**: `{{DELTA_FENSTER}}` (Value, Δ-Bezugszeitraum), `{{DELTA_AMPEL}}`, `{{DELTA_FORTSCHRITT}}`,
  `{{DELTA_ERLEDIGT}}`, `{{DELTA_ENTSCHEIDE}}`, `{{AKTIVITAET_TABELLE}}`, `{{COMMITMENTS_TABELLE}}`,
  `{{ENTSCHEIDE_TABELLE}}`, `{{KOMMENTAR}}`.

**Fix-Struktur** (Body-Anker; `{{FOOTER}}` dynamisch, Text zentral in `_docmap.FOOTER`):

- **traktanden**: `{{MEETING_ID}}`, `{{DAUER}}`, `{{VORSITZ}}`, `{{TEILNEHMER}}`, `{{STANDING_RULE}}`,
  `{{BODY_TRAKTANDEN}}`.
- **entscheide**: `{{REGISTER_ID}}`, `{{TITEL}}`, `{{BESCHLUSS}}`, `{{TYP}}`, `{{GREMIUM}}`,
  `{{ANTRAGSTELLER}}`, `{{DATUM}}`, `{{STATUS}}`, `{{BEGRUENDUNG}}`, `{{DATENGRUNDLAGE}}`, `{{QUELLE}}`.
- **briefings**: `{{MS_ID}}`, `{{WS_NAME}}`, `{{PRIO}}`, `{{MSTATUS}}`, `{{QUARTAL}}`, `{{NAME}}`,
  `{{OWNER}}`, `{{BETEILIGTE}}`, `{{START}}`, `{{DUE}}`, `{{DEPS}}`, `{{FLAGS}}`, `{{ZIEL_KLARTEXT}}`,
  `{{KONTEXT}}`, `{{BODY_LEISTUNG}}`, `{{BODY_VORGEHEN}}`, `{{ERFOLGSMESSUNG}}`, `{{BODY_RISIKEN}}`,
  `{{GROUNDING}}`.
- **fuehrungsrhythmus** (Landscape): `{{TITEL}}`, `{{UNTERTITEL}}`, `{{BODY_RHYTHMUS}}`,
  `{{BODY_GRUNDSAETZE}}`.

## Spaltenbreiten

Portrait A4, Ränder 50 pt → nutzbar ~495 pt: Tabellensumme **≤ 490 pt**. Landscape (FR) → nutzbar
741,89 pt: Summe **≤ 741 pt**. Übersteigt die Summe die nutzbare Breite, ragt die Tabelle über den
Rand (fixed-width). Die Consumer-Tests prüfen das.
