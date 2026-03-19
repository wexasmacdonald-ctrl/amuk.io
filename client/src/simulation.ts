import type { InputState } from './input'
import type { Vec2, Viewport } from './types'

export type PlayerState = {
  position: Vec2
  heading: number
  speed: number
  radius: number
}

export type SimulationState = {
  player: PlayerState
  world: {
    inradius: number
    cornerRadius: number
  }
  exit: {
    position: Vec2
    outerRadius: number
    innerRadius: number
  }
  eliminated: boolean
  eliminatedTimer: number
  eliminatedCount: number
}

// Inradius is the center-to-flat-side distance for the map octagon.
const WORLD_INRADIUS = 2500
export const PLAYER_SPEED = 220
export const PLAYER_RADIUS = 18

export const createSimulation = (): SimulationState => ({
  player: {
    position: { x: 0, y: 0 },
    heading: 0,
    speed: PLAYER_SPEED,
    radius: PLAYER_RADIUS,
  },
  world: {
    inradius: WORLD_INRADIUS,
    cornerRadius: WORLD_INRADIUS / Math.cos(Math.PI / 8),
  },
  exit: {
    position: { x: 0, y: 0 },
    outerRadius: 140,
    innerRadius: 90,
  },
  eliminated: false,
  eliminatedTimer: 0,
  eliminatedCount: 0,
})

const resetPlayer = (state: SimulationState) => {
  state.player.position.x = 0
  state.player.position.y = 0
  state.player.heading = 0
  state.eliminated = false
  state.eliminatedTimer = 0
}

export const updateSimulation = (
  state: SimulationState,
  dt: number,
  input: InputState,
  viewport: Viewport
) => {
  if (state.eliminated) {
    state.eliminatedTimer += dt
    if (state.eliminatedTimer >= 1) {
      resetPlayer(state)
    }
    return
  }

  if (input.hasMouse) {
    const dx = input.mouseX - viewport.width / 2
    const dy = input.mouseY - viewport.height / 2
    if (Math.abs(dx) + Math.abs(dy) > 0.001) {
      state.player.heading = Math.atan2(dy, dx)
    }
  }

  state.player.position.x += Math.cos(state.player.heading) * state.player.speed * dt
  state.player.position.y += Math.sin(state.player.heading) * state.player.speed * dt

  if (!isInsideOctagon(state.player.position, state.world.inradius)) {
    state.eliminated = true
    state.eliminatedTimer = 0
    state.eliminatedCount += 1
  }
}

export const isInsideOctagon = (point: Vec2, inradius: number) => {
  const absX = Math.abs(point.x)
  const absY = Math.abs(point.y)
  if (absX > inradius || absY > inradius) {
    return false
  }
  return absX + absY <= inradius * Math.SQRT2
}

export const distanceToOctagonEdge = (point: Vec2, inradius: number) => {
  const absX = Math.abs(point.x)
  const absY = Math.abs(point.y)
  const dx = inradius - absX
  const dy = inradius - absY
  const d45 = (inradius * Math.SQRT2 - (absX + absY)) / Math.SQRT2
  return Math.min(dx, dy, d45)
}
