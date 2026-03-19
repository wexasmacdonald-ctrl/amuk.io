export type InputState = {
  mouseX: number
  mouseY: number
  hasMouse: boolean
  moving: boolean
  pauseRequested: boolean
  showPrizeDebug: boolean
  resetRequested: boolean
}

export const createInput = (canvas: HTMLCanvasElement): InputState => {
  const state: InputState = {
    mouseX: 0,
    mouseY: 0,
    hasMouse: false,
    moving: false,
    pauseRequested: false,
    showPrizeDebug: false,
    resetRequested: false,
  }

  const updateFromPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    state.mouseX = event.clientX - rect.left
    state.mouseY = event.clientY - rect.top
    state.hasMouse = true
  }

  canvas.addEventListener('pointermove', updateFromPointer)
  canvas.addEventListener('pointerdown', (event) => {
    updateFromPointer(event)
    state.moving = true
  })
  canvas.addEventListener('pointerup', () => {
    state.moving = false
  })
  canvas.addEventListener('pointerenter', updateFromPointer)
  canvas.addEventListener('pointerleave', () => {
    state.hasMouse = false
    state.moving = false
  })

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      return
    }
    if (event.key === 'p' || event.key === 'P' || event.key === 'Escape') {
      state.pauseRequested = true
    }
    if (event.key === 'k' || event.key === 'K') {
      state.showPrizeDebug = !state.showPrizeDebug
    }
    if (event.key === 'r' || event.key === 'R') {
      state.resetRequested = true
    }
  })

  return state
}
