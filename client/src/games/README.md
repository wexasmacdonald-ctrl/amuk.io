# Games folder

This folder holds per-game UI/data modules.

Suggested structure:
- games/index.ts: Registry of available games to render in the lobby.
- games/<game-slug>/
  - meta.ts: name, description, tags, min/max players
  - assets/: images, icons
  - rules.md: design notes and flow

Keep placeholders minimal until a real game module is added.
