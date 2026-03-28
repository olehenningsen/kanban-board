# Kanban Board

Et simpelt kanban board bygget med Node.js + Express. Trello-lignende interface med drag & drop, prioriteter og bruger-tildeling.

## Kom i gang

```bash
npm install
npm start
```

Åbn [http://localhost:3333](http://localhost:3333) i din browser.

**Standard adgangskode:** `henry2026`

## Features

- 🔐 Adgangskodebeskyttet
- 📋 4 kolonner: Backlog, Opgaver, I gang, Færdig
- 🖱️ Drag & drop (desktop + mobil)
- 🏷️ Prioriteter (lav/medium/høj)
- 👤 Tildel til Ole eller Henry
- 📱 Mobilvenligt design
- 💾 Data gemt i lokal JSON-fil

## Konfiguration

Rediger `.env` filen:

- `SESSION_SECRET` — session nøgle
- `KANBAN_PASSWORD` — bcrypt-hashet adgangskode

For at ændre adgangskode:
```bash
node -e "require('bcryptjs').hash('ny-kode', 10).then(h => console.log(h))"
```
Indsæt resultatet i `.env` som `KANBAN_PASSWORD`.
