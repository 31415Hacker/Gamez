const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const rooms = new Map();

const animals = new Set([
  'aardvark', 'albatross', 'alligator', 'alpaca', 'ant', 'anteater', 'antelope', 'ape', 'armadillo',
  'baboon', 'badger', 'bat', 'bear', 'beaver', 'bee', 'bison', 'boar', 'buffalo', 'butterfly',
  'camel', 'cat', 'cheetah', 'chicken', 'chimpanzee', 'chinchilla', 'cobra', 'cougar', 'cow', 'crab', 'crocodile',
  'deer', 'dingo', 'dinosaur', 'dog', 'dolphin', 'donkey', 'dove', 'dragon', 'duck',
  'eagle', 'echidna', 'eel', 'elephant', 'elk',
  'falcon', 'ferret', 'finch', 'fish', 'flamingo', 'fly', 'fox', 'frog',
  'gazelle', 'gerbil', 'giraffe', 'goat', 'goose', 'gorilla',
  'hamster', 'hare', 'hawk', 'hedgehog', 'hippo', 'horse', 'hyena',
  'ibex', 'iguana',
  'jackal', 'jaguar', 'jellyfish',
  'kangaroo', 'koala',
  'lemur', 'leopard', 'lion', 'lizard', 'llama', 'lobster',
  'magpie', 'manatee', 'monkey', 'moose', 'mouse', 'mule',
  'newt',
  'octopus', 'opossum', 'orangutan', 'ostrich', 'otter', 'owl', 'ox',
  'panda', 'panther', 'parrot', 'peacock', 'pelican', 'penguin', 'pig', 'pigeon', 'pony', 'porcupine',
  'quail',
  'rabbit', 'raccoon', 'ram', 'rat', 'raven', 'reindeer', 'rhino', 'rooster',
  'salmon', 'seal', 'shark', 'sheep', 'skunk', 'sloth', 'snail', 'snake', 'sparrow', 'spider', 'squid', 'swan',
  'tiger', 'toad', 'toucan', 'turkey', 'turtle',
  'unicorn',
  'vulture',
  'walrus', 'wasp', 'weasel', 'whale', 'wolf', 'wombat', 'woodpecker',
  'yak',
  'zebra'
]);

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function clean(value, fallback) {
  return String(value || fallback).trim().slice(0, 24);
}

function newRoom(code) {
  return { code, players: new Map(), round: null, history: [] };
}

function publicState(room) {
  return {
    type: 'state',
    room: room.code,
    players: [...room.players.values()].map(({ id, name, score, connected }) => ({ id, name, score, connected })),
    round: room.round ? {
      letter: room.round.letter,
      endsAt: room.round.endsAt,
      active: room.round.active,
      answered: [...room.round.answered]
    } : null,
    history: room.history.slice(-8)
  };
}

function broadcast(room) {
  const message = JSON.stringify(publicState(room));
  for (const player of room.players.values()) {
    if (player.socket.readyState === WebSocket.OPEN) player.socket.send(message);
  }
}

function stopRound(room, message) {
  if (!room.round) return;
  clearTimeout(room.round.timeout);
  room.round.active = false;
  room.history.push({ kind: 'system', message });
  broadcast(room);
}

function startRound(room) {
  if (room.round?.active) return;
  const letter = letters[Math.floor(Math.random() * letters.length)];
  const endsAt = Date.now() + 5000;
  const round = { letter, endsAt, active: true, answered: new Set() };
  round.timeout = setTimeout(() => stopRound(room, `Time! The letter was ${letter}.`), 5000);
  room.round = round;
  room.history.push({ kind: 'system', message: `New round: name an animal beginning with ${letter}.` });
  broadcast(room);
}

function sendError(socket, message) {
  socket.send(JSON.stringify({ type: 'error', message }));
}

const server = http.createServer((request, response) => {
  const requested = request.url === '/' ? '/index.html' : request.url;
  const filePath = path.join(publicDir, path.normalize(requested));
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403); response.end('Forbidden'); return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) { response.writeHead(404); response.end('Not found'); return; }
    const type = filePath.endsWith('.css') ? 'text/css' : filePath.endsWith('.js') ? 'text/javascript' : 'text/html';
    response.writeHead(200, { 'Content-Type': type }); response.end(data);
  });
});

const wss = new WebSocket.Server({ server });
wss.on('connection', (socket) => {
  let player;
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw); } catch { sendError(socket, 'That message was not valid.'); return; }

    if (message.action === 'join') {
      if (player) return;
      const code = clean(message.room, 'SUNNY').toUpperCase();
      const room = rooms.get(code) || newRoom(code);
      const id = crypto.randomUUID();
      player = { id, name: clean(message.name, 'Player'), room: code, score: 0, connected: true, socket };
      room.players.set(id, player); rooms.set(code, room);
      socket.send(JSON.stringify({ type: 'joined', id, room: code }));
      room.history.push({ kind: 'system', message: `${player.name} joined the room.` });
      broadcast(room); return;
    }

    if (!player) { sendError(socket, 'Join a room first.'); return; }
    const room = rooms.get(player.room || clean(message.room, 'SUNNY')) || [...rooms.values()].find((candidate) => candidate.players.has(player.id));
    if (!room) return;

    if (message.action === 'start') { startRound(room); return; }
    if (message.action === 'submit') {
      if (!room.round?.active) { sendError(socket, 'There is no active round.'); return; }
      if (room.round.answered.has(player.id)) { sendError(socket, 'You already answered this round.'); return; }
      const answer = clean(message.answer, '').toLowerCase().replace(/[^a-z-]/g, '');
      const letter = room.round.letter.toLowerCase();
      const valid = answer.length > 1 && answer.startsWith(letter) && animals.has(answer);
      room.round.answered.add(player.id);
      if (valid) {
        player.score += 1;
        room.history.push({ kind: 'success', message: `${player.name} scored with ${answer}.` });
      } else {
        room.history.push({ kind: 'miss', message: `${player.name}: “${answer || '...'}” is not a ${room.round.letter} animal.` });
      }
      broadcast(room);
      return;
    }
  });

  socket.on('close', () => {
    if (!player) return;
    const room = [...rooms.values()].find((candidate) => candidate.players.has(player.id));
    if (!room) return;
    room.players.delete(player.id);
    room.history.push({ kind: 'system', message: `${player.name} left the room.` });
    if (room.players.size === 0) { if (room.round) clearTimeout(room.round.timeout); rooms.delete(room.code); }
    else broadcast(room);
  });
});

server.listen(port, () => console.log(`Gamez is running at http://localhost:${port}`));
