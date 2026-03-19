import { createInput } from './input'
import { createSimulation, PLAYER_SPEED } from './simulation'
import { createCamera } from './camera'
import { renderWorld } from './render'
import { renderHud } from './hud'
import { createNetwork } from './network'
import { getMatch, leaveMatch } from './lib/gameApi'
import type { RenderPlayer, Viewport } from './types'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) {
  throw new Error('Missing #game canvas element.')
}

const context = canvas.getContext('2d')
if (!context) {
  throw new Error('2D canvas context not available.')
}

const input = createInput(canvas)
const simulation = createSimulation()
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
const envWsBase = import.meta.env.VITE_WS_URL as string | undefined
const sessionId = localStorage.getItem('session_id') || ''
const fallbackWsBase = isLocal
  ? `ws://${window.location.hostname}:8787`
  : 'wss://lobby.amuk.io'
const matchId = window.location.pathname.startsWith('/match/')
  ? window.location.pathname.replace('/match/', '')
  : ''
const base = envWsBase || fallbackWsBase
const wsBase = base.replace(/\/$/, '')
const wsUrl = wsBase.includes('{matchId}')
  ? wsBase.replace('{matchId}', matchId)
  : `${wsBase}/ws?matchId=${encodeURIComponent(matchId)}${
      sessionId ? `&session=${encodeURIComponent(sessionId)}` : ''
    }`
const network = createNetwork(wsUrl)

const pauseButton = document.querySelector<HTMLButtonElement>('[data-pause]')
if (pauseButton) {
  pauseButton.addEventListener('click', () => {
    input.pauseRequested = true
  })
}
const leaveButton = document.querySelector<HTMLButtonElement>(
  '[data-leave-match]'
)
let exitHandled = false
const redirectAfterExit = async () => {
  if (exitHandled || !matchId) {
    return
  }
  exitHandled = true
  try {
    const match = await getMatch(matchId)
    if (match.status === 'complete') {
      window.location.href = `/results/${matchId}`
      return
    }
  } catch {
    // ignore
  }
  window.location.href = '/play'
}
if (leaveButton && matchId) {
  leaveButton.addEventListener('click', () => {
    void leaveMatch(matchId).finally(() => {
      void redirectAfterExit()
    })
  })
}

const viewport: Viewport = {
  width: 0,
  height: 0,
  dpr: 1,
}

const resizeCanvas = () => {
  const visualViewport = window.visualViewport
  viewport.width = visualViewport?.width ?? window.innerWidth
  viewport.height = visualViewport?.height ?? window.innerHeight
  viewport.dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(viewport.width * viewport.dpr)
  canvas.height = Math.floor(viewport.height * viewport.dpr)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
}

window.addEventListener('resize', resizeCanvas)
window.visualViewport?.addEventListener('resize', resizeCanvas)
resizeCanvas()

const STEP_MS = 1000 / 30
const SMOOTH_POS = 0.18
const SMOOTH_ANG = 0.22
const CORRECTION_BLEND = 0.12
const MAX_SNAP_DIST = 400
const BUFFER_SIZE = 512
const MAX_ACCUM_MS = 250
const RENDER_DELAY_TICKS = 2
let currentAngle = 0
let lastSnapshotTime = 0
let nextSeq = 0
let correction = { x: 0, y: 0 }
let eventFeed: Array<{ text: string; createdAtMs: number }> = []
// (elimination events now come from server broadcasts)
let wasConnected = false
let roundOverlay:
  | {
      payload: {
        roundId: number
        winners: Array<{
          id: string
          handle?: string
          rank: number
          matchGemPoints: number
        }>
        leaderboard: Array<{ id: string; handle?: string; matchGemPoints: number }>
      }
      expiresAtMs: number
    }
  | null = null
let lastFrameTime = performance.now()
const frameTimes: number[] = []
let accumulatorMs = 0

type BufferedState = {
  seq: number
  x: number
  y: number
  angle: number
}

type BufferedInput = {
  seq: number
  angle: number
  moving: boolean
}

const stateBuffer: BufferedState[] = Array.from({ length: BUFFER_SIZE }, () => ({
  seq: -1,
  x: 0,
  y: 0,
  angle: 0,
}))

const inputBuffer: BufferedInput[] = Array.from({ length: BUFFER_SIZE }, () => ({
  seq: -1,
  angle: 0,
  moving: false,
}))

const stepLocalPlayer = (angle: number, moving: boolean, dtSec: number) => {
  if (simulation.eliminated) {
    return
  }
  simulation.player.heading = angle
  if (moving) {
    simulation.player.position.x += Math.cos(angle) * PLAYER_SPEED * dtSec
    simulation.player.position.y += Math.sin(angle) * PLAYER_SPEED * dtSec
  }
}

const simulateStep = (state: BufferedState, angle: number, moving: boolean, dtSec: number) => ({
  seq: state.seq + 1,
  x: moving ? state.x + Math.cos(angle) * PLAYER_SPEED * dtSec : state.x,
  y: moving ? state.y + Math.sin(angle) * PLAYER_SPEED * dtSec : state.y,
  angle,
})

const storeState = (seq: number, x: number, y: number, angle: number) => {
  const idx = seq % BUFFER_SIZE
  stateBuffer[idx] = { seq, x, y, angle }
}

const getState = (seq: number) => {
  const entry = stateBuffer[seq % BUFFER_SIZE]
  if (entry.seq !== seq) {
    return null
  }
  return entry
}

const storeInput = (seq: number, angle: number, moving: boolean) => {
  const idx = seq % BUFFER_SIZE
  inputBuffer[idx] = { seq, angle, moving }
}

const getInput = (seq: number) => {
  const entry = inputBuffer[seq % BUFFER_SIZE]
  if (entry.seq !== seq) {
    return null
  }
  return entry
}

storeState(0, simulation.player.position.x, simulation.player.position.y, 0)
storeInput(0, 0, false)

const sampleAngle = () => {
  if (input.hasMouse) {
    const dx = input.mouseX - viewport.width / 2
    const dy = input.mouseY - viewport.height / 2
    if (Math.abs(dx) + Math.abs(dy) > 0.001) {
      return Math.atan2(dy, dx)
    }
  }
  return currentAngle
}

const sendInput = (nowClient: number, angle: number, moving: boolean, seq: number) => {
  if (!network.state.connected) {
    return
  }
  network.sendInput(angle, moving, seq, nowClient)
}

const reconcileSnapshot = () => {
  const snapshot = network.state.latestSnapshot
  if (!snapshot || snapshot.serverTimeMs === lastSnapshotTime) {
    return false
  }
  lastSnapshotTime = snapshot.serverTimeMs

  const localId = network.state.clientId
  if (!localId) {
    return false
  }

  const localPlayer = snapshot.players.find((player) => player.id === localId)
  if (!localPlayer) {
    return false
  }

  if (localPlayer.eliminated && !simulation.eliminated) {
    simulation.eliminatedCount += 1
  }

  simulation.eliminated = localPlayer.eliminated
  if (simulation.eliminated) {
    correction.x = 0
    correction.y = 0
    return true
  }

  const ackSeq = localPlayer.lastSeq
  if (typeof ackSeq !== 'number') {
    return true
  }

  const predictedAtAck = getState(ackSeq)
  if (!predictedAtAck) {
    simulation.player.position.x = localPlayer.x
    simulation.player.position.y = localPlayer.y
    simulation.player.heading = localPlayer.angle
    currentAngle = localPlayer.angle
    storeState(ackSeq, localPlayer.x, localPlayer.y, localPlayer.angle)
    if (ackSeq > nextSeq) {
      nextSeq = ackSeq
    }
    return true
  }

  const dx = localPlayer.x - predictedAtAck.x
  const dy = localPlayer.y - predictedAtAck.y
  const dist = Math.hypot(dx, dy)
  if (dist > MAX_SNAP_DIST) {
    simulation.player.position.x = localPlayer.x
    simulation.player.position.y = localPlayer.y
    simulation.player.heading = localPlayer.angle
    currentAngle = localPlayer.angle
    correction.x = 0
    correction.y = 0
    storeState(ackSeq, localPlayer.x, localPlayer.y, localPlayer.angle)
    return true
  }

  if (dist > 0.01) {
    correction.x += dx
    correction.y += dy
  }

  storeState(ackSeq, localPlayer.x, localPlayer.y, localPlayer.angle)
  let base = getState(ackSeq)
  if (!base) {
    return true
  }

  for (let seq = ackSeq + 1; seq <= nextSeq; seq += 1) {
    const inp = getInput(seq)
    const angle = inp ? inp.angle : base.angle
    const moving = inp ? inp.moving : false
    const updated = simulateStep(base, angle, moving, STEP_MS / 1000)
    storeState(seq, updated.x, updated.y, updated.angle)
    base = updated
  }

  const latest = getState(nextSeq)
  if (latest) {
    simulation.player.position.x = latest.x
    simulation.player.position.y = latest.y
    simulation.player.heading = latest.angle
    currentAngle = latest.angle
  }
  return true
}

const tick = (_time: number) => {
  const nowClient = performance.now()
  const roundState = network.state.round?.state ?? 'running'
  const localPaused =
    network.state.latestSnapshot?.players.find(
      (player) => player.id === network.state.clientId
    )?.paused ?? false

  if (network.state.connected) {
    wasConnected = true
  } else if (wasConnected && !exitHandled) {
    void redirectAfterExit()
  }

  if (leaveButton) {
    leaveButton.hidden = !simulation.eliminated
  }

  const frameMs = Math.max(0, nowClient - lastFrameTime)
  lastFrameTime = nowClient
  frameTimes.push(frameMs)
  if (frameTimes.length > 60) {
    frameTimes.shift()
  }
  const avgFrameMs =
    frameTimes.reduce((total, value) => total + value, 0) / frameTimes.length

  const snapshotApplied = reconcileSnapshot()
  accumulatorMs = Math.min(accumulatorMs + frameMs, MAX_ACCUM_MS)

  if (!simulation.eliminated && roundState === 'running') {
    if (input.resetRequested) {
      network.sendReset(nowClient)
      input.resetRequested = false
    }
    if (input.pauseRequested) {
      network.sendPause()
      input.pauseRequested = false
    }
    if (!localPaused) {
      while (accumulatorMs >= STEP_MS) {
        const angle = sampleAngle()
        const moving = input.moving
        currentAngle = angle
        nextSeq += 1
        storeInput(nextSeq, angle, moving)
        stepLocalPlayer(angle, moving, STEP_MS / 1000)
        storeState(
          nextSeq,
          simulation.player.position.x,
          simulation.player.position.y,
          simulation.player.heading
        )
        sendInput(nowClient, angle, moving, nextSeq)
        accumulatorMs -= STEP_MS
      }
    } else {
      accumulatorMs = 0
    }
  } else {
    accumulatorMs = 0
  }
  if (roundState !== 'running' && !snapshotApplied) {
    reconcileSnapshot()
  }

  if (!simulation.eliminated) {
    correction.x *= 1 - CORRECTION_BLEND
    correction.y *= 1 - CORRECTION_BLEND
  }

  const alpha = Math.max(0, Math.min(1, accumulatorMs / STEP_MS))
  let renderX = simulation.player.position.x
  let renderY = simulation.player.position.y
  let renderAngle = simulation.player.heading
  if (!simulation.eliminated) {
    const renderSeq = Math.max(0, nextSeq - RENDER_DELAY_TICKS)
    const a = getState(renderSeq)
    const b = getState(renderSeq + 1)
    if (a && b) {
      renderX = a.x + (b.x - a.x) * alpha
      renderY = a.y + (b.y - a.y) * alpha
      renderAngle = lerpAngle(a.angle, b.angle, alpha)
    }
    renderX += correction.x * CORRECTION_BLEND
    renderY += correction.y * CORRECTION_BLEND
  }

  const events = network.drainEvents()
  events.forEach((event) => {
    if (event.kind === 'gem_pickup') {
      const tierLabel =
        event.tier === 'rare' ? 'Rare' : event.tier === 'uncommon' ? 'Uncommon' : 'Common'
      eventFeed.unshift({
        text: `${eventName(event)} picked ${tierLabel} +${event.valuePoints}`,
        createdAtMs: performance.now(),
      })
    } else if (event.kind === 'elimination') {
      const isYou = event.playerId === network.state.clientId
      eventFeed.unshift({
        text: isYou ? 'You were eliminated!' : `${eventName(event)} eliminated`,
        createdAtMs: performance.now(),
      })
    }
  })
  eventFeed = eventFeed.slice(0, 6)

  const roundEnds = network.drainRoundEnds()
  if (roundEnds.length > 0) {
    const latest = roundEnds[roundEnds.length - 1]
    roundOverlay = {
      payload: {
        roundId: latest.roundId,
        winners: latest.winners,
        leaderboard: latest.leaderboard,
      },
      expiresAtMs: performance.now() + 3000,
    }
    eventFeed.unshift({
      text: 'Round ended - Top 3 paid',
      createdAtMs: performance.now(),
    })
  }
  if (roundOverlay && performance.now() >= roundOverlay.expiresAtMs) {
    roundOverlay = null
  }

  const remotePlayers = network.getRemotePlayers(SMOOTH_POS, SMOOTH_ANG)
  const players: RenderPlayer[] = [
    {
      id: network.state.clientId || 'local',
      position: { x: renderX, y: renderY },
      heading: renderAngle,
      eliminated: simulation.eliminated,
      isLocal: true,
    },
    ...remotePlayers,
  ]

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)

  context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
  const previousPosition = { ...simulation.player.position }
  const previousHeading = simulation.player.heading
  simulation.player.position.x = renderX
  simulation.player.position.y = renderY
  simulation.player.heading = renderAngle
  if (network.state.round?.currentInradius) {
    simulation.world.inradius = network.state.round.currentInradius
    simulation.world.cornerRadius = simulation.world.inradius / Math.cos(Math.PI / 8)
  }
  const camera = createCamera(simulation.player.position, viewport)
  renderWorld(
    context,
    simulation,
    camera,
    viewport,
    players,
    network.state.gems,
    nowClient
  )
  simulation.player.position.x = previousPosition.x
  simulation.player.position.y = previousPosition.y
  simulation.player.heading = previousHeading

  const gemCounts = getGemCounts(network.state.gems)
  const leaderboard = getLiveLeaders(network.state.latestSnapshot?.players ?? [])

  renderHud(context, simulation, viewport, localPaused, {
    pingMs: network.state.pingMs,
    playerCount: network.state.playerCount,
    clientId: network.state.clientId || 'connecting',
    snapshotRate: network.state.snapshotRate,
    avgFrameMs,
    smoothPos: SMOOTH_POS,
    smoothAng: SMOOTH_ANG,
    matchGemPoints: network.state.matchGemPoints,
    round: network.state.round,
    showPrizeDebug: input.showPrizeDebug,
    gemTotal: gemCounts.total,
    gemCommon: gemCounts.common,
    gemUncommon: gemCounts.uncommon,
    gemRare: gemCounts.rare,
    aliveCount: (network.state.latestSnapshot?.players ?? []).filter(
      (p) => !p.eliminated
    ).length,
    leaderboard,
  })

  drawEventFeed(context, eventFeed)
  if (roundOverlay) {
    drawRoundOverlay(context, viewport, roundOverlay.payload, network.state.clientId)
  }

  window.requestAnimationFrame(tick)
}

window.requestAnimationFrame(tick)

const drawEventFeed = (
  ctx: CanvasRenderingContext2D,
  events: Array<{ text: string; createdAtMs: number }>
) => {
  if (events.length === 0) {
    return
  }
  const now = performance.now()
  const lineHeight = 18
  ctx.save()
  ctx.font = '12px "Consolas", "Courier New", monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  events.forEach((event, index) => {
    const age = now - event.createdAtMs
    if (age >= 6000) {
      return
    }
    const alpha = Math.max(0, 1 - age / 6000)
    ctx.fillStyle = `rgba(130, 255, 200, ${alpha.toFixed(3)})`
    ctx.fillText(event.text, 20, 110 + index * lineHeight)
  })
  ctx.restore()
}

const drawRoundOverlay = (
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  payload: {
    roundId: number
    winners: Array<{
      id: string
      handle?: string
      rank: number
      matchGemPoints: number
    }>
    leaderboard: Array<{ id: string; handle?: string; matchGemPoints: number }>
  },
  clientId: string
) => {
  const width = viewport.width
  const height = viewport.height
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(120, 255, 248, 0.95)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 42px "Consolas", "Courier New", monospace'
  ctx.fillText('ROUND OVER', width / 2, height / 2 - 120)
  ctx.font = '16px "Consolas", "Courier New", monospace'
  ctx.fillText('Top 3 finishers', width / 2, height / 2 - 88)

  ctx.font = '14px "Consolas", "Courier New", monospace'
  ctx.textAlign = 'left'
  const startY = height / 2 - 40
  payload.winners.slice(0, 3).forEach((entry, index) => {
    const y = startY + index * 18
    const name = entry.id === clientId ? 'You' : entry.handle || shortId(entry.id)
    ctx.fillText(
      `#${entry.rank} ${name}  ${entry.matchGemPoints} tokens`,
      width / 2 - 160,
      y
    )
  })

  const yourIndex = payload.leaderboard.findIndex((entry) => entry.id === clientId)
  if (yourIndex >= 0) {
    const you = payload.leaderboard[yourIndex]
    const youName = 'You'
    ctx.fillText(
      `#${yourIndex + 1} ${youName}  ${you.matchGemPoints} tokens`,
      width / 2 - 160,
      startY + 72
    )
  }
  ctx.restore()
}

const getGemCounts = (gems: Array<{ tier: string }>) => {
  let common = 0
  let uncommon = 0
  let rare = 0
  gems.forEach((gem) => {
    if (gem.tier === 'rare') {
      rare += 1
    } else if (gem.tier === 'uncommon') {
      uncommon += 1
    } else {
      common += 1
    }
  })
  return {
    total: gems.length,
    common,
    uncommon,
    rare,
  }
}

const getLiveLeaders = (
  players: Array<{ id: string; handle?: string; matchGemPoints?: number }>
) => {
  return [...players]
    .map((player) => ({
      id: player.id,
      handle: player.handle,
      matchGemPoints: player.matchGemPoints ?? 0,
    }))
    .sort((a, b) => b.matchGemPoints - a.matchGemPoints)
    .slice(0, 3)
}

const shortId = (id: string) => (id.length > 4 ? id.slice(0, 4) : id)

const eventName = (event: { playerId: string; playerHandle?: string }) =>
  event.playerHandle || `P${shortId(event.playerId)}`

const lerpAngle = (a: number, b: number, t: number) => {
  const tau = Math.PI * 2
  const diff = ((b - a + Math.PI * 3) % tau) - Math.PI
  return a + diff * t
}
