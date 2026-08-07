# Container-Image des RUBICON Control Tower (02.08.2026).
#
# Möglich geworden durch R3 (01.08.): server.mjs ist ein echter App-Server —
# vorher lief die API nur als Vite-DEV-Middleware und wäre in einem Container
# still verschwunden.
#
# Build:  docker build -t rubicon-tower .
# Lauf:   docker run -p 8080:8080 -e PORT=8080 -e RUBICON_ORIGINS=https://rubicon.axs.aero rubicon-tower
FROM node:24-slim

# Python + Google-API-Client-Libs fuer die serverseitige Doc-/Report-Erzeugung
# (Google Doc via Docs-API + PDF via Drive files.export, DEPLOYMENT_GCP.md §9/§12).
# PyMuPDF (fitz) fuer die PDF->PNG-Vorschauen (Briefings/Fuehrungsrhythmus) und gen_protokoll.
# Chromium ist BEWUSST nicht enthalten (Image-Groesse): der HTML->PDF-Pfad laeuft
# serverseitig ueber den Gotenberg-Sidecar (RUBICON_GOTENBERG_URL), nicht lokales Chrome.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-yaml python3-pip \
    && pip3 install --no-cache-dir --break-system-packages google-api-python-client google-auth PyMuPDF \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Abhängigkeiten zuerst (bessere Layer-Nutzung)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Build-Abhängigkeiten separat, damit dist/ erzeugt werden kann
COPY . .

# Struktur-Snapshot fuer die Merge-Bruecke (DEPLOYMENT_GCP.md §10): das GCS-Volume
# mountet zur Laufzeit ueber /app/src/data (= Live-SSOT) und verdeckt die gebackene
# src/data. Darum eine Kopie AUSSERHALB des Mount-Punkts ablegen — der Merge-Job liest
# die Repo-Struktur aus /app/_repo_seed, die Live-Daten aus dem Volume.
RUN cp -a src/data _repo_seed

# Build-Stamp: CI reicht kurzen SHA + Commit-ISO via --build-arg durch; lokal Fallback (vite nutzt Build-Zeit)
ARG RUBICON_BUILD_SHA=dev
ARG RUBICON_BUILD_ISO=
ENV RUBICON_BUILD_SHA=$RUBICON_BUILD_SHA
ENV RUBICON_BUILD_ISO=$RUBICON_BUILD_ISO
RUN npm install --include=dev && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV RUBICON_PY=/usr/bin/python3
EXPOSE 8080

# Kein Vite, kein HMR — der eigenständige App-Server (dist/ + public/ + API)
CMD ["node", "server.mjs"]
