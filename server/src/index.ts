import { WebSocketServer, type WebSocket } from 'ws'
import { randomUUID } from 'crypto'

type PlayerState = {
  id: string
  x: number
  y: number
  headingAngle: number
  speed: number
  state: 'alive' | 'dead' | 'extracted'
  stateUntilMs?: number
  exitHoldMs: number
  holdingExit: boolean
  matchGemPoints: number
  matchGemPickupsCount: number
  rareGemsCount: number
  lastScoreChangeMs?: number
  lastSeq: number
}

type InputMessage = {
  type: 'input'
  angle: number
  seq: number
  t: number
}

type ExitHoldMessage = {
  type: 'exitHold'
  holding: boolean
  seq: number
  t: number
}

type ResetMessage = {
  type: 'reset'
  t: number
}
const PORT = 8080
const TICK_RATE = 30
const SNAPSHOT_RATE = 15
const WORLD_INRADIUS = 2500
const PLAYER_SPEED = 220
const PLAYER_RADIUS = 18
const EXIT_R = 120
const RESPAWN_MS = 2000
const ROUND_END_RESET_MS = 3000
const ROUND_MS = 120000
const ACTIVE_GEMS = 18
const GEM_RESPAWN_MIN_MS = 800
const GEM_RESPAWN_MAX_MS = 1800
const GEM_RADIUS_COMMON = 6
const GEM_RADIUS_UNCOMMON = 8
const GEM_RADIUS_RARE = 11
const TOTAL_PAYOUT_CENTS = 1000

const players = new Map<WebSocket, PlayerState>()
let serverTimeMs = 0
let tick = 0
const dtMs = 1000 / TICK_RATE
const snapshotEveryTicks = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE))

type Gem = {
  id: string
  tier: 'common' | 'uncommon' | 'rare'
  valuePoints: number
  x: number
  y: number
  radius: number
  despawnAtMs?: number
}

const gems: Gem[] = []

type PendingGemSpawn = {
  spawnAtMs: number
}

const pendingGemSpawns: PendingGemSpawn[] = []

let roundId = 1
let roundState: 'running' | 'ending' | 'resetting' = 'running'
let roundStartMs = 0
let roundEndAtMs = 0
let roundResetAtMs = 0

const wss = new WebSocketServer({ port: PORT })
console.log(`[server] ws listening on :${PORT}`)

wss.on('connection', (socket) => {
  const id = randomUUID()
  const player: PlayerState = {
    id,
    x: 0,
    y: 0,
    headingAngle: 0,
    speed: PLAYER_SPEED,
    state: 'alive',
    exitHoldMs: 0,
    holdingExit: false,
    matchGemPoints: 0,
    matchGemPickupsCount: 0,
    rareGemsCount: 0,
    lastSeq: 0,
  }
  players.set(socket, player)

  socket.send(
    JSON.stringify({
      type: 'welcome',
      id,
      serverTimeMs,
      tick,
    })
  )

  socket.on('message', (data) => {
    let message: InputMessage | ExitHoldMessage | ResetMessage | null = null
    try {
      message = JSON.parse(data.toString()) as
        | InputMessage
        | ExitHoldMessage
        | ResetMessage
    } catch {
      return
    }

    if (!message) {
      return
    }

    const current = players.get(socket)
    if (!current) {
      return
    }

    if (message.type === 'input') {
      current.headingAngle = message.angle
      current.lastSeq = message.seq
      return
    }

    if (message.type === 'exitHold') {
      current.holdingExit = message.holding
    }

    if (message.type === 'reset') {
      resetPlayer(current)
    }
  })

  socket.on('close', () => {
    players.delete(socket)
  })
})

const tickInterval = Math.round(1000 / TICK_RATE)
setInterval(() => {
  serverTimeMs += dtMs
  tick += 1
  const dt = 1 / TICK_RATE

  if (roundState === 'running') {
    ensureGemCount()
    updatePendingGemSpawns()
  }

  for (const player of players.values()) {
    if (player.state !== 'alive') {
      if (player.stateUntilMs && player.stateUntilMs <= serverTimeMs) {
        respawnPlayer(player)
      }
      continue
    }

    player.x += Math.cos(player.headingAngle) * player.speed * dt
    player.y += Math.sin(player.headingAngle) * player.speed * dt

    if (!isInsideOctagon(player.x, player.y, WORLD_INRADIUS)) {
      eliminatePlayer(player, serverTimeMs)
    }
  }

  if (roundState === 'running') {
    handleGemPickups()
  }

  updateRoundState()

  if (tick % snapshotEveryTicks !== 0) {
    return
  }

  const snapshot = {
    type: 'snapshot',
    serverTimeMs,
    tick,
    players: Array.from(players.values()).map((player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      angle: player.headingAngle,
      eliminated: player.state === 'dead',
      extracted: player.state === 'extracted',
      matchGemPoints: player.matchGemPoints,
      rareGemsCount: player.rareGemsCount,
      lastSeq: player.lastSeq,
    })),
    round: {
      roundId,
      state: roundState,
      roundStartMs,
      elapsedMs: Math.max(0, serverTimeMs - roundStartMs),
      roundEndAtMs,
    },
    gems: gems.map((gem) => ({
      id: gem.id,
      tier: gem.tier,
      valuePoints: gem.valuePoints,
      x: gem.x,
      y: gem.y,
      radius: gem.radius,
    })),
  }

  const payload = JSON.stringify(snapshot)
  for (const socket of players.keys()) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload)
    }
  }
}, tickInterval)

const isInsideOctagon = (x: number, y: number, inradius: number) => {
  const absX = Math.abs(x)
  const absY = Math.abs(y)
  if (absX > inradius || absY > inradius) {
    return false
  }
  return absX + absY <= inradius * Math.SQRT2
}

const isInsideExit = (x: number, y: number, radius: number) =>
  x * x + y * y <= radius * radius

const respawnPlayer = (player: PlayerState) => {
  player.x = 0
  player.y = 0
  player.headingAngle = 0
  player.state = 'alive'
  player.stateUntilMs = undefined
  player.exitHoldMs = 0
  player.holdingExit = false
}

const eliminatePlayer = (player: PlayerState, now: number) => {
  player.state = 'dead'
  player.stateUntilMs = now + 1000
  player.exitHoldMs = 0
  player.holdingExit = false
}

const resetPlayer = (player: PlayerState) => {
  player.x = 0
  player.y = 0
  player.headingAngle = 0
  player.state = 'alive'
  player.stateUntilMs = undefined
  player.exitHoldMs = 0
  player.holdingExit = false
  player.matchGemPoints = 0
  player.matchGemPickupsCount = 0
  player.rareGemsCount = 0
  player.lastScoreChangeMs = undefined
}

const broadcastEvent = (event: {
  type: 'event'
  kind: 'gem_pickup'
  playerId: string
  valuePoints: number
  tier: 'common' | 'uncommon' | 'rare'
  serverNowMs?: number
}) => {
  const payload = JSON.stringify(event)
  for (const socket of players.keys()) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload)
    }
  }
}

const broadcastRoundEnd = (payload: {
  type: 'round_end'
  roundId: number
  winners: Array<{
    id: string
    rank: number
    matchGemPoints: number
    prizeCents: number
  }>
  endedAtMs: number
  leaderboard: Array<{ id: string; matchGemPoints: number }>
}) => {
  const message = JSON.stringify(payload)
  for (const socket of players.keys()) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message)
    }
  }
}

const handleGemPickups = () => {
  if (gems.length === 0) {
    return
  }

  for (const player of players.values()) {
    if (player.state !== 'alive') {
      continue
    }
    for (let i = gems.length - 1; i >= 0; i -= 1) {
      const gem = gems[i]
      if (!gem) {
        continue
      }
      const dx = gem.x - player.x
      const dy = gem.y - player.y
      const radius = PLAYER_RADIUS + gem.radius
      if (dx * dx + dy * dy > radius * radius) {
        continue
      }

      gems.splice(i, 1)
      player.matchGemPoints += gem.valuePoints
      player.matchGemPickupsCount += 1
      if (gem.tier === 'rare') {
        player.rareGemsCount += 1
      }
      player.lastScoreChangeMs = serverTimeMs

      broadcastEvent({
        type: 'event',
        kind: 'gem_pickup',
        playerId: player.id,
        valuePoints: gem.valuePoints,
        tier: gem.tier,
        serverNowMs: serverTimeMs,
      })

      pendingGemSpawns.push({
        spawnAtMs:
          serverTimeMs + randomRange(GEM_RESPAWN_MIN_MS, GEM_RESPAWN_MAX_MS),
      })
    }
  }
}

const updatePendingGemSpawns = () => {
  for (let i = pendingGemSpawns.length - 1; i >= 0; i -= 1) {
    const pending = pendingGemSpawns[i]
    if (!pending) {
      continue
    }
    if (pending.spawnAtMs <= serverTimeMs) {
      pendingGemSpawns.splice(i, 1)
      spawnGem()
    }
  }
}

const ensureGemCount = () => {
  const needed = ACTIVE_GEMS - (gems.length + pendingGemSpawns.length)
  for (let i = 0; i < needed; i += 1) {
    spawnGem()
  }
}

const updateRoundState = () => {
  if (roundState === 'running') {
    if (roundStartMs === 0) {
      roundStartMs = serverTimeMs
    }
    roundEndAtMs = roundStartMs + ROUND_MS
    const elapsedMs = serverTimeMs - roundStartMs
    if (elapsedMs >= ROUND_MS) {
      endRound()
    }
    return
  }

  if (roundState === 'ending' && serverTimeMs >= roundResetAtMs) {
    resetRound()
  }
}

const endRound = () => {
  roundState = 'ending'
  roundResetAtMs = serverTimeMs + ROUND_END_RESET_MS

  const sorted = Array.from(players.values()).sort((a, b) => {
    if (b.matchGemPoints !== a.matchGemPoints) {
      return b.matchGemPoints - a.matchGemPoints
    }
    if (b.rareGemsCount !== a.rareGemsCount) {
      return b.rareGemsCount - a.rareGemsCount
    }
    const aTime = a.lastScoreChangeMs ?? Number.POSITIVE_INFINITY
    const bTime = b.lastScoreChangeMs ?? Number.POSITIVE_INFINITY
    return aTime - bTime
  })

  const prizes = [
    Math.round(TOTAL_PAYOUT_CENTS * 0.5),
    Math.round(TOTAL_PAYOUT_CENTS * 0.3),
    Math.round(TOTAL_PAYOUT_CENTS * 0.1),
  ]

  const winners = sorted.slice(0, 3).map((player, index) => ({
    id: player.id,
    rank: index + 1,
    matchGemPoints: player.matchGemPoints,
    prizeCents: prizes[index] ?? 0,
  }))

  const leaderboard = sorted.map((player) => ({
    id: player.id,
    matchGemPoints: player.matchGemPoints,
  }))

  broadcastRoundEnd({
    type: 'round_end',
    roundId,
    endedAtMs: serverTimeMs,
    winners,
    leaderboard,
  })
}

const resetRound = () => {
  roundState = 'resetting'
  gems.length = 0
  pendingGemSpawns.length = 0

  for (const player of players.values()) {
    player.x = 0
    player.y = 0
    player.headingAngle = 0
    player.state = 'alive'
    player.stateUntilMs = undefined
    player.exitHoldMs = 0
    player.holdingExit = false
    player.matchGemPoints = 0
    player.matchGemPickupsCount = 0
    player.rareGemsCount = 0
    player.lastScoreChangeMs = undefined
  }

  roundId += 1
  roundStartMs = serverTimeMs
  roundEndAtMs = roundStartMs + ROUND_MS
  roundState = 'running'
  ensureGemCount()
}

const spawnGem = () => {
  const roll = Math.random()
  let tier: Gem['tier'] = 'common'
  let valuePoints = 1
  let radius = GEM_RADIUS_COMMON
  if (roll < 0.03) {
    tier = 'rare'
    valuePoints = 10
    radius = GEM_RADIUS_RARE
  } else if (roll < 0.2) {
    tier = 'uncommon'
    valuePoints = 3
    radius = GEM_RADIUS_UNCOMMON
  }
  const { x, y } = randomPointInOctagon(WORLD_INRADIUS)
  gems.push({
    id: randomUUID(),
    tier,
    valuePoints,
    x,
    y,
    radius,
  })
}

const randomRange = (min: number, max: number) =>
  Math.round(min + Math.random() * (max - min))

const randomPointInOctagon = (inradius: number) => {
  for (;;) {
    const x = (Math.random() * 2 - 1) * inradius
    const y = (Math.random() * 2 - 1) * inradius
    if (isInsideOctagon(x, y, inradius)) {
      return { x, y }
    }
  }
}
