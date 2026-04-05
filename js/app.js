/**
 * Kille Score Calculator — App UI
 * Handles all screen navigation, rendering, and user interactions.
 */
import { CARDS, getCardById, getCardsByType } from './cards.js';
import { PlayerStore, GameStore } from './store.js';
import {
  createGame, addRound, removeLastRound, completeGame, calculateScoreTable
} from './game.js';
import { computeAdvancedStats, getMostCommonCard, getTopCards, getLeaderboard } from './stats.js';
import { downloadExport, importFile } from './importexport.js';

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════
let currentScreen = 'home';
const screenStack = [];

// Game setup
let selectedPlayerIds = new Set();

// Active game
let activeGame = null;

// Round entry
let roundState = {
  standByIds: new Set(),
  winnerId: null,
  loserCards: {}, // { playerId: cardId }
  nekenIds: new Set()
};

// Card picker
let cardPickerTarget = null; // playerId being assigned
let cardPickerCallback = null;

// Stats
let selectedStatsPlayerId = null;
let cachedStats = null;

// ═══════════════════════════════════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════════════════════════════════
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════
function navigateTo(screenId, options = {}) {
  if (!options.replace) {
    screenStack.push(currentScreen);
  }
  currentScreen = screenId;
  $$('.screen').forEach(el => el.classList.remove('active'));
  $(`#screen-${screenId}`).classList.add('active');
  updateHeader(screenId);
  renderScreen(screenId);
  window.scrollTo(0, 0);
}

function goBack() {
  const prev = screenStack.pop() || 'home';
  currentScreen = prev;
  $$('.screen').forEach(el => el.classList.remove('active'));
  $(`#screen-${prev}`).classList.add('active');
  updateHeader(prev);
  renderScreen(prev);
  window.scrollTo(0, 0);
}

function updateHeader(screenId) {
  const titles = {
    home: 'Kille',
    players: 'Spelare',
    setup: 'Nytt Spel',
    game: 'Protokoll',
    history: 'Historik',
    'view-game': 'Spelprotokoll',
    stats: 'Statistik'
  };
  $('#header-title').textContent = titles[screenId] || 'Kille';
  const backBtn = $('#btn-back');
  if (screenId === 'home') {
    backBtn.classList.remove('visible');
  } else {
    backBtn.classList.add('visible');
  }
  // Hide header action by default
  $('#btn-header-action').style.display = 'none';
}

function renderScreen(screenId) {
  switch (screenId) {
    case 'home': renderHome(); break;
    case 'players': renderPlayers(); break;
    case 'setup': renderSetup(); break;
    case 'game': renderGame(); break;
    case 'history': renderHistory(); break;
    case 'stats': renderStats(); break;
    case 'view-game': break; // rendered when entering
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME SCREEN
// ═══════════════════════════════════════════════════════════════════════════
function renderHome() {
  const active = GameStore.getActive();
  const continueBtn = $('#btn-continue-game');
  if (active) {
    continueBtn.style.display = '';
    const playerNames = active.playerIds
      .map(id => PlayerStore.get(id)?.name || '?')
      .join(', ');
    continueBtn.textContent = `▶ Fortsätt (${playerNames})`;
  } else {
    continueBtn.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
function renderPlayers() {
  const players = PlayerStore.getAll();
  const list = $('#player-list');
  const empty = $('#players-empty');

  if (players.length === 0) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = players.map(p => `
    <li class="player-item" data-id="${p.id}">
      <div class="player-item__avatar">${p.name.charAt(0).toUpperCase()}</div>
      <span class="player-item__name">${escHtml(p.name)}</span>
      <button class="player-item__action" data-action="remove" data-id="${p.id}" title="Ta bort">✕</button>
    </li>
  `).join('');
}

function addPlayer() {
  const input = $('#input-player-name');
  const name = input.value.trim();
  if (!name) return;
  PlayerStore.add(name);
  input.value = '';
  input.focus();
  renderPlayers();
}

function removePlayer(id) {
  const player = PlayerStore.get(id);
  if (!player) return;
  showConfirm(`Ta bort ${player.name}?`, () => {
    PlayerStore.remove(id);
    renderPlayers();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GAME SETUP
// ═══════════════════════════════════════════════════════════════════════════
function renderSetup() {
  const players = PlayerStore.getAll();
  const grid = $('#setup-grid');

  if (players.length < 2) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state__text">Lägg till minst 2 spelare först.</div></div>`;
    return;
  }

  grid.innerHTML = players.map(p => `
    <div class="setup-player ${selectedPlayerIds.has(p.id) ? 'selected' : ''}" data-id="${p.id}">
      <div class="setup-player__avatar">${p.name.charAt(0).toUpperCase()}</div>
      <div class="setup-player__name">${escHtml(p.name)}</div>
    </div>
  `).join('');

  updateSetupCount();
}

function toggleSetupPlayer(id) {
  if (selectedPlayerIds.has(id)) {
    selectedPlayerIds.delete(id);
  } else {
    if (selectedPlayerIds.size >= 8) return;
    selectedPlayerIds.add(id);
  }
  renderSetup();
}

function updateSetupCount() {
  const count = selectedPlayerIds.size;
  $('#setup-count').textContent = `${count} spelare valda`;
  $('#btn-start-game').disabled = count < 2;
}

function startGame() {
  if (selectedPlayerIds.size < 2) return;
  activeGame = createGame([...selectedPlayerIds]);
  GameStore.save(activeGame);
  GameStore.setActive(activeGame.id);
  selectedPlayerIds.clear();
  navigateTo('game', { replace: true });
  // Clear stack so back goes to home
  screenStack.length = 0;
  screenStack.push('home');
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVE GAME — PROTOCOL TABLE
// ═══════════════════════════════════════════════════════════════════════════
function renderGame() {
  if (!activeGame) return;

  const table = calculateScoreTable(activeGame);
  const players = activeGame.playerIds.map(id => PlayerStore.get(id) || { id, name: '?' });

  // Empty state
  const emptyEl = $('#game-empty');
  const wrapperEl = $('#protocol-wrapper');
  if (table.rounds.length === 0) {
    emptyEl.style.display = '';
    wrapperEl.style.display = 'none';
  } else {
    emptyEl.style.display = 'none';
    wrapperEl.style.display = '';
  }

  // Undo button
  $('#btn-undo-round').style.display = table.rounds.length > 0 ? '' : 'none';

  // Header
  $('#protocol-head').innerHTML = `<tr>
    <th>#</th>
    ${players.map(p => `<th>${escHtml(p.name)}</th>`).join('')}
  </tr>`;

  // Body (newest round at top)
  const reversedRounds = [...table.rounds].reverse();
  $('#protocol-body').innerHTML = reversedRounds.map(round => {
    const cells = players.map(p => {
      const s = round.scores[p.id];
      if (s.isStandBy) {
        return `<td><div class="protocol-cell">
          <span class="protocol-cell__round protocol-cell__round--standby">—</span>
          <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        </div></td>`;
      }
      if (s.isWinner) {
        const winnerClass = s.hadNeken ? 'protocol-cell__round--winner protocol-cell__round--winner-neken' : 'protocol-cell__round--winner';
        return `<td><div class="protocol-cell">
          <span class="protocol-cell__round ${winnerClass}">+${s.roundScore}</span>
          <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        </div></td>`;
      }
      const card = s.cardId ? getCardById(s.cardId) : null;
      return `<td><div class="protocol-cell">
        <span class="protocol-cell__round protocol-cell__round--loser">${s.roundScore}</span>
        <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        ${card ? `<span class="protocol-cell__card">${escHtml(card.name)}${s.neken ? ' ×2' : ''}</span>` : ''}
      </div></td>`;
    }).join('');
    return `<tr><td>${round.roundNumber}</td>${cells}</tr>`;
  }).join('');

  // Footer (totals)
  $('#protocol-foot').innerHTML = `<tr>
    <td>Σ</td>
    ${players.map(p => {
      const total = table.totals[p.id] || 0;
      const cls = total > 0 ? 'total-positive' : total < 0 ? 'total-negative' : 'total-zero';
      return `<td class="${cls}">${formatScore(total)}</td>`;
    }).join('')}
  </tr>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUND ENTRY MODAL
// ═══════════════════════════════════════════════════════════════════════════
function openRoundModal() {
  if (!activeGame) return;

  // Reset state
  roundState = {
    standByIds: new Set(),
    winnerId: null,
    loserCards: {},
    nekenIds: new Set()
  };

  const roundNum = activeGame.rounds.length + 1;
  $('#round-modal-title').textContent = `Omgång ${roundNum}`;

  renderStandbyGrid();
  renderWinnerGrid();
  renderLoserAssignments();
  updateRoundPreview();

  $('#modal-round').classList.add('active');
}

function closeRoundModal(skipAnimation = false) {
  const overlay = $('#modal-round');
  if (skipAnimation) {
    overlay.classList.remove('active');
    return;
  }
  overlay.classList.add('closing');
  setTimeout(() => overlay.classList.remove('active', 'closing'), 250);
}

function renderStandbyGrid() {
  const players = activeGame.playerIds.map(id => PlayerStore.get(id) || { id, name: '?' });
  $('#standby-grid').innerHTML = players.map(p => `
    <button class="standby-toggle ${roundState.standByIds.has(p.id) ? 'standby' : ''}" data-id="${p.id}">
      ${escHtml(p.name)}
    </button>
  `).join('');
}

function toggleStandby(playerId) {
  if (roundState.standByIds.has(playerId)) {
    roundState.standByIds.delete(playerId);
  } else {
    roundState.standByIds.add(playerId);
    // If this player was the winner, clear winner
    if (roundState.winnerId === playerId) {
      roundState.winnerId = null;
    }
    // Remove from loser cards and neken
    delete roundState.loserCards[playerId];
    roundState.nekenIds.delete(playerId);
  }
  renderStandbyGrid();
  renderWinnerGrid();
  renderLoserAssignments();
  updateRoundPreview();
}

function getActivePlayers() {
  return activeGame.playerIds.filter(id => !roundState.standByIds.has(id));
}

function renderWinnerGrid() {
  const active = getActivePlayers();
  const players = active.map(id => PlayerStore.get(id) || { id, name: '?' });

  $('#winner-grid').innerHTML = players.map(p => `
    <button class="winner-btn ${roundState.winnerId === p.id ? 'selected' : ''}" data-id="${p.id}">
      <span class="winner-btn__icon">${roundState.winnerId === p.id ? '👑' : '👤'}</span>
      ${escHtml(p.name)}
    </button>
  `).join('');
}

function selectWinner(playerId) {
  roundState.winnerId = playerId;
  // Remove winner from loser cards and neken
  delete roundState.loserCards[playerId];
  roundState.nekenIds.delete(playerId);
  renderWinnerGrid();
  renderLoserAssignments();
  updateRoundPreview();
}

function playMockLaugh() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();

  const bursts = [0, 0.19, 0.38, 0.57]; // four "ha"s
  bursts.forEach((offset, i) => {
    const t = ctx.currentTime + offset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    // Descending pitch per burst for a derisive feel
    const baseFreq = 340 - i * 18;
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.72, t + 0.14);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  });
}

function toggleNeken(playerId) {
  if (roundState.nekenIds.has(playerId)) {
    roundState.nekenIds.delete(playerId);
  } else {
    // Only one player can have neken per round
    roundState.nekenIds.clear();
    roundState.nekenIds.add(playerId);
    playMockLaugh();
  }
  renderLoserAssignments();
  updateRoundPreview();
}

// Returns the auto-assigned card for the neken loser:
// double the worst card played by any non-neken loser this round.
function getNekenCards() {
  const losers = getActivePlayers().filter(id => id !== roundState.winnerId);
  const nekenPlayers = losers.filter(id => roundState.nekenIds.has(id));

  if (nekenPlayers.length === 0) return {};

  // Find the worst card among all losers (including the neken player)
  let worstCard = null;
  losers.forEach(id => {
    if (roundState.loserCards[id]) {
      const card = getCardById(roundState.loserCards[id]);
      if (card && (!worstCard || card.points > worstCard.points)) {
        worstCard = card;
      }
    }
  });

  const result = {};
  nekenPlayers.forEach(id => {
    result[id] = worstCard; // null until at least one non-neken loser has picked
  });
  return result;
}

function renderLoserAssignments() {
  const section = $('#loser-section');
  const container = $('#loser-assignments');

  if (!roundState.winnerId) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const losers = getActivePlayers().filter(id => id !== roundState.winnerId);
  const players = losers.map(id => PlayerStore.get(id) || { id, name: '?' });

  const nekenCards = getNekenCards();

  container.innerHTML = players.map(p => {
    const isNeken = roundState.nekenIds.has(p.id);

    if (isNeken) {
      const nekenCard = nekenCards[p.id];
      const points = nekenCard ? nekenCard.points * 2 : 0;
      const ownCardId = roundState.loserCards[p.id];
      const ownCard = ownCardId ? getCardById(ownCardId) : null;
      const cardLabel = nekenCard
        ? `${escHtml(nekenCard.name)} ×2`
        : '<em>Väntar på sämsta kort…</em>';
      return `<div class="loser-row">
        <span class="loser-row__name">${escHtml(p.name)}</span>
        <button class="loser-row__neken-btn loser-row__neken-btn--active" data-neken-player="${p.id}">Neken ✕</button>
        <button class="loser-row__card-btn ${ownCard ? 'has-card' : ''}" data-player="${p.id}">
          ${ownCard ? `${escHtml(ownCard.name)} (${ownCard.points}p)` : 'Välj kort...'}
        </button>
        <span class="loser-row__neken-card">${cardLabel}</span>
        ${nekenCard ? `<span class="loser-row__points">−${points}</span>` : ''}
      </div>`;
    }

    const cardId = roundState.loserCards[p.id];
    const card = cardId ? getCardById(cardId) : null;
    const points = card ? card.points : 0;

    return `<div class="loser-row">
      <span class="loser-row__name">${escHtml(p.name)}</span>
      <button class="loser-row__neken-btn" data-neken-player="${p.id}">Neken</button>
      <button class="loser-row__card-btn ${card ? 'has-card' : ''}" data-player="${p.id}">
        ${card ? `${escHtml(card.name)} (${card.points}p)` : 'Välj kort...'}
      </button>
      ${card ? `<span class="loser-row__points">−${points}</span>` : ''}
    </div>`;
  }).join('');
}

function updateRoundPreview() {
  const preview = $('#round-preview');
  const scoreEl = $('#round-preview-score');
  const confirmBtn = $('#btn-confirm-round');

  if (!roundState.winnerId) {
    preview.style.display = 'none';
    confirmBtn.disabled = true;
    return;
  }

  const losers = getActivePlayers().filter(id => id !== roundState.winnerId);
  const nekenCards = getNekenCards();
  const allAssigned = losers.length > 0 && losers.every(id => !!roundState.loserCards[id]);

  let totalPoints = 0;
  losers.forEach(id => {
    if (roundState.nekenIds.has(id)) {
      const card = nekenCards[id];
      totalPoints += card ? card.points * 2 : 0;
    } else {
      const cardId = roundState.loserCards[id];
      if (cardId) {
        const card = getCardById(cardId);
        totalPoints += card ? card.points : 0;
      }
    }
  });

  preview.style.display = '';
  scoreEl.textContent = `+${totalPoints}`;
  confirmBtn.disabled = !allAssigned;
}

function confirmRound() {
  if (!roundState.winnerId) return;
  const losers = getActivePlayers().filter(id => id !== roundState.winnerId);
  const nekenCards = getNekenCards();
  if (!losers.every(id => !!roundState.loserCards[id])) return;

  const roundData = {
    winnerId: roundState.winnerId,
    standByIds: [...roundState.standByIds],
    losers: losers.map(id => {
      if (roundState.nekenIds.has(id)) {
        return { playerId: id, cardId: nekenCards[id].id, neken: true };
      }
      return { playerId: id, cardId: roundState.loserCards[id] };
    })
  };

  activeGame = addRound(activeGame, roundData);
  GameStore.save(activeGame);
  closeRoundModal();
  renderGame();
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD PICKER
// ═══════════════════════════════════════════════════════════════════════════
function initCardPicker() {
  // Render card grids (static, done once)
  renderCardGroup('#picker-picture-cards', getCardsByType('picture'));
  renderCardGroup('#picker-number-cards', getCardsByType('number'));
  renderCardGroup('#picker-zero-cards', getCardsByType('zero'));
}

function renderCardGroup(selector, cards) {
  $(selector).innerHTML = cards.map(c => {
    let visual = '';
    if (c.image) {
      visual = `<img class="card-tile__image" src="${c.image}" alt="${c.name}" loading="lazy">`;
    } else if (c.type === 'number') {
      visual = `<div class="card-tile__number">${c.number}</div>`;
    }
    return `<div class="card-tile" data-card="${c.id}">
      ${visual}
      <span class="card-tile__name">${escHtml(c.name)}</span>
      <span class="card-tile__points">${c.points}p</span>
    </div>`;
  }).join('');
}

function openCardPicker(playerId) {
  const player = PlayerStore.get(playerId);
  $('#card-picker-title').textContent = `Välj kort för ${player?.name || '?'}`;
  cardPickerTarget = playerId;
  $('#card-picker-overlay').classList.add('active');
}

function closeCardPicker(skipAnimation = false) {
  cardPickerTarget = null;
  const overlay = $('#card-picker-overlay');
  if (skipAnimation) {
    overlay.classList.remove('active');
    return;
  }
  overlay.classList.add('closing');
  setTimeout(() => overlay.classList.remove('active', 'closing'), 250);
}

function selectCard(cardId) {
  if (cardPickerTarget) {
    roundState.loserCards[cardPickerTarget] = cardId;
    closeCardPicker();
    renderLoserAssignments();
    updateRoundPreview();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GAME CONTROLS
// ═══════════════════════════════════════════════════════════════════════════
function undoLastRound() {
  if (!activeGame || activeGame.rounds.length === 0) return;
  showConfirm('Ångra senaste omgången?', () => {
    activeGame = removeLastRound(activeGame);
    GameStore.save(activeGame);
    renderGame();
  });
}

function endGame() {
  if (!activeGame) return;
  showConfirm('Avsluta spelet?', () => {
    activeGame = completeGame(activeGame);
    GameStore.save(activeGame);
    GameStore.clearActive();
    showGameEndLeaderboard(activeGame);
    activeGame = null;
  });
}

function showGameEndLeaderboard(game) {
  const { totals } = calculateScoreTable(game);
  const players = PlayerStore.getAll();
  const ranked = game.playerIds
    .map(pid => ({
      id: pid,
      name: (players.find(p => p.id === pid) || { name: '?' }).name,
      score: totals[pid] || 0
    }))
    .sort((a, b) => b.score - a.score);

  const medals = ['🥇', '🥈', '🥉'];
  // Podium order: 2nd, 1st, 3rd (visual layout)
  const podiumOrder = [1, 0, 2];
  const podiumEl = $('#podium');
  const restEl = $('#leaderboard-rest');

  const podiumPlayers = ranked.slice(0, Math.min(3, ranked.length));
  podiumEl.innerHTML = podiumOrder
    .filter(i => i < podiumPlayers.length)
    .map(i => {
      const p = podiumPlayers[i];
      const place = i + 1;
      const scoreClass = p.score > 0 ? 'positive' : p.score < 0 ? 'negative' : 'zero';
      const scoreStr = p.score > 0 ? `+${p.score}` : String(p.score);
      return `
        <div class="podium__place podium__place--${place}">
          <div class="podium__medal">${medals[i]}</div>
          <div class="podium__name">${escHtml(p.name)}</div>
          <div class="podium__score podium__score--${scoreClass}">${scoreStr}</div>
          <div class="podium__bar"></div>
        </div>`;
    })
    .join('');

  // Remaining players (4th and beyond)
  if (ranked.length > 3) {
    restEl.innerHTML = ranked.slice(3).map((p, i) => {
      const scoreClass = p.score > 0 ? 'positive' : p.score < 0 ? 'negative' : 'zero';
      const scoreStr = p.score > 0 ? `+${p.score}` : String(p.score);
      return `
        <div class="leaderboard-rest__item">
          <span class="leaderboard-rest__rank">${i + 4}.</span>
          <span class="leaderboard-rest__name">${escHtml(p.name)}</span>
          <span class="leaderboard-rest__score podium__score--${scoreClass}">${scoreStr}</span>
        </div>`;
    }).join('');
  } else {
    restEl.innerHTML = '';
  }

  $('#leaderboard-overlay').classList.add('active');
}

function closeLeaderboard() {
  $('#leaderboard-overlay').classList.remove('active');
  navigateTo('home', { replace: true });
  screenStack.length = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════════════════════
function renderHistory() {
  const games = GameStore.getAll().slice().reverse();
  const list = $('#history-list');
  const empty = $('#history-empty');

  if (games.length === 0) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = games.map(g => {
    const playerNames = g.playerIds
      .map(id => PlayerStore.get(id)?.name || '?')
      .join(', ');
    const date = new Date(g.createdAt).toLocaleDateString('sv-SE', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const badge = g.status === 'active'
      ? '<span class="history-item__badge history-item__badge--active">Pågår</span>'
      : '<span class="history-item__badge history-item__badge--completed">Avslutad</span>';

    return `<div class="history-item" data-game="${g.id}">
      <div class="history-item__date">${date} ${badge}</div>
      <div class="history-item__players">${escHtml(playerNames)}</div>
      <div class="history-item__stats">
        <span>${g.rounds.length} omgångar</span>
        <button class="history-item__delete" data-delete="${g.id}" aria-label="Ta bort spel">✕</button>
      </div>
    </div>`;
  }).join('');
}

function deleteGame(gameId) {
  const game = GameStore.get(gameId);
  if (!game) return;
  showConfirm('Ta bort spelet? Det kan inte återställas.', () => {
    GameStore.remove(gameId);
    renderHistory();
  });
}

function viewGame(gameId) {
  const game = GameStore.get(gameId);
  if (!game) return;

  // If it's the active game, go to game screen
  if (game.status === 'active') {
    activeGame = game;
    navigateTo('game');
    return;
  }

  // Render read-only protocol
  const table = calculateScoreTable(game);
  const players = game.playerIds.map(id => PlayerStore.get(id) || { id, name: '?' });

  $('#view-protocol-head').innerHTML = `<tr>
    <th>#</th>
    ${players.map(p => `<th>${escHtml(p.name)}</th>`).join('')}
  </tr>`;

  const reversedRounds = [...table.rounds].reverse();
  $('#view-protocol-body').innerHTML = reversedRounds.map(round => {
    const cells = players.map(p => {
      const s = round.scores[p.id];
      if (s.isStandBy) {
        return `<td><div class="protocol-cell">
          <span class="protocol-cell__round protocol-cell__round--standby">—</span>
          <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        </div></td>`;
      }
      if (s.isWinner) {
        const winnerClass = s.hadNeken ? 'protocol-cell__round--winner protocol-cell__round--winner-neken' : 'protocol-cell__round--winner';
        return `<td><div class="protocol-cell">
          <span class="protocol-cell__round ${winnerClass}">+${s.roundScore}</span>
          <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        </div></td>`;
      }
      const card = s.cardId ? getCardById(s.cardId) : null;
      return `<td><div class="protocol-cell">
        <span class="protocol-cell__round protocol-cell__round--loser">${s.roundScore}</span>
        <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        ${card ? `<span class="protocol-cell__card">${escHtml(card.name)}${s.neken ? ' ×2' : ''}</span>` : ''}
      </div></td>`;
    }).join('');
    return `<tr><td>${round.roundNumber}</td>${cells}</tr>`;
  }).join('');

  $('#view-protocol-foot').innerHTML = `<tr>
    <td>Σ</td>
    ${players.map(p => {
      const total = table.totals[p.id] || 0;
      const cls = total > 0 ? 'total-positive' : total < 0 ? 'total-negative' : 'total-zero';
      return `<td class="${cls}">${formatScore(total)}</td>`;
    }).join('')}
  </tr>`;

  navigateTo('view-game');
}

// ═══════════════════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════════════════
function renderStats() {
  const games = GameStore.getAll();
  const players = PlayerStore.getAll();

  const gamesWithRounds = games.filter(g => g.status === 'completed' && g.rounds.length > 0);
  const emptyEl = $('#stats-empty');
  const tabsEl = $('#stats-tabs');

  if (gamesWithRounds.length === 0) {
    emptyEl.style.display = '';
    tabsEl.style.display = 'none';
    $$('.stats-panel').forEach(el => el.style.display = 'none');
    return;
  }

  emptyEl.style.display = 'none';
  tabsEl.style.display = '';

  cachedStats = computeAdvancedStats(games, players);

  // Render active tab
  const activeTab = $('.stats-tab.active')?.dataset.tab || 'leaderboard';
  renderStatsTab(activeTab);
}

function switchStatsTab(tab) {
  $$('.stats-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  $$('.stats-panel').forEach(el => el.classList.remove('active'));
  $(`#stats-${tab}`).classList.add('active');
  renderStatsTab(tab);
}

function renderStatsTab(tab) {
  if (!cachedStats) return;
  switch (tab) {
    case 'leaderboard': renderLeaderboard(); break;
    case 'players': renderPlayerStats(); break;
    case 'cards': renderCardStats(); break;
    case 'records': renderRecords(); break;
  }
}

function renderLeaderboard() {
  const leaderboard = getLeaderboard(cachedStats.players);
  const container = $('#leaderboard-content');

  if (leaderboard.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state__text">Ingen data ännu.</div></div>';
    return;
  }

  container.innerHTML = `<div class="leaderboard">${leaderboard.map(p => {
    const scoreClass = p.totalScore > 0 ? 'positive' : p.totalScore < 0 ? 'negative' : 'zero';
    return `<div class="leaderboard-item">
      <div class="leaderboard-rank">${p.rank}</div>
      <div class="leaderboard-avatar">${p.name.charAt(0).toUpperCase()}</div>
      <div class="leaderboard-info">
        <div class="leaderboard-name">${escHtml(p.name)}</div>
        <div class="leaderboard-meta">${p.gamesPlayed} spel &middot; ${p.roundsWon} v/${p.roundsPlayed} r &middot; ${p.winRate}%</div>
      </div>
      <div class="leaderboard-score ${scoreClass}">${p.totalScore > 0 ? '+' : ''}${p.totalScore}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderPlayerStats() {
  const players = PlayerStore.getAll().filter(p => cachedStats.players[p.id]?.gamesPlayed > 0);
  const selector = $('#stats-player-selector');
  const detail = $('#player-detail-content');

  if (players.length === 0) {
    selector.innerHTML = '';
    detail.innerHTML = '<div class="empty-state"><div class="empty-state__text">Ingen spelardata ännu.</div></div>';
    return;
  }

  // Auto-select first player if none selected
  if (!selectedStatsPlayerId || !players.find(p => p.id === selectedStatsPlayerId)) {
    selectedStatsPlayerId = players[0].id;
  }

  selector.innerHTML = players.map(p =>
    `<button class="stats-player-btn ${p.id === selectedStatsPlayerId ? 'active' : ''}" data-player-stats="${p.id}">${escHtml(p.name)}</button>`
  ).join('');

  renderPlayerDetail(selectedStatsPlayerId);
}

function renderPlayerDetail(playerId) {
  const ps = cachedStats.players[playerId];
  const player = PlayerStore.get(playerId);
  if (!ps || !player) return;

  const detail = $('#player-detail-content');
  const commonCard = getMostCommonCard(ps);
  const avgScore = ps.avgScorePerRound;
  const avgClass = avgScore > 0 ? 'positive' : avgScore < 0 ? 'negative' : '';

  // Score history chart
  let chartHtml = '';
  if (ps.scoreHistory.length > 1) {
    const scores = ps.scoreHistory.map(h => h.score);
    const maxAbs = Math.max(...scores.map(Math.abs), 1);
    chartHtml = `
      <h3 class="stats-section-title">Poängutveckling</h3>
      <div class="score-chart">
        <div class="score-chart__bars">
          ${scores.map(s => {
            const pct = Math.round(Math.abs(s) / maxAbs * 100);
            const cls = s >= 0 ? 'score-chart__bar--positive' : 'score-chart__bar--negative';
            return `<div class="score-chart__bar ${cls}" style="height: ${Math.max(pct, 4)}%" title="${s > 0 ? '+' : ''}${s}"></div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // Card frequency
  let cardHtml = '';
  const cardEntries = Object.entries(ps.cardFrequency).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (cardEntries.length > 0) {
    const maxCount = cardEntries[0][1];
    cardHtml = `
      <h3 class="stats-section-title">Vanligaste kort</h3>
      <div class="card-freq-list">
        ${cardEntries.map(([cardId, count]) => {
          const card = getCardById(cardId);
          if (!card) return '';
          const pct = Math.round(count / maxCount * 100);
          return `<div class="card-freq-item">
            <span class="card-freq-name">${escHtml(card.name)}</span>
            <div class="card-freq-bar-wrap"><div class="card-freq-bar" style="width: ${pct}%"></div></div>
            <span class="card-freq-count">${count}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  // Head-to-head
  let h2hHtml = '';
  const opponents = Object.entries(ps.opponents);
  if (opponents.length > 0) {
    h2hHtml = `
      <h3 class="stats-section-title">Mot andra spelare</h3>
      <div class="h2h-list">
        ${opponents.map(([oppId, rec]) => {
          const opp = PlayerStore.get(oppId);
          if (!opp) return '';
          return `<div class="h2h-item">
            <span class="h2h-name">${escHtml(opp.name)}</span>
            <span class="h2h-record"><span class="h2h-wins">${rec.wins}V</span> / <span class="h2h-losses">${rec.losses}F</span></span>
          </div>`;
        }).join('')}
      </div>`;
  }

  // Streak
  let streakText = '—';
  if (ps.currentStreak.type === 'win') {
    streakText = `${ps.currentStreak.count} vinst${ps.currentStreak.count > 1 ? 'er' : ''} i rad`;
  } else if (ps.currentStreak.type === 'loss') {
    streakText = `${ps.currentStreak.count} förlust${ps.currentStreak.count > 1 ? 'er' : ''} i rad`;
  }

  detail.innerHTML = `
    <div class="player-detail-header">
      <div class="player-detail-avatar">${player.name.charAt(0).toUpperCase()}</div>
      <div class="player-detail-name">${escHtml(player.name)}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card__value">${ps.gamesPlayed}</div>
        <div class="stat-card__label">Spel</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${ps.gamesWon}</div>
        <div class="stat-card__label">Vunna spel</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${ps.roundsWon}</div>
        <div class="stat-card__label">Vunna rundor</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${ps.winRate}%</div>
        <div class="stat-card__label">Vinstprocent</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value ${ps.totalScore > 0 ? 'positive' : ps.totalScore < 0 ? 'negative' : ''}">${ps.totalScore > 0 ? '+' : ''}${ps.totalScore}</div>
        <div class="stat-card__label">Totalpoäng</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value ${avgClass}">${avgScore > 0 ? '+' : ''}${avgScore}</div>
        <div class="stat-card__label">Snitt/runda</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value positive">${ps.bestRoundScore !== null ? '+' + ps.bestRoundScore : '—'}</div>
        <div class="stat-card__label">Bästa runda</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value negative">${ps.worstRoundScore !== null ? ps.worstRoundScore : '—'}</div>
        <div class="stat-card__label">Sämsta runda</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${ps.nekenGiven}</div>
        <div class="stat-card__label">Neken (fått)</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${ps.nekenAsWinner}</div>
        <div class="stat-card__label">Neken (vunnit)</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${commonCard ? escHtml(commonCard.card.name) : '—'}</div>
        <div class="stat-card__label">Vanligaste kort</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${streakText}</div>
        <div class="stat-card__label">Streak</div>
      </div>
    </div>

    ${chartHtml}
    ${cardHtml}
    ${h2hHtml}
  `;
}

function renderCardStats() {
  const container = $('#cards-content');
  const topCards = getTopCards(cachedStats.cards, 20);

  if (topCards.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state__text">Ingen kortdata ännu.</div></div>';
    return;
  }

  const maxPlayed = Math.max(...topCards.map(c => c.timesPlayed));

  // Collect players who appear in any card's playerFrequency, sorted by total losses desc
  const playerTotals = {};
  topCards.forEach(c => {
    Object.entries(c.playerFrequency).forEach(([pid, cnt]) => {
      playerTotals[pid] = (playerTotals[pid] || 0) + cnt;
    });
  });
  const heatmapPlayers = Object.entries(playerTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([pid]) => ({ id: pid, name: PlayerStore.get(pid)?.name || '?' }));

  // Global max cell value for color scaling
  const globalMax = heatmapPlayers.length > 0
    ? Math.max(...topCards.flatMap(c => heatmapPlayers.map(p => c.playerFrequency[p.id] || 0)))
    : 1;

  function heatColor(val) {
    if (val === 0) return null;
    const t = val / globalMax; // 0..1
    // interpolate cream-200 → green-700
    const r = Math.round(245 - t * (245 - 26));
    const g = Math.round(239 - t * (239 - 77));
    const b = Math.round(224 - t * (224 - 46));
    return `rgb(${r},${g},${b})`;
  }

  const heatmapHtml = `
    <h3 class="stats-section-title">Heatmap — spelare vs kort</h3>
    <div class="heatmap-wrap">
      <table class="heatmap-table">
        <thead>
          <tr>
            <th class="hm-card-col">Kort</th>
            <th>p</th>
            ${heatmapPlayers.map(p => `<th>${escHtml(p.name)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${topCards.map(c => {
            return `<tr>
              <td class="hm-card-label">${escHtml(c.name)}</td>
              <td class="hm-card-pts">${c.points}</td>
              ${heatmapPlayers.map(p => {
                const v = c.playerFrequency[p.id] || 0;
                const bg = heatColor(v);
                const style = bg ? `background:${bg};color:#fff` : '';
                return `<td class="heatmap-cell" data-v="${v}" style="${style}">${v || ''}</td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  container.innerHTML = `
    <h3 class="stats-section-title">Mest spelade kort</h3>
    <div class="card-freq-list">
      ${topCards.map(c => {
        const pct = Math.round(c.timesPlayed / maxPlayed * 100);
        return `<div class="card-freq-item">
          <span class="card-freq-name">${escHtml(c.name)} <span style="color:var(--text-muted);font-size:0.75rem">${c.points}p</span></span>
          <div class="card-freq-bar-wrap"><div class="card-freq-bar" style="width: ${pct}%"></div></div>
          <span class="card-freq-count">${c.timesPlayed}${c.timesWithNeken > 0 ? ` <span class="neken-badge">N${c.timesWithNeken}</span>` : ''}</span>
        </div>`;
      }).join('')}
    </div>

    ${heatmapHtml}
  `;
}

function renderRecords() {
  const container = $('#records-content');
  const r = cachedStats.records;

  const items = [
    { icon: '🏆', title: 'Flest vunna spel', holder: r.mostGamesWon, format: v => `${v.count} spel` },
    { icon: '⚜', title: 'Flest vunna rundor', holder: r.mostRoundsWon, format: v => `${v.count} rundor` },
    { icon: '🎮', title: 'Flest spelade spel', holder: r.mostGamesPlayed, format: v => `${v.count} spel` },
    { icon: '🔥', title: 'Bästa runda (poäng)', holder: r.highestRoundScore, format: v => `+${v.score}` },
    { icon: '💀', title: 'Sämsta runda (poäng)', holder: r.lowestRoundScore, format: v => `${v.score}` },
    { icon: '📈', title: 'Bästa spel (totalt)', holder: r.highestGameScore, format: v => `+${v.score}` },
    { icon: '📉', title: 'Sämsta spel (totalt)', holder: r.lowestGameScore, format: v => `${v.score}` },
    { icon: '😈', title: 'Flest neken', holder: r.mostNeken, format: v => `${v.count} gånger` },
    { icon: '🔥', title: 'Längsta vinstsvit', holder: r.longestWinStreak, format: v => `${v.count} spel` },
  ].filter(item => item.holder && (item.holder.count > 0 || item.holder.score !== undefined));

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state__text">Inga rekord ännu.</div></div>';
    return;
  }

  container.innerHTML = `<div class="records-list">${items.map(item => `
    <div class="record-item">
      <div class="record-icon">${item.icon}</div>
      <div class="record-info">
        <div class="record-title">${item.title}</div>
        <div class="record-holder">${escHtml(item.holder.name)}</div>
      </div>
      <div class="record-value">${item.format(item.holder)}</div>
    </div>
  `).join('')}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════════════════════
let confirmCallback = null;

function showConfirm(message, onConfirm) {
  $('#confirm-text').textContent = message;
  confirmCallback = onConfirm;
  $('#confirm-dialog').classList.add('active');
}

function closeConfirm() {
  $('#confirm-dialog').classList.remove('active');
  confirmCallback = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatScore(score) {
  if (score > 0) return `+${score}`;
  return String(score);
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT / EXPORT
// ═══════════════════════════════════════════════════════════════════════════
function handleExport() {
  downloadExport();
  showToast('Data exporterad');
}

function handleImport() {
  $('#input-import-file').click();
}

async function handleImportFile(file) {
  if (!file) return;
  try {
    const { playersAdded, gamesAdded } = await importFile(file);
    // Invalidate store caches so the app reads fresh data
    PlayerStore._cache = null;
    GameStore._cache = null;
    activeGame = GameStore.getActive();
    renderHome();
    showToast(`Importerat: ${gamesAdded} spel, ${playersAdded} nya spelare`);
  } catch (err) {
    showToast(`Import misslyckades: ${err.message}`);
  }
  // Reset file input so the same file can be imported again if needed
  $('#input-import-file').value = '';
}

// ─── Toast ───────────────────────────────────────────────────────────────────
let toastTimer = null;

function showToast(message) {
  let toast = $('#app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('app-toast--visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('app-toast--visible'), 3000);
}

// ═══════════════════════════════════════════════════════════════════════════
// SWIPE TO DISMISS
// ═══════════════════════════════════════════════════════════════════════════
function addSwipeToDismiss(sheetEl, closeFn) {
  let startY = 0;
  let startScrollTop = 0;

  sheetEl.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    startScrollTop = sheetEl.scrollTop;
    sheetEl.style.transition = 'none';
  }, { passive: true });

  sheetEl.addEventListener('touchmove', (e) => {
    if (startScrollTop > 0) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) sheetEl.style.transform = `translateY(${dy}px)`;
  }, { passive: true });

  sheetEl.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - startY;
    if (startScrollTop === 0 && dy > 80) {
      sheetEl.style.transition = 'transform 200ms ease';
      sheetEl.style.transform = 'translateY(100%)';
      setTimeout(() => {
        sheetEl.style.transition = '';
        sheetEl.style.transform = '';
        closeFn(true);
      }, 200);
    } else {
      sheetEl.style.transition = 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)';
      sheetEl.style.transform = '';
      sheetEl.addEventListener('transitionend', () => {
        sheetEl.style.transition = '';
      }, { once: true });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════════════════════════════
function bindEvents() {
  // Navigation
  $('#btn-back').addEventListener('click', goBack);
  $('#btn-players').addEventListener('click', () => navigateTo('players'));
  $('#btn-new-game').addEventListener('click', () => {
    selectedPlayerIds.clear();
    navigateTo('setup');
  });
  $('#btn-continue-game').addEventListener('click', () => {
    activeGame = GameStore.getActive();
    if (activeGame) navigateTo('game');
  });
  $('#btn-history').addEventListener('click', () => navigateTo('history'));
  $('#btn-stats').addEventListener('click', () => navigateTo('stats'));
  $('#btn-export').addEventListener('click', handleExport);
  $('#btn-import').addEventListener('click', handleImport);
  $('#input-import-file').addEventListener('change', e => handleImportFile(e.target.files[0]));

  // Player management
  $('#btn-add-player').addEventListener('click', addPlayer);
  $('#input-player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPlayer();
  });
  $('#player-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove"]');
    if (btn) removePlayer(btn.dataset.id);
  });

  // Game setup
  $('#setup-grid').addEventListener('click', (e) => {
    const el = e.target.closest('.setup-player');
    if (el) toggleSetupPlayer(el.dataset.id);
  });
  $('#btn-start-game').addEventListener('click', startGame);

  // Game actions
  $('#btn-new-round').addEventListener('click', openRoundModal);
  $('#btn-undo-round').addEventListener('click', undoLastRound);
  $('#btn-end-game').addEventListener('click', endGame);
  $('#btn-leaderboard-close').addEventListener('click', closeLeaderboard);

  // Round modal
  $('#btn-cancel-round').addEventListener('click', closeRoundModal);
  $('#btn-confirm-round').addEventListener('click', confirmRound);

  // Stand-by toggles
  $('#standby-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.standby-toggle');
    if (btn) toggleStandby(btn.dataset.id);
  });

  // Winner selection
  $('#winner-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.winner-btn');
    if (btn) selectWinner(btn.dataset.id);
  });

  // Loser card assignment
  $('#loser-assignments').addEventListener('click', (e) => {
    const nekenBtn = e.target.closest('.loser-row__neken-btn');
    if (nekenBtn) { toggleNeken(nekenBtn.dataset.nekenPlayer); return; }
    const cardBtn = e.target.closest('.loser-row__card-btn');
    if (cardBtn) openCardPicker(cardBtn.dataset.player);
  });

  // Card picker
  $$('#picker-picture-cards, #picker-number-cards, #picker-zero-cards').forEach(grid => {
    grid.addEventListener('click', (e) => {
      const tile = e.target.closest('.card-tile');
      if (tile) selectCard(tile.dataset.card);
    });
  });

  // Close card picker on overlay click
  $('#card-picker-overlay').addEventListener('click', (e) => {
    if (e.target === $('#card-picker-overlay')) closeCardPicker();
  });

  // Close round modal on overlay click
  $('#modal-round').addEventListener('click', (e) => {
    if (e.target === $('#modal-round')) closeRoundModal();
  });

  // Confirm dialog
  $('#confirm-yes').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirm();
  });
  $('#confirm-no').addEventListener('click', closeConfirm);

  // Stats
  $('#stats-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.stats-tab');
    if (tab) switchStatsTab(tab.dataset.tab);
  });
  $('#stats-player-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('.stats-player-btn');
    if (btn) {
      selectedStatsPlayerId = btn.dataset.playerStats;
      renderPlayerStats();
    }
  });

  // History
  $('#history-list').addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.history-item__delete');
    if (deleteBtn) {
      deleteGame(deleteBtn.dataset.delete);
      return;
    }
    const item = e.target.closest('.history-item');
    if (item) viewGame(item.dataset.game);
  });

  // Swipe to dismiss bottom sheets
  addSwipeToDismiss($('.modal'), closeRoundModal);
  addSwipeToDismiss($('.card-picker'), closeCardPicker);
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════
function init() {
  initCardPicker();
  bindEvents();

  // Restore active game if any
  activeGame = GameStore.getActive();
  renderHome();
}

document.addEventListener('DOMContentLoaded', init);
