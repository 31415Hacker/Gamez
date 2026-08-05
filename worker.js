const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ANIMAL_WORDS = /\b(animal|mammal|bird|fish|reptile|amphibian|insect|arachnid|crustacean|mollusc|mollusk|marsupial|rodent|primate|canine|feline|bovine|equine|avian|aquatic|worm|beetle|butterfly|spider|snake|lizard|frog|toad|turtle|tortoise|shark|whale|dolphin)\b/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Gamez WebSocket server', { status: 426 });
    const code = (url.pathname.split('/').pop() || 'SUNNY').toUpperCase().slice(0, 12);
    const id = env.GAME_ROOM.idFromName(code);
    return env.GAME_ROOM.get(id).fetch(request);
  }
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.roomCode = 'SUNNY';
    this.players = new Map();
    this.hostId = null;
    this.round = null;
    this.history = [];
    this.dictionaryCache = new Map();
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const pair = new WebSocketPair();
    this.roomCode = (new URL(request.url).pathname.split('/').pop() || 'SUNNY').toUpperCase();
    const [client, server] = Object.values(pair);
    server.accept();
    server.addEventListener('message', (event) => this.message(server, event.data));
    server.addEventListener('close', () => this.leave(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  async message(socket, raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return this.error(socket, 'That message was not valid.'); }
    if (message.action === 'join') return this.join(socket, message);
    const player = [...this.players.values()].find((item) => item.socket === socket);
    if (!player) return this.error(socket, 'Join a room first.');
    if (message.action === 'start') {
      if (player.id !== this.hostId) return this.error(socket, 'Only the host can start a round.');
      return this.startRound();
    }
    if (message.action === 'submit') return this.submit(socket, player, message.answer);
  }

  join(socket, message) {
    if ([...this.players.values()].some((item) => item.socket === socket)) return;
    const id = crypto.randomUUID();
    const wantsHost = message.role === 'host';
    if (wantsHost && message.password !== (this.env.HOST_PASSWORD || 'gamez-host-2026')) return this.error(socket, 'That host password is incorrect.');
    if (wantsHost && this.hostId) return this.error(socket, 'This room already has a host.');
    const player = { id, name: String(message.name || 'Player').trim().slice(0, 24), score: 0, socket };
    this.players.set(id, player);
    if (wantsHost) this.hostId = id;
    socket.send(JSON.stringify({ type: 'joined', id }));
    this.history.push({ kind: 'system', message: `${player.name} joined the room.` });
    this.broadcast();
  }

  async submit(socket, player, rawAnswer) {
    if (!this.round?.active) return this.error(socket, 'There is no active round.');
    if (this.round.answered.has(player.id)) return this.error(socket, 'You already answered this round.');
    const answer = String(rawAnswer || '').trim().toLowerCase().replace(/[^a-z-]/g, '');
    this.round.answered.add(player.id);
    const knownAnimal = answer.length > 1 && await this.isDictionaryAnimal(answer);
    const valid = knownAnimal && answer.startsWith(this.round.letter.toLowerCase());
    if (valid) {
      player.score += 1;
      this.history.push({ kind: 'success', message: `${player.name} scored with ${answer}.` });
    } else {
      const reason = knownAnimal ? `does not begin with ${this.round.letter}` : 'not recognized as an animal by the dictionary';
      this.history.push({ kind: 'miss', message: `${player.name}: “${answer || '...'}” is ${reason}.` });
    }
    this.broadcast();
  }

  async isDictionaryAnimal(word) {
    if (this.dictionaryCache.has(word)) return this.dictionaryCache.get(word);
    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      if (!response.ok) return false;
      const entries = await response.json();
      const definitions = entries.flatMap((entry) => entry.meanings || []).flatMap((meaning) => meaning.definitions || []).map((item) => item.definition || '').join(' ').toLowerCase();
      const valid = ANIMAL_WORDS.test(definitions);
      this.dictionaryCache.set(word, valid);
      return valid;
    } catch { return false; }
  }

  startRound() {
    if (this.round?.active) return;
    const letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    this.round = { letter, endsAt: Date.now() + 5000, active: true, answered: new Set() };
    this.round.timeout = setTimeout(() => this.stopRound(`Time! The letter was ${letter}.`), 5000);
    this.history.push({ kind: 'system', message: `New round: name an animal beginning with ${letter}.` });
    this.broadcast();
  }

  stopRound(message) { if (this.round) { this.round.active = false; this.history.push({ kind: 'system', message }); this.broadcast(); } }
  error(socket, message) { socket.send(JSON.stringify({ type: 'error', message })); }

  leave(socket) {
    const entry = [...this.players.entries()].find(([, player]) => player.socket === socket);
    if (!entry) return;
    const [id, player] = entry;
    this.players.delete(id);
    if (this.hostId === id) {
      this.hostId = null;
      this.history.push({ kind: 'system', message: `${player.name} left. A new host can join with the host password.` });
    } else this.history.push({ kind: 'system', message: `${player.name} left the room.` });
    this.broadcast();
  }

  broadcast() {
    const state = JSON.stringify({ type: 'state', room: this.roomCode, hostId: this.hostId, players: [...this.players.values()].map(({ id, name, score }) => ({ id, name, score })), round: this.round && { letter: this.round.letter, endsAt: this.round.endsAt, active: this.round.active, answered: [...this.round.answered] }, history: this.history.slice(-8) });
    for (const player of this.players.values()) if (player.socket.readyState === 1) player.socket.send(state);
  }
}
