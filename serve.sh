#!/bin/bash
# RUBICON Control Tower — Vite-Dev-Server als launchd-Login-Agent (Port 8621).
# node/npm liegen unter nvm; PATH muss die nvm-bin enthalten.
export PATH="/Users/dieterstreuli/.nvm/versions/node/v24.14.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/dieterstreuli/Chief/rubicon/control-tower || exit 1
# exec, damit launchd den Vite-Prozess direkt überwacht (KeepAlive greift sauber).
exec node node_modules/vite/bin/vite.js --port 8621 --strictPort
