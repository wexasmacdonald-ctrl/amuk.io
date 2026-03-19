import type { Vec2, Viewport } from './types'

export type Camera = {
  offsetX: number
  offsetY: number
}

export const createCamera = (playerPosition: Vec2, viewport: Viewport): Camera => ({
  offsetX: viewport.width / 2 - playerPosition.x,
  offsetY: viewport.height / 2 - playerPosition.y,
})
