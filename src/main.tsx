import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

type GameVersion = 'grade1' | 'grade3';
type GameStage = 'setup' | 'confirm' | 'playing';
type Phase = 'idle' | 'choosing-card' | 'placing-card' | 'choosing-sign' | 'choosing-root' | 'guessing' | 'result' | 'ended';
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

interface ResultPrompt {
  message: string;
  displayMessage: string;
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
  lastDeductionTurn?: number;
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
  lastDisplayResult?: string;
  resultPrompt?: ResultPrompt;
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
    lastDeductionTurn: undefined,
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
    || value === 'result'
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
    lastDeductionTurn: typeof candidate.lastDeductionTurn === 'number'
      ? Math.max(1, Math.floor(candidate.lastDeductionTurn))
      : undefined,
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
    lastDisplayResult: typeof candidate.lastDisplayResult === 'string' ? candidate.lastDisplayResult : undefined,
    resultPrompt: candidate.resultPrompt && typeof candidate.resultPrompt.message === 'string'
      ? {
          message: candidate.resultPrompt.message,
          displayMessage: typeof candidate.resultPrompt.displayMessage === 'string'
            ? candidate.resultPrompt.displayMessage
            : candidate.resultPrompt.message,
        }
      : undefined,
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

const DEDUCTION_COOLDOWN_TURNS = 5;

function currentTurnNumber(state: GameState) {
  return state.completedTurns + 1;
}

function turnsUntilDeduction(state: GameState) {
  const currentTurn = currentTurnNumber(state);
  const firstOpenWait = Math.max(0, DEDUCTION_COOLDOWN_TURNS - currentTurn);
  const reuseWait = state.lastDeductionTurn === undefined
    ? 0
    : Math.max(0, state.lastDeductionTurn + DEDUCTION_COOLDOWN_TURNS - currentTurn);
  return Math.max(firstOpenWait, reuseWait);
}

function canOpenDeduction(state: GameState) {
  return turnsUntilDeduction(state) === 0;
}

function deductionStatusLabel(state: GameState) {
  const turns = turnsUntilDeduction(state);
  return turns === 0 ? '작전 회의 가능' : `작전 회의까지 ${turns}턴 남음`;
}

function sabotageRevealText(state: GameState) {
  return state.sabotages
    .slice()
    .sort((a, b) => a - b)
    .map((player) => `${player}번`)
    .join(', ');
}

function finalResultMessages(state: GameState, winner: 'players' | 'sabotages') {
  const reveal = sabotageRevealText(state);
  if (winner === 'players') {
    return {
      teacher: `목표 정보를 모두 확보했습니다!\n프로젝트 B 해독 성공!\n분석관 팀 승리입니다.\n\n첩자 번호: ${reveal}`,
      display: `프로젝트 B 해독 성공\n분석관 팀 승리\n첩자 공개: ${reveal}`,
    };
  }
  return {
    teacher: `목표 정보 확보에 실패했습니다.\n첩자 팀 승리입니다.\n\n첩자 번호: ${reveal}`,
    display: `목표 정보 확보 실패\n첩자 팀 승리\n첩자 공개: ${reveal}`,
  };
}

function finishIfNeeded(state: GameState): GameState {
  if (state.winner) {
    const messages = finalResultMessages(state, state.winner);
    return {
      ...state,
      phase: 'ended',
      activeAction: undefined,
      timerEnd: undefined,
      displayMode: 'normal',
      resultPrompt: undefined,
      lastResult: messages.teacher,
      lastDisplayResult: messages.display,
    };
  }

  if (state.score >= state.targetScore) {
    const messages = finalResultMessages(state, 'players');
    return waitForResultConfirm({
      ...state,
      winner: 'players',
    }, messages.teacher, messages.display);
  }

  if (state.completedTurns >= totalTurns(state)) {
    const messages = finalResultMessages(state, 'sabotages');
    return waitForResultConfirm({
      ...state,
      winner: 'sabotages',
    }, messages.teacher, messages.display);
  }
  return state;
}

function clearActionState(state: GameState): GameState {
  return {
    ...state,
    phase: 'idle',
    activeAction: undefined,
    timerEnd: undefined,
    candidates: [],
    selectedCard: undefined,
    selectedSign: undefined,
    rootCandidates: [],
    displayMode: 'normal',
    resultPrompt: undefined,
  };
}

function waitForResultConfirm(state: GameState, message: string, displayMessage = message): GameState {
  return {
    ...state,
    phase: 'result',
    activeAction: undefined,
    timerEnd: undefined,
    candidates: [],
    selectedCard: undefined,
    selectedSign: undefined,
    rootCandidates: [],
    resultPrompt: { message, displayMessage },
    lastResult: message,
    lastDisplayResult: displayMessage,
  };
}

function advanceTurn(state: GameState): GameState {
  const next: GameState = clearActionState({
    ...state,
    completedTurns: state.completedTurns + 1,
    currentPlayer: state.currentPlayer === state.playerCount ? 1 : state.currentPlayer + 1,
  });

  if (
    next.completedTurns < totalTurns(next)
    && next.caughtSabotages.includes(next.currentPlayer)
  ) {
    return waitForResultConfirm(
      next,
      `${next.currentPlayer}번은 검거된 첩자이므로 행동할 수 없습니다.\n차례를 넘깁니다.`,
      `${next.currentPlayer}번은 검거된 첩자이므로 차례를 넘깁니다.`,
    );
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
      '분석관은 방정식의 근, 즉 암호 키를 찾아 정보를 획득한다.',
      '첩자는 정체를 숨긴 채 식을 교란해 정보 획득을 방해한다.',
    ],
  },
  {
    title: '2단계: 게임 설정',
    items: [
      '학년 버전을 선택한다.',
      '실제 참여 학생 수, 목표 정보, 바퀴 수, 첩자 수를 입력한다.',
      '첩자 배정 확인 화면에서 교사가 첩자 번호를 확인한다.',
      '게임 시작 후에는 첩자 전체 번호가 공개되지 않는다.',
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
      '방정식의 근을 암호 키로 입력한다.',
      '맞히면 정보를 2건 획득하고, 틀리면 정보를 1건 유실하며, 이후 식은 초기화된다.',
    ],
  },
  {
    title: '5단계: 작전 회의 열기',
    items: [
      '최근 행동을 HDMI 화면에 공유한다.',
      '첩자로 의심되는 번호를 지목할 수 있다.',
      '맞히면 해당 첩자는 이후 행동할 수 없다.',
      '작전 회의는 5턴마다 한 번만 열 수 있으며, 게임 시작 후 5턴이 지나야 처음 사용할 수 있다.',
      '지목 자체는 획득한 정보에 영향을 주지 않는다.',
    ],
  },
  {
    title: '6단계: 승리 조건',
    items: [
      '현재 획득한 정보가 목표 정보에 도달하면 즉시 분석관 팀이 승리한다.',
      '전체 턴 종료 시까지 목표 정보에 도달하지 못하면 첩자 팀이 승리한다.',
    ],
  },
];

const HELP_STORY = [
  '제2차세계대전 시기 암호 해독 작전에서 아이디어를 얻은 가상의 수학 게임입니다.',
  '여러분은 암호 해독팀의 분석관이 되어 방정식의 근, 즉 암호 키를 찾아야 합니다.',
  '하지만 팀 안에는 식을 교란하는 내부 첩자가 숨어 있습니다.',
];

const SIMULATION_STEPS = [
  {
    title: '1단계: 식 만들기 시작',
    action: '1번이 "-3"을 우변에 추가',
    equation: '비어 있음 = -3',
    description: [
      '아직 한쪽 변이 비어 있으면 근을 제시할 수 없습니다.',
    ],
  },
  {
    title: '2단계: 양변 완성',
    action: '2번이 "2x"를 좌변에 추가',
    equation: '2x = -3',
    description: [
      '양변이 모두 채워져도 전체 카드 수가 4장 미만이면 근 제시가 불가능합니다.',
    ],
  },
  {
    title: '3단계: 근 제시 가능 상태',
    action: '3번이 "-5"를 좌변에 추가, 4번이 "3"을 우변에 추가',
    equation: '2x - 5 = -3 + 3',
    description: [
      '좌변과 우변이 모두 있고 전체 카드가 4장 이상이면 근 제시가 가능합니다.',
    ],
  },
  {
    title: '4단계: 근 후보 확인',
    description: [
      '근 제시하기를 선택하면 먼저 양수 또는 음수 중 하나를 고릅니다.',
      '선택한 부호에 따라 후보 3개가 무작위로 제시됩니다.',
      '실제 근이 후보 3개 안에 없을 수도 있습니다.',
    ],
    signOptions: ['양수 선택', '음수 선택'],
    selectedSignText: '양수를 선택했습니다.',
    rootOptions: ['x = 1', 'x = 2', 'x = 5'],
  },
  {
    title: '5단계: 근 제시 실패',
    action: '5번이 후보 중 x=2를 선택했습니다.',
    equation: '2x - 5 = -3 + 3',
    calculation: [
      '좌변: 2×2 - 5 = -1',
      '우변: -3 + 3 = 0',
    ],
    result: '근이 아니므로 정보를 1건 유실하고, 현재 식은 초기화됩니다.',
  },
  {
    title: '6단계: 근 제시 성공',
    action: '6번이 근으로 x = 1 선택',
    equation: 'x + 1 = 3 - x',
    calculation: [
      '좌변 2',
      '우변 2',
    ],
    result: '암호 키 입력 성공! 정보를 2건 획득합니다.',
  },
  {
    title: '7단계: 작전 회의',
    description: [
      '작전 회의에서는 최근 5개 행동을 보고 첩자로 의심되는 번호를 지목할 수 있습니다.',
      '첩자를 맞히면 해당 첩자는 이후 행동할 수 없습니다.',
    ],
    recentActions: [
      '2번: "-5"를 좌변에 추가',
      '3번: "2x"를 우변에 추가',
      '4번: 근으로 x = 4 선택',
      '5번: "-x"를 좌변에 추가',
      '6번: 14번을 첩자로 지목',
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
        <div className="help-story">
          {HELP_STORY.map((line) => (
            <p key={line}>{line}</p>
          ))}
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

function SimulationModal({ onClose }: { onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = SIMULATION_STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === SIMULATION_STEPS.length - 1;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="help-modal simulation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="simulation-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="help-modal-header">
          <div>
            <p className="eyebrow">설명용 시뮬레이션</p>
            <h2 id="simulation-modal-title">게임 흐름 미리 보기</h2>
          </div>
          <strong className="simulation-step-count">{stepIndex + 1} / {SIMULATION_STEPS.length}</strong>
        </div>

        <article className="simulation-card">
          <h3>{step.title}</h3>
          {step.equation && (
            <div className="simulation-equation">
              <span>예시 방정식</span>
              <strong>{step.equation}</strong>
            </div>
          )}
          {step.action && (
            <p className="simulation-line"><strong>예시 행동:</strong> {step.action}</p>
          )}
          {step.signOptions && (
            <div className="simulation-choice-demo">
              <strong>1) 부호 선택</strong>
              <div className="simulation-chip-row">
                {step.signOptions.map((option, index) => (
                  <span className={index === 0 ? 'simulation-chip simulation-chip-active' : 'simulation-chip'} key={option}>
                    {option}
                  </span>
                ))}
              </div>
              {step.selectedSignText && <p>{step.selectedSignText}</p>}
            </div>
          )}
          {step.rootOptions && (
            <div className="simulation-choice-demo">
              <strong>2) 무작위 후보 제시</strong>
              <div className="simulation-chip-row">
                {step.rootOptions.map((option) => (
                  <span className="simulation-chip" key={option}>{option}</span>
                ))}
              </div>
            </div>
          )}
          {step.calculation && (
            <div className="simulation-block">
              <strong>예시 계산</strong>
              {step.calculation.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          {step.recentActions && (
            <div className="simulation-block">
              <strong>예시 최근 행동</strong>
              <ol className="simulation-actions">
                {step.recentActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>
            </div>
          )}
          <div className="simulation-block">
            <strong>{step.result ? '결과' : '설명'}</strong>
            {step.description?.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {step.result && <p>{step.result}</p>}
          </div>
        </article>

        <div className="simulation-controls">
          <button type="button" disabled={isFirst} onClick={() => setStepIndex((current) => current - 1)}>
            이전
          </button>
          <button type="button" disabled={isLast} onClick={() => setStepIndex((current) => current + 1)}>
            다음
          </button>
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </div>
  );
}

function StartScreen({ onStart }: { onStart: (version: GameVersion) => void }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSimulationOpen, setIsSimulationOpen] = useState(false);

  return (
    <main className="page start-page">
      <div className="app-shell start-shell">
        <h1 className="start-title">
          <span className="start-title-kicker">프로젝트 B</span>
          <span className="start-title-main">방정식 암호 해독 작전</span>
        </h1>
        <div className="start-story">
          <p>비밀 암호문을 해독하기 위한 열쇠는 방정식의 근입니다.</p>
          <p>분석관은 근을 찾아 정보를 획득하고,</p>
          <p>첩자는 정체를 숨긴 채 암호 해독을 방해합니다.</p>
        </div>
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
          <button type="button" className="link-button" onClick={() => setIsSimulationOpen(true)}>시뮬레이션 보기</button>
          <a href="/teacher">교사용 화면</a>
          <a href="/display">HDMI 화면</a>
        </nav>
      </div>
      {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}
      {isSimulationOpen && <SimulationModal onClose={() => setIsSimulationOpen(false)} />}
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
  const recommendedLabel = state.version === 'grade1' ? '1학년 권장' : '3학년 권장';
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
              목표 정보
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
              첩자 수
              <input
                type="number"
                min="1"
                max="39"
                value={sabotageCount}
                onChange={(event) => setSabotageCount(event.target.value)}
              />
            </label>
          </div>
          <p className="muted">{recommendedLabel}: {recommended.playerCount}명, {recommended.rounds}바퀴, 첩자 {recommended.sabotageCount}명</p>
          {!isPlayerCountValid && <p className="setup-error">플레이어 수는 5명 이상 40명 이하로 입력하세요.</p>}
          {!isTargetScoreValid && <p className="setup-error">목표 정보는 1건 이상으로 입력하세요.</p>}
          {!isRoundsValid && <p className="setup-error">바퀴 수는 1 이상 5 이하로 입력하세요.</p>}
          {!isSabotageCountValid && <p className="setup-error">첩자 수는 1명 이상이며 플레이어 수보다 작아야 합니다.</p>}
          <div className="action-row">
            <a href="/" onClick={() => updateState(() => null)}>시작 화면</a>
            <button type="button" disabled={!isValid} onClick={goToConfirm}>첩자 배정 확인</button>
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
        <p className="eyebrow">교사용 첩자 확인</p>
        <h1>{VERSION_LABEL[state.version]}</h1>
        <section className="control-panel setup-card">
          <div className="setup-summary">
            <span>플레이어 수: {state.playerCount}명</span>
            <span>바퀴 수: {state.rounds}바퀴</span>
            <span>첩자 수: {state.sabotageCount}명</span>
            <span>목표 정보: {state.targetScore}건</span>
          </div>
          <p className="sabotage-preview">
            첩자 번호: {state.sabotages.map((player) => `${player}번`).join(', ')}
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

function ResultConfirmModal({ message, onConfirm }: { message: string; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop result-modal-backdrop" role="presentation">
      <section
        className="result-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-modal-title"
      >
        <p className="eyebrow">행동 결과</p>
        <h2 id="result-modal-title">결과 확인</h2>
        <div className="result-modal-message">
          {message.split('\n').map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <button type="button" className="result-confirm-button" onClick={onConfirm}>
          확인
        </button>
      </section>
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
    if (!state || state.phase === 'idle' || state.phase === 'result' || state.phase === 'ended' || !state.timerEnd || state.timerEnd > now) return;
    updateState((current) => {
      if (!current || current.phase === 'idle' || current.phase === 'result' || current.phase === 'ended' || !current.timerEnd || current.timerEnd > Date.now()) return current;
      if (current.activeAction === 'root') {
        const score = current.score - 1;
        const message = `${current.currentPlayer}번의 근 제시 시간이 초과되었습니다.\n정보를 1건 유실했습니다.\n현재 식은 초기화됩니다.`;
        const displayMessage = `${current.currentPlayer}번이 근 제시 시간을 초과해 정보를 1건 유실했습니다.`;
        const timedOutRoot = appendLog({ ...current, score }, {
          kind: 'timeout',
          note: '근 제시 시간 초과. 정보를 1건 유실했습니다.',
        });
        return waitForResultConfirm({
          ...timedOutRoot,
          left: [],
          right: [],
        }, message, displayMessage);
      }
      if (current.activeAction === 'deduction') {
        const message = `${current.currentPlayer}번의 작전 회의 시간이 초과되었습니다.\n아무 변화 없이 진행합니다.`;
        const displayMessage = `${current.currentPlayer}번의 작전 회의 시간이 초과되었습니다.`;
        const timedOutDeduction = appendLog(current, {
          kind: 'timeout',
          note: '작전 회의 시간 초과',
        });
        return waitForResultConfirm(timedOutDeduction, message, displayMessage);
      }
      const message = `${current.currentPlayer}번의 시간이 초과되었습니다.\n아무 행동 없이 턴을 종료합니다.`;
      const displayMessage = `${current.currentPlayer}번이 시간 초과로 행동하지 못했습니다.`;
      const timedOut = appendLog(current, {
        kind: 'timeout',
        candidates: current.candidates.map((card) => card.label),
        selectedCard: current.selectedCard?.label,
        note: '제한 시간 초과로 행동 없이 턴 종료',
      });
      return waitForResultConfirm(timedOut, message, displayMessage);
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
      const message = `${current.currentPlayer}번이 '${selected.label}'를 ${sideLabel(side)}에 추가했습니다.`;
      return waitForResultConfirm(logged, message, message);
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
      const message = success
        ? `${current.currentPlayer}번이 x = ${root}를 선택했습니다.\n암호 키 입력 성공!\n정보를 2건 획득했습니다.\n현재 식은 초기화됩니다.`
        : `${current.currentPlayer}번이 x = ${root}를 선택했습니다.\n잘못된 암호 키입니다.\n정보를 1건 유실했습니다.\n현재 식은 초기화됩니다.`;
      const displayMessage = success
        ? `${current.currentPlayer}번이 x = ${root}를 선택해 정보를 2건 획득했습니다.`
        : `${current.currentPlayer}번이 x = ${root}를 선택했지만 잘못된 암호 키입니다. 정보를 1건 유실했습니다.`;
      const reachedTarget = score >= current.targetScore;
      const victoryMessages = reachedTarget
        ? finalResultMessages({ ...logged, left: [], right: [], winner: 'players' }, 'players')
        : null;
      const finalMessage = reachedTarget
        ? victoryMessages!.teacher
        : message;
      const finalDisplayMessage = reachedTarget
        ? victoryMessages!.display
        : displayMessage;
      return waitForResultConfirm({
        ...logged,
        left: [],
        right: [],
        winner: reachedTarget ? 'players' : current.winner,
      }, finalMessage, finalDisplayMessage);
    });
  };

  const startDeduction = () => {
    updateState((current) => current && current.phase === 'idle' && canOpenDeduction(current)
      ? {
          ...current,
          phase: 'guessing',
          activeAction: 'deduction',
          timerEnd: Date.now() + 60_000,
          displayMode: 'deduction',
          lastDeductionTurn: currentTurnNumber(current),
          lastResult: undefined,
          lastDisplayResult: `${current.currentPlayer}번이 작전 회의를 열었습니다.`,
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
      const message = hit
        ? `${current.currentPlayer}번이 ${player}번을 첩자로 지목했습니다.\n첩자를 찾아냈습니다!\n${player}번은 이후 행동할 수 없습니다.`
        : `${current.currentPlayer}번이 ${player}번을 첩자로 지목했습니다.\n지목에 실패했습니다.\n아무 변화 없이 진행합니다.`;
      const displayMessage = hit
        ? `${current.currentPlayer}번이 ${player}번을 첩자로 지목해 찾아냈습니다.`
        : `${current.currentPlayer}번이 ${player}번을 첩자로 지목했지만 실패했습니다.`;
      return waitForResultConfirm(logged, message, displayMessage);
    });
  };

  const confirmResult = () => {
    updateState((current) => {
      if (!current || current.phase !== 'result' || !current.resultPrompt) return current;
      if (current.winner) return finishIfNeeded(current);
      return advanceTurn(current);
    });
  };

  const idle = state.phase === 'idle';
  const deductionReady = canOpenDeduction(state);
  const deductionStatus = deductionStatusLabel(state);
  const currentPlayerIsSabotage = state.sabotages.includes(state.currentPlayer);
  const fellowSabotages = state.sabotages.filter((player) => player !== state.currentPlayer);

  return (
    <main className="page dashboard-page">
      <div className="app-shell">
        <header className="screen-header">
          <div>
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
          <StatCard label="현재 획득한 정보" value={`${state.score}건`} />
          <StatCard label="목표 정보" value={`${state.targetScore}건`} />
          <StatCard label="남은 첩자 수" value={`${remainingSabotages(state)}명`} />
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
                <button type="button" onClick={startDeduction} disabled={!idle || !deductionReady}>작전 회의 열기</button>
              </div>
            )}
            {state.phase !== 'ended' && (
              <p className={deductionReady ? 'meeting-status meeting-status-ready' : 'meeting-status'}>
                {deductionStatus}
              </p>
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
                <h3>첩자로 의심되는 번호 선택</h3>
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
                <strong>역할: {currentPlayerIsSabotage ? '첩자' : '분석관'}</strong>
                {currentPlayerIsSabotage && (
                  <p>같은 편: {fellowSabotages.length > 0 ? fellowSabotages.map((player) => `${player}번`).join(', ') : '없음'}</p>
                )}
                <button type="button" onClick={() => setIsRoleOpen(false)}>확인 완료</button>
              </div>
            )}
            <p>검거된 첩자: {state.caughtSabotages.length > 0 ? state.caughtSabotages.map((player) => `${player}번`).join(', ') : '없음'}</p>
            {state.lastResult && <p className="last-result">{state.lastResult}</p>}
          </aside>
        </section>
      </div>
      {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}
      {state.resultPrompt && (
        <ResultConfirmModal message={state.resultPrompt.message} onConfirm={confirmResult} />
      )}
    </main>
  );
}

function LogList({ logs }: { logs: ActionLog[] }) {
  if (logs.length === 0) {
    return <p className="muted">아직 공유할 행동 기록이 없습니다.</p>;
  }

  return (
    <div className="log-list">
      {logs.map((log) => (
        <article className="log-item" key={log.id}>
          <strong>{log.player}번 · {log.note}</strong>
          <span>행동: {log.kind === 'card' ? '카드 추가하기' : log.kind === 'root' ? '근 제시하기' : log.kind === 'deduction' ? '작전 회의 열기' : '시간 초과'}</span>
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
    return `${log.player}번: 근으로 x = ${log.rootValue} 선택`;
  }
  if (log.kind === 'deduction' && log.guessedPlayer !== undefined) {
    return `${log.player}번: ${log.guessedPlayer}번을 첩자로 지목`;
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
    return <p className="display-log-empty">아직 공유할 행동 기록이 없습니다.</p>;
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
          <StatCard label="현재 획득한 정보" value={`${state.score}건`} />
          <StatCard label="목표 정보" value={`${state.targetScore}건`} />
          <StatCard label="남은 턴 수" value={`${remainingTurns(state)}턴`} />
          <StatCard label="현재 라운드" value={`${currentRound(state)} / ${state.rounds}`} />
          <StatCard label="현재 차례 번호" value={`${state.currentPlayer}번`} />
          <StatCard label="남은 첩자 수" value={`${remainingSabotages(state)}명`} accent />
        </div>
        <p className="display-meeting-status">{deductionStatusLabel(state)}</p>
        {state.phase !== 'ended' && !state.winner && (state.lastDisplayResult || state.lastResult) && (
          <div className="display-recent-result">
            {(state.lastDisplayResult || state.lastResult || '').split('\n').map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        {state.winner && (
          <div className="display-result">
            {(state.lastDisplayResult || state.lastResult || '').split('\n').map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        {state.displayMode === 'deduction' && (
          <section className="deduction-board">
            <p className="eyebrow">작전 회의</p>
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
