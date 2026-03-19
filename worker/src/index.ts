export interface Env {
  DB: D1Database
  GAME: DurableObjectNamespace
}

type MatchStatus = 'lobby' | 'active' | 'complete'

type MatchRow = {
  id: string
  status: MatchStatus
  created_at: string
  started_at: string | null
  ends_at: string | null
  seed: number | null
}

type MatchPlayerRow = {
  id: string
  match_id: string
  account_id: string
  joined_at: string
  gems: number
  placement: number | null
  left_at?: string | null
  eliminated_at?: string | null
}

type PlayerState = {
  id: string
  handle?: string
  x: number
  y: number
  headingAngle: number
  speed: number
  state: 'alive' | 'dead'
  moving: boolean
  paused: boolean
  matchGemPoints: number
  matchGemPickupsCount: number
  rareGemsCount: number
  lastScoreChangeMs?: number
  speedBoost: number
  lastSeq: number
  lastInputAtMs: number
}

type BotPersonality = 'aggressive' | 'cautious' | 'balanced'

type BotState = PlayerState & {
  isBot: true
  personality: BotPersonality
  nextDecisionMs: number
  wanderAngle: number
  lastX: number
  lastY: number
  stuckTicks: number
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

type Gem = {
  id: string
  tier: 'common' | 'uncommon' | 'rare'
  valuePoints: number
  x: number
  y: number
  radius: number
  despawnAtMs?: number
}

type PendingGemSpawn = {
  spawnAtMs: number
}

const TICK_RATE = 30
const SNAPSHOT_RATE = 15
const WORLD_INRADIUS = 2500
const PLAYER_SPEED = 220
const PLAYER_RADIUS = 18
const PLAYER_IDLE_MS = 15000
const ROUND_END_RESET_MS = 3000
const ROUND_MS = 120000
const ACTIVE_GEMS = 60
const GEM_RESPAWN_MIN_MS = 300
const GEM_RESPAWN_MAX_MS = 900
const GEM_RADIUS_COMMON = 6
const GEM_RADIUS_UNCOMMON = 8
const GEM_RADIUS_RARE = 11
const SHRINK_START_PCT = 0.4
const SHRINK_MIN_INRADIUS = 600
const MATCH_DURATION_MS = 2 * 60 * 1000
const MAX_MATCH_PLAYERS = 5
const MIN_MATCH_PLAYERS = 1
const QUEUE_WAIT_MS = 60 * 1000
const BOT_FILL_COUNT = 3
const BOT_VISION_RADIUS = 650
const BOT_BORDER_BUFFER = 220
const BOT_DECISION_MS = 1200
const BOT_SEPARATION_RADIUS = 70
const BOT_STUCK_TICKS = 18
const SPEED_BOOST_AMOUNT = 80
const SPEED_BOOST_DECAY = 4
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const PASSWORD_ITERATIONS = 100000

const BOT_HANDLES = ['BOT-ATLAS', 'BOT-EMBER', 'BOT-NOVA', 'BOT-ONYX', 'BOT-ZEKE']
const BOT_PERSONALITIES: BotPersonality[] = ['aggressive', 'cautious', 'balanced', 'aggressive', 'cautious']

const buildCorsHeaders = (request: Request) => {
  const headers = new Headers()
  const origin = request.headers.get('Origin')
  headers.set('Access-Control-Allow-Origin', origin ?? '*')
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  headers.set('Access-Control-Allow-Credentials', 'true')
  return headers
}

const json = (request: Request, data: unknown, init: ResponseInit = {}) => {
  const headers = buildCorsHeaders(request)
  headers.set('Content-Type', 'application/json')
  Object.entries(init.headers || {}).forEach(([key, value]) => {
    headers.set(key, String(value))
  })
  return new Response(JSON.stringify(data), { ...init, headers })
}

const empty = (request: Request, status = 204, init: ResponseInit = {}) => {
  const headers = buildCorsHeaders(request)
  Object.entries(init.headers || {}).forEach(([key, value]) => {
    headers.set(key, String(value))
  })
  return new Response(null, { status, headers })
}

const badRequest = (request: Request, message: string) =>
  json(request, { error: message }, { status: 400 })

const parseDbTime = (value: string | null) => {
  if (!value) {
    return 0
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z'
  return Date.parse(normalized)
}

const parseJson = async <T extends Record<string, unknown>>(
  request: Request
) => {
  const body = (await request.json()) as T
  return body
}

const encodeBase64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))

const decodeBase64 = (encoded: string) =>
  Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))

const hashPassword = async (password: string, salt?: Uint8Array) => {
  const encoder = new TextEncoder()
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(16))
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PASSWORD_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  )

  return {
    salt: encodeBase64(saltBytes),
    hash: encodeBase64(new Uint8Array(derived)),
  }
}

const verifyPassword = async (
  password: string,
  salt: string,
  expectedHash: string
) => {
  const derived = await hashPassword(password, decodeBase64(salt))
  return derived.hash === expectedHash
}

const parseCookies = (request: Request) => {
  const header = request.headers.get('Cookie') || ''
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [key, ...rest] = part.trim().split('=')
    if (!key) {
      return acc
    }
    acc[key] = decodeURIComponent(rest.join('='))
    return acc
  }, {})
}

const setSessionCookie = (sessionId: string) =>
  `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    SESSION_TTL_MS / 1000
  }`

const clearSessionCookie = () =>
  'session_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'

const getSessionAccount = async (env: Env, request: Request) => {
  const cookies = parseCookies(request)
  const authHeader = request.headers.get('Authorization') || ''
  const bearer = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : ''
  const sessionId = cookies.session_id || bearer
  if (!sessionId) {
    return null
  }

  return getSessionById(env, sessionId)
}

const getSessionById = async (env: Env, sessionId: string) => {
  const now = Date.now()
  const session = await env.DB.prepare(
    `
    select s.id as session_id,
           a.id as account_id,
           a.handle as handle,
           s.expires_at as expires_at
    from sessions s
    join accounts a on a.id = s.account_id
    where s.id = ?1
  `
  )
    .bind(sessionId)
    .first<{ session_id: string; account_id: string; handle: string; expires_at: number }>()

  if (!session || session.expires_at <= now) {
    return null
  }

  return {
    sessionId: session.session_id,
    accountId: session.account_id,
    handle: session.handle,
  }
}

const requireSession = async (env: Env, request: Request) => {
  const session = await getSessionAccount(env, request)
  if (!session) {
    throw json(request, { error: 'Unauthorized' }, { status: 401 })
  }
  return session
}

const tryMatchmake = async (env: Env, options?: { force?: boolean }) => {
  const summary = await env.DB.prepare(
    `
    select count(*) as count,
           max(created_at) as latest
    from queue
  `
  ).first<{ count: number | string; latest: string | null }>()

  const queuedCount = Number(summary?.count ?? 0)
  if (queuedCount < MIN_MATCH_PLAYERS) {
    return null
  }

  const force = options?.force ?? false
  if (!force && queuedCount < MAX_MATCH_PLAYERS) {
    const latestTime = parseDbTime(summary?.latest ?? null)
    if (!latestTime || Date.now() - latestTime < QUEUE_WAIT_MS) {
      return null
    }
  }

  const takeCount = Math.min(MAX_MATCH_PLAYERS, queuedCount)
  const queueResult = await env.DB.prepare(
    `
    select id, account_id
    from queue
    order by created_at asc
    limit ?1
  `
  )
    .bind(takeCount)
    .all<{ id: string; account_id: string }>()

  const matchId = crypto.randomUUID()
  const now = new Date()
  const endsAt = new Date(now.getTime() + MATCH_DURATION_MS)

  await env.DB.prepare(
    `
    insert into matches (id, status, started_at, ends_at)
    values (?1, 'active', ?2, ?3)
  `
  )
    .bind(matchId, now.toISOString(), endsAt.toISOString())
    .run()

  for (const entry of queueResult.results) {
    await env.DB.prepare(
      `
      insert into match_players (id, match_id, account_id)
      values (?1, ?2, ?3)
    `
    )
      .bind(crypto.randomUUID(), matchId, entry.account_id)
      .run()
  }

  const queueIds = queueResult.results.map((entry) => entry.id)
  if (queueIds.length) {
    const placeholders = queueIds.map(() => '?').join(',')
    await env.DB.prepare(`delete from queue where id in (${placeholders})`)
      .bind(...queueIds)
      .run()
  }

  const match = await env.DB.prepare('select * from matches where id = ?1')
    .bind(matchId)
    .first<MatchRow>()
  return match ?? null
}

const ensureBotAccounts = async (env: Env, count: number) => {
  const handles = BOT_HANDLES.slice(0, count).map((handle) => handle.toLowerCase())
  if (handles.length === 0) {
    return []
  }
  const placeholders = handles.map(() => '?').join(',')
  const existing = await env.DB.prepare(
    `select id, handle from accounts where handle in (${placeholders})`
  )
    .bind(...handles)
    .all<{ id: string; handle: string }>()

  const byHandle = new Map(existing.results.map((row) => [row.handle, row]))
  const created: Array<{ id: string; handle: string }> = []

  for (const handle of handles) {
    if (byHandle.has(handle)) {
      continue
    }
    const { salt, hash } = await hashPassword(crypto.randomUUID())
    const accountId = crypto.randomUUID()
    await env.DB.prepare(
      `
      insert into accounts (id, handle, password_hash, password_salt)
      values (?1, ?2, ?3, ?4)
    `
    )
      .bind(accountId, handle, hash, salt)
      .run()
    created.push({ id: accountId, handle })
  }

  const merged = [
    ...existing.results,
    ...created,
  ].filter((row) => handles.includes(row.handle))
  merged.sort((a, b) => handles.indexOf(a.handle) - handles.indexOf(b.handle))
  return merged
}

const createMatchWithPlayers = async (
  env: Env,
  players: Array<{ id: string }>
) => {
  const matchId = crypto.randomUUID()
  const now = new Date()
  const endsAt = new Date(now.getTime() + MATCH_DURATION_MS)

  await env.DB.prepare(
    `
    insert into matches (id, status, started_at, ends_at)
    values (?1, 'active', ?2, ?3)
  `
  )
    .bind(matchId, now.toISOString(), endsAt.toISOString())
    .run()

  for (const player of players) {
    await env.DB.prepare(
      `
      insert into match_players (id, match_id, account_id)
      values (?1, ?2, ?3)
    `
    )
      .bind(crypto.randomUUID(), matchId, player.id)
      .run()
  }

  const match = await env.DB.prepare('select * from matches where id = ?1')
    .bind(matchId)
    .first<MatchRow>()
  return match ?? null
}

const seedBotsInArena = async (
  env: Env,
  matchId: string,
  bots: Array<{ id: string; handle: string }>
) => {
  const id = env.GAME.idFromName(matchId)
  const stub = env.GAME.get(id)
  await stub.fetch(`https://internal/seed-bots?matchId=${matchId}`, {
    method: 'POST',
    headers: {
      'X-Internal': '1',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bots }),
  })
}

const finalizeMatch = async (env: Env, matchId: string) => {
  const match = await env.DB.prepare('select * from matches where id = ?1')
    .bind(matchId)
    .first<MatchRow>()
  if (!match) {
    return null
  }

  if (match.status === 'complete') {
    return match
  }

  const playersResult = await env.DB.prepare(
    `
    select *
    from match_players
    where match_id = ?1
  `
  )
    .bind(matchId)
    .all<MatchPlayerRow>()

  const players = [...playersResult.results]
  const alivePlayers = players.filter(
    (player) => !player.eliminated_at && !player.left_at
  )
  const useSurvivalRanking =
    players.length > 1 && alivePlayers.length <= 1

  const sorted = [...players].sort((a, b) => {
    if (!useSurvivalRanking) {
      if (a.gems !== b.gems) {
        return b.gems - a.gems
      }
      return a.joined_at.localeCompare(b.joined_at)
    }

    const aAlive = !a.eliminated_at && !a.left_at
    const bAlive = !b.eliminated_at && !b.left_at
    if (aAlive && !bAlive) {
      return -1
    }
    if (!aAlive && bAlive) {
      return 1
    }

    const aTime = a.eliminated_at ?? a.left_at ?? ''
    const bTime = b.eliminated_at ?? b.left_at ?? ''
    if (aTime !== bTime) {
      return bTime.localeCompare(aTime)
    }
    return a.joined_at.localeCompare(b.joined_at)
  })

  for (let i = 0; i < sorted.length; i += 1) {
    const player = sorted[i]
    await env.DB.prepare(
      'update match_players set placement = ?1 where id = ?2'
    )
      .bind(i + 1, player.id)
      .run()
  }

  await env.DB.prepare(`update matches set status = 'complete' where id = ?1`)
    .bind(matchId)
    .run()

  const updated = await env.DB.prepare('select * from matches where id = ?1')
    .bind(matchId)
    .first<MatchRow>()

  return updated ?? null
}

const endMatchIfSolo = async (
  env: Env,
  matchId: string,
  leaverAccountId: string
) => {
  const leftAt = new Date().toISOString()
  await env.DB.prepare(
    `
    update match_players
    set left_at = ?1
    where match_id = ?2 and account_id = ?3
  `
  )
    .bind(leftAt, matchId, leaverAccountId)
    .run()

  const remaining = await env.DB.prepare(
    'select id, account_id from match_players where match_id = ?1 and left_at is null'
  )
    .bind(matchId)
    .all<{ id: string; account_id: string }>()

  if (remaining.results.length > 1) {
    return { ended: false }
  }

  if (remaining.results.length === 1) {
    const winner = remaining.results[0]
    await env.DB.prepare(
      'update match_players set placement = 1 where id = ?1'
    )
      .bind(winner.id)
      .run()
  }

  await env.DB.prepare("update matches set status = 'complete' where id = ?1")
    .bind(matchId)
    .run()

  return { ended: true }
}

export class GameArena {
  private players = new Map<WebSocket, PlayerState>()
  private playersByAccount = new Map<string, PlayerState>()
  private socketsByAccount = new Map<string, WebSocket>()
  private bots = new Map<string, BotState>()
  private serverTimeMs = 0
  private tick = 0
  private intervalId: number | null = null
  private roundId = 1
  private roundState: 'running' | 'ending' | 'resetting' = 'running'
  private roundStartMs = 0
  private roundEndAtMs = 0
  private roundResetAtMs = 0
  private gems: Gem[] = []
  private pendingGemSpawns: PendingGemSpawn[] = []
  private matchId: string | null = null
  private matchEndsAtMs: number | null = null
  private endingMatch = false

  constructor(private state: DurableObjectState, private env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (!this.matchId) {
      const matchId = url.searchParams.get('matchId')
      if (matchId) {
        this.matchId = matchId
        this.matchEndsAtMs = Date.now() + MATCH_DURATION_MS
      }
    }
    if (url.pathname === '/seed-bots') {
      if (request.headers.get('X-Internal') !== '1') {
        return new Response('Forbidden', { status: 403 })
      }
      const body = await parseJson<{ bots?: Array<{ id?: string; handle?: string }> }>(
        request
      )
      const bots = (body.bots || []).filter(
        (bot) => bot.id && bot.handle
      ) as Array<{ id: string; handle: string }>
      this.addBots(bots)
      return json(request, { ok: true })
    }
    if (url.pathname === '/end') {
      if (request.headers.get('X-Internal') !== '1') {
        return new Response('Forbidden', { status: 403 })
      }
      void this.persistAllPlayerStats(this.getAllPlayers())
      for (const socket of this.players.keys()) {
        try {
          socket.close()
        } catch {
          // ignore
        }
      }
      this.players.clear()
      this.playersByAccount.clear()
      this.socketsByAccount.clear()
      this.bots.clear()
      this.stopTickIfIdle()
      return new Response('ok')
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 })
    }

    const accountId = request.headers.get('X-Account-Id')
    if (!accountId) {
      return new Response('Unauthorized', { status: 401 })
    }
    const accountHandle = request.headers.get('X-Account-Handle') || undefined

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    this.handleSession(server, accountId, accountHandle)
    return new Response(null, { status: 101, webSocket: client })
  }

  private ensureTickRunning() {
    if (this.intervalId !== null) {
      return
    }
    const tickInterval = Math.round(1000 / TICK_RATE)
    this.intervalId = setInterval(() => this.step(), tickInterval) as unknown as number
  }

  private stopTickIfIdle() {
    if (this.players.size > 0 || this.bots.size > 0 || this.intervalId === null) {
      return
    }
    clearInterval(this.intervalId)
    this.intervalId = null
  }

  private handleSession(
    socket: WebSocket,
    accountId: string,
    accountHandle?: string
  ) {
    socket.accept()
    this.ensureTickRunning()

    const existingSocket = this.socketsByAccount.get(accountId)
    if (existingSocket && existingSocket.readyState === existingSocket.OPEN) {
      existingSocket.close()
      this.players.delete(existingSocket)
    }

    let player = this.playersByAccount.get(accountId)
    if (!player) {
      player = {
        id: accountId,
        handle: accountHandle,
        x: 0,
        y: 0,
        headingAngle: 0,
        speed: PLAYER_SPEED,
        state: 'alive',
        moving: false,
        paused: false,
        matchGemPoints: 0,
        matchGemPickupsCount: 0,
        rareGemsCount: 0,
        speedBoost: 0,
        lastSeq: 0,
        lastInputAtMs: this.serverTimeMs,
      }
      this.playersByAccount.set(accountId, player)
    } else if (accountHandle) {
      player.handle = accountHandle
    }

    this.players.set(socket, player)
    this.socketsByAccount.set(accountId, socket)

    socket.send(
      JSON.stringify({
        type: 'welcome',
        id: player.id,
        serverTimeMs: this.serverTimeMs,
        tick: this.tick,
      })
    )

    socket.addEventListener('message', (event) => {
      let message: InputMessage | ResetMessage | PauseMessage | { type: 'ping'; t: number } | null = null
      try {
        message = JSON.parse(event.data as string) as
          | InputMessage
          | ResetMessage
          | PauseMessage
          | { type: 'ping'; t: number }
      } catch {
        return
      }

      if (!message) {
        return
      }

      if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', t: message.t }))
        return
      }

      const current = this.players.get(socket)
      if (!current) {
        return
      }

      if (message.type === 'input') {
        current.headingAngle = message.angle
        current.moving = message.moving
        current.lastSeq = message.seq
        current.lastInputAtMs = this.serverTimeMs
        return
      }

      if (message.type === 'reset') {
        return
      }

      if (message.type === 'pause') {
        this.togglePause(current)
        current.lastInputAtMs = this.serverTimeMs
      }
    })

    socket.addEventListener('close', () => {
      const current = this.players.get(socket)
      if (current) {
        void this.persistPlayerStats(current)
        void this.markLeft(current)
      }
      this.players.delete(socket)
      const active = this.socketsByAccount.get(accountId)
      if (active === socket) {
        this.socketsByAccount.delete(accountId)
      }
      this.stopTickIfIdle()
    })
  }

  private addBots(bots: Array<{ id: string; handle: string }>) {
    let botIndex = 0
    for (const bot of bots) {
      if (this.bots.has(bot.id)) {
        continue
      }
      const spawn = this.randomPointInOctagon(WORLD_INRADIUS * 0.6)
      const wanderAngle = Math.random() * Math.PI * 2
      const personality = BOT_PERSONALITIES[botIndex % BOT_PERSONALITIES.length]
      const speedMult = personality === 'aggressive' ? 0.95 : personality === 'cautious' ? 0.88 : 0.92
      this.bots.set(bot.id, {
        id: bot.id,
        handle: bot.handle,
        x: spawn.x,
        y: spawn.y,
        headingAngle: wanderAngle,
        speed: PLAYER_SPEED * speedMult,
        state: 'alive',
        moving: true,
        paused: false,
        matchGemPoints: 0,
        matchGemPickupsCount: 0,
        rareGemsCount: 0,
        speedBoost: 0,
        lastSeq: 0,
        lastInputAtMs: this.serverTimeMs,
        isBot: true,
        personality,
        nextDecisionMs: this.serverTimeMs,
        wanderAngle,
        lastX: spawn.x,
        lastY: spawn.y,
        stuckTicks: 0,
      })
      botIndex += 1
    }
    if (this.bots.size > 0) {
      this.ensureTickRunning()
    }
  }

  private updateBot(bot: BotState, dt: number, currentInradius: number) {
    if (bot.state !== 'alive') {
      return
    }
    const steer = this.getBotSteering(bot, currentInradius)
    if (steer) {
      bot.headingAngle = Math.atan2(steer.y, steer.x)
      bot.nextDecisionMs = this.serverTimeMs + BOT_DECISION_MS
    } else if (this.serverTimeMs >= bot.nextDecisionMs) {
      bot.wanderAngle = this.randomRange(0, 628) / 100
      bot.headingAngle = bot.wanderAngle
      bot.nextDecisionMs =
        this.serverTimeMs + BOT_DECISION_MS + this.randomRange(0, 800)
    }

    const effectiveBotSpeed = bot.speed + bot.speedBoost
    bot.x += Math.cos(bot.headingAngle) * effectiveBotSpeed * dt
    bot.y += Math.sin(bot.headingAngle) * effectiveBotSpeed * dt
    bot.speedBoost = Math.max(0, bot.speedBoost - SPEED_BOOST_DECAY)

    const moved = Math.hypot(bot.x - bot.lastX, bot.y - bot.lastY)
    bot.lastX = bot.x
    bot.lastY = bot.y
    if (moved < 0.5) {
      bot.stuckTicks += 1
    } else {
      bot.stuckTicks = 0
    }
    if (bot.stuckTicks >= BOT_STUCK_TICKS) {
      bot.stuckTicks = 0
      bot.headingAngle = Math.random() * Math.PI * 2
      bot.nextDecisionMs = this.serverTimeMs + BOT_DECISION_MS
    }

    if (!this.isInsideOctagon(bot.x, bot.y, currentInradius)) {
      this.eliminatePlayer(bot)
    }
  }

  private getBotSteering(bot: BotState, currentInradius: number) {
    let steerX = 0
    let steerY = 0

    const distToCenter = Math.hypot(bot.x, bot.y)
    const shrinkPressure = Math.max(0, distToCenter / currentInradius - 0.6)

    // Border avoidance — scales with how close the boundary is
    const borderBuffer = bot.personality === 'cautious' ? BOT_BORDER_BUFFER * 1.5 : BOT_BORDER_BUFFER
    const nearBorder = !this.isInsideOctagon(bot.x, bot.y, currentInradius - borderBuffer)
    if (nearBorder) {
      const urgency = bot.personality === 'cautious' ? 5 : 3
      steerX += -bot.x * urgency
      steerY += -bot.y * urgency
    }

    // Shrink awareness — cautious bots drift toward center earlier
    if (shrinkPressure > 0) {
      const pull = bot.personality === 'cautious' ? shrinkPressure * 4 : shrinkPressure * 2
      steerX += -bot.x * pull
      steerY += -bot.y * pull
    }

    // Gem seeking — aggressive bots look further, cautious bots stay closer
    const visionRadius = bot.personality === 'aggressive' ? BOT_VISION_RADIUS * 1.3 : BOT_VISION_RADIUS
    const target = this.findBestGem(bot, visionRadius, currentInradius)
    if (target) {
      const gemWeight = bot.personality === 'aggressive' ? 1.5 : 1
      steerX += (target.x - bot.x) * gemWeight
      steerY += (target.y - bot.y) * gemWeight
    }

    // Player avoidance — avoid getting bumped near edges
    let pushX = 0
    let pushY = 0
    for (const other of this.getAllPlayers()) {
      if (other.id === bot.id || other.state !== 'alive') {
        continue
      }
      const dx = bot.x - other.x
      const dy = bot.y - other.y
      const d2 = dx * dx + dy * dy
      if (d2 > BOT_SEPARATION_RADIUS * BOT_SEPARATION_RADIUS || d2 === 0) {
        continue
      }
      const inv = 1 / Math.sqrt(d2)
      // Push away harder when near the border
      const edgeDanger = nearBorder ? 4 : 2
      pushX += dx * inv * edgeDanger
      pushY += dy * inv * edgeDanger
    }
    steerX += pushX
    steerY += pushY

    // Score-aware: if leading, play safer (drift toward center)
    const allPlayers = this.getAllPlayers().filter((p) => p.state === 'alive')
    const maxScore = allPlayers.reduce((max, p) => Math.max(max, p.matchGemPoints), 0)
    if (bot.matchGemPoints >= maxScore && maxScore > 0 && bot.personality !== 'aggressive') {
      steerX += -bot.x * 0.5
      steerY += -bot.y * 0.5
    }

    if (steerX === 0 && steerY === 0) {
      return null
    }
    return { x: steerX, y: steerY }
  }

  private findBestGem(bot: BotState, radius: number, currentInradius: number) {
    let best: Gem | null = null
    let bestScore = -1
    const r2 = radius * radius
    for (const gem of this.gems) {
      const dx = gem.x - bot.x
      const dy = gem.y - bot.y
      const d2 = dx * dx + dy * dy
      if (d2 > r2) {
        continue
      }
      // Score the gem: value / distance, penalize gems near the edge
      const dist = Math.sqrt(d2) + 1
      const gemDistToCenter = Math.hypot(gem.x, gem.y)
      const edgePenalty = gemDistToCenter > currentInradius * 0.7 ? 0.3 : 1
      const score = (gem.valuePoints * edgePenalty) / dist
      if (score > bestScore) {
        bestScore = score
        best = gem
      }
    }
    return best
  }

  private getAllPlayers() {
    return [...this.players.values(), ...this.bots.values()]
  }

  private step() {
    const dtMs = 1000 / TICK_RATE
    const dt = 1 / TICK_RATE
    this.serverTimeMs += dtMs
    this.tick += 1
    const currentInradius = this.getCurrentInradius()

    if (this.roundState === 'running') {
      this.ensureGemCount(currentInradius)
      this.updatePendingGemSpawns(currentInradius)
      this.crushGemsOutsideBounds(currentInradius)
    }

    for (const [socket, player] of this.players.entries()) {
      if (
        this.serverTimeMs - player.lastInputAtMs > PLAYER_IDLE_MS &&
        socket.readyState === socket.OPEN
      ) {
        void this.persistPlayerStats(player)
        void this.markLeft(player)
        try {
          socket.close()
        } catch {
          // ignore
        }
        this.players.delete(socket)
        const active = this.socketsByAccount.get(player.id)
        if (active === socket) {
          this.socketsByAccount.delete(player.id)
        }
        continue
      }
      if (player.state === 'dead') {
        continue
      }
      if (player.state !== 'alive') {
        continue
      }
      if (player.paused) {
        if (!this.isInsideOctagon(player.x, player.y, currentInradius)) {
          this.eliminatePlayer(player)
        }
        continue
      }

      if (player.moving) {
        const effectiveSpeed = player.speed + player.speedBoost
        player.x += Math.cos(player.headingAngle) * effectiveSpeed * dt
        player.y += Math.sin(player.headingAngle) * effectiveSpeed * dt
      }
      player.speedBoost = Math.max(0, player.speedBoost - SPEED_BOOST_DECAY)

      if (!this.isInsideOctagon(player.x, player.y, currentInradius)) {
        this.eliminatePlayer(player)
      }
    }

    for (const bot of this.bots.values()) {
      this.updateBot(bot, dt, currentInradius)
    }

    if (this.roundState === 'running') {
      this.handlePlayerCollisions()
      this.handleGemPickups()
    }

    const aliveCount = this.getAllPlayers().filter(
      (player) => player.state === 'alive'
    ).length
    this.checkForSoloMatchEnd(aliveCount)
    this.checkMatchTimeExpired()
    this.updateRoundState()

    const snapshotEveryTicks = Math.max(
      1,
      Math.round(TICK_RATE / SNAPSHOT_RATE)
    )
    if (this.tick % snapshotEveryTicks !== 0) {
      return
    }

    const snapshot = {
      type: 'snapshot',
      serverTimeMs: this.serverTimeMs,
      tick: this.tick,
      players: this.getAllPlayers().map((player) => ({
        id: player.id,
        handle: player.handle,
        x: player.x,
        y: player.y,
        angle: player.headingAngle,
        eliminated: player.state === 'dead',
        paused: player.paused,
        matchGemPoints: player.matchGemPoints,
        rareGemsCount: player.rareGemsCount,
        lastSeq: player.lastSeq,
      })),
      round: {
        roundId: this.roundId,
        state: this.roundState,
        roundStartMs: this.roundStartMs,
        elapsedMs: Math.max(0, this.serverTimeMs - this.roundStartMs),
        roundEndAtMs: this.roundEndAtMs,
        currentInradius,
      },
      gems: this.gems.map((gem) => ({
        id: gem.id,
        tier: gem.tier,
        valuePoints: gem.valuePoints,
        x: gem.x,
        y: gem.y,
        radius: gem.radius,
      })),
    }

    const payload = JSON.stringify(snapshot)
    for (const socket of this.players.keys()) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload)
      }
    }
  }

  private isInsideOctagon(x: number, y: number, inradius: number) {
    const absX = Math.abs(x)
    const absY = Math.abs(y)
    if (absX > inradius || absY > inradius) {
      return false
    }
    return absX + absY <= inradius * Math.SQRT2
  }

  private eliminatePlayer(player: PlayerState) {
    if (player.state !== 'dead') {
      this.broadcastEvent({
        type: 'event',
        kind: 'elimination',
        playerId: player.id,
        playerHandle: player.handle,
        serverNowMs: this.serverTimeMs,
      })
      void this.markEliminated(player)
    }
    player.state = 'dead'
  }

  private getCurrentInradius() {
    if (this.roundStartMs === 0) {
      return WORLD_INRADIUS
    }
    const elapsed = this.serverTimeMs - this.roundStartMs
    const pct = Math.min(1, elapsed / ROUND_MS)
    if (pct < SHRINK_START_PCT) {
      return WORLD_INRADIUS
    }
    const shrinkPct = (pct - SHRINK_START_PCT) / (1 - SHRINK_START_PCT)
    return WORLD_INRADIUS - (WORLD_INRADIUS - SHRINK_MIN_INRADIUS) * shrinkPct
  }

  private togglePause(player: PlayerState) {
    if (player.state !== 'alive') {
      return
    }
    player.paused = !player.paused
  }

  private broadcastEvent(event: {
    type: 'event'
    kind: string
    playerId: string
    playerHandle?: string
    valuePoints?: number
    tier?: 'common' | 'uncommon' | 'rare'
    serverNowMs?: number
  }) {
    const payload = JSON.stringify(event)
    for (const socket of this.players.keys()) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload)
      }
    }
  }

  private broadcastRoundEnd(payload: {
    type: 'round_end'
    roundId: number
    winners: Array<{
      id: string
      handle?: string
      rank: number
      matchGemPoints: number
    }>
    endedAtMs: number
    leaderboard: Array<{ id: string; handle?: string; matchGemPoints: number }>
  }) {
    const message = JSON.stringify(payload)
    for (const socket of this.players.keys()) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message)
      }
    }
  }

  private handlePlayerCollisions() {
    const alive = this.getAllPlayers().filter((p) => p.state === 'alive')
    const collisionRadius = PLAYER_RADIUS * 2
    const pushStrength = 80
    for (let i = 0; i < alive.length; i += 1) {
      for (let j = i + 1; j < alive.length; j += 1) {
        const a = alive[i]
        const b = alive[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy)
        if (dist >= collisionRadius || dist === 0) {
          continue
        }
        const overlap = collisionRadius - dist
        const nx = dx / dist
        const ny = dy / dist
        const push = overlap * 0.5 + pushStrength / TICK_RATE
        a.x -= nx * push
        a.y -= ny * push
        b.x += nx * push
        b.y += ny * push
      }
    }
  }

  private handleGemPickups() {
    if (this.gems.length === 0) {
      return
    }

    for (const player of this.getAllPlayers()) {
      if (player.state !== 'alive') {
        continue
      }
      for (let i = this.gems.length - 1; i >= 0; i -= 1) {
        const gem = this.gems[i]
        if (!gem) {
          continue
        }
        const dx = gem.x - player.x
        const dy = gem.y - player.y
        const radius = PLAYER_RADIUS + gem.radius
        if (dx * dx + dy * dy > radius * radius) {
          continue
        }

        this.gems.splice(i, 1)
        player.matchGemPoints += gem.valuePoints
        player.matchGemPickupsCount += 1
        if (gem.tier === 'rare') {
          player.rareGemsCount += 1
        }
        player.speedBoost = SPEED_BOOST_AMOUNT
        player.lastScoreChangeMs = this.serverTimeMs
        void this.persistPlayerStats(player)

        this.broadcastEvent({
          type: 'event',
          kind: 'gem_pickup',
          playerId: player.id,
          valuePoints: gem.valuePoints,
          tier: gem.tier,
          serverNowMs: this.serverTimeMs,
        })

        this.pendingGemSpawns.push({
          spawnAtMs:
            this.serverTimeMs +
            this.randomRange(GEM_RESPAWN_MIN_MS, GEM_RESPAWN_MAX_MS),
        })
      }
    }
  }

  private updatePendingGemSpawns(currentInradius: number) {
    for (let i = this.pendingGemSpawns.length - 1; i >= 0; i -= 1) {
      const pending = this.pendingGemSpawns[i]
      if (!pending) {
        continue
      }
      if (pending.spawnAtMs <= this.serverTimeMs) {
        this.pendingGemSpawns.splice(i, 1)
        this.spawnGem(currentInradius)
      }
    }
  }

  private ensureGemCount(currentInradius: number) {
    const needed = ACTIVE_GEMS - (this.gems.length + this.pendingGemSpawns.length)
    for (let i = 0; i < needed; i += 1) {
      this.spawnGem(currentInradius)
    }
  }

  private crushGemsOutsideBounds(currentInradius: number) {
    for (let i = this.gems.length - 1; i >= 0; i -= 1) {
      const gem = this.gems[i]
      if (!gem) {
        continue
      }
      if (!this.isInsideOctagon(gem.x, gem.y, currentInradius)) {
        this.gems.splice(i, 1)
      }
    }
  }

  private updateRoundState() {
    if (this.roundState === 'running') {
      if (this.roundStartMs === 0) {
        this.roundStartMs = this.serverTimeMs
      }
      this.roundEndAtMs = this.roundStartMs + ROUND_MS
      const elapsedMs = this.serverTimeMs - this.roundStartMs
      if (elapsedMs >= ROUND_MS) {
        this.endRound()
      }
      return
    }

    if (this.roundState === 'ending' && this.serverTimeMs >= this.roundResetAtMs) {
      this.resetRound()
    }
  }

  private endRound() {
    this.roundState = 'ending'
    this.roundResetAtMs = this.serverTimeMs + ROUND_END_RESET_MS

    const socketsToKick: WebSocket[] = []
    for (const [socket, player] of this.players.entries()) {
      if (player.paused && player.state === 'alive') {
        void this.markLeft(player)
        socketsToKick.push(socket)
      }
    }

    const sorted = this.getAllPlayers().sort((a, b) => {
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

    void this.persistAllPlayerStats(sorted)

    const winners = sorted.slice(0, 3).map((player, index) => ({
      id: player.id,
      handle: player.handle,
      rank: index + 1,
      matchGemPoints: player.matchGemPoints,
    }))

    const leaderboard = sorted.map((player) => ({
      id: player.id,
      handle: player.handle,
      matchGemPoints: player.matchGemPoints,
    }))

    this.broadcastRoundEnd({
      type: 'round_end',
      roundId: this.roundId,
      endedAtMs: this.serverTimeMs,
      winners,
      leaderboard,
    })

    socketsToKick.forEach((socket) => {
      if (socket.readyState === socket.OPEN) {
        try {
          socket.close()
        } catch {
          // ignore
        }
      }
    })
  }

  private resetRound() {
    this.roundState = 'resetting'
    this.gems.length = 0
    this.pendingGemSpawns.length = 0

    for (const player of this.players.values()) {
      player.x = 0
      player.y = 0
      player.headingAngle = 0
      player.state = 'alive'
      player.moving = false
      player.paused = false
      player.matchGemPoints = 0
      player.matchGemPickupsCount = 0
      player.rareGemsCount = 0
      player.speedBoost = 0
      player.lastScoreChangeMs = undefined
    }
    for (const bot of this.bots.values()) {
      const spawn = this.randomPointInOctagon(WORLD_INRADIUS * 0.6)
      bot.x = spawn.x
      bot.y = spawn.y
      bot.headingAngle = Math.random() * Math.PI * 2
      bot.state = 'alive'
      bot.paused = false
      bot.matchGemPoints = 0
      bot.matchGemPickupsCount = 0
      bot.rareGemsCount = 0
      bot.speedBoost = 0
      bot.lastScoreChangeMs = undefined
      bot.nextDecisionMs = this.serverTimeMs
    }

    this.roundId += 1
    this.roundStartMs = this.serverTimeMs
    this.roundEndAtMs = this.roundStartMs + ROUND_MS
    this.roundState = 'running'
    this.ensureGemCount()
  }

  private checkForSoloMatchEnd(aliveCount: number) {
    if (this.endingMatch || this.roundState !== 'running') {
      return
    }
    const totalPlayers = this.playersByAccount.size + this.bots.size
    if (totalPlayers < 2) {
      return
    }
    if (aliveCount > 1) {
      return
    }
    this.endingMatch = true
    void this.endMatchDueToSolo()
  }

  private checkMatchTimeExpired() {
    if (this.endingMatch || !this.matchEndsAtMs) {
      return
    }
    if (Date.now() < this.matchEndsAtMs) {
      return
    }
    this.endingMatch = true
    void this.endMatchDueToTimeExpired()
  }

  private async endMatchDueToTimeExpired() {
    if (!this.matchId) {
      return
    }
    await this.persistAllPlayerStats(this.getAllPlayers())
    await finalizeMatch(this.env, this.matchId)
    for (const socket of this.players.keys()) {
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
    this.players.clear()
    this.playersByAccount.clear()
    this.socketsByAccount.clear()
    this.bots.clear()
    this.stopTickIfIdle()
  }

  private async endMatchDueToSolo() {
    if (!this.matchId) {
      return
    }
    await this.persistAllPlayerStats(this.getAllPlayers())
    await finalizeMatch(this.env, this.matchId)
    for (const socket of this.players.keys()) {
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
    this.players.clear()
    this.playersByAccount.clear()
    this.socketsByAccount.clear()
    this.bots.clear()
    this.stopTickIfIdle()
  }

  private spawnGem(currentInradius?: number) {
    const inradius = currentInradius ?? WORLD_INRADIUS
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
    const { x, y } = this.randomPointInOctagon(inradius * 0.9)
    this.gems.push({
      id: crypto.randomUUID(),
      tier,
      valuePoints,
      x,
      y,
      radius,
    })
  }

  private randomRange(min: number, max: number) {
    return Math.round(min + Math.random() * (max - min))
  }

  private randomPointInOctagon(inradius: number) {
    for (;;) {
      const x = (Math.random() * 2 - 1) * inradius
      const y = (Math.random() * 2 - 1) * inradius
      if (this.isInsideOctagon(x, y, inradius)) {
        return { x, y }
      }
    }
  }

  private async persistPlayerStats(player: PlayerState) {
    if (!this.matchId) {
      return
    }
    await this.env.DB.prepare(
      `
      update match_players
      set gems = ?1
      where match_id = ?2 and account_id = ?3
    `
    )
      .bind(player.matchGemPoints, this.matchId, player.id)
      .run()
  }

  private async markEliminated(player: PlayerState) {
    if (!this.matchId) {
      return
    }
    await this.env.DB.prepare(
      `
      update match_players
      set eliminated_at = coalesce(eliminated_at, datetime('now'))
      where match_id = ?1 and account_id = ?2
    `
    )
      .bind(this.matchId, player.id)
      .run()
  }

  private async markLeft(player: PlayerState) {
    if (!this.matchId) {
      return
    }
    await this.env.DB.prepare(
      `
      update match_players
      set left_at = coalesce(left_at, datetime('now'))
      where match_id = ?1 and account_id = ?2 and eliminated_at is null
    `
    )
      .bind(this.matchId, player.id)
      .run()
  }

  private async persistAllPlayerStats(players: PlayerState[]) {
    if (!this.matchId) {
      return
    }
    for (const player of players) {
      await this.env.DB.prepare(
        `
        update match_players
        set gems = ?1
        where match_id = ?2 and account_id = ?3
      `
      )
        .bind(player.matchGemPoints, this.matchId, player.id)
        .run()
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === 'OPTIONS') {
        return empty(request)
      }

      const url = new URL(request.url)
      const pathname = url.pathname

      if (pathname === '/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') {
          return new Response('Expected websocket', { status: 426 })
        }
        const sessionQuery = url.searchParams.get('session') || ''
        const session =
          (await getSessionAccount(env, request)) ||
          (sessionQuery ? await getSessionById(env, sessionQuery) : null)
        if (!session) {
          return json(request, { error: 'Unauthorized' }, { status: 401 })
        }
        const matchId = url.searchParams.get('matchId')
        if (!matchId) {
          return badRequest(request, 'Missing matchId')
        }

        const membership = await env.DB.prepare(
          `
          select id
          from match_players
          where match_id = ?1 and account_id = ?2
          limit 1
        `
        )
          .bind(matchId, session.accountId)
          .first<{ id: string }>()

        if (!membership) {
          return json(request, { error: 'Forbidden' }, { status: 403 })
        }

        const id = env.GAME.idFromName(matchId)
        const stub = env.GAME.get(id)
        const headers = new Headers(request.headers)
        headers.set('X-Account-Id', session.accountId)
        headers.set('X-Account-Handle', session.handle)
        const wsRequest = new Request(request.url, {
          headers,
        })
        return stub.fetch(wsRequest)
      }

      if (request.method === 'POST' && pathname === '/api/auth/signup') {
        const body = await parseJson<{ handle?: string; password?: string }>(
          request
        )
        const handle = body.handle?.trim().toLowerCase()
        const password = body.password?.trim()
        if (!handle || !password) {
          return badRequest(request, 'Missing handle or password')
        }

        const existing = await env.DB.prepare(
          'select id from accounts where handle = ?1'
        )
          .bind(handle)
          .first<{ id: string }>()

        if (existing) {
          return json(request, { error: 'Handle already exists' }, { status: 409 })
        }

        const { salt, hash } = await hashPassword(password)
        const accountId = crypto.randomUUID()
        await env.DB.prepare(
          `
          insert into accounts (id, handle, password_hash, password_salt)
          values (?1, ?2, ?3, ?4)
        `
        )
          .bind(accountId, handle, hash, salt)
          .run()

        const sessionId = crypto.randomUUID()
        const expiresAt = Date.now() + SESSION_TTL_MS
        await env.DB.prepare(
          `
          insert into sessions (id, account_id, expires_at)
          values (?1, ?2, ?3)
        `
        )
          .bind(sessionId, accountId, expiresAt)
          .run()

      return json(
        request,
        { id: accountId, handle, sessionId },
        {
          headers: {
            'Set-Cookie': setSessionCookie(sessionId),
          },
        }
        )
      }

      if (request.method === 'POST' && pathname === '/api/auth/login') {
        const body = await parseJson<{ handle?: string; password?: string }>(
          request
        )
        const handle = body.handle?.trim().toLowerCase()
        const password = body.password?.trim()
        if (!handle || !password) {
          return badRequest(request, 'Missing handle or password')
        }

        const account = await env.DB.prepare(
          `
          select id, handle, password_hash, password_salt
          from accounts
          where handle = ?1
        `
        )
          .bind(handle)
          .first<{
            id: string
            handle: string
            password_hash: string
            password_salt: string
          }>()

        if (!account) {
          return json(request, { error: 'Invalid credentials' }, { status: 401 })
        }

        const ok = await verifyPassword(
          password,
          account.password_salt,
          account.password_hash
        )
        if (!ok) {
          return json(request, { error: 'Invalid credentials' }, { status: 401 })
        }

        const sessionId = crypto.randomUUID()
        const expiresAt = Date.now() + SESSION_TTL_MS
        await env.DB.prepare(
          `
          insert into sessions (id, account_id, expires_at)
          values (?1, ?2, ?3)
        `
        )
          .bind(sessionId, account.id, expiresAt)
          .run()

      return json(
        request,
        { id: account.id, handle: account.handle, sessionId },
        {
          headers: {
            'Set-Cookie': setSessionCookie(sessionId),
          },
        }
        )
      }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      const session = await getSessionAccount(env, request)
      if (session) {
        await env.DB.prepare('delete from sessions where id = ?1')
          .bind(session.sessionId)
          .run()
      }
        return empty(request, 204, {
          headers: {
            'Set-Cookie': clearSessionCookie(),
          },
        })
      }

      if (request.method === 'GET' && pathname === '/api/auth/me') {
        const session = await getSessionAccount(env, request)
        if (!session) {
          return json(request, null)
        }
        return json(request, { id: session.accountId, handle: session.handle })
      }

      if (request.method === 'POST' && pathname === '/api/queue/join') {
        const session = await requireSession(env, request)
        await env.DB.prepare(
          `
          insert into queue (id, account_id)
          values (?1, ?2)
          on conflict(account_id) do update set created_at = datetime('now')
        `
        )
          .bind(crypto.randomUUID(), session.accountId)
          .run()
        const match = await tryMatchmake(env)
        if (match) {
          return json(request, match)
        }
        return empty(request)
      }

      if (request.method === 'POST' && pathname === '/api/queue/cancel') {
        const session = await requireSession(env, request)
        await env.DB.prepare('delete from queue where account_id = ?1')
          .bind(session.accountId)
          .run()
        return empty(request)
      }

      if (request.method === 'GET' && pathname === '/api/queue/status') {
        await requireSession(env, request)
        const result = await env.DB.prepare(
          `
          select q.account_id,
                 q.created_at,
                 a.handle
          from queue q
          join accounts a on a.id = q.account_id
          order by q.created_at asc
        `
        ).all<{ account_id: string; created_at: string; handle: string }>()

        const latestJoin = result.results.reduce((latest, entry) => {
          if (!latest) {
            return entry.created_at
          }
          return entry.created_at > latest ? entry.created_at : latest
        }, '' as string)

        const latestTime = parseDbTime(latestJoin || null)
        const waitingMs = latestTime ? Math.max(0, Date.now() - latestTime) : 0

        return json(request, {
          count: result.results.length,
          maxPlayers: MAX_MATCH_PLAYERS,
          minPlayers: MIN_MATCH_PLAYERS,
          autoStartAfterMs: QUEUE_WAIT_MS,
          waitingMs,
          entries: result.results.map((entry) => ({
            id: entry.account_id,
            handle: entry.handle,
            joinedAt: entry.created_at,
          })),
        })
      }

      if (request.method === 'POST' && pathname === '/api/queue/start') {
        const session = await requireSession(env, request)
        const membership = await env.DB.prepare(
          'select id from queue where account_id = ?1 limit 1'
        )
          .bind(session.accountId)
          .first<{ id: string }>()
        if (!membership) {
          return json(request, { error: 'Not in queue' }, { status: 403 })
        }
        const match = await tryMatchmake(env, { force: true })
        if (!match) {
          return json(request, null)
        }
        return json(request, match)
      }

      if (request.method === 'POST' && pathname === '/api/queue/bots') {
        const session = await requireSession(env, request)
        const membership = await env.DB.prepare(
          'select id from queue where account_id = ?1 limit 1'
        )
          .bind(session.accountId)
          .first<{ id: string }>()
        if (!membership) {
          return json(request, { error: 'Not in queue' }, { status: 403 })
        }

        const summary = await env.DB.prepare(
          'select count(*) as count from queue'
        ).first<{ count: number | string }>()
        const queuedCount = Number(summary?.count ?? 0)
        if (queuedCount > 1) {
          return json(request, { error: 'Players available' }, { status: 409 })
        }

        const botCount = Math.max(
          0,
          Math.min(BOT_FILL_COUNT, MAX_MATCH_PLAYERS - 1)
        )
        const bots = await ensureBotAccounts(env, botCount)
        const match = await createMatchWithPlayers(env, [
          { id: session.accountId },
          ...bots.map((bot) => ({ id: bot.id })),
        ])

        await env.DB.prepare('delete from queue where account_id = ?1')
          .bind(session.accountId)
          .run()

        if (match) {
          await seedBotsInArena(env, match.id, bots)
        }
        return json(request, match)
      }

      if (request.method === 'POST' && pathname === '/api/matchmake') {
        await requireSession(env, request)
        const match = await tryMatchmake(env)
        return json(request, match)
      }

      if (request.method === 'GET' && pathname === '/api/matches/latest') {
        const session = await requireSession(env, request)
        const latest = await env.DB.prepare(
          `
          select mp.id as mp_id,
                 mp.match_id,
                 mp.account_id,
                 mp.joined_at,
                 mp.gems,
                 mp.placement,
                 m.id as m_id,
                 m.status,
                 m.created_at,
                 m.started_at,
                 m.ends_at,
                 m.seed
          from match_players mp
          join matches m on m.id = mp.match_id
          where mp.account_id = ?1
          order by m.created_at desc
          limit 1
        `
        )
          .bind(session.accountId)
          .first<{
            mp_id: string
            match_id: string
            account_id: string
            joined_at: string
            gems: number
            placement: number | null
            m_id: string
            status: MatchStatus
            created_at: string
            started_at: string | null
            ends_at: string | null
            seed: number | null
          }>()

        if (!latest) {
          return json(request, null)
        }

        return json(request, {
          match: {
            id: latest.m_id,
            status: latest.status,
            created_at: latest.created_at,
            started_at: latest.started_at,
            ends_at: latest.ends_at,
            seed: latest.seed,
          },
          player: {
            id: latest.mp_id,
            match_id: latest.match_id,
            account_id: latest.account_id,
            joined_at: latest.joined_at,
            gems: latest.gems,
            placement: latest.placement,
          },
        })
      }

    const matchRoute = pathname.match(
      /^\/api\/matches\/([^/]+)(?:\/(players|finalize))?$/
    )
    if (matchRoute) {
      const matchId = matchRoute[1]
      const action = matchRoute[2]

        if (request.method === 'GET' && !action) {
          const match = await env.DB.prepare(
            'select * from matches where id = ?1'
          )
            .bind(matchId)
            .first<MatchRow>()
          if (!match) {
            return new Response(null, { status: 404 })
          }
          return json(request, match)
        }

        if (request.method === 'GET' && action === 'players') {
          const result = await env.DB.prepare(
            `
            select mp.id,
                   mp.match_id,
                   mp.account_id,
                   mp.joined_at,
                   mp.left_at,
                   mp.eliminated_at,
                   mp.gems,
                   mp.placement,
                   a.handle as handle
            from match_players mp
            join accounts a on a.id = mp.account_id
            where mp.match_id = ?1
          `
          )
            .bind(matchId)
            .all<MatchPlayerRow & { handle: string }>()

          return json(request, result.results)
        }

      if (request.method === 'POST' && action === 'finalize') {
        const match = await finalizeMatch(env, matchId)
        if (!match) {
          return new Response(null, { status: 404 })
        }
        return json(request, match)
      }
    }

    if (request.method === 'POST' && pathname === '/api/matches/leave') {
      const session = await requireSession(env, request)
      const body = await parseJson<{ matchId?: string }>(request)
      if (!body.matchId) {
        return badRequest(request, 'Missing matchId')
      }
      const result = await endMatchIfSolo(env, body.matchId, session.accountId)
      if (result.ended) {
        const id = env.GAME.idFromName(body.matchId)
        const stub = env.GAME.get(id)
        await stub.fetch('https://internal/end', {
          method: 'POST',
          headers: {
            'X-Internal': '1',
          },
        })
      }
      return empty(request)
    }

    return new Response('Not found', { status: 404 })
    } catch (error) {
      if (error instanceof Response) {
        return error
      }
      const message = error instanceof Error ? error.message : 'Server error'
      return json(request, { error: message }, { status: 500 })
    }
  },
}
