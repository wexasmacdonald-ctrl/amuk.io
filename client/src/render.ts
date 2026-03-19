import type { Camera } from './camera'
import { isInsideOctagon } from './simulation'
import type { SimulationState } from './simulation'
import type { Gem, RenderPlayer, Viewport } from './types'

const BACKGROUND_COOL = { r: 8, g: 10, b: 12 }
const BACKGROUND_WARM = { r: 14, g: 16, b: 18 }
const NEON_PLAYER = '#37f06a'
const NEON_REMOTE = '#8b8f97'
const NEON_EXIT = '#37f06a'
const NEON_BOUNDS = 'rgba(255, 255, 255, 0.14)'
const TILE_SIZE = 96
const TILE_HIGHLIGHT_RADIUS = 90
const TILE_FADE_IN = 12
const TILE_FADE_OUT = 10
let lastTimeMs = 0
const tileGlow = new Map<string, number>()
const TILE_PATH = new Path2D(
  'M 0 0 L 70 0 L 90 20 L 130 20 L 150 0 L 200 0 L 200 70 L 180 90 L 180 130 L 200 150 L 200 200 L 130 200 L 110 180 L 70 180 L 50 200 L 0 200 L 0 130 L 20 110 L 20 70 L 0 50 Z'
)

export const renderWorld = (
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  camera: Camera,
  viewport: Viewport,
  players: RenderPlayer[],
  gems: Gem[],
  timeMs: number
) => {
  ctx.save()
  drawArenaFloor(ctx, state, viewport)

  ctx.translate(camera.offsetX, camera.offsetY)
  drawArenaTiles(ctx, state, camera, viewport, timeMs)
  drawWorldBounds(ctx, state)
  drawExit(ctx, state)
  drawGems(ctx, gems, timeMs)
  players.forEach((player) => {
    drawPlayer(ctx, player)
  })
  ctx.restore()
}

const drawWorldBounds = (ctx: CanvasRenderingContext2D, state: SimulationState) => {
  const { inradius } = state.world
  ctx.save()
  ctx.strokeStyle = NEON_BOUNDS
  ctx.lineWidth = 2
  ctx.setLineDash([12, 12])
  pathOctagon(ctx, inradius)
  ctx.stroke()
  ctx.restore()
}

const drawArenaFloor = (
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  viewport: Viewport
) => {
  const background = getBackgroundTint(state)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, viewport.width, viewport.height)
}

const drawArenaTiles = (
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  camera: Camera,
  viewport: Viewport,
  timeMs: number
) => {
  const { inradius } = state.world
  const spacing = TILE_SIZE
  const margin = spacing * 2
  const minX = -camera.offsetX - margin
  const maxX = viewport.width - camera.offsetX + margin
  const minY = -camera.offsetY - margin
  const maxY = viewport.height - camera.offsetY + margin
  const startX = Math.floor(minX / spacing) * spacing
  const startY = Math.floor(minY / spacing) * spacing
  const scale = TILE_SIZE / 200
  const player = state.player.position
  const dt = Math.min((timeMs - lastTimeMs) / 1000, 0.05)
  lastTimeMs = timeMs
  const seen = new Set<string>()
  const activeSet = new Set<string>()

  ctx.save()
  ctx.lineWidth = 1
  const activeTiles: Array<{ cx: number; cy: number; value: number }> = []
  for (let x = startX; x <= maxX; x += spacing) {
    for (let y = startY; y <= maxY; y += spacing) {
      const cx = x + spacing * 0.5
      const cy = y + spacing * 0.5
      if (!isInsideOctagon({ x: cx, y: cy }, inradius + spacing)) {
        continue
      }

      const ix = Math.round(x / spacing)
      const iy = Math.round(y / spacing)
      const key = `${ix},${iy}`
      const dx = player.x - cx
      const dy = player.y - cy
      const dist = Math.hypot(dx, dy)
      const eligibleMask = ix % 2 === 0 && iy % 2 === 0
      let eligible = eligibleMask && dist < TILE_HIGHLIGHT_RADIUS
      if (eligible) {
        for (let ox = -1; ox <= 1 && eligible; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            if (ox === 0 && oy === 0) {
              continue
            }
            if (activeSet.has(`${ix + ox},${iy + oy}`)) {
              eligible = false
              break
            }
          }
        }
      }
      const target = eligible ? 1 - dist / TILE_HIGHLIGHT_RADIUS : 0
      const current = tileGlow.get(key) ?? 0
      const speed = target > current ? TILE_FADE_IN : TILE_FADE_OUT
      const smooth = 1 - Math.exp(-speed * dt)
      const value = target === 0 ? 0 : current + (target - current) * smooth
      tileGlow.set(key, value)
      seen.add(key)

      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(scale, scale)
      ctx.translate(-100, -100)
      const baseAlpha = 0.5
      ctx.fillStyle = 'rgba(16, 18, 20, 0.95)'
      ctx.strokeStyle = `rgba(200, 205, 210, ${baseAlpha})`
      ctx.lineWidth = 1
      ctx.fill(TILE_PATH)
      ctx.stroke(TILE_PATH)
      ctx.restore()

      if (value > 0.01) {
        activeSet.add(key)
        activeTiles.push({ cx, cy, value })
      }
    }
  }
  activeTiles.forEach(({ cx, cy, value }) => {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    ctx.translate(-100, -100)
    const scaleBoost = 1 + value * 0.35
    ctx.fillStyle = 'rgba(11, 12, 14, 0.95)'
    ctx.strokeStyle = `rgba(55, 240, 106, ${0.6 + value * 0.5})`
    ctx.lineWidth = 1 + value * 1.5
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
    ctx.shadowBlur = 4 + value * 6
    ctx.scale(scaleBoost, scaleBoost)
    ctx.fill(TILE_PATH)
    ctx.stroke(TILE_PATH)
    ctx.restore()
  })
  for (const [key, value] of tileGlow) {
    if (!seen.has(key) && value < 0.02) {
      tileGlow.delete(key)
    }
  }
  ctx.restore()
}

const drawExit = (ctx: CanvasRenderingContext2D, state: SimulationState) => {
  const { position, outerRadius, innerRadius } = state.exit
  ctx.save()
  ctx.fillStyle = 'rgba(120, 255, 200, 0.08)'
  ctx.beginPath()
  ctx.arc(position.x, position.y, outerRadius * 0.75, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  drawGlowRing(ctx, position.x, position.y, outerRadius, NEON_EXIT, 10, 18)
  drawGlowRing(ctx, position.x, position.y, innerRadius, NEON_EXIT, 6, 14)
}

const drawPlayer = (ctx: CanvasRenderingContext2D, player: RenderPlayer) => {
  const color = player.isLocal ? NEON_PLAYER : NEON_REMOTE
  const alpha = player.alpha ?? (player.eliminated ? 0.35 : 1)
  const radius = 18
  drawGlowRing(ctx, player.position.x, player.position.y, radius, color, 6, 12, alpha)

  const indicatorLength = radius * 0.9
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.shadowColor = color
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.moveTo(player.position.x, player.position.y)
  ctx.lineTo(
    player.position.x + Math.cos(player.heading) * indicatorLength,
    player.position.y + Math.sin(player.heading) * indicatorLength
  )
  ctx.stroke()
  ctx.restore()
}

const drawGems = (ctx: CanvasRenderingContext2D, gems: Gem[], timeMs: number) => {
  gems.forEach((gem) => {
    const phase = timeMs * 0.006 + hashId(gem.id)
    const isRare = gem.tier === 'rare'
    const strength = isRare ? 0.14 : 0.08
    const pulse = 1 + Math.sin(phase) * strength
    const radius = gem.radius * pulse
    const color =
      gem.tier === 'common'
        ? '#7ee6ff'
        : gem.tier === 'uncommon'
        ? '#a9ff7b'
        : '#ffd36a'
    const glow = isRare ? 18 : gem.tier === 'uncommon' ? 12 : 8
    const width = isRare ? 5 : gem.tier === 'uncommon' ? 4 : 3

    ctx.save()
    ctx.fillStyle = `${color}22`
    ctx.beginPath()
    ctx.arc(gem.x, gem.y, radius * 0.7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    drawGlowRing(ctx, gem.x, gem.y, radius, color, width, glow)
  })
}

const hashId = (id: string) => {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 997
  }
  return hash
}

const drawGlowRing = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  width: number,
  blur: number,
  alpha = 1
) => {
  ctx.save()
  ctx.strokeStyle = toRgba(color, alpha)
  ctx.lineWidth = width
  ctx.shadowColor = toRgba(color, alpha)
  ctx.shadowBlur = blur
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

const pathOctagon = (ctx: CanvasRenderingContext2D, inradius: number) => {
  const vertices = getOctagonVertices(inradius)
  ctx.beginPath()
  ctx.moveTo(vertices[0].x, vertices[0].y)
  for (let i = 1; i < vertices.length; i += 1) {
    ctx.lineTo(vertices[i].x, vertices[i].y)
  }
  ctx.closePath()
}

const getOctagonVertices = (inradius: number) => {
  const k = inradius * (Math.SQRT2 - 1)
  return [
    { x: inradius, y: k },
    { x: k, y: inradius },
    { x: -k, y: inradius },
    { x: -inradius, y: k },
    { x: -inradius, y: -k },
    { x: -k, y: -inradius },
    { x: k, y: -inradius },
    { x: inradius, y: -k },
  ]
}

export const getBackgroundTint = (state: SimulationState) => {
  const dist = Math.hypot(state.player.position.x, state.player.position.y)
  const maxDist = state.world.cornerRadius
  const t = clamp(dist / maxDist, 0, 1)
  const r = Math.round(lerp(BACKGROUND_COOL.r, BACKGROUND_WARM.r, t))
  const g = Math.round(lerp(BACKGROUND_COOL.g, BACKGROUND_WARM.g, t))
  const b = Math.round(lerp(BACKGROUND_COOL.b, BACKGROUND_WARM.b, t))
  return `rgb(${r}, ${g}, ${b})`
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const toRgba = (hex: string, alpha: number) => {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
