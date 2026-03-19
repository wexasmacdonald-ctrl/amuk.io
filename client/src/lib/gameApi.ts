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
  handle?: string
}

type QueueStatus = {
  count: number
  maxPlayers: number
  minPlayers: number
  autoStartAfterMs: number
  waitingMs: number
  entries: Array<{
    id: string
    handle: string
    joinedAt: string
  }>
}

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ||
  'http://localhost:8080'

const SESSION_KEY = 'session_id'

const apiRequest = async <T>(path: string, options?: RequestInit) => {
  const sessionId = localStorage.getItem(SESSION_KEY)
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
      ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {}),
    },
    credentials: 'include',
    ...options,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || response.statusText)
  }

  if (response.status === 204) {
    return null as T
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const text = await response.text()
    throw new Error(text || 'Unexpected response.')
  }

  try {
    return (await response.json()) as T
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Failed to parse response.'
    )
  }
}

type AccountRow = {
  id: string
  handle: string
}

type AuthResponse = AccountRow & { sessionId: string }

export const getMe = async () => {
  return apiRequest<AccountRow | null>('/api/auth/me', { method: 'GET' })
}

export const signUp = async (handle: string, password: string) => {
  const response = await apiRequest<AuthResponse>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ handle, password }),
  })
  localStorage.setItem(SESSION_KEY, response.sessionId)
  return { id: response.id, handle: response.handle }
}

export const signIn = async (handle: string, password: string) => {
  const response = await apiRequest<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ handle, password }),
  })
  localStorage.setItem(SESSION_KEY, response.sessionId)
  return { id: response.id, handle: response.handle }
}

export const signOut = async () => {
  await apiRequest('/api/auth/logout', { method: 'POST' })
  localStorage.removeItem(SESSION_KEY)
}

export const joinQueue = async () => {
  const response = await apiRequest<MatchRow | null>('/api/queue/join', {
    method: 'POST',
  })
  return response
}

export const cancelQueue = async () => {
  await apiRequest('/api/queue/cancel', {
    method: 'POST',
  })
}

export const getQueueStatus = async () => {
  return apiRequest<QueueStatus>('/api/queue/status')
}

export const startQueueNow = async () => {
  return apiRequest<MatchRow | null>('/api/queue/start', {
    method: 'POST',
  })
}

export const startQueueWithBots = async () => {
  return apiRequest<MatchRow | null>('/api/queue/bots', {
    method: 'POST',
  })
}

export const tryMatchmake = async () => {
  return apiRequest<MatchRow | null>('/api/matchmake', { method: 'POST' })
}

export const getMyLatestMatch = async () => {
  return apiRequest<{
    match: MatchRow
    player: MatchPlayerRow
  } | null>('/api/matches/latest')
}

export const getMatch = async (matchId: string) => {
  return apiRequest<MatchRow>(`/api/matches/${matchId}`)
}

export const getMatchPlayers = async (matchId: string) => {
  return apiRequest<MatchPlayerRow[]>(`/api/matches/${matchId}/players`)
}

export const finalizeMatch = async (matchId: string) => {
  return apiRequest<MatchRow>(`/api/matches/${matchId}/finalize`, {
    method: 'POST',
  })
}

export const leaveMatch = async (matchId: string) => {
  await apiRequest('/api/matches/leave', {
    method: 'POST',
    body: JSON.stringify({ matchId }),
  })
}
