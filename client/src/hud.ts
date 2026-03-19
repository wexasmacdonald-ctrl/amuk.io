import { distanceToOctagonEdge } from './simulation'
import type { SimulationState } from './simulation'
import type { HudInfo, Viewport } from './types'

const FONT_MONO = '"JetBrains Mono", "Consolas", monospace'
const FONT_DISPLAY = '"Space Grotesk", system-ui, sans-serif'

const NEON_GREEN = '#37f06a'
const NEON_CYAN = '#00f0ff'
const NEON_PINK = '#ff2d7b'
const NEON_GOLD = '#ffd36a'
const INK = 'rgba(238, 240, 242, 0.9)'
const INK_MUTED = 'rgba(107, 114, 128, 0.9)'
const INK_DIM = 'rgba(59, 64, 72, 0.9)'

export const renderHud = (
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  viewport: Viewport,
  paused: boolean,
  hudInfo: HudInfo
) => {
  drawDangerVignette(ctx, state, viewport)
  drawTopBar(ctx, hudInfo, viewport)
  drawLeaderboard(ctx, hudInfo, viewport)
  drawDebugPanel(ctx, state, hudInfo)

  if (state.eliminated) {
    drawEliminatedOverlay(ctx, viewport)
  } else if (paused) {
    drawPausedOverlay(ctx, viewport)
  }
}

/* ═══════════ TOP BAR — Timer, Alive, Score ═══════════ */
const drawTopBar = (
  ctx: CanvasRenderingContext2D,
  hudInfo: HudInfo,
  viewport: Viewport
) => {
  const cx = viewport.width / 2

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  // Timer
  if (hudInfo.round) {
    const remaining = Math.max(
      0,
      Math.ceil((hudInfo.round.roundEndAtMs - hudInfo.round.roundStartMs - hudInfo.round.elapsedMs) / 1000)
    )
    const minutes = Math.floor(remaining / 60)
    const seconds = remaining % 60
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
    const isLow = remaining <= 30
    const isCritical = remaining <= 10

    // Timer background pill
    const pillWidth = 100
    const pillHeight = 38
    ctx.fillStyle = 'rgba(8, 10, 14, 0.75)'
    ctx.strokeStyle = isLow ? 'rgba(255, 45, 123, 0.3)' : 'rgba(55, 240, 106, 0.15)'
    ctx.lineWidth = 1
    roundRect(ctx, cx - pillWidth / 2, 12, pillWidth, pillHeight, 8)
    ctx.fill()
    ctx.stroke()

    ctx.font = `700 22px ${FONT_MONO}`
    ctx.fillStyle = isCritical ? NEON_PINK : isLow ? NEON_GOLD : INK
    if (isLow) {
      ctx.shadowColor = isCritical ? NEON_PINK : NEON_GOLD
      ctx.shadowBlur = 16
    }
    ctx.fillText(timeStr, cx, 19)
    ctx.shadowBlur = 0
  }

  // Alive count
  ctx.font = `500 10px ${FONT_MONO}`
  ctx.fillStyle = INK_DIM
  ctx.letterSpacing = '0.1em'
  ctx.fillText(
    `${hudInfo.aliveCount} ALIVE / ${hudInfo.playerCount} TOTAL`,
    cx,
    56
  )

  // Gem score — prominent below timer
  ctx.font = `700 16px ${FONT_DISPLAY}`
  ctx.fillStyle = NEON_GREEN
  ctx.shadowColor = NEON_GREEN
  ctx.shadowBlur = 8
  ctx.fillText(`${hudInfo.matchGemPoints}`, cx - 4, 72)
  ctx.shadowBlur = 0
  ctx.font = `500 10px ${FONT_MONO}`
  ctx.fillStyle = INK_MUTED
  ctx.fillText('GEMS', cx + 26, 75)

  ctx.restore()
}

/* ═══════════ LEADERBOARD ═══════════ */
const drawLeaderboard = (
  ctx: CanvasRenderingContext2D,
  hudInfo: HudInfo,
  viewport: Viewport
) => {
  if (!hudInfo.leaderboard.length) {
    return
  }

  const x = viewport.width - 16
  const startY = 16

  ctx.save()

  // Background panel
  const panelWidth = 160
  const panelHeight = 12 + hudInfo.leaderboard.length * 22 + 8
  ctx.fillStyle = 'rgba(8, 10, 14, 0.65)'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.lineWidth = 1
  roundRect(ctx, x - panelWidth, startY, panelWidth, panelHeight, 8)
  ctx.fill()
  ctx.stroke()

  // Header
  ctx.font = `500 9px ${FONT_MONO}`
  ctx.fillStyle = INK_DIM
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('LEADERS', x - panelWidth + 10, startY + 8)

  // Entries
  ctx.font = `500 11px ${FONT_MONO}`
  hudInfo.leaderboard.forEach((entry, index) => {
    const y = startY + 22 + index * 22
    const name = entry.handle || shortId(entry.id)
    const rankColors = [NEON_GOLD, INK_MUTED, INK_DIM]
    const color = rankColors[index] ?? INK_DIM

    ctx.textAlign = 'left'
    ctx.fillStyle = color
    ctx.fillText(`${index + 1}`, x - panelWidth + 10, y)

    ctx.fillStyle = INK
    ctx.fillText(name, x - panelWidth + 28, y)

    ctx.textAlign = 'right'
    ctx.fillStyle = NEON_GREEN
    ctx.fillText(`${entry.matchGemPoints}`, x - 10, y)
  })

  ctx.restore()
}

/* ═══════════ DEBUG PANEL (bottom-left, subtle) ═══════════ */
const drawDebugPanel = (
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  hudInfo: HudInfo
) => {
  if (!hudInfo.showPrizeDebug) {
    // Minimal info when debug is off
    ctx.save()
    ctx.font = `400 10px ${FONT_MONO}`
    ctx.fillStyle = INK_DIM
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`${hudInfo.pingMs}ms  ${hudInfo.snapshotRate}/s`, 14, 14)
    ctx.restore()
    return
  }

  const lines = [
    `PING ${hudInfo.pingMs}ms`,
    `SNAP ${hudInfo.snapshotRate}/s`,
    `FRAME ${hudInfo.avgFrameMs.toFixed(1)}ms`,
    `PLAYERS ${hudInfo.playerCount}`,
    `POS ${state.player.position.x.toFixed(0)}, ${state.player.position.y.toFixed(0)}`,
    `GEMS C${hudInfo.gemCommon} U${hudInfo.gemUncommon} R${hudInfo.gemRare}`,
  ]

  if (hudInfo.round) {
    lines.push(`ROUND ${hudInfo.round.roundId} ${hudInfo.round.state}`)
  }

  ctx.save()
  ctx.font = `400 10px ${FONT_MONO}`
  ctx.fillStyle = INK_DIM
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  lines.forEach((line, i) => {
    ctx.fillText(line, 14, 14 + i * 14)
  })
  ctx.restore()
}

/* ═══════════ ELIMINATED OVERLAY ═══════════ */
const drawEliminatedOverlay = (
  ctx: CanvasRenderingContext2D,
  viewport: Viewport
) => {
  const cx = viewport.width / 2
  const cy = viewport.height / 2

  ctx.save()

  // Dark overlay
  ctx.fillStyle = 'rgba(5, 6, 8, 0.7)'
  ctx.fillRect(0, 0, viewport.width, viewport.height)

  // Accent line
  ctx.strokeStyle = NEON_PINK
  ctx.lineWidth = 2
  ctx.shadowColor = NEON_PINK
  ctx.shadowBlur = 20
  ctx.beginPath()
  ctx.moveTo(cx - 120, cy - 30)
  ctx.lineTo(cx + 120, cy - 30)
  ctx.stroke()
  ctx.shadowBlur = 0

  // Title
  ctx.fillStyle = NEON_PINK
  ctx.font = `700 42px ${FONT_DISPLAY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.letterSpacing = '0.1em'
  ctx.shadowColor = NEON_PINK
  ctx.shadowBlur = 24
  ctx.fillText('ELIMINATED', cx, cy)
  ctx.shadowBlur = 0

  // Sub text
  ctx.font = `400 13px ${FONT_MONO}`
  ctx.fillStyle = INK_MUTED
  ctx.fillText('Spectating...', cx, cy + 32)

  ctx.restore()
}

/* ═══════════ PAUSED OVERLAY ═══════════ */
const drawPausedOverlay = (
  ctx: CanvasRenderingContext2D,
  viewport: Viewport
) => {
  const cx = viewport.width / 2
  const cy = viewport.height / 2

  ctx.save()
  ctx.fillStyle = 'rgba(5, 6, 8, 0.7)'
  ctx.fillRect(0, 0, viewport.width, viewport.height)

  ctx.fillStyle = NEON_CYAN
  ctx.font = `700 36px ${FONT_DISPLAY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = NEON_CYAN
  ctx.shadowBlur = 20
  ctx.fillText('PAUSED', cx, cy - 12)
  ctx.shadowBlur = 0

  ctx.font = `400 12px ${FONT_MONO}`
  ctx.fillStyle = INK_MUTED
  ctx.fillText('Press P or click to resume', cx, cy + 20)

  ctx.restore()
}

/* ═══════════ DANGER VIGNETTE ═══════════ */
const drawDangerVignette = (
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  viewport: Viewport
) => {
  const threshold = state.world.inradius * 0.15
  const edgeDistance = distanceToOctagonEdge(
    state.player.position,
    state.world.inradius
  )
  const danger = clamp(1 - edgeDistance / threshold, 0, 1)

  if (danger <= 0) {
    return
  }

  ctx.save()
  const centerX = viewport.width / 2
  const centerY = viewport.height / 2
  const radius = Math.max(viewport.width, viewport.height) * 0.55
  const gradient = ctx.createRadialGradient(
    centerX,
    centerY,
    radius * 0.3,
    centerX,
    centerY,
    radius
  )
  const alpha = 0.5 * danger
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
  gradient.addColorStop(0.7, `rgba(255, 45, 123, ${(alpha * 0.3).toFixed(3)})`)
  gradient.addColorStop(1, `rgba(255, 45, 123, ${alpha.toFixed(3)})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, viewport.width, viewport.height)
  ctx.restore()
}

/* ═══════════ UTILS ═══════════ */
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const shortId = (id: string) => (id.length > 4 ? id.slice(0, 4) : id)

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
