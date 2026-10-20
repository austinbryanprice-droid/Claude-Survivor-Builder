# Multiplayer Protocol Notes (PeerJS Host-Authoritative)

These are example message shapes. The implementing AI may adjust them as long as the authority model is preserved.

## Authority Rules
- Host validates all critical actions (block place/break/upgrade, resource costs, enemy spawning, research unlocks).
- Clients send inputs or requests. Host broadcasts confirmed state.
- Late joiners receive a full world snapshot.

## Example Message Types

```json
{
  "type": "snapshot",
  "chunks": { "0,0,0": [/* block data */] },
  "modules": [/* placed functional pieces */],
  "players": [/* positions, health, energy */],
  "resources": { "scrap": 120, "composite": 40 },
  "research": 25,
  "night": 3
}
```

```json
{
  "type": "block_update",
  "pos": [x, y, z],
  "action": "place" | "break" | "upgrade",
  "blockId": 2,
  "tier": 1,
  "playerId": "abc123"
}
```

```json
{
  "type": "player_state",
  "id": "abc123",
  "position": [x, y, z],
  "rotation": [yaw, pitch],
  "health": 80,
  "energy": 65
}
```

```json
{
  "type": "wave_start",
  "night": 4,
  "enemyCount": 14
}
```

## Host Disconnect
- Session ends.
- Display clear message to remaining players.
- Host attempts auto-save before connection drops when possible.
- Resume requires host to reload save and share a new room code.
- No host migration in v1.
