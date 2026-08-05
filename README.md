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

The `public/` directory is deployed automatically to GitHub Pages. When opened
from this project's GitHub Pages site, the frontend tries `ws://localhost:8787`
so it can connect to a local `npm start` server on your computer. This only
works for the person who is running that local server: `localhost` is never a
public multiplayer host.

For public multiplayer, deploy `worker.js` with Wrangler, set the host password
as a Cloudflare secret, and set `window.GAMEZ_WS_URL` in `public/index.html` to
the Worker URL, for example `wss://gamez-multiplayer.your-subdomain.workers.dev`.

```bash
npx wrangler login
npx wrangler secret put HOST_PASSWORD
npx wrangler deploy
```

The default development host password is `gamez-host-2026`. Set a private
production password with `wrangler secret put HOST_PASSWORD`; the Pages UI
never contains the password.
