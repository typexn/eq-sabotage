import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

type GameVersion = 'grade1' | 'grade3';
type GameStage = 'setup' | 'confirm' | 'playing';
type Phase = 'idle' | 'choosing-card' | 'placing-card' | 'choosing-sign' | 'choosing-root' | 'guessing' | 'ended';
type Side = 'left' | 'right';
type ActionKind = 'card' | 'root' | 'deduction' | 'timeout';

interface TermCard {
  id: string;
  label: string;
  a: number;
  b: number;
  c: number;
}

interface ActionLog {
  id: string;
  player: number;
  kind: ActionKind;
  candidates?: string[];
  selectedCard?: string;
  side?: Side;
  rootValue?: number;
  success?: boolean;
  guessedPlayer?: number;
  guessHit?: boolean;
  note: string;
}

interface GameState {
  version: GameVersion;
  gameStage: GameStage;
  playerCount: number;
  rounds: number;
  sabotageCount: number;
  sabotages: number[];
  caughtSabotages: number[];
  currentPlayer: number;
  completedTurns: number;
  score: number;
  targetScore: number;
  left: TermCard[];
  right: TermCard[];
  phase: Phase;
  activeAction?: ActionKind;
  timerEnd?: number;
  candidates: TermCard[];
  selectedCard?: TermCard;
  selectedSign?: 1 | -1;
  rootCandidates: number[];
  displayMode: 'normal' | 'deduction';
  logs: ActionLog[];
  lastResult?: string;
  winner?: 'players' | 'sabotages';
  updatedAt: number;
}

const STORAGE_KEY = 'equation-sabotage-state-v1';
const CHANNEL_NAME = 'equation-sabotage-channel';

const VERSION_LABEL: Record<GameVersion, string> = {
  grade1: '1학년 버전',
  grade3: '3학년 버전',
};

const DEFAULT_SETTINGS: Record<GameVersion, Pick<GameState, 'playerCount' | 'targetScore' | 'rounds' | 'sabotageCount'>> = {
  grade1: {
    playerCount: 22,
    targetScore: 10,
    rounds: 3,
    sabotageCount: 3,
  },
  grade3: {
    playerCount: 28,
    targetScore: 10,
    rounds: 2,
    sabotageCount: 4,
  },
};

const CARD_POOL: Record<GameVersion, Omit<TermCard, 'id'>[]> = {
  grade1: [
    ...[-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((c) => ({ label: String(c), a: 0, b: 0, c })),
    { label: '-2x', a: 0, b: -2, c: 0 },
    { label: '-x', a: 0, b: -1, c: 0 },
    { label: 'x', a: 0, b: 1, c: 0 },
    { label: '2x', a: 0, b: 2, c: 0 },
  ],
  grade3: [
    ...[-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((c) => ({ label: String(c), a: 0, b: 0, c })),
    { label: '-2x', a: 0, b: -2, c: 0 },
    { label: '-x', a: 0, b: -1, c: 0 },
    { label: 'x', a: 0, b: 1, c: 0 },
    { label: '2x', a: 0, b: 2, c: 0 },
    { label: '-x²', a: -1, b: 0, c: 0 },
    { label: 'x²', a: 1, b: 0, c: 0 },
  ],
};

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

function drawCards(version: GameVersion) {
  return shuffle(CARD_POOL[version]).slice(0, 3).map((card) => ({ ...card, id: uid('card') }));
}

function drawRootCandidates(sign: 1 | -1) {
  return shuffle([1, 2, 3, 4, 5]).slice(0, 3).map((value) => value * sign).sort((a, b) => a - b);
}

function pickSabotages(playerCount: number, sabotageCount: number) {
  return shuffle(Array.from({ length: playerCount }, (_, index) => index + 1)).slice(0, sabotageCount).sort((a, b) => a - b);
}

function defaultPlayerCount(version: GameVersion) {
  return DEFAULT_SETTINGS[version].playerCount;
}

function defaultRounds(version: GameVersion) {
  return DEFAULT_SETTINGS[version].rounds;
}

function defaultTargetScore(version: GameVersion) {
  return DEFAULT_SETTINGS[version].targetScore;
}

function defaultSabotageCount(version: GameVersion) {
  return DEFAULT_SETTINGS[version].sabotageCount;
}

function createGame(
  version: GameVersion,
  playerCount = defaultPlayerCount(version),
  gameStage: GameStage = 'setup',
  targetScore = defaultTargetScore(version),
  rounds = defaultRounds(version),
  sabotageCount = defaultSabotageCount(version),
): GameState {
  return {
    version,
    gameStage,
    playerCount,
    rounds,
    sabotageCount,
    sabotages: gameStage === 'setup' ? [] : pickSabotages(playerCount, sabotageCount),
    caughtSabotages: [],
    currentPlayer: 1,
    completedTurns: 0,
    score: 0,
    targetScore,
    left: [],
    right: [],
    phase: 'idle',
    candidates: [],
    rootCandidates: [],
    displayMode: 'normal',
    logs: [],
    updatedAt: Date.now(),
  };
}

function isGameVersion(value: unknown): value is GameVersion {
  return value === 'grade1' || value === 'grade3';
}

function isGameStage(value: unknown): value is GameStage {
  return value === 'setup' || value === 'confirm' || value === 'playing';
}

function isPhase(value: unknown): value is Phase {
  return (
    value === 'idle'
    || value === 'choosing-card'
    || value === 'placing-card'
    || value === 'choosing-sign'
    || value === 'choosing-root'
    || value === 'guessing'
    || value === 'ended'
  );
}

function isDisplayMode(value: unknown): value is GameState['displayMode'] {
  return value === 'normal' || value === 'deduction';
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberArrayOr(value: unknown, fallback: number[] = []) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : fallback;
}

function cardArrayOr(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is TermCard => (
        item
        && typeof item === 'object'
        && typeof (item as TermCard).id === 'string'
        && typeof (item as TermCard).label === 'string'
        && typeof (item as TermCard).a === 'number'
        && typeof (item as TermCard).b === 'number'
        && typeof (item as TermCard).c === 'number'
      ))
    : [];
}

function normalizeStoredState(value: unknown): GameState | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<GameState>;
  if (!isGameVersion(candidate.version)) return null;

  const defaults = DEFAULT_SETTINGS[candidate.version];
  const playerCount = Math.max(1, Math.floor(numberOr(candidate.playerCount, defaults.playerCount)));
  const rounds = Math.min(5, Math.max(1, Math.floor(numberOr(candidate.rounds, defaults.rounds))));
  const gameStage = isGameStage(candidate.gameStage) ? candidate.gameStage : 'playing';
  const fallbackSabotageCount = Math.min(defaults.sabotageCount, Math.max(1, playerCount - 1));
  const sabotageCount = Math.min(
    Math.max(1, playerCount - 1),
    Math.max(1, Math.floor(numberOr(candidate.sabotageCount, fallbackSabotageCount))),
  );
  const sabotages = numberArrayOr(candidate.sabotages)
    .filter((player) => player >= 1 && player <= playerCount)
    .slice(0, sabotageCount);

  if (gameStage !== 'setup' && sabotages.length !== sabotageCount) {
    return null;
  }

  return {
    version: candidate.version,
    gameStage,
    playerCount,
    rounds,
    sabotageCount,
    sabotages: gameStage === 'setup' ? [] : sabotages,
    caughtSabotages: numberArrayOr(candidate.caughtSabotages).filter((player) => player >= 1 && player <= playerCount),
    currentPlayer: Math.min(playerCount, Math.max(1, Math.floor(numberOr(candidate.currentPlayer, 1)))),
    completedTurns: Math.max(0, Math.floor(numberOr(candidate.completedTurns, 0))),
    score: numberOr(candidate.score, 0),
    targetScore: numberOr(candidate.targetScore, 10),
    left: cardArrayOr(candidate.left),
    right: cardArrayOr(candidate.right),
    phase: isPhase(candidate.phase) ? candidate.phase : 'idle',
    activeAction: candidate.activeAction,
    timerEnd: typeof candidate.timerEnd === 'number' ? candidate.timerEnd : undefined,
    candidates: cardArrayOr(candidate.candidates),
    selectedCard: cardArrayOr(candidate.selectedCard ? [candidate.selectedCard] : [])[0],
    selectedSign: candidate.selectedSign === 1 || candidate.selectedSign === -1 ? candidate.selectedSign : undefined,
    rootCandidates: numberArrayOr(candidate.rootCandidates).filter((root) => root >= -5 && root <= 5 && root !== 0),
    displayMode: isDisplayMode(candidate.displayMode) ? candidate.displayMode : 'normal',
    logs: Array.isArray(candidate.logs) ? candidate.logs.filter((log): log is ActionLog => Boolean(log && typeof log === 'object')) : [],
    lastResult: typeof candidate.lastResult === 'string' ? candidate.lastResult : undefined,
    winner: candidate.winner === 'players' || candidate.winner === 'sabotages' ? candidate.winner : undefined,
    updatedAt: numberOr(candidate.updatedAt, Date.now()),
  };
}

function readStoredState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const normalized = normalizeStoredState(JSON.parse(raw));
    if (!normalized) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return normalized;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function saveState(state: GameState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(state.updatedAt);
    channel.close();
  } catch {
    // localStorage storage events still cover other tabs.
  }
}

function useSharedGameState() {
  const [state, setState] = useState<GameState | null>(() => readStoredState());

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setState(readStoredState());
      }
    };
    window.addEventListener('storage', onStorage);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => setState(readStoredState());
    } catch {
      channel = null;
    }

    return () => {
      window.removeEventListener('storage', onStorage);
      channel?.close();
    };
  }, []);

  const updateState = (updater: (current: GameState | null) => GameState | null) => {
    setState((current) => {
      const next = updater(current);
      if (!next) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      const stamped = { ...next, updatedAt: Date.now() };
      saveState(stamped);
      return stamped;
    });
  };

  return [state, updateState] as const;
}

function sideLabel(side?: Side) {
  if (!side) return '';
  return side === 'left' ? '좌변' : '우변';
}

function combine(cards: TermCard[]) {
  return cards.reduce(
    (sum, card) => ({ a: sum.a + card.a, b: sum.b + card.b, c: sum.c + card.c }),
    { a: 0, b: 0, c: 0 },
  );
}

function evaluate(cards: TermCard[], x: number) {
  const coefs = combine(cards);
  return coefs.a * x * x + coefs.b * x + coefs.c;
}

function isIdentity(left: TermCard[], right: TermCard[]) {
  const l = combine(left);
  const r = combine(right);
  return l.a === r.a && l.b === r.b && l.c === r.c;
}

function isRoot(left: TermCard[], right: TermCard[], x: number) {
  return isIdentity(left, right) || evaluate(left, x) === evaluate(right, x);
}

function formatSide(cards: TermCard[]) {
  if (cards.length === 0) return '비어 있음';
  return cards.map((card) => card.label).join(' + ').replaceAll('+ -', '- ');
}

function formatEquation(state: GameState | null) {
  if (!state) return '게임 대기 중';
  return `${formatSide(state.left)} = ${formatSide(state.right)}`;
}

function totalTurns(state: GameState) {
  return state.playerCount * state.rounds;
}

function remainingTurns(state: GameState) {
  return Math.max(0, totalTurns(state) - state.completedTurns);
}

function currentRound(state: GameState) {
  return Math.min(state.rounds, Math.floor(state.completedTurns / state.playerCount) + 1);
}

function finishIfNeeded(state: GameState): GameState {
  if (state.completedTurns >= totalTurns(state)) {
    return {
      ...state,
      phase: 'ended',
      activeAction: undefined,
      timerEnd: undefined,
      displayMode: 'normal',
      winner: state.score >= state.targetScore ? 'players' : 'sabotages',
      lastResult: state.score >= state.targetScore ? '일반 플레이어 승리' : '사보타지 승리',
    };
  }
  return state;
}

function advanceTurn(state: GameState): GameState {
  let next: GameState = {
    ...state,
    completedTurns: state.completedTurns + 1,
    currentPlayer: state.currentPlayer === state.playerCount ? 1 : state.currentPlayer + 1,
    phase: 'idle',
    activeAction: undefined,
    timerEnd: undefined,
    candidates: [],
    selectedCard: undefined,
    selectedSign: undefined,
    rootCandidates: [],
    displayMode: 'normal',
  };

  while (
    next.completedTurns < totalTurns(next)
    && next.caughtSabotages.includes(next.currentPlayer)
  ) {
    next = {
      ...next,
      completedTurns: next.completedTurns + 1,
      currentPlayer: next.currentPlayer === next.playerCount ? 1 : next.currentPlayer + 1,
      lastResult: `${next.currentPlayer}번은 검거된 사보타지라 차례를 건너뜁니다.`,
    };
  }

  return finishIfNeeded(next);
}

function appendLog(state: GameState, log: Omit<ActionLog, 'id' | 'player'>) {
  return {
    ...state,
    logs: [
      ...state.logs,
      {
        ...log,
        id: uid('log'),
        player: state.currentPlayer,
      },
    ],
  };
}

function canOfferRoot(state: GameState) {
  return state.left.length > 0 && state.right.length > 0 && state.left.length + state.right.length >= 4;
}

function remainingSabotages(state: GameState) {
  return state.sabotageCount - state.caughtSabotages.length;
}

function secondsLeft(state: GameState | null, now: number) {
  if (!state?.timerEnd) return null;
  return Math.max(0, Math.ceil((state.timerEnd - now) / 1000));
}

function StatCard({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <section className={accent ? 'stat-card stat-card-accent' : 'stat-card'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

const HELP_STEPS = [
  {
    title: '1단계: 게임 목표',
    items: [
      '일반 플레이어는 방정식의 근을 찾아 승점을 얻는다.',
      '사보타지는 정체를 숨긴 채 근을 찾기 어렵게 만든다.',
    ],
  },
  {
    title: '2단계: 게임 설정',
    items: [
      '학년 버전을 선택한다.',
      '실제 참여 학생 수와 목표 승점을 입력한다.',
      '사보타지 배정 확인 화면에서 교사가 사보타지 번호를 확인한다.',
      '게임 시작 후에는 사보타지 전체 번호가 공개되지 않는다.',
    ],
  },
  {
    title: '3단계: 카드 추가하기',
    items: [
      '카드 3장 중 1장을 골라 좌변 또는 우변에 추가한다.',
      '학생들은 근이 제시 가능한 범위에 들어오도록 식을 조정한다.',
    ],
  },
  {
    title: '4단계: 근 제시하기',
    items: [
      '좌변과 우변에 카드가 각각 1장 이상 있고, 전체 카드가 4장 이상일 때만 가능하다.',
      '양수 또는 음수를 고른 뒤 1~5 중 하나를 선택한다.',
      'x=0은 선택할 수 없다.',
      '맞히면 +2점, 틀리면 -1점이며, 이후 식은 초기화된다.',
    ],
  },
  {
    title: '5단계: 화면 공유 및 추리하기',
    items: [
      '현재까지의 행동 기록을 HDMI 화면에 공개한다.',
      '사보타지로 의심되는 번호를 지목할 수 있다.',
      '맞히면 해당 사보타지는 이후 행동할 수 없다.',
      '지목 자체는 승점에 영향을 주지 않는다.',
    ],
  },
  {
    title: '6단계: 승리 조건',
    items: [
      '모든 턴이 끝났을 때 승점이 목표 승점 이상이면 일반 플레이어 승리.',
      '목표 승점 미만이면 사보타지 승리.',
    ],
  },
];

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="help-modal-header">
          <div>
            <p className="eyebrow">교사용 도움말</p>
            <h2 id="help-modal-title">게임 방법</h2>
          </div>
          <button type="button" className="modal-close-button" aria-label="도움말 닫기" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="help-step-list">
          {HELP_STEPS.map((step) => (
            <article className="help-step" key={step.title}>
              <h3>{step.title}</h3>
              <ul>
                {step.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function StartScreen({ onStart }: { onStart: (version: GameVersion) => void }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  return (
    <main className="page start-page">
      <div className="app-shell start-shell">
        <p className="eyebrow">수업용 웹 게임</p>
        <h1>방정식으로 사보타지하기</h1>
        <div className="version-grid" aria-label="버전 선택">
          <button type="button" className="version-button" onClick={() => onStart('grade1')}>
            <span>1학년 버전</span>
            <small>일차방정식</small>
          </button>
          <button type="button" className="version-button" onClick={() => onStart('grade3')}>
            <span>3학년 버전</span>
            <small>이차방정식</small>
          </button>
        </div>
        <nav className="screen-links" aria-label="화면 이동">
          <button type="button" className="link-button" onClick={() => setIsHelpOpen(true)}>게임 방법 보기</button>
          <a href="/teacher">교사용 화면</a>
          <a href="/display">HDMI 화면</a>
        </nav>
      </div>
      {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}
    </main>
  );
}

function PlayerSetupScreen({ state, updateState }: { state: GameState; updateState: ReturnType<typeof useSharedGameState>[1] }) {
  const [playerCount, setPlayerCount] = useState(String(state.playerCount));
  const [targetScore, setTargetScore] = useState(String(state.targetScore));
  const [rounds, setRounds] = useState(String(state.rounds));
  const [sabotageCount, setSabotageCount] = useState(String(state.sabotageCount));
  const parsedCount = Number(playerCount);
  const parsedTargetScore = Number(targetScore);
  const parsedRounds = Number(rounds);
  const parsedSabotageCount = Number(sabotageCount);
  const recommended = DEFAULT_SETTINGS[state.version];
  const isPlayerCountValid = Number.isInteger(parsedCount) && parsedCount >= 5 && parsedCount <= 40;
  const isTargetScoreValid = Number.isInteger(parsedTargetScore) && parsedTargetScore >= 1;
  const isRoundsValid = Number.isInteger(parsedRounds) && parsedRounds >= 1 && parsedRounds <= 5;
  const isSabotageCountValid = Number.isInteger(parsedSabotageCount) && parsedSabotageCount >= 1 && parsedSabotageCount < parsedCount;
  const isValid = isPlayerCountValid && isTargetScoreValid && isRoundsValid && isSabotageCountValid;

  const goToConfirm = () => {
    if (!isValid) return;
    updateState(() => createGame(state.version, parsedCount, 'confirm', parsedTargetScore, parsedRounds, parsedSabotageCount));
  };

  return (
    <main className="page dashboard-page">
      <div className="app-shell centered-panel setup-panel">
        <p className="eyebrow">게임 설정</p>
        <h1>{VERSION_LABEL[state.version]}</h1>
        <section className="control-panel setup-card">
          <div className="setup-input-grid">
            <label className="target-input player-count-input">
              플레이어 수
              <input
                type="number"
                min="5"
                max="40"
                value={playerCount}
                onChange={(event) => setPlayerCount(event.target.value)}
              />
            </label>
            <label className="target-input player-count-input">
              목표 승점
              <input
                type="number"
                min="1"
                value={targetScore}
                onChange={(event) => setTargetScore(event.target.value)}
              />
            </label>
            <label className="target-input player-count-input">
              바퀴 수
              <input
                type="number"
                min="1"
                max="5"
                value={rounds}
                onChange={(event) => setRounds(event.target.value)}
              />
            </label>
            <label className="target-input player-count-input">
              사보타지 수
              <input
                type="number"
                min="1"
                max="39"
                value={sabotageCount}
                onChange={(event) => setSabotageCount(event.target.value)}
              />
            </label>
          </div>
          <p className="muted">권장: {recommended.playerCount}명, {recommended.rounds}바퀴, 사보타지 {recommended.sabotageCount}명</p>
          {!isPlayerCountValid && <p className="setup-error">플레이어 수는 5명 이상 40명 이하로 입력하세요.</p>}
          {!isTargetScoreValid && <p className="setup-error">목표 승점은 1점 이상으로 입력하세요.</p>}
          {!isRoundsValid && <p className="setup-error">바퀴 수는 1 이상 5 이하로 입력하세요.</p>}
          {!isSabotageCountValid && <p className="setup-error">사보타지 수는 1명 이상이며 플레이어 수보다 작아야 합니다.</p>}
          <div className="action-row">
            <a href="/" onClick={() => updateState(() => null)}>시작 화면</a>
            <button type="button" disabled={!isValid} onClick={goToConfirm}>사보타지 배정 확인</button>
          </div>
        </section>
      </div>
    </main>
  );
}

function SabotageConfirmScreen({ state, updateState }: { state: GameState; updateState: ReturnType<typeof useSharedGameState>[1] }) {
  const reroll = () => {
    updateState((current) => current
      ? createGame(current.version, current.playerCount, 'confirm', current.targetScore, current.rounds, current.sabotageCount)
      : current);
  };

  const startPlaying = () => {
    updateState((current) => current ? { ...current, gameStage: 'playing', lastResult: undefined } : current);
  };

  const goBack = () => {
    updateState((current) => current ? { ...current, gameStage: 'setup', sabotages: [] } : current);
  };

  return (
    <main className="page dashboard-page">
      <div className="app-shell centered-panel setup-panel">
        <p className="eyebrow">교사용 사보타지 확인</p>
        <h1>{VERSION_LABEL[state.version]}</h1>
        <section className="control-panel setup-card">
          <div className="setup-summary">
            <span>플레이어 수: {state.playerCount}명</span>
            <span>바퀴 수: {state.rounds}바퀴</span>
            <span>사보타지 수: {state.sabotageCount}명</span>
            <span>목표 승점: {state.targetScore}점</span>
          </div>
          <p className="sabotage-preview">
            사보타지 번호: {state.sabotages.map((player) => `${player}번`).join(', ')}
          </p>
          <div className="action-row">
            <button type="button" onClick={reroll}>다시 배정하기</button>
            <button type="button" onClick={startPlaying}>게임 시작</button>
            <button type="button" onClick={goBack}>이전으로</button>
            <a href="/" onClick={() => updateState(() => null)}>시작 화면</a>
          </div>
        </section>
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <main className="page dashboard-page">
      <div className="app-shell centered-panel">
        <p className="eyebrow">게임 대기 중</p>
        <h1>시작 화면에서 버전을 선택하세요</h1>
        <a className="primary-link" href="/">시작 화면으로 이동</a>
      </div>
    </main>
  );
}

function RootChoice({ roots, onSubmit }: { roots: number[]; onSubmit: (root: number) => void }) {
  return (
    <div className="choice-block">
      <h3>근 선택</h3>
      <div className="card-row">
        {roots.map((root) => (
          <button type="button" className="math-card" key={root} onClick={() => onSubmit(root)}>
            x={root}
          </button>
        ))}
      </div>
    </div>
  );
}

function TeacherScreen({ state, updateState }: { state: GameState | null; updateState: ReturnType<typeof useSharedGameState>[1] }) {
  const [now, setNow] = useState(Date.now());
  const [isRoleOpen, setIsRoleOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const timer = secondsLeft(state, now);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setIsRoleOpen(false);
  }, [state?.currentPlayer]);

  useEffect(() => {
    if (!state || state.phase === 'idle' || state.phase === 'ended' || !state.timerEnd || state.timerEnd > now) return;
    updateState((current) => {
      if (!current || current.phase === 'idle' || current.phase === 'ended' || !current.timerEnd || current.timerEnd > Date.now()) return current;
      if (current.activeAction === 'root') {
        const score = current.score - 1;
        const timedOutRoot = appendLog({ ...current, score }, {
          kind: 'timeout',
          note: '근 제시 시간 초과: 오답 처리 (-1점)',
        });
        return advanceTurn({
          ...timedOutRoot,
          left: [],
          right: [],
          lastResult: '시간 초과로 근 제시에 실패했습니다. -1점, 식 초기화',
        });
      }
      const timedOut = appendLog(current, {
        kind: 'timeout',
        candidates: current.candidates.map((card) => card.label),
        selectedCard: current.selectedCard?.label,
        note: '제한 시간 초과로 행동 없이 턴 종료',
      });
      return advanceTurn({ ...timedOut, lastResult: '제한 시간 초과' });
    });
  }, [now, state, updateState]);

  if (!state) return <EmptyState />;
  if (state.gameStage === 'setup') return <PlayerSetupScreen state={state} updateState={updateState} />;
  if (state.gameStage === 'confirm') return <SabotageConfirmScreen state={state} updateState={updateState} />;

  const startCardAction = () => {
    updateState((current) => current && current.phase === 'idle'
      ? {
          ...current,
          phase: 'choosing-card',
          activeAction: 'card',
          timerEnd: Date.now() + 20_000,
          candidates: drawCards(current.version),
          selectedCard: undefined,
          lastResult: undefined,
        }
      : current);
  };

  const chooseCard = (card: TermCard) => {
    updateState((current) => current && current.phase === 'choosing-card'
      ? { ...current, phase: 'placing-card', selectedCard: card }
      : current);
  };

  const placeCard = (side: Side) => {
    updateState((current) => {
      if (!current || current.phase !== 'placing-card' || !current.selectedCard) return current;
      const selected = current.selectedCard;
      const placed = {
        ...current,
        left: side === 'left' ? [...current.left, selected] : current.left,
        right: side === 'right' ? [...current.right, selected] : current.right,
      };
      const logged = appendLog(placed, {
        kind: 'card',
        candidates: current.candidates.map((card) => card.label),
        selectedCard: selected.label,
        side,
        note: `${selected.label} 카드를 ${sideLabel(side)}에 추가`,
      });
      return advanceTurn({ ...logged, lastResult: `${selected.label} 카드 추가 완료` });
    });
  };

  const startRootAction = () => {
    updateState((current) => current && current.phase === 'idle' && canOfferRoot(current)
      ? {
          ...current,
          phase: 'choosing-sign',
          activeAction: 'root',
          timerEnd: Date.now() + 20_000,
          selectedSign: undefined,
          rootCandidates: [],
          lastResult: undefined,
        }
      : current);
  };

  const chooseSign = (sign: 1 | -1) => {
    updateState((current) => current && current.phase === 'choosing-sign'
      ? { ...current, phase: 'choosing-root', selectedSign: sign, rootCandidates: drawRootCandidates(sign) }
      : current);
  };

  const submitRoot = (root: number) => {
    updateState((current) => {
      if (!current || current.phase !== 'choosing-root') return current;
      const success = isRoot(current.left, current.right, root);
      const score = current.score + (success ? 2 : -1);
      const logged = appendLog({ ...current, score }, {
        kind: 'root',
        rootValue: root,
        success,
        note: `x=${root} 제시 ${success ? '성공' : '실패'}`,
      });
      return advanceTurn({
        ...logged,
        left: [],
        right: [],
        lastResult: `근 제시 ${success ? '성공: +2점' : '실패: -1점'}`,
      });
    });
  };

  const startDeduction = () => {
    updateState((current) => current && current.phase === 'idle'
      ? {
          ...current,
          phase: 'guessing',
          activeAction: 'deduction',
          timerEnd: Date.now() + 60_000,
          displayMode: 'deduction',
          lastResult: undefined,
        }
      : current);
  };

  const guessSabotage = (player: number) => {
    updateState((current) => {
      if (!current || current.phase !== 'guessing') return current;
      const hit = current.sabotages.includes(player) && !current.caughtSabotages.includes(player);
      const caughtSabotages = hit ? [...current.caughtSabotages, player].sort((a, b) => a - b) : current.caughtSabotages;
      const logged = appendLog({ ...current, caughtSabotages }, {
        kind: 'deduction',
        guessedPlayer: player,
        guessHit: hit,
        note: `${player}번 지목 ${hit ? '성공' : '실패'}`,
      });
      return advanceTurn({ ...logged, lastResult: `${player}번 지목 ${hit ? '성공' : '실패'}` });
    });
  };

  const idle = state.phase === 'idle';
  const currentPlayerIsSabotage = state.sabotages.includes(state.currentPlayer);
  const fellowSabotages = state.sabotages.filter((player) => player !== state.currentPlayer);

  return (
    <main className="page dashboard-page">
      <div className="app-shell">
        <header className="screen-header">
          <div>
            <p className="eyebrow">교사용 화면</p>
            <h1>{VERSION_LABEL[state.version]}</h1>
          </div>
          <div className="header-actions">
            <button type="button" className="link-button compact-help-button" onClick={() => setIsHelpOpen(true)}>도움말</button>
            <a href="/" onClick={() => updateState(() => null)}>시작 화면</a>
            <a href="/display">HDMI 화면</a>
          </div>
        </header>

        <section className="equation-panel">
          <span>현재 방정식</span>
          <strong>{formatEquation(state)}</strong>
        </section>

        <div className="stats-grid">
          <StatCard label="현재 차례" value={`${state.currentPlayer}번`} accent />
          <StatCard label="현재 라운드" value={`${currentRound(state)} / ${state.rounds}`} />
          <StatCard label="남은 턴 수" value={`${remainingTurns(state)}턴`} />
          <StatCard label="승점" value={`${state.score}점`} />
          <StatCard label="목표 승점" value={`${state.targetScore}점`} />
          <StatCard label="남은 사보타지" value={`${remainingSabotages(state)}명`} />
        </div>

        <section className="teacher-grid">
          <div className="control-panel">
            <div className="panel-title">
              <h2>이번 차례 행동</h2>
              {timer !== null && <strong className="timer">{timer}초</strong>}
            </div>
            {state.phase === 'ended' ? (
              <div className="result-banner">{state.lastResult}</div>
            ) : (
              <div className="action-row">
                <button type="button" onClick={startCardAction} disabled={!idle}>카드 추가하기</button>
                <button type="button" onClick={startRootAction} disabled={!idle || !canOfferRoot(state)}>근 제시하기</button>
                <button type="button" onClick={startDeduction} disabled={!idle}>화면 공유 및 추리하기</button>
              </div>
            )}

            {state.phase === 'choosing-card' && (
              <div className="choice-block">
                <h3>후보 카드 3장</h3>
                <div className="card-row">
                  {state.candidates.map((card) => (
                    <button type="button" className="math-card" key={card.id} onClick={() => chooseCard(card)}>
                      {card.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {state.phase === 'placing-card' && state.selectedCard && (
              <div className="choice-block">
                <h3>{state.selectedCard.label} 카드를 어디에 둘까요?</h3>
                <div className="action-row">
                  <button type="button" onClick={() => placeCard('left')}>좌변</button>
                  <button type="button" onClick={() => placeCard('right')}>우변</button>
                </div>
              </div>
            )}

            {state.phase === 'choosing-sign' && (
              <div className="choice-block">
                <h3>근의 부호 선택</h3>
                <div className="action-row">
                  <button type="button" onClick={() => chooseSign(1)}>양수</button>
                  <button type="button" onClick={() => chooseSign(-1)}>음수</button>
                </div>
              </div>
            )}

            {state.phase === 'choosing-root' && state.selectedSign && (
              <RootChoice roots={state.rootCandidates} onSubmit={submitRoot} />
            )}

            {state.phase === 'guessing' && (
              <div className="choice-block">
                <h3>사보타지 의심 번호 선택</h3>
                <div className="player-grid">
                  {Array.from({ length: state.playerCount }, (_, index) => index + 1).map((player) => (
                    <button
                      type="button"
                      key={player}
                      disabled={state.caughtSabotages.includes(player)}
                      onClick={() => guessSabotage(player)}
                    >
                      {player}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="control-panel">
            <h2>진행 정보</h2>
            {state.phase !== 'ended' && (
              <button type="button" className="role-check-button" onClick={() => setIsRoleOpen(true)}>
                내 역할 확인
              </button>
            )}
            {isRoleOpen && (
              <div className="role-reveal-panel">
                <span>현재 차례: {state.currentPlayer}번</span>
                <strong>역할: {currentPlayerIsSabotage ? '사보타지' : '일반 플레이어'}</strong>
                {currentPlayerIsSabotage && (
                  <p>같은 편: {fellowSabotages.length > 0 ? fellowSabotages.map((player) => `${player}번`).join(', ') : '없음'}</p>
                )}
                <button type="button" onClick={() => setIsRoleOpen(false)}>확인 완료</button>
              </div>
            )}
            <p>검거됨: {state.caughtSabotages.length > 0 ? state.caughtSabotages.join(', ') : '없음'}</p>
            {state.lastResult && <p className="last-result">{state.lastResult}</p>}
          </aside>
        </section>
      </div>
      {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}
    </main>
  );
}

function LogList({ logs }: { logs: ActionLog[] }) {
  if (logs.length === 0) {
    return <p className="muted">아직 공개할 행동 기록이 없습니다.</p>;
  }

  return (
    <div className="log-list">
      {logs.map((log) => (
        <article className="log-item" key={log.id}>
          <strong>{log.player}번 · {log.note}</strong>
          <span>행동: {log.kind === 'card' ? '카드 추가하기' : log.kind === 'root' ? '근 제시하기' : log.kind === 'deduction' ? '화면 공유 및 추리하기' : '시간 초과'}</span>
          {log.candidates && <span>후보 카드: {log.candidates.join(', ')}</span>}
          {log.selectedCard && <span>선택 카드: {log.selectedCard}</span>}
          {log.side && <span>선택한 변: {sideLabel(log.side)}</span>}
          {log.rootValue !== undefined && <span>제시한 근: x={log.rootValue}, 결과: {log.success ? '성공' : '실패'}</span>}
          {log.guessedPlayer !== undefined && <span>지목 번호: {log.guessedPlayer}번, 결과: {log.guessHit ? '성공' : '실패'}</span>}
        </article>
      ))}
    </div>
  );
}

function summarizeDisplayLog(log: ActionLog) {
  if (log.kind === 'card' && log.selectedCard && log.side) {
    return `${log.player}번: '${log.selectedCard}'을 ${sideLabel(log.side)}에 추가`;
  }
  if (log.kind === 'root' && log.rootValue !== undefined) {
    return `${log.player}번: x = ${log.rootValue} 제시`;
  }
  if (log.kind === 'deduction' && log.guessedPlayer !== undefined) {
    return `${log.player}번: ${log.guessedPlayer}번을 사보타지로 지목`;
  }
  if (log.kind === 'timeout') {
    if (log.note.includes('근 제시')) {
      return `${log.player}번: 근 제시 시간 초과`;
    }
    return `${log.player}번: 시간 초과`;
  }
  return `${log.player}번: ${log.note}`;
}

function DisplayLogSummary({ logs }: { logs: ActionLog[] }) {
  const recentLogs = logs.slice(-5);

  if (recentLogs.length === 0) {
    return <p className="display-log-empty">아직 공개할 행동 기록이 없습니다.</p>;
  }

  return (
    <ol className="display-log-summary">
      {recentLogs.map((log) => (
        <li key={log.id}>{summarizeDisplayLog(log)}</li>
      ))}
    </ol>
  );
}

function DisplayScreen({ state }: { state: GameState | null }) {
  const [now, setNow] = useState(Date.now());
  const timer = secondsLeft(state, now);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  if (!state) {
    return (
      <main className="page display-page">
        <div className="display-layout">
          <p className="eyebrow">학생용 HDMI 화면</p>
          <section className="display-equation">
            <span>현재 방정식</span>
            <strong>게임 대기 중</strong>
          </section>
        </div>
      </main>
    );
  }

  if (state.gameStage !== 'playing') {
    return (
      <main className="page display-page">
        <div className="display-layout">
          <p className="eyebrow">학생용 HDMI 화면</p>
          <section className="display-equation">
            <span>현재 상태</span>
            <strong>게임 설정 중입니다</strong>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="page display-page">
      <div className="display-layout">
        <div className="display-topline">
          <p className="eyebrow">학생용 HDMI 화면</p>
          {timer !== null && <strong className="display-timer">{timer}초</strong>}
        </div>
        <section className="display-equation">
          <span>현재 방정식</span>
          <strong>{formatEquation(state)}</strong>
        </section>
        <div className="display-stats">
          <StatCard label="현재 승점" value={`${state.score}점`} />
          <StatCard label="목표 승점" value={`${state.targetScore}점`} />
          <StatCard label="남은 턴 수" value={`${remainingTurns(state)}턴`} />
          <StatCard label="현재 라운드" value={`${currentRound(state)} / ${state.rounds}`} />
          <StatCard label="현재 차례 번호" value={`${state.currentPlayer}번`} />
          <StatCard label="남은 사보타지 수" value={`${remainingSabotages(state)}명`} accent />
        </div>
        {state.phase === 'ended' && <div className="display-result">{state.lastResult}</div>}
        {state.displayMode === 'deduction' && (
          <section className="deduction-board">
            <h2>최근 5개 행동</h2>
            <DisplayLogSummary logs={state.logs} />
          </section>
        )}
      </div>
    </main>
  );
}

function App() {
  const [state, updateState] = useSharedGameState();
  const path = window.location.pathname;

  const startGame = (version: GameVersion) => {
    updateState(() => createGame(version, defaultPlayerCount(version), 'setup'));
    window.location.href = '/teacher';
  };

  const content = useMemo(() => {
    if (path === '/teacher') return <TeacherScreen state={state} updateState={updateState} />;
    if (path === '/display') return <DisplayScreen state={state} />;
    return <StartScreen onStart={startGame} />;
  }, [path, state]);

  return content;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
