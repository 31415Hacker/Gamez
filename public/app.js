let socket;
let myId;
let state;
let timerInterval;
let selectedGame = 'animal';

const $ = (id) => document.getElementById(id);
const lobby = $('lobby'); const playPanel = $('playPanel'); const roomPanel = $('roomPanel');

document.querySelectorAll('.game-card').forEach((card) => card.addEventListener('click', () => {
  selectedGame = card.dataset.game; $('gameInput').value = selectedGame;
  $('joinTitle').innerHTML = selectedGame === 'quickchain' ? 'Keep the chain.<br><em>Think fast.</em>' : selectedGame === 'detective' ? 'Ask less.<br><em>Guess smart.</em>' : 'One letter.<br><em>Ten seconds.</em>';
  $('joinDescription').textContent = selectedGame === 'quickchain' ? 'Build a word chain together. Your word must begin with the last letter of the previous word.' : selectedGame === 'detective' ? 'Team A gets an animal. Team B asks yes-or-no questions, counts them, then teams swap.' : 'Take turns naming a real animal that starts with the letter on screen. No repeats, no googling, no mercy.';
  lobby.classList.add('hidden'); playPanel.classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' });
}));
$('backButton').addEventListener('click', () => { playPanel.classList.add('hidden'); lobby.classList.remove('hidden'); });
$('joinForm').addEventListener('submit', (event) => { event.preventDefault(); connect(); });
$('roleInput').addEventListener('change', () => $('passwordField').classList.toggle('hidden', $('roleInput').value !== 'host'));
$('startButton').addEventListener('click', () => send({ action: 'start' }));
$('answerForm').addEventListener('submit', (event) => { event.preventDefault(); const input = $('answerInput'); if (input.value.trim()) { send({ action: 'submit', answer: input.value }); input.value = ''; } });
$('guessForm').addEventListener('submit', (event) => { event.preventDefault(); const input = $('guessInput'); if (input.value.trim()) { send({ action: 'guess', answer: input.value }); input.value = ''; } });
$('questionForm').addEventListener('submit', (event) => { event.preventDefault(); const input = $('questionInput'); if (input.value.trim()) { send({ action: 'question', text: input.value }); input.value = ''; } });
document.querySelectorAll('#detectiveButtons button').forEach((button) => button.addEventListener('click', () => send({ action: 'answer-question', answer: button.dataset.answer })));
$('copyButton').addEventListener('click', async () => { await navigator.clipboard?.writeText($('roomName').textContent); $('copyButton').textContent = 'COPIED!'; setTimeout(() => $('copyButton').textContent = 'COPY ROOM CODE', 1300); });

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const localPagesServer = location.hostname.endsWith('github.io') ? 'ws://localhost:8787' : `${protocol}://${location.host}`;
  const configuredServer = window.GAMEZ_WS_URL;
  const websocketUrl = configuredServer
    ? `${configuredServer.replace(/\/$/, '')}/room/${encodeURIComponent($('roomInput').value)}`
    : localPagesServer;
  socket = new WebSocket(websocketUrl);
  socket.addEventListener('open', () => send({ action: 'join', name: $('nameInput').value, room: $('roomInput').value, game: selectedGame, role: $('roleInput').value, password: $('passwordInput').value }));
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (message.type === 'joined') myId = message.id; if (message.type === 'error') return alert(message.message); if (message.type === 'state') render(message); });
  socket.addEventListener('close', () => { if (roomPanel.classList.contains('hidden') === false) $('roundStatus').textContent = 'CONNECTION LOST'; });
}
function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function render(next) {
  state = next; playPanel.classList.add('hidden'); lobby.classList.add('hidden'); roomPanel.classList.remove('hidden');
  $('roomName').textContent = next.room; $('playerCount').textContent = `${next.players.length} / 8`;
  const isHost = next.hostId === myId;
  $('players').innerHTML = next.players.map((player) => `<div class="player"><span>${escapeHtml(player.name)} ${player.id === myId ? '<small class="you">YOU</small>' : ''} ${player.id === next.hostId ? '<small class="host">HOST</small>' : ''}</span><span class="score">${player.score} pts</span></div>`).join('');
  const round = next.round; const gameName = next.game === 'quickchain' ? 'Quick Chain' : next.game === 'detective' ? 'Animal Detective' : 'Animal Sprint'; $('gameTitle').firstChild.textContent = `${gameName} `;
  const detective = next.game === 'detective'; const chain = next.game === 'quickchain'; $('roundLabel').textContent = detective ? (round?.animal ? 'TEAM A SEES' : 'CURRENT QUESTION') : chain ? 'CURRENT CHAIN' : 'YOUR LETTER IS'; $('letter').textContent = detective ? (round?.animal || round?.currentQuestion || '?') : chain ? (round?.currentWord || 'START') : (round?.letter || '?');
  $('letter').classList.toggle('question-display', detective && !round?.animal);
  $('rulesText').textContent = detective ? 'Team B asks yes-or-no questions. Team A answers. Lowest question count wins.' : chain ? 'Play a word beginning with the last letter of the previous word.' : 'Say an animal that begins with the displayed letter before time runs out.';
  $('startButton').classList.toggle('hidden', !isHost || Boolean(round?.active));
  $('roundStatus').textContent = round?.active ? (detective ? `${round.phase === 'answering' ? 'TEAM A ANSWERS' : 'TEAM B ASKS'} · ${round.questionCount || 0} QUESTIONS` : chain ? 'PLAY A WORD' : 'NAME AN ANIMAL') : (round ? 'ROUND OVER' : (isHost ? 'READY TO START' : 'WAITING FOR HOST'));
  const canAnswer = Boolean(round?.active && !detective && !(round.answered || []).includes(myId)); $('answerInput').disabled = !canAnswer; $('answerForm').querySelector('button').disabled = !canAnswer; $('answerInput').placeholder = chain ? 'Next word...' : 'Type an animal...';
  $('answerForm').classList.toggle('hidden', detective); $('questionForm').classList.toggle('hidden', !detective || !round?.active || !round.teamB?.includes(myId) || round.phase !== 'asking'); $('guessForm').classList.toggle('hidden', !detective || !round?.active || !round.teamB?.includes(myId) || round.phase !== 'asking'); $('detectiveButtons').classList.toggle('hidden', !detective || !round?.active || !round.teamA?.includes(myId) || round.phase !== 'answering');
  if (round?.active) startTimer(round.endsAt); else { $('timer').textContent = '—'; clearInterval(timerInterval); }
  $('feed').innerHTML = next.history.map((item) => `<p class="${item.kind}">${escapeHtml(item.message)}</p>`).join('');
}
function startTimer(endsAt) { clearInterval(timerInterval); const tick = () => { const remaining = Math.max(0, endsAt - Date.now()); $('timer').textContent = `${(remaining / 1000).toFixed(1)}s`; if (!remaining) clearInterval(timerInterval); }; tick(); timerInterval = setInterval(tick, 100); }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
