import type { Gem, RenderPlayer, RoundEndPayload, RoundInfo } from './types'

type WelcomeMessage = {
  type: 'welcome'
  id: string
  serverTimeMs: number
  tick: number
}

type SnapshotPlayer = {
  id: string
  handle?: string
  x: number
  y: number
  angle: number
  eliminated: boolean
  paused?: boolean
  matchGemPoints?: number
  rareGemsCount?: number
  lastSeq?: number
}

export type SnapshotMessage = {
  type: 'snapshot'
  serverTimeMs: number
  tick: number
  players: SnapshotPlayer[]
  gems: Gem[]
  round: RoundInfo
}

type InputMessage = {
  type: 'input'
  angle: number
  moving: boolean
  seq: number
  t: number
}

type ResetMessage = {
  type: 'reset'
  t: number
}

type PauseMessage = {
  type: 'pause'
}

type EventMessage = {
  type: 'event'
  kind: string
  playerId: string
  playerHandle?: string
  valuePoints?: number
  tier?: 'common' | 'uncommon' | 'rare'
  serverNowMs?: number
}

type RoundEndMessage = {
  type: 'round_end'
  roundId: number
  endedAtMs: number
  winners: Array<{
    id: string
    handle?: string
    rank: number
    matchGemPoints: number
  }>
  leaderboard: Array<{
    id: string
    handle?: string
    matchGemPoints: number
  }>
}

type RemoteState = {
  id: string
  targetX: number
  targetY: number
  targetAngle: number
  renderX: number
  renderY: number
  renderAngle: number
  eliminated: boolean
}

export type NetworkState = {
  clientId: string
  connected: boolean
  pingMs: number
  playerCount: number
  latestSnapshot: SnapshotMessage | null
  snapshotRate: number
  gems: Gem[]
  matchGemPoints: number
  rareGemsCount: number
  round: RoundInfo | null
}

export type NetworkClient = {
  state: NetworkState
  sendInput: (angle: number, moving: boolean, seq: number, clientTime: number) => void
  sendReset: (clientTime: number) => void
  sendPause: () => void
  getServerTime: () => number
  getRemotePlayers: (smoothPos: number, smoothAng: number) => RenderPlayer[]
  drainEvents: () => EventMessage[]
  drainRoundEnds: () => RoundEndPayload[]
}

export const createNetwork = (url: string): NetworkClient => {
  const socket = new WebSocket(url)
  const remotes = new Map<string, RemoteState>()
  const nanLogged = new Set<string>()
  const events: EventMessage[] = []
  const roundEnds: RoundEndPayload[] = []
  let lastSnapshotClientTime = performance.now()
  let lastServerTimeMs = 0
  let offsetEstimate = 0
  let offsetInitialized = false
  let rateWindowStart = performance.now()
  let rateCount = 0
  let pingIntervalId: number | null = null

  const state: NetworkState = {
    clientId: '',
    connected: false,
    pingMs: 0,
    playerCount: 0,
    latestSnapshot: null,
    snapshotRate: 0,
    gems: [],
    matchGemPoints: 0,
    rareGemsCount: 0,
    round: null,
  }

  socket.addEventListener('message', (event) => {
    let message:
      | WelcomeMessage
      | SnapshotMessage
      | EventMessage
      | RoundEndMessage
      | { type: 'pong'; t: number }
      | null = null
    try {
      message = JSON.parse(event.data as string) as
        | WelcomeMessage
        | SnapshotMessage
        | EventMessage
        | RoundEndMessage
        | { type: 'pong'; t: number }
    } catch {
      return
    }

    if (!message) {
      return
    }

    if (message.type === 'pong') {
      const rtt = performance.now() - message.t
      state.pingMs = Math.round(rtt)
      return
    }

    if (message.type === 'welcome') {
      state.clientId = message.id
      state.connected = true
      return
    }

    if (message.type === 'snapshot') {
      const clientNow = performance.now()
      lastSnapshotClientTime = clientNow
      lastServerTimeMs = message.serverTimeMs
      const measuredOffset = message.serverTimeMs - clientNow
      if (!offsetInitialized) {
        offsetEstimate = measuredOffset
        offsetInitialized = true
      } else {
        offsetEstimate += (measuredOffset - offsetEstimate) * 0.1
      }
      state.latestSnapshot = message
      state.playerCount = message.players.length
      state.gems = message.gems
      state.round = message.round

      const seen = new Set<string>()
      message.players.forEach((player) => {
        if (player.id === state.clientId) {
          state.matchGemPoints = player.matchGemPoints ?? 0
          state.rareGemsCount = player.rareGemsCount ?? 0
          return
        }

        seen.add(player.id)
        const existing = remotes.get(player.id)
        if (!existing) {
          remotes.set(player.id, {
            id: player.id,
            targetX: player.x,
            targetY: player.y,
            targetAngle: player.angle,
            renderX: player.x,
            renderY: player.y,
            renderAngle: player.angle,
            eliminated: player.eliminated,
          })
          return
        }

        existing.targetX = player.x
        existing.targetY = player.y
        existing.targetAngle = player.angle
        existing.eliminated = player.eliminated
      })

      for (const id of remotes.keys()) {
        if (!seen.has(id)) {
          remotes.delete(id)
        }
      }

      rateCount += 1
      const elapsed = clientNow - rateWindowStart
      if (elapsed >= 1000) {
        state.snapshotRate = Math.round((rateCount * 1000) / elapsed)
        rateWindowStart = clientNow
        rateCount = 0
      }

      return
    }

    if (message.type === 'event') {
      events.push(message)
    }

    if (message.type === 'round_end') {
      roundEnds.push({
        roundId: message.roundId,
        endedAtMs: message.endedAtMs,
        winners: message.winners,
        leaderboard: message.leaderboard,
      })
    }
  })

  socket.addEventListener('close', () => {
    state.connected = false
    if (pingIntervalId !== null) {
      clearInterval(pingIntervalId)
      pingIntervalId = null
    }
  })

  socket.addEventListener('open', () => {
    remotes.clear()
    nanLogged.clear()
    state.snapshotRate = 0
    pingIntervalId = window.setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        const now = performance.now()
        socket.send(JSON.stringify({ type: 'ping', t: now }))
      }
    }, 2000)
  })

  const sendInput = (angle: number, moving: boolean, seq: number, clientTime: number) => {
    if (socket.readyState !== socket.OPEN) {
      return
    }
    const payload: InputMessage = {
      type: 'input',
      angle,
      moving,
      seq,
      t: clientTime,
    }
    socket.send(JSON.stringify(payload))
  }

  const sendReset = (clientTime: number) => {
    if (socket.readyState !== socket.OPEN) {
      return
    }
    const payload: ResetMessage = {
      type: 'reset',
      t: clientTime,
    }
    socket.send(JSON.stringify(payload))
  }

  const sendPause = () => {
    if (socket.readyState !== socket.OPEN) {
      return
    }
    const payload: PauseMessage = {
      type: 'pause',
    }
    socket.send(JSON.stringify(payload))
  }

  const getServerTime = () => {
    const clientNow = performance.now()
    if (!offsetInitialized) {
      return lastServerTimeMs + (clientNow - lastSnapshotClientTime)
    }
    return clientNow + offsetEstimate
  }

  const getRemotePlayers = (smoothPos: number, smoothAng: number) => {
    const posFactor = clamp(smoothPos, 0, 1)
    const angFactor = clamp(smoothAng, 0, 1)
    const players: RenderPlayer[] = []

    for (const remote of remotes.values()) {
      if (!isFinite(remote.renderX) || !isFinite(remote.renderY)) {
        snapRemote(remote)
      } else {
        remote.renderX = lerp(remote.renderX, remote.targetX, posFactor)
        remote.renderY = lerp(remote.renderY, remote.targetY, posFactor)
      }

      if (!isFinite(remote.renderAngle) || !isFinite(remote.targetAngle)) {
        snapRemote(remote)
      } else {
        remote.renderAngle = lerpAngle(remote.renderAngle, remote.targetAngle, angFactor)
      }

      if (
        !isFinite(remote.renderX) ||
        !isFinite(remote.renderY) ||
        !isFinite(remote.renderAngle)
      ) {
        snapRemote(remote)
        if (!nanLogged.has(remote.id)) {
          nanLogged.add(remote.id)
          console.error('[remote] NaN detected, snapping to target', remote.id)
        }
      }

      players.push({
        id: remote.id,
        position: { x: remote.renderX, y: remote.renderY },
        heading: remote.renderAngle,
        eliminated: remote.eliminated,
        isLocal: false,
      })
    }

    return players
  }

  const snapRemote = (remote: RemoteState) => {
    remote.renderX = remote.targetX
    remote.renderY = remote.targetY
    remote.renderAngle = remote.targetAngle
  }

  return {
    state,
    sendInput,
    sendReset,
    sendPause,
    getServerTime,
    getRemotePlayers,
    drainEvents: () => {
      const drained = events.splice(0, events.length)
      return drained
    },
    drainRoundEnds: () => {
      const drained = roundEnds.splice(0, roundEnds.length)
      return drained
    },
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const lerpAngle = (a: number, b: number, t: number) => {
  const tau = Math.PI * 2
  const diff = ((b - a + Math.PI * 3) % tau) - Math.PI
  return a + diff * t
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))
