import {
  cancelQueue,
  finalizeMatch,
  getMatch,
  getMatchPlayers,
  getMyLatestMatch,
  getQueueStatus,
  joinQueue,
  getMe,
  signIn,
  signOut,
  signUp,
  startQueueNow,
  startQueueWithBots,
  tryMatchmake,
} from './lib/gameApi'

const routeSections = Array.from(
  document.querySelectorAll<HTMLElement>('[data-route], [data-route-prefix]')
)
const routeLinks = Array.from(
  document.querySelectorAll<HTMLAnchorElement>('[data-route-link]')
)

if (routeSections.length === 0) {
  throw new Error('Missing route sections.')
}

type RouteInfo = {
  section: HTMLElement
  path: string
  param?: string
}

let currentCleanup: (() => void) | null = null
let currentAccount: { id: string; handle: string } | null = null
let postLoginRedirect: string | null = null
let gameLoaded = false
let currentPath = window.location.pathname

const updateLoginUI = () => {
  document.body.classList.toggle('is-logged-in', Boolean(currentAccount))
  const nameEl = document.querySelector<HTMLElement>('[data-player-name]')
  const metaEl = document.querySelector<HTMLElement>('[data-player-meta]')
  if (nameEl) {
    nameEl.textContent = currentAccount?.handle || 'Guest'
  }
  if (metaEl) {
    metaEl.textContent = currentAccount ? 'Signed in' : 'Not signed in'
  }
}

const normalizePath = (path: string) => {
  const clean = path.split('?')[0]?.split('#')[0] ?? '/'
  const trimmed = clean.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

const resolveRoute = (path: string): RouteInfo | null => {
  const exact = routeSections.find((section) => section.dataset.route === path)
  if (exact) {
    return { section: exact, path }
  }

  for (const section of routeSections) {
    const prefix = section.dataset.routePrefix
    if (!prefix) {
      continue
    }
    if (path.startsWith(prefix)) {
      const param = path.slice(prefix.length)
      return { section, path: prefix, param }
    }
  }

  return null
}

const setActiveRoute = async (path: string) => {
  const target = normalizePath(path)
  const routeInfo = resolveRoute(target)

  if (!routeInfo) {
    history.replaceState({}, '', '/')
    return setActiveRoute('/')
  }

  if (currentCleanup) {
    currentCleanup()
    currentCleanup = null
  }

  routeSections.forEach((section) => {
    section.classList.toggle('is-active', section === routeInfo.section)
  })

  currentPath = target

  if (routeInfo.path === '/') {
    currentCleanup = handleLandingRoute()
  } else if (routeInfo.path === '/play') {
    currentCleanup = handlePlayRoute()
  } else if (routeInfo.path === '/match/') {
    currentCleanup = handleMatchRoute(routeInfo.param || '')
  } else if (routeInfo.path === '/results/') {
    currentCleanup = handleResultsRoute(routeInfo.param || '')
  } else if (routeInfo.path === '/login') {
    currentCleanup = handleLoginRoute()
  } else if (routeInfo.path === '/profile') {
    currentCleanup = handleProfileRoute()
  }

  window.scrollTo(0, 0)
}

const pushRoute = (path: string) => {
  history.pushState({}, '', path)
  void setActiveRoute(path)
}

const handlePlayRoute = () => {
  if (!currentAccount) {
    postLoginRedirect = '/play'
    pushRoute('/login')
    return () => {}
  }

  const statusEl = document.querySelector<HTMLElement>('[data-queue-status]')
  const detailEl = document.querySelector<HTMLElement>('[data-queue-detail]')
  const joinButton = document.querySelector<HTMLButtonElement>(
    '[data-join-match]'
  )
  const cancelButton = document.querySelector<HTMLButtonElement>(
    '[data-cancel-queue]'
  )
  const queuePanel = document.querySelector<HTMLElement>('[data-queue-panel]')
  const queueWaitEl = document.querySelector<HTMLElement>('[data-queue-wait]')
  const queueListEl = document.querySelector<HTMLUListElement>(
    '[data-queue-list]'
  )
  const queueStartButton = document.querySelector<HTMLButtonElement>(
    '[data-queue-start]'
  )
  const queueBotsButton = document.querySelector<HTMLButtonElement>(
    '[data-queue-bots]'
  )

  if (!statusEl || !detailEl || !joinButton || !cancelButton) {
    throw new Error('Missing play route elements.')
  }
  if (
    !queuePanel ||
    !queueWaitEl ||
    !queueListEl ||
    !queueStartButton ||
    !queueBotsButton
  ) {
    throw new Error('Missing queue panel elements.')
  }

  let pollId: number | null = null
  let queueing = false
  let queueStartedAtMs = 0
  const botOfferMs = 5000

  const setQueueState = (isQueueing: boolean) => {
    queueing = isQueueing
    queueStartedAtMs = isQueueing ? performance.now() : 0
    joinButton.disabled = isQueueing
    cancelButton.hidden = !isQueueing
    statusEl.textContent = isQueueing ? 'Queueing...' : 'Ready to queue.'
    detailEl.textContent = isQueueing
      ? 'Finding another player...'
      : 'Click join to enter matchmaking.'
    queuePanel.hidden = !isQueueing
    queueStartButton.hidden = true
    queueBotsButton.hidden = true
  }

  const setQueueError = (message: string) => {
    statusEl.textContent = message
    detailEl.textContent = 'Please try again.'
  }

  const checkForMatch = async () => {
    const created = await tryMatchmake()
    if (created?.id) {
      pushRoute(`/match/${created.id}`)
      return
    }
    const latest = await getMyLatestMatch()
    if (!latest) {
      return
    }

    if (latest.match.status === 'active') {
      pushRoute(`/match/${latest.match.id}`)
    }
  }

  const startPolling = () => {
    if (pollId !== null) {
      return
    }
    pollId = window.setInterval(() => {
      void checkForMatch()
      void refreshQueueStatus()
    }, 1000)
  }

  const startQueue = async () => {
    try {
      setQueueState(true)
      const match = await joinQueue()
      if (match?.id) {
        pushRoute(`/match/${match.id}`)
        return
      }
      await checkForMatch()
      await refreshQueueStatus()
      startPolling()
    } catch (error) {
      setQueueState(false)
      setQueueError(
        error instanceof Error ? error.message : 'Failed to join queue.'
      )
    }
  }

  const stopQueue = async () => {
    if (pollId !== null) {
      window.clearInterval(pollId)
      pollId = null
    }
    try {
      await cancelQueue()
      setQueueState(false)
      queueListEl.innerHTML = ''
      queueWaitEl.textContent = 'Waiting for players...'
    } catch (error) {
      setQueueError(
        error instanceof Error ? error.message : 'Failed to cancel queue.'
      )
    }
  }

  const refreshQueueStatus = async () => {
    if (!queueing) {
      return
    }
    try {
      const status = await getQueueStatus()
      const waitingSeconds = Math.floor(status.waitingMs / 1000)
      queueWaitEl.textContent = `Players: ${status.count}/${status.maxPlayers} - Last join ${waitingSeconds}s ago`
      queueListEl.innerHTML = ''
      status.entries.forEach((entry) => {
        const item = document.createElement('li')
        item.textContent = entry.handle
        queueListEl.appendChild(item)
      })
      queueStartButton.hidden = status.count < status.minPlayers
      const localWaitMs = queueStartedAtMs
        ? performance.now() - queueStartedAtMs
        : 0
      const waitMs = Math.max(status.waitingMs, localWaitMs)
      queueBotsButton.hidden = status.count > 1 || waitMs < botOfferMs
    } catch (error) {
      queueWaitEl.textContent =
        error instanceof Error ? error.message : 'Unable to load queue.'
    }
  }

  void (async () => {
    try {
      const latest = await getMyLatestMatch()
      if (latest && latest.match.status === 'active') {
        pushRoute(`/match/${latest.match.id}`)
        return
      }
    } catch (error) {
      setQueueError(
        error instanceof Error ? error.message : 'Failed to load match.'
      )
    }
  })()

  const onJoin = () => {
    if (!queueing) {
      void startQueue()
    }
  }

  const onCancel = () => {
    void stopQueue().then(() => {
      pushRoute('/')
    })
  }

  const onStartNow = () => {
    if (!queueing) {
      return
    }
    void (async () => {
      const match = await startQueueNow()
      if (match?.id) {
        pushRoute(`/match/${match.id}`)
      }
    })()
  }

  const onPlayWithBots = () => {
    if (!queueing) {
      return
    }
    void (async () => {
      const match = await startQueueWithBots()
      if (match?.id) {
        pushRoute(`/match/${match.id}`)
      }
    })()
  }

  joinButton.addEventListener('click', onJoin)
  cancelButton.addEventListener('click', onCancel)
  queueStartButton.addEventListener('click', onStartNow)
  queueBotsButton.addEventListener('click', onPlayWithBots)
  setQueueState(false)

  return () => {
    joinButton.removeEventListener('click', onJoin)
    cancelButton.removeEventListener('click', onCancel)
    queueStartButton.removeEventListener('click', onStartNow)
    queueBotsButton.removeEventListener('click', onPlayWithBots)
    if (pollId !== null) {
      window.clearInterval(pollId)
      pollId = null
    }
  }
}

const handleLandingRoute = () => {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-arena-bg]')
  if (!canvas) {
    return () => {}
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return () => {}
  }

  const tilePath = new Path2D(
    'M 0 0 L 70 0 L 90 20 L 130 20 L 150 0 L 200 0 L 200 70 L 180 90 L 180 130 L 200 150 L 200 200 L 130 200 L 110 180 L 70 180 L 50 200 L 0 200 L 0 130 L 20 110 L 20 70 L 0 50 Z'
  )
  const tileSize = 80
  const spacing = tileSize
  let width = 0
  let height = 0
  let dpr = 1
  let rafId = 0

  const resize = () => {
    const bounds = canvas.parentElement?.getBoundingClientRect()
    width = bounds?.width ?? window.innerWidth
    height = bounds?.height ?? window.innerHeight
    dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const hash = (x: number, y: number) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    return v - Math.floor(v)
  }

  const draw = (timeMs: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const scale = tileSize / 200
    const cols = Math.ceil(width / spacing) + 2
    const rows = Math.ceil(height / spacing) + 2
    const offsetX = -spacing
    const offsetY = -spacing
    const active: Array<{ x: number; y: number; strength: number }> = []
    const activeSet = new Set<string>()
    const framePhase = Math.floor(timeMs / 1600) % 5

    ctx.save()
    ctx.lineWidth = 1
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        const cx = offsetX + i * spacing + spacing * 0.5
        const cy = offsetY + j * spacing + spacing * 0.5
        const seed = hash(i, j)
        const phase = timeMs * 0.0006 + seed * Math.PI * 2
        const pulse = (Math.sin(phase) + 1) * 0.5
        const strength = Math.max(0, (pulse - 0.9) / 0.1)
        if (strength > 0) {
          const group = (i + j * 7) % 5
          if (group !== framePhase) {
            continue
          }
          let blocked = false
          for (let dx = -1; dx <= 1 && !blocked; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
              if (activeSet.has(`${i + dx},${j + dy}`)) {
                blocked = true
                break
              }
            }
          }
          if (!blocked) {
            active.push({ x: cx, y: cy, strength })
            activeSet.add(`${i},${j}`)
          }
        }

        ctx.save()
        ctx.translate(cx, cy)
        ctx.scale(scale, scale)
        ctx.translate(-100, -100)
        ctx.fillStyle = 'rgba(10, 12, 14, 0.12)'
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)'
        ctx.fill(tilePath)
        ctx.stroke(tilePath)
        ctx.restore()
      }
    }
    ctx.restore()

    active.forEach(({ x, y, strength }) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(scale * (1 + strength * 0.08), scale * (1 + strength * 0.08))
      ctx.translate(-100, -100)
      ctx.fillStyle = 'rgba(12, 14, 16, 0.25)'
      ctx.strokeStyle = `rgba(55, 240, 106, ${0.12 + strength * 0.2})`
      ctx.lineWidth = 2 + strength * 2
      ctx.shadowColor = 'rgba(55, 240, 106, 0.35)'
      ctx.shadowBlur = 6 + strength * 6
      ctx.fill(tilePath)
      ctx.stroke(tilePath)
      ctx.restore()
    })

    rafId = window.requestAnimationFrame(draw)
  }

  resize()
  window.addEventListener('resize', resize)
  rafId = window.requestAnimationFrame(draw)

  return () => {
    window.removeEventListener('resize', resize)
    window.cancelAnimationFrame(rafId)
  }
}

const handleMatchRoute = (matchId: string) => {
  if (!matchId) {
    pushRoute('/')
    return () => {}
  }

  if (!currentAccount) {
    postLoginRedirect = `/match/${matchId}`
    pushRoute('/login')
    return () => {}
  }

  void (async () => {
    try {
      const latest = await getMyLatestMatch()
      if (!latest || latest.match.id !== matchId) {
        pushRoute('/play')
      }
    } catch {
      pushRoute('/play')
    }
  })()

  let pollId: number | null = null
  let finalizeStarted = false

  const refreshMatch = async () => {
    const match = await getMatch(matchId)

    const timeUp =
      match.ends_at !== null && new Date(match.ends_at).getTime() <= Date.now()

    if (match.status === 'complete') {
      pushRoute(`/results/${matchId}`)
      return
    }

    if (timeUp && !finalizeStarted) {
      finalizeStarted = true
      await finalizeMatch(matchId)
      pushRoute(`/results/${matchId}`)
    }
  }

  pollId = window.setInterval(() => {
    void refreshMatch()
  }, 1000)

  if (!gameLoaded) {
    gameLoaded = true
    void import('./main')
  }

  void refreshMatch()

  return () => {
    if (pollId !== null) {
      window.clearInterval(pollId)
    }
  }
}

const handleResultsRoute = (matchId: string) => {
  const statusEl = document.querySelector<HTMLElement>('[data-results-status]')
  const matchEl = document.querySelector<HTMLElement>('[data-results-match]')
  const placementEl = document.querySelector<HTMLElement>(
    '[data-results-placement]'
  )
  const gemsEl = document.querySelector<HTMLElement>('[data-results-gems]')
  const topList = document.querySelector<HTMLOListElement>('[data-results-top]')
  const tableBody = document.querySelector<HTMLTableSectionElement>(
    '[data-results-table]'
  )

  if (
    !statusEl ||
    !matchEl ||
    !placementEl ||
    !gemsEl ||
    !topList ||
    !tableBody
  ) {
    throw new Error('Missing results route elements.')
  }

  if (!matchId) {
    pushRoute('/')
    return () => {}
  }

  matchEl.textContent = matchId
  statusEl.textContent = 'Match complete. Queue again when ready.'

  void (async () => {
    try {
      const players = await getMatchPlayers(matchId)
      const me = currentAccount
        ? players.find((player) => player.account_id === currentAccount?.id)
        : null

      placementEl.textContent = me?.placement ? `${me.placement}` : '--'
      gemsEl.textContent = me ? `${me.gems}` : '0'

      const sorted = [...players].sort((a, b) => {
        if (a.placement && b.placement) {
          return a.placement - b.placement
        }
        return b.gems - a.gems
      })
      const top = sorted.slice(0, 3)
      topList.innerHTML = ''
      top.forEach((player, index) => {
        const item = document.createElement('li')
        const placement = player.placement ?? index + 1
        const isYou = player.account_id === currentAccount?.id
        const name =
          isYou
            ? 'You'
            : player.handle ||
              (player.account_id ? `P${player.account_id.slice(0, 4)}` : 'Player')
        item.textContent = `#${placement}  ${name}  ${player.gems} tokens`
        topList.appendChild(item)
      })

      tableBody.innerHTML = ''
      sorted.forEach((player, index) => {
        const row = document.createElement('tr')
        const placement = player.placement ?? index + 1
        const isYou = player.account_id === currentAccount?.id
        const name =
          isYou
            ? 'You'
            : player.handle ||
              (player.account_id ? `P${player.account_id.slice(0, 4)}` : 'Player')
        const placementCell = document.createElement('td')
        placementCell.textContent = `#${placement}`
        const nameCell = document.createElement('td')
        nameCell.textContent = name
        const gemsCell = document.createElement('td')
        gemsCell.textContent = `${player.gems}`
        row.appendChild(placementCell)
        row.appendChild(nameCell)
        row.appendChild(gemsCell)
        tableBody.appendChild(row)
      })
    } catch {
      statusEl.textContent = 'Unable to load results.'
    }
  })()

  return () => {}
}

const handleLoginRoute = () => {
  const statusEl = document.querySelector<HTMLElement>('[data-profile-status]')
  const handleInput = document.querySelector<HTMLInputElement>(
    '[data-profile-handle]'
  )
  const passwordInput = document.querySelector<HTMLInputElement>(
    '[data-profile-password]'
  )
  const saveButton = document.querySelector<HTMLButtonElement>(
    '[data-profile-save]'
  )
  const loginButton = document.querySelector<HTMLButtonElement>(
    '[data-profile-login]'
  )

  if (
    !statusEl ||
    !handleInput ||
    !passwordInput ||
    !saveButton ||
    !loginButton
  ) {
    throw new Error('Missing login route elements.')
  }

  const renderProfile = () => {
    if (currentAccount) {
      statusEl.textContent = `Signed in as ${currentAccount.handle}.`
      handleInput.value = currentAccount.handle
      passwordInput.value = ''
    } else {
      statusEl.textContent = 'Not signed in.'
      handleInput.value = ''
      passwordInput.value = ''
    }
  }

  const onSignup = async () => {
    const handle = handleInput.value.trim()
    const password = passwordInput.value.trim()
    if (!handle || !password) {
      statusEl.textContent = 'Enter handle and password.'
      return
    }
    try {
      currentAccount = await signUp(handle, password)
      updateLoginUI()
      renderProfile()
      if (postLoginRedirect) {
        const target = postLoginRedirect
        postLoginRedirect = null
        pushRoute(target)
      } else {
        pushRoute('/play')
      }
    } catch (error) {
      statusEl.textContent =
        error instanceof Error ? error.message : 'Sign up failed.'
    }
  }

  const onLogin = async () => {
    const handle = handleInput.value.trim()
    const password = passwordInput.value.trim()
    if (!handle || !password) {
      statusEl.textContent = 'Enter handle and password.'
      return
    }
    try {
      currentAccount = await signIn(handle, password)
      updateLoginUI()
      renderProfile()
      if (postLoginRedirect) {
        const target = postLoginRedirect
        postLoginRedirect = null
        pushRoute(target)
      } else {
        pushRoute('/play')
      }
    } catch (error) {
      statusEl.textContent =
        error instanceof Error ? error.message : 'Login failed.'
    }
  }

  saveButton.addEventListener('click', onSignup)
  loginButton.addEventListener('click', onLogin)
  renderProfile()

  return () => {
    saveButton.removeEventListener('click', onSignup)
    loginButton.removeEventListener('click', onLogin)
  }
}

const handleProfileRoute = () => {
  const handleEl = document.querySelector<HTMLElement>(
    '[data-profile-handle-readonly]'
  )
  const logoutButton = document.querySelector<HTMLButtonElement>(
    '[data-profile-logout]'
  )

  if (!handleEl || !logoutButton) {
    throw new Error('Missing profile route elements.')
  }

  if (!currentAccount) {
    pushRoute('/login')
    return () => {}
  }

  handleEl.textContent = currentAccount.handle

  const onLogout = async () => {
    try {
      await signOut()
      currentAccount = null
      updateLoginUI()
      pushRoute('/')
    } catch {
      pushRoute('/login')
    }
  }

  logoutButton.addEventListener('click', onLogout)

  return () => {
    logoutButton.removeEventListener('click', onLogout)
  }
}

routeLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault()
    const href = link.getAttribute('href') || '/'
    const target = normalizePath(href)
    if (target === '/play' && !currentAccount) {
      postLoginRedirect = '/play'
      pushRoute('/login')
      return
    }
    if (
      target === '/' &&
      (currentPath.startsWith('/match/') || currentPath.startsWith('/results/'))
    ) {
      window.location.href = '/'
      return
    }
    pushRoute(target)
  })
})

window.addEventListener('popstate', () => {
  void setActiveRoute(window.location.pathname)
})

const boot = async () => {
  const signoutButton = document.querySelector<HTMLButtonElement>('[data-signout]')
  if (signoutButton) {
    signoutButton.addEventListener('click', async () => {
      try {
        await signOut()
      } finally {
        currentAccount = null
        updateLoginUI()
        pushRoute('/')
      }
    })
  }
  currentAccount = await getMe()
  updateLoginUI()
  await setActiveRoute(window.location.pathname)
}

void boot()
