# Ashbound Outpost — Complete Implementation Specification

**For AI Coding Agents**  
Version 1.0  
Browser Co-op Hybrid Refined-Voxel Survivor-Builder  
Desktop-first • MIT License • Host-authoritative PeerJS • Session-based local save

---

## 1. Project Intent and Non-Negotiables

Ashbound Outpost is a 2–4 player co-op browser game. Players are the remaining crew of a crashed orbital station. They scavenge debris during the day and defend a shared outpost against escalating waves of rogue machines at night. Building and upgrading the outpost is the primary way to answer survival pressure.

**Core fantasy**: You are the person building and surviving (first-person or over-the-shoulder third-person), not a top-down commander.

### Locked Non-Negotiables

- Browser client (static-capable, deployable to GitHub Pages).
- Minecraft-style first-person + over-the-shoulder third-person camera.
- Hybrid building: refined/beveled voxels for structural elements + modular models for functional pieces.
- Host-authoritative multiplayer via PeerJS/WebRTC for 2–4 players.
- Session-based runs with host-local save (IndexedDB preferred). No accounts or cloud persistence in v1.
- Day scavenge/build → Night wave defense loop.
- In-place upgrades and material tiers.
- Clear failure state with results screen and retry.
- MIT license for all code. Assets must be CC0, generated, or clearly licensed with attribution.
- Desktop-first performance target: stable 60 FPS at 1080p on mid-range laptops from the last 4–5 years.

**If any implementation choice conflicts with these, the non-negotiable wins.**

---

## 2. Recommended Tech Stack

- **Build tool**: Vite
- **Language**: TypeScript (preferred) or JavaScript
- **3D**: Three.js (recent stable, r160+ or current)
- **Multiplayer**: PeerJS (WebRTC)
- **Audio**: Howler.js or native Web Audio API
- **UI**: HTML/CSS overlays on the canvas (no heavy framework required)
- **Persistence**: IndexedDB (preferred) or localStorage for host save

The client must remain fully static. No required backend for the MVP. Optional later path: Colyseus or Socket.io server.

---

## 3. Repository and Folder Structure

Suggested layout:

```
/src
  /engine      (scene, renderer, camera, input, game loop)
  /world       (voxel data, meshing, chunks, materials)
  /systems     (survival, waves, economy, upgrades)
  /net         (PeerJS host authority, message handling, sync)
  /ui          (HUD, menus, overlays)
/assets        (models, textures, audio)
/public
README.md
LICENSE
CREDITS.md
```

Keep the built output suitable for direct GitHub Pages deployment.

---

## 4. Visual Style Specification

### Geometry
- Structural elements (walls, floors, foundations, platforms) are grid-snapped voxels with **subtle edge bevels or chamfers**. They must not read as pure sharp Minecraft cubes.
- Functional modules (turrets, generators, storage, research terminal, beds, lights, etc.) are modular glTF models that also snap to the grid.
- Terrain can use refined voxels or light smoothing. Player-built structures stay more geometric for precise defense building.

### Materials and Lighting
- Detailed, non-pixelated textures or procedural materials: weathered metal panels, reinforced composites, concrete with wear, exposed wiring.
- Strong ambient occlusion and soft directional shadows.
- Dynamic day/night lighting with color temperature shift (warmer day, cooler night).
- Emissive accents on powered or active tech (cyan or amber).
- Atmospheric haze at distance and gradient skies.
- Color palette: dark metallic base with warm amber and cool cyan tech accents.

### What to Avoid
- Default Minecraft block aesthetic (pure cubes, pixelated textures).
- Effects that only run well on high-end GPUs.

The overall impression should be “refined salvaged modular tech,” not “Minecraft clone.”  
See the `references/` folder for visual targets.

---

## 5. Camera and Controls

- Default: first-person with pointer lock and mouse look.
- Toggle to over-the-shoulder third-person (V or F5).
- Movement: WASD, jump, sprint. Smooth and frame-rate independent.
- Left-click: break blocks or attack.
- Right-click: place selected block or interact.
- Hotbar: number keys 1–9 or scroll wheel.
- Build Mode key (B): shows ghost preview of selected piece, material cost, and valid/invalid snap highlight. Outside Build Mode, right-click still places if a block is selected.
- Interact key (E) while aiming at a structure: upgrade or use it if materials/requirements are met.
- Placement must feel precise. Clear snap, immediate visual feedback, and cost display are required.

Combat is secondary to building but must remain responsive.

---

## 6. Multiplayer Architecture and Authority

**Model**: PeerJS / WebRTC, host-authoritative.

- One player creates a room (short code) and becomes the host.
- The host’s browser is the authoritative simulation for: block placement validation, resource costs, enemy AI, wave spawning, health, and research progress.
- Clients send inputs. Host resolves and broadcasts deltas (block changes, entity positions, health updates, etc.).
- Clients may predict their own movement locally and reconcile with host updates.
- Late joiners receive a world snapshot from the host.

### Host Disconnect
- If the host disconnects, the session ends for all players.
- Show a clear message. Host should attempt an auto-save of current state before drop when possible.
- To resume, the host reloads the save and shares a new room code.
- No host migration or automatic reconnection in v1.

This behavior must be documented in the UI or README so players understand the expectation.

See `notes/multiplayer_protocol.md` for example message shapes.

---

## 7. Persistence and Session Model

- Session-based. Each outpost run is self-contained.
- Host saves the full outpost state (voxel data, placed modules, upgrades, research progress, resource counts) to IndexedDB or localStorage.
- On host start, offer to resume the last save or start new.
- No accounts, no shared cloud persistence, no cross-device sync in v1.
- Players rejoin a resumed session by the host sharing a new room code after loading the save.

Target session length is roughly 30–60 minutes of play, but longer is acceptable if the group wants.

---

## 8. Survival Loop

### Day Phase (target 8–12 minutes)
- Primary activities: scavenge debris for materials, build, upgrade, and repair the shared outpost.
- Light ambient threats optional; not the focus.
- Debris nodes are finite and deplete. New nodes appear slowly or in slightly farther areas.

### Night / Wave Phase (target 4–6 minutes)
- Escalating waves of rogue drones and corrupted machines attack the outpost.
- Waves scale primarily by number and health. Introduce tougher variants or specials (armored, flying, or base-targeting) every few nights, with a notable special every ~5 nights.
- Nights 1–2 should be light. Pressure should be noticeable by night 5–7 for a coordinated group.

### Player Needs
- Health and Energy (hunger analog).
- Energy drains slowly over time and faster during combat or heavy building. Low energy reduces movement and interaction speed.
- Individual death is soft: respawn at the base (bed or designated point) with a temporary energy and damage debuff.

### Failure
- Full wipe (base destroyed or all players down with no respawns remaining) ends the run.
- Show an “Outpost Overrun” results screen with nights survived, materials gathered, upgrades completed, and research earned.
- Options: Retry (same starting conditions) or New Run.

There is no meta-progression outside a single session in v1.

See `notes/economy_and_waves.md` for example numbers.

---

## 9. Building, Upgrades and Economy

### Placement
- Everything snaps to a grid.
- Structural pieces use refined beveled voxels. Functional modules use models that also snap.

### Material Tiers
- Scrap (common, weak, early)
- Reinforced Composite
- Advanced Alloy
- Energy-Infused (late, high health or special properties, scarce)

### Upgrades
- Most structures can be upgraded in place by aiming and pressing the interact key while holding the required materials.
- Upgrades improve health, damage, range, efficiency, or other stats and change the visual appearance.
- Examples: basic wall → reinforced wall → electrified wall; basic turret → auto-turret → heavy turret.

### Functional Modules (MVP set)
- Wall / floor / platform variants
- Basic turret
- Power generator / power node
- Storage
- Research terminal
- Bed / respawn point
- Light

### Economy Rules
- Shared resource pool for all base construction and upgrades.
- Personal inventory/hotbar for tools and temporary items.
- Day phase should yield enough materials for 1–2 meaningful upgrades if the group is reasonably efficient.
- Upgrade costs rise with tier. Early progress feels fast; later progress feels earned.
- Research Points are earned primarily by surviving nights (small bonus possible for low base damage or efficiency).
- Research Terminal unlocks the next material tier and new modules at clear thresholds.
- Optional light synergies (e.g., power node boosts nearby turrets). Do not require a full simulation.

A coordinated group should feel meaningful progress every 2–3 nights without pure grinding.

---

## 10. UI Specification

- Minimal, non-intrusive HUD.
- Health and Energy bars (bottom or lower corners).
- Hotbar centered at the bottom with clear icons and counts.
- Subtle day/night or wave indicator.
- Crosshair that changes slightly when targeting a placeable surface.
- Build Mode: ghost preview, material cost, valid/invalid snap highlight.
- Overlays (inventory, research): clean dark metallic panels with subtle cyan/amber accents.
- Results screen: clear stats and Retry / New Run buttons.
- Host disconnect message must be clear.
- Style: dark metallic, functional, slightly optimistic sci-fi. Avoid heavy skeuomorphism or dense clutter.

HTML/CSS overlays on the Three.js canvas are the expected approach.

---

## 11. Audio Direction

- Ambient: soft industrial hum + wind/debris during day; lower, tenser drone at night.
- Feedback SFX: distinct place and break sounds, turret fire, enemy hits, power activation.
- Short rising stinger approximately 10 seconds before a wave.
- Sparse music that shifts from calmer (day) to more urgent (night). No constant heavy loops.
- Prefer free CC0 sources or simple synthesis. Keep file sizes small.

Audio should support the loop and theme without dominating.

---

## 12. Performance and Device Targets

- Desktop-first.
- Target: stable 60 FPS at 1080p with 2–4 players on mid-range laptops from the last 4–5 years (integrated graphics acceptable for modest scenes).
- Modest render distance (approximately 8–12 chunks).
- Use instanced meshes for voxels, chunking, and frustum culling.
- Provide simple quality options (shadows, particles, view distance) for graceful degradation.
- Mobile is not a primary target.

Prioritize chunking, instancing, and efficient materials from the start.

---

## 13. Art and Asset Approach

- Structural voxels: procedural textures or simple PBR materials with code-based bevels.
- Functional modules, characters, and key props: small set of optimized glTF models (target 10–15 unique pieces for MVP, each under ~5–10k triangles).
- Shared material library and color palette for consistency.
- All external assets must be documented in CREDITS.md with licenses.
- Prefer CC0 or clearly licensed free assets.

Visual consistency and lighting quality matter more than high unique model counts early.

---

## 14. Explicit Scope Guardrails (Not in MVP)

Do **not** implement any of the following in the first version:

- Infinite or large procedural worlds
- Full crafting trees or complex multi-step recipes
- Vehicles or automation chains
- Multiple biomes or long-distance exploration
- Voice chat, accounts, leaderboards, or cloud persistence
- Advanced AI (complex pathfinding, formations, or player-like tactics)
- Structural integrity or collapse physics
- Mobile-first controls
- Full character customization
- Mod support
- Deep narrative or cutscenes
- Host migration or automatic reconnection

These may be considered only after the core loop is fun and stable.

---

## 15. Implementation Phases and Acceptance Criteria

### Phase 0 — Project Setup
- Public GitHub repo with MIT LICENSE and CREDITS.md template.
- Vite + Three.js project that runs locally and builds for static deployment.
- Folder structure in place. README with setup instructions.

**Acceptance**: Repo clones, installs, and displays a blank Three.js canvas. Builds successfully for GitHub Pages.

### Phase 1 — Core Engine and Camera
- Scene, renderer, basic lighting.
- Pointer-lock first-person camera + third-person toggle.
- WASD movement, jump, sprint with basic collision.

**Acceptance**: Smooth movement and camera toggle at target frame rate in a local scene.

### Phase 2 — Refined Voxel System
- Chunked voxel data structure.
- Raycast place and break.
- Greedy meshing with simple edge bevels.
- Ghost preview and valid/invalid highlight.

**Acceptance**: Player can build multi-level structures that look refined (beveled edges) rather than pure cubes.

### Phase 3 — Multiplayer Foundation
- PeerJS room create/join via code.
- Host-authoritative block place/break sync.
- Player position sync with interpolation.
- Clear host disconnect handling.

**Acceptance**: Two or more browsers can join, see each other, and collaboratively place/break blocks in real time.

### Phase 4 — Survival Loop
- Day/night timer with lighting shift.
- Health and Energy meters.
- At least one enemy type that paths toward the base.
- Escalating wave spawning.
- Soft individual respawn and full-wipe results screen.

**Acceptance**: Group can complete at least one full day/night cycle and see a clear failure state.

### Phase 5 — Building, Upgrades and Economy
- Material tiers and shared resource pool.
- In-place upgrades with visual change.
- Core functional modules (turret, generator, storage, research terminal, bed, light).
- Research Points from surviving nights that gate higher tiers.

**Acceptance**: Upgrades cost resources, improve capability, and higher tiers unlock through survival.

### Phase 6 — UI, Persistence, Audio and Polish
- Full minimal HUD, hotbar, Build Mode, and results screen.
- Host local save/load.
- Core audio feedback and ambient.
- Performance pass meeting the desktop target.

**Acceptance**: Full loop is playable by 2–4 people without console commands. Client deploys to GitHub Pages.

---

## 16. Final Deliverables for MVP

- Playable browser client hosted on GitHub Pages.
- Public GitHub repository with MIT license, clear README, and CREDITS.md.
- Ability for a host to create a room, friends to join via code, collaboratively build a refined-voxel outpost, survive escalating night waves, upgrade structures, and resume via host local save.
- Clear failure state with retry.
- Performance acceptable on mid-range desktop hardware.
- Visual style that reads as refined salvaged modular tech rather than a direct Minecraft clone.

---

This specification is the authoritative source for implementation. Where details are not explicitly numeric, follow the stated principles and the non-negotiables. Update the document if major implementation discoveries require a change to a locked decision.
