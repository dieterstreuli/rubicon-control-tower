# Container-Image des RUBICON Control Tower (02.08.2026).
#
# Möglich geworden durch R3 (01.08.): server.mjs ist ein echter App-Server —
# vorher lief die API nur als Vite-DEV-Middleware und wäre in einem Container
# still verschwunden.
#
# Build:  docker build -t rubicon-tower .
# Lauf:   docker run -p 8080:8080 -e PORT=8080 -e RUBICON_ORIGINS=https://rubicon.axs.aero rubicon-tower
FROM node:24-slim

# Python für die Renderer (Reports/Briefings/Protokolle) — ohne sie laufen nur
# die Lese-Funktionen. Chrome für die PDF-Erzeugung ist BEWUSST nicht enthalten
# (Image-Grösse); PDF-Generierung bleibt vorerst lokal beim CoS.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-yaml \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Abhängigkeiten zuerst (bessere Layer-Nutzung)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Build-Abhängigkeiten separat, damit dist/ erzeugt werden kann
COPY . .
RUN npm install --include=dev && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

# Kein Vite, kein HMR — der eigenständige App-Server (dist/ + public/ + API)
CMD ["node", "server.mjs"]
