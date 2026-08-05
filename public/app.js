let socket;
let myId;
let state;
let timerInterval;

const $ = (id) => document.getElementById(id);
const lobby = $('lobby'); const playPanel = $('playPanel'); const roomPanel = $('roomPanel');

document.querySelectorAll('.game-card').forEach((card) => card.addEventListener('click', () => {
  if (card.dataset.game === 'coming') return alert('That game is still warming up. Try Animal Sprint!');
  lobby.classList.add('hidden'); playPanel.classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' });
}));
$('backButton').addEventListener('click', () => { playPanel.classList.add('hidden'); lobby.classList.remove('hidden'); });
$('joinForm').addEventListener('submit', (event) => { event.preventDefault(); connect(); });
$('roleInput').addEventListener('change', () => $('passwordField').classList.toggle('hidden', $('roleInput').value !== 'host'));
$('startButton').addEventListener('click', () => send({ action: 'start' }));
$('answerForm').addEventListener('submit', (event) => { event.preventDefault(); const input = $('answerInput'); if (input.value.trim()) { send({ action: 'submit', answer: input.value }); input.value = ''; } });
$('copyButton').addEventListener('click', async () => { await navigator.clipboard?.writeText($('roomName').textContent); $('copyButton').textContent = 'COPIED!'; setTimeout(() => $('copyButton').textContent = 'COPY ROOM CODE', 1300); });

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const localPagesServer = location.hostname.endsWith('github.io') ? 'ws://localhost:8787' : `${protocol}://${location.host}`;
  const configuredServer = window.GAMEZ_WS_URL;
  const websocketUrl = configuredServer
    ? `${configuredServer.replace(/\/$/, '')}/room/${encodeURIComponent($('roomInput').value)}`
    : localPagesServer;
  socket = new WebSocket(websocketUrl);
  socket.addEventListener('open', () => send({ action: 'join', name: $('nameInput').value, room: $('roomInput').value, role: $('roleInput').value, password: $('passwordInput').value }));
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (message.type === 'joined') myId = message.id; if (message.type === 'error') return alert(message.message); if (message.type === 'state') render(message); });
  socket.addEventListener('close', () => { if (roomPanel.classList.contains('hidden') === false) $('roundStatus').textContent = 'CONNECTION LOST'; });
}
function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function render(next) {
  state = next; playPanel.classList.add('hidden'); lobby.classList.add('hidden'); roomPanel.classList.remove('hidden');
  $('roomName').textContent = next.room; $('playerCount').textContent = `${next.players.length} / 8`;
  const isHost = next.hostId === myId;
  $('players').innerHTML = next.players.map((player) => `<div class="player"><span>${escapeHtml(player.name)} ${player.id === myId ? '<small class="you">YOU</small>' : ''} ${player.id === next.hostId ? '<small class="host">HOST</small>' : ''}</span><span class="score">${player.score} pts</span></div>`).join('');
  const round = next.round; $('letter').textContent = round?.letter || '?'; $('startButton').classList.toggle('hidden', !isHost || Boolean(round?.active));
  $('roundStatus').textContent = round?.active ? 'NAME AN ANIMAL' : (round ? 'ROUND OVER' : (isHost ? 'READY TO START' : 'WAITING FOR HOST'));
  const canAnswer = Boolean(round?.active && !round.answered.includes(myId)); $('answerInput').disabled = !canAnswer; $('answerForm').querySelector('button').disabled = !canAnswer;
  if (round?.active) startTimer(round.endsAt); else { $('timer').textContent = '—'; clearInterval(timerInterval); }
  $('feed').innerHTML = next.history.map((item) => `<p class="${item.kind}">${escapeHtml(item.message)}</p>`).join('');
}
function startTimer(endsAt) { clearInterval(timerInterval); const tick = () => { const remaining = Math.max(0, endsAt - Date.now()); $('timer').textContent = `${(remaining / 1000).toFixed(1)}s`; if (!remaining) clearInterval(timerInterval); }; tick(); timerInterval = setInterval(tick, 100); }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
