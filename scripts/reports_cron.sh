#!/bin/bash
# RUBICON — Auto-Generierung der verdichteten Reports (Woche/Monat/Quartal) vor den
# Sitzungen. Läuft als launchd-Cron (Mo 06:00 + Monatsanfang). Perioden werden aus
# meta.today (Steuerungsdatum) abgeleitet; schreibt PDFs + Google Docs + Index.
export PATH="/Library/Frameworks/Python.framework/Versions/3.14/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/dieterstreuli/Chief/rubicon/control-tower || exit 1
echo "==== $(date '+%Y-%m-%d %H:%M:%S') · reports --auto ===="
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 scripts/gen_report.py --auto
echo ""
