# Gamez

Real-time multiplayer party games using a Node.js WebSocket server.

Animal answers are checked against the [Free Dictionary API](https://dictionaryapi.dev/)
as well as the server's animal list, so misspellings and made-up words are rejected.

## Local development

```bash
npm install
npm start
```

Open `http://localhost:8787` in multiple browser tabs and join the same room.

## Deployment

The `public/` directory is deployed automatically to GitHub Pages. GitHub Pages
cannot run the WebSocket server, so deploy `server.js` separately and set
`window.GAMEZ_WS_URL` in `public/index.html` to its secure WebSocket URL, for
example `wss://your-gamez-server.example.com`.
