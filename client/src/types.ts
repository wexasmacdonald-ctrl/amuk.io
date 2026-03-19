export type Vec2 = {
  x: number
  y: number
}

export type Viewport = {
  width: number
  height: number
  dpr: number
}

export type RenderPlayer = {
  id: string
  position: Vec2
  heading: number
  eliminated: boolean
  isLocal: boolean
  alpha?: number
}

export type Gem = {
  id: string
  tier: 'common' | 'uncommon' | 'rare'
  valuePoints: number
  x: number
  y: number
  radius: number
}

export type RoundInfo = {
  roundId: number
  state: 'running' | 'ending' | 'resetting'
  roundStartMs: number
  elapsedMs: number
  roundEndAtMs: number
  currentInradius?: number
}

export type RoundEndPayload = {
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

export type HudInfo = {
  pingMs: number
  playerCount: number
  clientId: string
  snapshotRate: number
  avgFrameMs: number
  smoothPos: number
  smoothAng: number
  matchGemPoints: number
  round: RoundInfo | null
  showPrizeDebug: boolean
  gemTotal: number
  gemCommon: number
  gemUncommon: number
  gemRare: number
  aliveCount: number
  leaderboard: Array<{ id: string; handle?: string; matchGemPoints: number }>
}
