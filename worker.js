const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ANIMAL_TAXA = new Set(['Animalia', 'Mammalia', 'Aves', 'Reptilia', 'Amphibia', 'Actinopterygii', 'Arachnida', 'Insecta', 'Mollusca', 'Crustacea']);

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
    this.game = 'animal';
    this.detectiveScores = { A: 0, B: 0 };
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
    if (message.action === 'question' && this.game === 'detective') return this.question(socket, player, message.text);
    if (message.action === 'answer-question' && this.game === 'detective') return this.answerQuestion(socket, player, message.answer);
    if (message.action === 'guess' && this.game === 'detective') return this.guess(socket, player, message.answer);
    if (message.action === 'submit' && this.game === 'quickchain') return this.chain(socket, player, message.answer);
    if (message.action === 'submit') return this.submit(socket, player, message.answer);
  }

  join(socket, message) {
    if ([...this.players.values()].some((item) => item.socket === socket)) return;
    const id = crypto.randomUUID();
    const wantsHost = message.role === 'host';
    const requestedGame = ['animal', 'quickchain', 'detective'].includes(message.game) ? message.game : 'animal';
    if (this.players.size && this.game !== requestedGame) return this.error(socket, 'That room is playing a different game.');
    this.game = requestedGame;
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
    const answer = String(rawAnswer || '').trim().toLowerCase().replace(/[^a-z -]/g, '').replace(/\s+/g, ' ');
    this.round.answered.add(player.id);
    const knownAnimal = answer.length > 1 && await this.isINaturalistAnimal(answer);
    const valid = knownAnimal && answer.startsWith(this.round.letter.toLowerCase());
    if (valid && this.round.answers.has(answer)) {
      this.round.answered.delete(player.id);
      return this.error(socket, 'Someone else guessed that already. Try another animal.');
    }
    if (valid) this.round.answers.add(answer);
    if (valid) {
      player.score += 1;
      this.history.push({ kind: 'success', message: `${player.name} scored with ${answer}.` });
    } else {
      const reason = knownAnimal ? `does not begin with ${this.round.letter}` : 'not recognized as an animal by the dictionary';
      this.history.push({ kind: 'miss', message: `${player.name}: “${answer || '...'}” is ${reason}.` });
    }
    this.broadcast();
  }

  async isINaturalistAnimal(word) {
    if (this.dictionaryCache.has(word)) return this.dictionaryCache.get(word);
    try {
      const response = await fetch(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(word)}&per_page=20`);
      if (!response.ok) return false;
      const data = await response.json();
      const target = String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
      const valid = (data.results || []).some((taxon) => ANIMAL_TAXA.has(taxon.iconic_taxon_name) && [taxon.name, taxon.preferred_common_name, taxon.matched_term].some((name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === target));
      this.dictionaryCache.set(word, valid);
      return valid;
    } catch { return false; }
  }

  startRound() {
    if (this.round?.active) return;
    if (this.game === 'quickchain') return this.startChain();
    if (this.game === 'detective') return this.startDetective();
    const letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    this.round = { type: 'animal', letter, endsAt: Date.now() + 10000, active: true, answered: new Set(), answers: new Set() };
    this.round.timeout = setTimeout(() => this.stopRound(`Time! The letter was ${letter}.`), 10000);
    this.history.push({ kind: 'system', message: `New round: name an animal beginning with ${letter}.` });
    this.broadcast();
  }

  startChain() {
    this.round = { type: 'quickchain', active: true, currentWord: '', currentPlayerId: null, usedWords: new Set() };
    this.history.push({ kind: 'system', message: 'Quick Chain started. The host picks the first word.' });
    this.broadcast();
  }

  async startDetective() {
    const players = [...this.players.values()];
    for (let index = players.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [players[index], players[swapIndex]] = [players[swapIndex], players[index]];
    }
    const knowerTeam = Math.random() < 0.5 ? 'A' : 'B';
    this.round = { type: 'detective', active: true, phase: 'asking', turn: 1, attempts: [], guessTeams: [], knowerTeam, animal: await this.randomAnimal(), teamA: players.filter((_, index) => index % 2 === 0).map((player) => player.id), teamB: players.filter((_, index) => index % 2 === 1).map((player) => player.id), questionCount: 0, currentQuestion: '' };
    this.history.push({ kind: 'system', message: 'Animal Detective started. Team B asks first.' });
    this.broadcast();
  }

  async randomAnimal() {
    try {
      const response = await fetch('https://api.inaturalist.org/v1/taxa?iconic_taxon_name=Animalia&rank=species&per_page=100&order_by=observations_count&order=desc');
      const data = await response.json();
      const names = (data.results || []).filter((taxon) => ANIMAL_TAXA.has(taxon.iconic_taxon_name)).map((taxon) => taxon.preferred_common_name || taxon.name).filter(Boolean);
      if (names.length) return names[Math.floor(Math.random() * names.length)].toLowerCase();
    } catch {}
    return 'lion';
  }

  question(socket, player, text) {
    const guessers = this.round?.knowerTeam === 'A' ? this.round.teamB : this.round.teamA;
    if (!this.round?.active || this.round.phase !== 'asking' || !guessers.includes(player.id)) return this.error(socket, 'Only the guessing team can ask a question right now.');
    this.round.questionCount += 1;
    this.round.currentQuestion = String(text || '').trim().slice(0, 120);
    this.history.push({ kind: 'system', message: `${player.name} asks: “${this.round.currentQuestion}”` });
    this.round.phase = 'answering';
    this.broadcast();
  }

  answerQuestion(socket, player, answer) {
    const knowers = this.round?.knowerTeam === 'A' ? this.round.teamA : this.round.teamB;
    if (!this.round?.active || this.round.phase !== 'answering' || !knowers.includes(player.id)) return this.error(socket, 'The team with the animal answers the current question.');
    this.history.push({ kind: 'system', message: `Team A answered: ${answer === 'yes' ? 'YES' : 'NO'}.` });
    this.round.phase = 'asking';
    this.broadcast();
  }

  async guess(socket, player, answer) {
    const guessers = this.round?.knowerTeam === 'A' ? this.round.teamB : this.round.teamA;
    if (!this.round?.active || this.round.phase !== 'asking' || !guessers.includes(player.id)) return this.error(socket, 'The guessing team guesses after asking questions.');
    if (String(answer || '').trim().toLowerCase() !== this.round.animal) return this.error(socket, 'That guess is incorrect. Ask another question.');
    this.round.attempts.push(this.round.questionCount);
    this.round.guessTeams.push(this.round.knowerTeam === 'A' ? 'B' : 'A');
    if (this.round.turn === 1) {
      this.history.push({ kind: 'success', message: `Team ${this.round.guessTeams[0]} guessed ${this.round.animal} in ${this.round.questionCount} question${this.round.questionCount === 1 ? '' : 's'}. Teams swap roles.` });
      this.round.knowerTeam = this.round.knowerTeam === 'A' ? 'B' : 'A';
      this.round.turn = 2; this.round.questionCount = 0; this.round.currentQuestion = ''; this.round.phase = 'asking';
      this.round.animal = await this.randomAnimal();
    } else {
      const [first, second] = this.round.attempts;
      const [firstTeam, secondTeam] = this.round.guessTeams;
      const winner = first === second ? 'It is a tie' : first < second ? `Team ${firstTeam} wins` : `Team ${secondTeam} wins`;
      if (first === second) { this.detectiveScores.A += 1; this.detectiveScores.B += 1; }
      else if (first < second) this.detectiveScores[firstTeam] += 1;
      else this.detectiveScores[secondTeam] += 1;
      this.history.push({ kind: 'success', message: `Team ${secondTeam} guessed ${this.round.animal} in ${this.round.questionCount} questions. ${winner}.` });
      this.round.active = false;
    }
    this.broadcast();
  }

  chain(socket, player, rawWord) {
    if (!this.round?.active) return this.error(socket, 'There is no active round.');
    const players = [...this.players.values()];
    const expectedId = this.round.currentPlayerId ? players[(players.findIndex((item) => item.id === this.round.currentPlayerId) + 1) % players.length]?.id : this.hostId;
    if (player.id !== expectedId) return this.error(socket, 'Wait for your turn.');
    const word = String(rawWord || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!word || this.round.usedWords.has(word)) return this.error(socket, 'That word was already used. Try another word.');
    if (this.round.currentWord && word[0] !== this.round.currentWord.at(-1)) return this.error(socket, `Your word must begin with ${this.round.currentWord.at(-1).toUpperCase()}.`);
    this.round.usedWords.add(word); this.round.currentWord = word; this.round.currentPlayerId = player.id;
    this.history.push({ kind: 'success', message: `${player.name} played ${word}.` });
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
    for (const player of this.players.values()) {
      const knowsAnimal = this.round?.knowerTeam === 'A' ? this.round.teamA?.includes(player.id) : this.round?.teamB?.includes(player.id);
      const round = this.round && { type: this.round.type, letter: this.round.letter, endsAt: this.round.endsAt, active: this.round.active, answered: [...(this.round.answered || [])], currentWord: this.round.currentWord, currentQuestion: this.round.currentQuestion, questionCount: this.round.questionCount, phase: this.round.phase, teamA: this.round.teamA, teamB: this.round.teamB, knowerTeam: this.round.knowerTeam, animal: knowsAnimal ? this.round.animal : undefined };
      if (player.socket.readyState === 1) player.socket.send(JSON.stringify({ type: 'state', room: this.roomCode, game: this.game, hostId: this.hostId, teamScores: this.detectiveScores, players: [...this.players.values()].map(({ id, name, score }) => ({ id, name, score })), round, history: this.history.slice(-8) }));
    }
  }
}
