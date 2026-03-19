export type GameDefinition = {
  id: string
  name: string
  description: string
  minPlayers: number
  maxPlayers: number
  tags?: string[]
}

// Registry placeholder. Add real games here later.
export const games: GameDefinition[] = []
