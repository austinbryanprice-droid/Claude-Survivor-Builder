# Art direction

The owner wants the look to match the visual references as closely as possible: graphics, details, textures, aesthetics, fidelity and the HUD. This document says how, in words, because the reference images are third-party screenshots and stay out of this repository. From the look spike onward, our own in-engine screenshots become the references that pull requests compare against.

Two limits from the spec still apply (section 1): a stable 60 FPS at 1080p on mid-range laptops, read as laptops with a dedicated GPU (integrated-only graphics is not a target, see [decisions](decisions.md#hardware-target-2026-10-20)), and only CC0, generated or clearly licensed assets. The look is bought with budget. The Balanced preset is tuned to hold the frame rate; Ultra goes closest to the references.

## What each reference teaches

| #   | Subject                                   | Take from it                                                                                                                                                                                           | Leave behind                                                         |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 01  | Shader-pack village at sunset             | A low warm sun, soft shadows, a sky from deep blue overhead to orange and pink at the horizon, puffy sunlit clouds, a lake with sun glitter and mirrored reflections, lantern glow, backlit tall grass | Pixel-cube textures, the pack's caption                              |
| 02  | Spruce forest on still water              | Conifers in silhouette against a lavender-peach sky, light shafts through the trees, near-mirror reflections                                                                                           | Blocky clouds                                                        |
| 03  | Aerial view of a dense forest             | Depth in layers: saturated greens close, orange haze far away, a sun glow with flare, bright clouds against deep blue                                                                                  | Blocky foliage; tree count is the main budget risk                   |
| 04  | Enshrouded construction (named "Valheim") | Thick, chunky pieces with visible courses, layered floors, ladders, cobbled ground, and the HUD                                                                                                        | Stone and thatch materials; our tiers are metal, composite and alloy |
| 05  | Valheim timber base                       | Layered roofs, trusses, round towers, curved walls, strong silhouettes, a hazy blue-green atmosphere                                                                                                   | Free-form snapping; we snap to the grid                              |
| 06  | Marching-cubes thumbnail                  | Organic, smooth landforms                                                                                                                                                                              | Flat-shaded facets; ours is smooth-shaded and textured               |
| 07  | Enshrouded landscape                      | A lush valley, pines and rock outcrops, snow peaks far away, cyan mist pools in hollows, one red mist pocket, grass blades with flowers up close, and the HUD                                          | Fantasy ruins                                                        |
| 08  | Cherry grove at sunset                    | A strong color grade, magenta-orange haze, layered silhouettes                                                                                                                                         | Pixel cubes                                                          |

References 01, 02, 03 and 08 are Minecraft-style and use pixel-cube textures, which spec section 4 bans. They inform lighting and atmosphere only. Textures follow the detailed references (04, 05, 07).

## The world

- A lush golden-hour valley, bounded at about 192 by 192 blocks (spec section 12 asks for 8 to 12 chunks of view). Hills and forest close the horizon.
- A lake on one side. The crash site sits in the middle: wreckage, the Outpost Core, and a scorched ash patch around them with a faint amber-red mist, echoing the red mist pocket in reference 07.
- Day is a long golden afternoon. The sun stays between about 12 and 45 degrees, always warm, so shadows stay long and readable. Night is cool blue with cyan tech accents. Dusk and dawn blend over about 40 seconds.
- Terrain is static in version 1. Players place and break structure blocks, not ground.

### Starting palette

| Use                      | Color                           |
| ------------------------ | ------------------------------- |
| Sky, zenith to horizon   | `#2f5d9e`, `#6d7fb8`, `#f2a65a` |
| Sun and warm light       | `#ffd9a0` to `#fff1c9`          |
| Night sky and moonlight  | `#070b1a`, `#1a2a4a`, `#8ab4ff` |
| Grass, lit and shaded    | `#7fa648`, `#4a7030`            |
| Dirt, rock, ash          | `#6b4a2f`, `#7d7468`, `#3b3835` |
| Structures: metal, plate | `#20262d`, `#38414b`            |
| Accents: amber, cyan     | `#f2a43a`, `#3ad1e0`            |

The look spike tuned these against screenshots. The palette stops in `src/shared/daycycle.ts` are now the source of truth; this table only names the intent.

## Light and atmosphere

1. **Sun.** One warm directional light with soft shadows from a shadow map that follows the player. The sun has a visible disc and glow.
2. **Fill.** A hemisphere light: sky color above, warm ground bounce below. Ambient occlusion is baked into vertex colors for terrain and structures, so no screen-space AO is needed on Balanced.
3. **Sky.** A gradient dome with procedural clouds that catch the sun on their undersides.
4. **Haze.** Height fog and distance haze tinted toward the sun, with colored mist pockets in hollows and over the crash site.
5. **Shafts, bloom and grade.** Half-resolution light shafts and bloom, then a final color grade with a light vignette. Strong grading (reference 08) is the cheapest way to look rich on modest hardware.

## Terrain, foliage and water

- **Terrain.** A smooth surface-nets mesh from the seeded density field, with collision from the same field, shaded with triplanar textures that blend by slope and height: grass on flats, rock on steep faces, dirt on worn paths, ash at the crash site. The look spike measured it against the smoothed-heightfield fallback and kept surface nets, because a heightfield smears rock faces (see `decisions.md`).
- **Foliage.** Instanced trees (pines and a broadleaf) with two levels of detail and distant impostors, grass cards and flowers that sway in the wind, and scattered boulders. Density scales with the preset.
- **Water.** One lake with a sky-colored fresnel, ripples and sun glitter. Ultra adds a half-resolution planar reflection for the still-water look of references 01 and 02.

## Structures and materials

Structures keep the spec's dark metal with amber and cyan accents, built with the construction language of references 04 and 05.

- **Geometry.** Thick pieces: walls read as deep, with inset panels and frame trim. Every face is inset and chamfered by 0.05 to 0.12 units, and faces are not merged, so seams stay visible. Phase 2c draws cubes with a 0.08 chamfer, a darker groove wherever two blocks meet and ambient occlusion in the corners. Slabs (half a cell high) and wedges (a 45 degree half-cube) give sloped roofs, eaves and strong silhouettes; since Phase 2e they take the same chamfer, groove and tiles as the cubes, and `?demo=hall` shows them as a gabled roof.
- **Tiers.** Scrap is patchwork salvaged plates with rust and rivets. Composite is layered grey-green panels with cyan edge strips. Alloy is brushed dark steel with amber inlays. Energy-Infused is dark with pulsing cyan veins. An upgrade must change the look, not only the stats: a block's material id picks its tile, so the Phase 5 upgrade changes one number and the block re-meshes.
- **Modules.** Turrets, generator, node, storage, terminal, bed and light are generated glTF models that feel engineered and modular. They glow cyan when powered and amber when active.
- **Materials.** Procedural, with detail bump from Balanced up. The tiles are baked on the GPU at load, four layouts for each tier, and each face of each block picks one by chance and turns it one of eight ways, so a wall never reads as one stamp repeated. Weathering, wear and exposed wiring come from the shared noise helpers, not per-piece textures, and no image file is involved.

## HUD

Reference images 04 and 07 are the model. The look spike built it (`src/ui/player-hud/`, with original icons) and the game page now shows it, fed by real numbers where the game has them (the compass follows the view, the Health and Energy bars are the player's own meters, the hotbar selection, the crosshair and the caption above the hotbar follow the player's building hands, and the day and night clock, the Core's gauge and the objective follow the run) and made-up ones where it does not yet (the hotbar's tools). The layout is drawn for 1280 by 720 and scales with the window. Type is a humanist serif system stack (Merriweather when installed, otherwise Georgia or the nearest serif).

- **Top left.** One torn, dark slate frame holds a wide health bar in three pale mint segments over a slim blue Energy bar that ends in a white cap. Under it, a column of round status icons, each with a short caption after a small triangle: green for a good one ("Charging", while the player stands in the Core's field) and amber for a bad one ("Low energy", "Out of energy"). The bars say how they stand without a number: Health empties from the right and turns red and breathes below a quarter; Energy turns amber below a quarter, where it starts to slow the player, and with none left its frame breathes. A wound flashes the Health bar and reddens the edges of the screen for a moment.
- **Top center.** A compass: a brush-stroke line about 320 px wide that shows 222 degrees, a small tick every 45 degrees, "N" inside a larger triangle with E, S and W as plain letters, and an orange diamond with an exclamation mark and a distance ("48M") for a waypoint.
- **Top right.** An objective banner: a slate bar that fades out to the left, a small letter-spaced place name over a bold objective line, and a mint diamond emblem straddling the end; under it, "Journal" with a white J key cap on a frosted pill.
- **Bottom center.** The hotbar: eight frosted slots with a numbered key cap at the top left, a status glyph at the top right, a green durability bar along the bottom, a stack count at the lower right, a cyan grid on blueprint items, and a white outline with a violet tint on the selected slot (a selected block keeps its cyan grid and gains a white ring and a soft glow). An "ALT" key cap sits to its left, and a "B Build" hint to its right that turns cyan while Build Mode is on. Slots 1 to 4 hold the four block materials as original icons, each a beveled cube in its tier's paint: scrap in rust with teal patches and rivets, composite in grey-green with cyan trim, alloy in steel with an amber hazard band, energy in graphite with cyan veins. Q turns the four into slabs and then wedges, drawn from the same paint, so the hotbar always shows the piece a click would place. A slot whose material has not been researched is dim and has a small padlock where its count would be ([Phase 5c](#phase-5c-research)).
- **Above the hotbar.** A caption: the name of the piece in hand in bold with "Cost 1 Scrap" under it in soft white, shown in Build Mode and for a moment after a new choice. When a click would do nothing, the second line turns coral red and says why ("Not enough Scrap", "Needs research · 12 of 20").
- **Center.** A small dot for a crosshair. Over a surface a block can go on it gets a thin cyan ring; in Build Mode a faint white ring is always there, and it turns red where a click would be refused.
- **Build Mode.** A translucent copy of the piece in hand, a block, a slab or a wedge, turned the way a click would place it, on the cell a click would fill (cyan when it works, red when it does not, with a bright rim and a slow breath) and a white outline, in the shape of the piece, on the block a click would break. The status panel at the bottom right lists the keys of the mode while it is on, Q for the kind of piece and R to turn it among them.
- **The day and night clock.** A small dark pill under the compass: the sun or the moon as a flat painted icon, the day or night with its number in letter-spaced capitals ("DAY 2", "NIGHT 2"), the time left until the light changes ("5:12"), and a thin bar along its bottom edge for how far through the day or night it is. It is amber by day and pale blue by night, and for the last 30 seconds before the light changes it breathes in its own colour. It is the spec's "subtle day/night or wave indicator", so it stays small. The waves join it when they exist.
- **The Outpost Core's gauge.** A second, slimmer pill under the clock: a small crystal icon, "CORE" in letter-spaced capitals, a thin bar and the points left. It is cyan while the Core is sound, amber below half, red below a quarter (and then it breathes) and flat grey at 0 once the Core has fallen; a hit flashes it. By night it is always up, even for a whole Core; by day it comes up only once the Core is hurt, so a morning with nothing wrong has nothing extra on the screen.
- **The research pill.** A third pill in the same column, under the Core's gauge and the respawn charges: a small atom, "RESEARCH" in letter-spaced capitals, a lavender bar towards the next row of the ladder and the points over it ("12/20", or the plain number at the top). It is up in Build Mode and for ten seconds after the points change, and it flashes when they rise ([Phase 5c](#phase-5c-research)).
- **Still to come.** The wave count by the clock, the held item's name for tools above the hotbar, a powered-area panel at the bottom right, and the inventory and research overlays (spec section 10) arrive with their phases and reuse the same frames and type.

## Quality presets

| Element             | Low                             | Balanced                                    | Ultra                            |
| ------------------- | ------------------------------- | ------------------------------------------- | -------------------------------- |
| Internal resolution | 75 percent, floor 60, 1.0 MP    | 100 percent, floor 70, up to 2.1 MP         | 100 percent, fixed, up to 3.7 MP |
| Anti-aliasing       | None                            | FXAA                                        | 4x MSAA                          |
| Shadows             | None (blob shadows still to do) | One 2048 filtered map, 90 m                 | Two cascades, 160 m              |
| Haze and light      | Fog only                        | Adds mist pockets and a lit sky             | Adds light shafts                |
| Bloom and grade     | Grade only                      | Half-resolution bloom and grade             | Full-resolution bloom and grade  |
| Water               | Flat tint                       | Ripples, glitter and a 0.3 scale reflection | A 0.5 scale planar reflection    |
| Terrain view        | 8 chunks, plain textures        | 10 chunks, detail normals                   | 12 chunks, detail normals        |
| Foliage             | 25 percent, grass to 22 m       | 60 percent, grass to 34 m                   | 100 percent, grass to 52 m       |

The numbers live in `src/shared/quality.ts`. Balanced is the default and is tuned for 60 FPS at 1080p on a mid-range laptop; its governor lowers the internal resolution a step at a time when frames run long. The owner confirms it on real hardware with the benchmark switch (`?bench=1` on the game page). Presets change with the P key, the Graphics choice on the pause panel (both remembered in the browser) and a `?quality=` URL switch (for one visit); the full menu comes with Phase 6.

## Rules of thumb

- Match lighting and atmosphere first; they carry most of the reference look and cost the least.
- Pick the cheaper effect when two look alike, and measure before adding the next one.
- Never ship an asset that is not generated in code, CC0 or clearly licensed, and list every external asset in `CREDITS.md`.
- Do not commit reference images, screenshots of other games or anything traced from them.

## Look spike results

The look spike, a throwaway page that Phase 2b folded into the game page, built the target look end to end: seeded surface-nets terrain, a day cycle with a shadowed sun, an analytic sky, haze with mist pockets, a lake, trees, grass, the Enshrouded-style HUD and the three presets. It also settled terrain meshing and collision (see [decisions](decisions.md#look-spike-2026-10-20)). The reference images stay out of this repository, so the side-by-side sheets sit in the project files instead; the screenshots here are ours.

### Screenshots

Headless Chromium on software GL at 1280 by 720, with `freeze=1` so every run draws the same frame. Each reproduces from its URL on the game page, for example `/?shot=lake&quality=balanced&hud=0&stats=0&freeze=1` (the switches are in [the app README](../src/app/README.md)). The screenshots below were taken on the look page, which drew the same valley.

![Across the lake into the low sun, Balanced](look/bal-lake.jpg)

![The valley in the morning with the player HUD, Balanced](look/hud-valley.jpg)

| Image                                                                                                   | Preset     | Compare with                                                             |
| ------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| [bal-lake](look/bal-lake.jpg)                                                                           | Balanced   | 01 and 02: a low warm sun, glitter and mist on the water, backlit pines  |
| [bal-valley](look/bal-valley.jpg)                                                                       | Balanced   | 07: pines and rock, cyan mist pools, snow peaks far away                 |
| [bal-canopy](look/bal-canopy.jpg)                                                                       | Balanced   | 03: layered forest, orange haze, a sun glow                              |
| [bal-sunset](look/bal-sunset.jpg)                                                                       | Balanced   | 08: a violet sky, orange haze, a strong grade                            |
| [bal-trail](look/bal-trail.jpg)                                                                         | Balanced   | 01 and 07: backlit grass and flowers up close                            |
| [bal-crash](look/bal-crash.jpg), [bal-noon](look/bal-noon.jpg)                                          | Balanced   | The crash clearing and high sun (no wreck until Phase 2)                 |
| [bal-outcrop](look/bal-outcrop.jpg), [terr-heightfield](look/terr-heightfield.jpg)                      | Balanced   | 06: a rock outcrop from surface nets, and the same view as a heightfield |
| [bal-dusk](look/bal-dusk.jpg), [bal-night](look/bal-night.jpg)                                          | Balanced   | Moon, stars, cool blue                                                   |
| [hud-valley](look/hud-valley.jpg), [hud-lake](look/hud-lake.jpg)                                        | Balanced   | 04 and 07: the player HUD at 1280 by 720                                 |
| [low-lake](look/low-lake.jpg), [ultra-lake](look/ultra-lake.jpg), [ultra-valley](look/ultra-valley.jpg) | Low, Ultra | The presets beside Balanced                                              |

Phase 2b put the valley in the game page, and its captures are in `phase-2/` (Balanced, 1280 by 720): [game-play](phase-2/game-play.jpg) (first person at the lake shore with the player HUD and the key hints), [game-third](phase-2/game-third.jpg) (third person), [game-pause](phase-2/game-pause.jpg) (the click-to-play card with the Graphics and Time of day choices) and [game-bench](phase-2/game-bench.jpg) (the benchmark's results card; software rendering, so its numbers mean nothing). Later Phase 2 pull requests add their build screenshots to the same folder.

### Frame budgets

Draw calls and triangles per frame at 1280 by 720, every pass counted (shadows, reflection, main view, post). The sandbox has no GPU, so these are the static budget; the milliseconds come from the benchmark below. The game page draws exactly these counts in the same views (checked after Phase 2b moved the valley into it, with `?shot=lake`, `valley` and `canopy`), so moving the valley into the game added no draw calls or triangles.

| View   | Low                 | Balanced             | Ultra                 |
| ------ | ------------------- | -------------------- | --------------------- |
| Lake   | 25 draws, 151k tris | 86 draws, 722k tris  | 91 draws, 1.52M tris  |
| Valley | 37 draws, 200k tris | 111 draws, 855k tris | 149 draws, 1.85M tris |
| Canopy | 35 draws, 218k tris | 103 draws, 892k tris | 131 draws, 1.91M tris |

Low draws at 0.75 scale. The terrain alone is 123k triangles per pass with surface nets. Ultra roughly doubles the triangle count because two shadow cascades redraw the scene.

Software rendering (SwiftShader, a 640 by 360 canvas) puts Balanced at about 12 times the cost of Low and Ultra at about 18 times. Only the ratios mean anything there, and a real GPU will not scale the same way, so they say which preset is heavier and nothing about frame rate.

Building the valley in headless Chromium takes about half a second: textures 20 to 30 ms, density field 3 to 6 ms, ground grid 150 to 380 ms, terrain mesh 150 to 180 ms (60 to 85 ms for the heightfield), scatter 60 to 80 ms.

### First real measurement

Austin ran the look page's `?bench=1` on 2026-10-20 (build 16034c2) on an RTX 4090 Laptop GPU (ANGLE, Direct3D 11) in Chrome 155 on Windows: a 2550 by 1273 canvas at device pixel ratio 1.25, a display of about 200 Hz, 30 seconds per preset with adaptive resolution off. Building the valley took 261 ms (field 2, ground grid 84, terrain mesh 70, scatter 29).

| Preset   | Internal size | Avg FPS | p95 ms | Slowest 1% FPS | CPU ms | GPU ms avg / p95 | Draws | Triangles |
| -------- | ------------- | ------: | -----: | -------------: | -----: | ---------------: | ----: | --------: |
| Low      | 1415 by 707   |   200.0 |    5.1 |            190 |    0.2 |        3.8 / 5.1 |    33 |      191k |
| Balanced | 2051 by 1024  |   200.0 |    5.1 |            187 |    0.3 |        1.7 / 4.0 |   102 |      816k |
| Ultra    | 2550 by 1273  |   200.0 |    5.1 |            191 |    0.4 |        2.9 / 4.3 |   131 |     1767k |

All three presets pass the game page's mark (at least 57 FPS on average, 95th percentile at most 18.5 ms) and no frame took longer than 33 ms. The internal sizes are the presets' pixel caps at work: 1.0 million pixels for Low, 2.1 million for Balanced and 3.7 million for Ultra, so Ultra drew the whole canvas.

**What this run shows.** It is the look spike's real-hardware result. On a machine this fast it confirms that nothing is broken: the preset switching, the benchmark route and the report work, and the draw and triangle counts match the static budget above. It does not show how much headroom there is. Every preset sat at the display's 200 FPS cap, so frame rate cannot tell them apart, and the GPU times are not monotonic across presets (Low 3.8 ms against Balanced 1.7 ms), which looks like power-state noise at the cap rather than real cost. Treat the GPU column as indicative only and do not scale it to slower hardware.

**What it does not show.** No mid-range dedicated GPU has been measured, so Balanced holding 60 FPS at 1080p on a mid-range laptop is still unproven. That is the target in SPEC sections 1 and 12, read as laptops with a dedicated GPU since [Austin's hardware decision](decisions.md#hardware-target-2026-10-20). To measure one, run the game page with `?bench=1` on it at 1080p, plugged in, with the tab in front (about 100 seconds), and check the report's graphics adapter line: on a laptop with two GPUs the browser has to run on the dedicated one (Windows Settings, System, Display, Graphics, High performance for the browser). See [the app README](../src/app/README.md#benchmark).

### Known gaps

- No mid-range dedicated GPU has been measured: the only real run so far was on a high-end laptop at its display's frame-rate cap.
- The crash site is an ash clearing with the Outpost Core in the middle of it (since Phase 4b, see [below](#phase-4b-the-outpost-core)); the wreck and the lanterns are still to come. Blocks are drawn since Phase 2c, and references 01, 04 and 05 are mostly about buildings (see [the blocks](#phase-2c-the-blocks)).
- Textures are detailed and smooth. References 01, 02, 03 and 08 use pixel cubes, and Austin chose smooth, detailed textures over them on 2026-10-20 (see [decisions](decisions.md#look-spike-2026-10-20)).
- Low has no shadows yet; blob shadows under trees are the planned stand-in.
- Balanced reflects the far shore faintly (0.3 scale); the near-mirror water of references 01 and 02 needs Ultra.
- The broadleaf canopies are brighter and simpler than the pines and oaks in reference 07. A second leaf texture and more colour variation are the next pass.
- Clouds are soft and procedural, not the sculpted volumes of references 01 and 03.
- Shaded grass at golden hour is dark, as it is in reference 01; reference 07's brighter mid-greens belong to a high-key daylight look that the morning and noon views already show.

## Phase 2c: the blocks

Phase 2c draws the voxel world: beveled blocks with ambient occlusion in four material tiers, and a time budget for re-meshing (how it works is in [decisions](decisions.md#phase-2c-block-meshing-and-materials)). Nothing placed a block yet, so the screenshots show the demo structures that `?demo=outpost` and `?demo=swatch` raise. They are taken the same way as the look spike's: headless Chromium on software GL, 1280 by 720, Balanced, `freeze=1`. Phase 2e's lighting pass retook them (the same views as before it are in [the lighting pass](#lighting-pass-against-references-04-and-05)).

![The demo outpost from the south in the afternoon, Balanced](phase-2/blocks-outpost.jpg)

![The four tiers side by side: Scrap, Composite, Alloy, Energy-Infused, Balanced](phase-2/blocks-swatch.jpg)

| Image                                        | URL on the game page                                                  | What to look at                                                                                                                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [blocks-outpost](phase-2/blocks-outpost.jpg) | `/?demo=outpost&shot=outpost&quality=balanced&hud=0&stats=0&freeze=1` | A walled outpost with a gate, a courtyard roof, four towers and lamps, standing in the valley. The grass and trees give way around its foundation. Compare with 04: thick pieces with visible courses.                  |
| [blocks-gate](phase-2/blocks-gate.jpg)       | the same with `shot=gate`                                             | The outpost at golden hour, the game's default light: warm sun on the metal, cool shade in the corners. The steel stays steel instead of turning tan.                                                                   |
| [blocks-swatch](phase-2/blocks-swatch.jpg)   | `/?demo=swatch&shot=swatch&...`                                       | One wall per tier with a few blocks in front, left to right: Scrap (rust, teal paint, grey primer), Composite (grey-green laminate with cyan trim), Alloy (brushed steel, amber markings), Energy-Infused (cyan veins). |
| [blocks-closeup](phase-2/blocks-closeup.jpg) | the same with `shot=closeup`                                          | A few steps from the Alloy wall: the chamfers catching light, the dark groove where two blocks meet, ambient occlusion in the corners, and faces that differ from one another.                                          |

### Frame budgets with blocks

Counted like the table above (every pass, 1280 by 720). The outpost is four chunks and 10 thousand triangles. A chunk that holds a block is one draw call in every pass that draws it, and the shadow pass counts, so Balanced pays twice for each.

| View                                     | Low                 | Balanced             | Ultra                 |
| ---------------------------------------- | ------------------- | -------------------- | --------------------- |
| Outpost (`demo=outpost`, `shot=outpost`) | 37 draws, 200k tris | 114 draws, 879k tris | 153 draws, 1.87M tris |

The other Balanced views: gate 108 draws and 768k triangles, closeup 118 and 813k, swatch 127 and 866k (nine chunks, four walls spread across the lawn). Beside the valley's own 111 draws and 855k triangles, a base this size costs a handful of draws and about 1 percent of the triangles. The sandbox has no GPU, so what a bigger base does to the frame rate is not measured yet. `/?bench=1&demo=outpost` flies the benchmark route with the outpost in view part of the way round; run it on a real machine once a heavier base exists (players can build one since Phase 2d).

The block tiles take about 43 MB of video memory at Balanced and Ultra (16 layers of 512 by 512, albedo and data, with mipmaps) and 11 MB on Low. They are baked the first time a block is meshed, so a world with no blocks pays nothing; under software rendering the bake takes about 9 seconds at Balanced and 3 at Low, a real GPU a few milliseconds.

Meshing a chunk on the sandbox CPU takes 0.3 to 1.3 ms for the demo's chunks and about 7 ms for a very dense one (a hollow room of 28 thousand triangles). The remesh queue spends 3 ms of a frame and always meshes at least one chunk, so one dense chunk can cost a frame; the mesher is pure and can move into a Worker if Phase 6 needs it.

### Known gaps in the blocks

- Slabs and wedges are drawn, can be walked on (a player steps up a slab or a ramp of wedges) and are placed by hand with Q and R. A slab's side shows a whole tile squeezed to half its height and a roof slope shows it stretched, The lighting pass looked at both in the Balanced shots and left them: they read as long panels on a roof and thin plates on a sill.
- One piece to a cell: a block put on a lower slab goes in the cell above, half a block over the slab, and two stacked slabs leave a gap a block cannot fill. A stair is a row of slabs one cell apart. The decisions page says why, and what would change it.
- The lighting pass against references 04 and 05 is done ([below](#lighting-pass-against-references-04-and-05)). A lit Scrap wall still reads orange at golden hour: its tiles are rust, and the low sun warms them.
- The tiles are small sci-fi panels. Reference 04's pieces are thicker and rougher (stone courses, timber); ours show the grid more. The lighting pass compared and left the tile art alone: how busy the tiles are is a decision about the art, and it is Austin's.
- A player standing in the grass sees blocks low in the frame through blades up to a meter tall (see the gate); that is the grass, not a gap in the blocks.

## Phase 2d: building by hand

Phase 2d lets a player place and break blocks (the rules and the reasons are in [decisions](decisions.md#phase-2d-building-by-hand)). The screenshots stand on a gate wall of the four tiers, placed through the `?debug` hook (`window.__ashbound.mp.placeNear`) so the aim repeats, with Build Mode on (B) and the cursor on the ground in the gateway. Headless Chromium on software GL, 1280 by 720, Balanced, golden hour, the HUD on.

![Build Mode: the ghost block stands in the gateway, cyan because a click would work](phase-2/build-gate.jpg)

![Out of reach: the ghost and the crosshair turn red and the caption says why](phase-2/build-out-of-reach.jpg)

| Image                                                | What to look at                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [build-gate](phase-2/build-gate.jpg)                 | The ghost is the beveled block itself, translucent with a bright rim, snapped to the grid cell a click would fill. The caption above the hotbar names the piece and its cost, slot 1 is selected, the crosshair has its cyan ring, and the status panel lists the keys of the mode. |
| [build-out-of-reach](phase-2/build-out-of-reach.jpg) | A step back: the cursor still sees the gateway but a click would not reach it, so the ghost and the ring turn red and the caption says "Out of reach".                                                                                                                              |
| [build-third](phase-2/build-third.jpg)               | The same from over the shoulder (V). The aim starts at the player's eyes, not at the camera, so the player's own body is never what the cursor hits.                                                                                                                                |
| [build-hotbar](phase-2/build-hotbar.jpg)             | The hotbar close up, after reference 07: four block icons on the cyan grid of placeable items, the selected slot in a white ring, the tools after them, ALT on the left and the B Build hint on the right.                                                                          |
| [game-pause](phase-2/game-pause.jpg)                 | The start card, retaken: the controls now list the mouse buttons, the hotbar keys, B, and (since slabs and wedges) Q and R, and the card still fits at 1280 by 720.                                                                                                                 |

### Frame cost of Build Mode

The ghost and the outline are four objects (the block, its edges, the wash over the target and its outline), and none of them casts or receives a shadow. With both shown the Balanced view costs 8 more draws (99 against 91) and 176 more triangles, because each object is drawn in two passes; with Build Mode off they are hidden and cost nothing. Counted like the tables above, on software GL: the real frame cost of eight transparent draws is not measured, but it is a very small fraction of the budget.

## Phase 2e: slabs and wedges

Phase 2e adds the two pieces that make roofs (how they are built and drawn is in [decisions](decisions.md#phase-2e-slabs-and-wedges)). They can be walked on and placed by hand (Q chooses the kind of piece, R turns it). The first screenshots show the gabled hall that `?demo=hall` raises: a platform with a ramp of wedges, composite walls with an arched door and slab sills, two lamp posts, and a roof of alloy wedges four rows deep with eaves and gable overhangs. Headless Chromium on software GL, 1280 by 720, Balanced, golden hour, `freeze=1`; retaken after the lighting pass at the end of this section.

![The gabled hall from the south-west, Balanced](phase-2/shapes-hallside.jpg)

![The roof and eaves up close, Balanced](phase-2/shapes-eaves.jpg)

| Image                                          | URL on the game page                                            | What to look at                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [shapes-hall](phase-2/shapes-hall.jpg)         | `/?demo=hall&shot=hall&quality=balanced&hud=0&stats=0&freeze=1` | The gable end: the roof is a stair of wedges whose slope is 45 degrees, the arched door has its top corners cut by upside-down wedges, and the eaves hang one block past the wall. Compare with the sloped roofs of 05.                                                                                       |
| [shapes-hallside](phase-2/shapes-hallside.jpg) | the same with `shot=hallside`                                   | The whole hall: wedge rows read as shingle courses with the same dark groove as the cubes, the slab sills sit half-way up the windows, and the ramp climbs to the platform.                                                                                                                                   |
| [shapes-eaves](phase-2/shapes-eaves.jpg)       | the same with `shot=eaves`                                      | The corner of the roof close up: chamfers on slopes and on the slanted ends of wedges, the groove between rows, and the closed surface where a wedge meets a cube. The tile on a slope is stretched along it by the diagonal (1.41 times); the lighting pass judged that it reads as long panels and left it. |

### Building with them

The next screenshots are taken in Build Mode with a slab or a wedge in hand. The player stands on the hall's front apron or on the grass in front of it (placed with the `?debug` hook so the aim repeats), and everything else is the game's own input.

![A wedge ghost on the apron, turned to rise toward the wall](phase-2/shapes-build-wedge.jpg)

![A slab ghost in the upper half of its cell, against the lamp post](phase-2/shapes-build-slab.jpg)

| Image                                                      | What to look at                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [shapes-build-wedge](phase-2/shapes-build-wedge.jpg)       | A wedge ghost on the apron deck. The player looks along the apron, where the aim alone would have the wedge rise away along it; one press of R turned it a quarter, so it rises toward the wall and its slope shows in profile. The ghost is the real shape, with its chamfers and a bright edge, and the caption and slots say wedge. |
| [shapes-build-slab](phase-2/shapes-build-slab.jpg)         | A slab ghost against the south face of a lamp post. The cursor is on the upper part of the cell, so the slab goes in the upper half. The four block slots show slabs in each tier's paint, and the status panel lists Q (block, slab or wedge) and R (turn it).                                                                        |
| [shapes-build-slab-low](phase-2/shapes-build-slab-low.jpg) | The same view with the cursor a little lower on the post: the slab drops to the lower half of the cell.                                                                                                                                                                                                                                |
| [shapes-build-hotbar](phase-2/shapes-build-hotbar.jpg)     | The hotbar after one press of Q: the four block slots are slabs drawn in each tier's own paint (rust, grey-green with cyan trim, steel, graphite with veins), and the caption names the piece, here "Reinforced Composite Slab" with its cost. Compare the cubes of [build-hotbar](phase-2/build-hotbar.jpg).                          |

### Frame cost of the shapes

The hall is four chunks and 12 thousand triangles (the outpost's 338 blocks make 10 thousand). Counted like the tables above, Balanced, every pass, on software GL: `shot=hall` 109 draws and 860k triangles, `hallside` 102 and 828k, `eaves` 104 and 795k, against the valley's own 111 draws and 855k. Alone, a cube and a slab are 44 triangles each and a wedge 32 (its slope and ends are panels, strips and corners like any face), so a roof is no heavier to draw than a wall. Build Mode costs the same with a slab or a wedge in hand as with a block: the ghost and the outline swap their geometry for the shape's own, made once and kept, and stay four objects.

### Lighting pass against references 04 and 05

Phase 2e-4 compares our structures with the construction references and adjusts the light that falls on them. It leaves the terrain, the sky and the tile art alone: the look spike's light was approved, and how busy the tiles are is Austin's decision.

**Measured first.** The crops are structure only (no sky, no grass). The numbers are on the displayed values: the median and the darkest 5 percent of the brightness (Rec. 709 luma, 0 to 1) and the mean saturation (largest channel minus smallest, over the largest). The references are not in the repository, so their rows can be reproduced only with the images; ours are the screenshots in this folder (golden hour, Balanced), and each pair is before then after.

| Crop                              | Median      | Darkest 5 % | Saturation  |
| --------------------------------- | ----------- | ----------- | ----------- |
| Reference 04, roofs and walls     | 0.16        | 0.08        | 0.40        |
| Reference 04, stone wall in shade | 0.17        | 0.12        | 0.20        |
| Reference 05, stone wall          | 0.28        | 0.12        | 0.39        |
| Reference 05, sloped roof         | 0.45        | 0.21        | 0.34        |
| Ours, the hall from the gable     | 0.23 → 0.24 | 0.06 → 0.07 | 0.49 → 0.44 |
| Ours, the hall from the side      | 0.14 → 0.17 | 0.06 → 0.08 | 0.57 → 0.52 |
| Ours, the roof and eaves          | 0.30 → 0.32 | 0.08 → 0.09 | 0.45 → 0.43 |
| Ours, the gate                    | 0.34 → 0.36 | 0.09 → 0.11 | 0.46 → 0.40 |

The references are single frames in their own light, so this is a check of range and not a match test. It showed that the brightness of a structure was already inside the references' range (a median of 0.14 to 0.34 against 0.16 to 0.45), so the pass does not brighten structures. Two things were outside it. Our shade was darker (the darkest 5 percent at 0.06 to 0.09 against 0.08 to 0.21) and violet, because the fill in shade is the golden-hour sky and it turned dark steel to plum, where the stone and timber of the references stay neutral. And Composite went yellow-olive in the low sun. Ours stays more saturated than the references' stone (0.40 to 0.52 against 0.20 to 0.40) on purpose: the amber marks, the cyan trim and the rust of Scrap are the spec's accents, and what the pass takes out is the tint the light adds, not the colour of the paint.

**What changed.** Three things in the structure shader and one in the mesher (the values and the reasons are in [decisions](decisions.md#phase-2e-slabs-and-wedges)):

- The sky's fill on a structure is cooler and a little stronger, so shade is a blue-grey and not a violet.
- The low sun's orange is pulled part of the way toward grey on every surface (it already was on metal), so Composite stays grey-green.
- A polished surface shows more of the sky face on, so a steel roof reads as steel and not as a dark slab.
- Where a wall meets the ground the corner shading now knows the terrain: each vertex is darkened by how high it is above the ground under it, half as bright on the ground and easing to nothing at a meter, so a wall sits in the ground and not on a table.

![The gabled hall from the side, before (left) and after (right)](phase-2/lighting-hallside.jpg)

![The gate at golden hour, before (left) and after (right)](phase-2/lighting-gate.jpg)

| Image                                              | What to look at                                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [lighting-hallside](phase-2/lighting-hallside.jpg) | The roof in shade is a little lighter and less purple; the amber marks keep their colour. The deepest shade, under the eaves and at the foot of the platform, is still dark and no longer plum.                                             |
| [lighting-eaves](phase-2/lighting-eaves.jpg)       | The same on the eaves, close up: the slopes keep their groove between rows and the shade between them has depth without going black.                                                                                                        |
| [lighting-gate](phase-2/lighting-gate.jpg)         | The Composite blocks along the top: yellow-olive before, grey-green after. The rows at the foot of the walls are darker where they meet the ground and the shade fades up the wall within a block; the Scrap floor blocks are less glaring. |
| [lighting-swatch](phase-2/lighting-swatch.jpg)     | Noon. It barely changes, as intended: the pass is about the low sun and the shade, and the mean brightness of the swatch goes from 0.504 to 0.510.                                                                                          |

**Cost.** Nothing is added to the scene and the geometry is the same, so the draw and triangle counts above stand. The shader has a handful more arithmetic operations per pixel. The contact shade is made when a chunk is meshed (the terrain never changes, so nothing is meshed again for it) and costs meshing time: a chunk of 29 thousand triangles (a hollow room) took 13.5 ms without it and 15.1 ms with it, and a checkerboard of 90 thousand triangles 46.7 and 50.2 ms, about 7 to 12 percent, in a Vitest run on the idle sandbox CPU (compare the pair: the 7 ms quoted above for a dense chunk was measured in the browser). The demo's chunks take 0.3 to 1.3 ms, so for them it is a tenth of a millisecond. The remesh queue still spends 3 ms of a frame and always meshes one chunk.

**Not checked.** Low and Ultra draw structures with the same shader and rendered the hall and the gate with no console error, but only Balanced's pictures were retaken. Nothing here has been seen on a real GPU: the light is judged on software-rendered screenshots, so the first look on Austin's machine is the one that counts.

## Phase 4b: the Outpost Core

The Core is the station's reactor, standing in the crater at the middle of the crash site, and the whole run is about it: the nights are about holding it, and the run ends when it falls. It is drawn to be found from across the valley and read at a glance, in the palette of the rest of the game: dark steel, amber trim and the cyan of the accents. The choices are in [decisions](decisions.md#phase-4b-the-outpost-core-2026-10-21).

### The reactor

- **Shape.** A foundation the width of its 3 by 3 footprint, a body with three vents of light in each face under a line of amber trim, a deck, four pylons with amber bands and cyan caps, and a frame joining their tops. In the cage a six-sided cyan crystal turns and bobs over a plate of light, with a thin ring tilted about it. It is 4 blocks high, about two blocks above the rim of the crater, so it is the first thing in the clearing the eye finds. The foundation reaches a block into the ground, because the crater floor slopes under it.
- **Steel.** Dark blue-grey and fairly metallic, so the golden sun gives it warm edge light instead of turning it to clay (a first version in lighter steel did exactly that, a tan like wood) and the night makes it navy.
- **The crystal is the gauge.** Cyan while the Core is sound, amber once it is worn and red near the end, with the turns at about the marks of the gauge on the HUD (half and a quarter). The beat quickens as it weakens, it flickers below 40 percent, a hit flashes it white, and when the Core has fallen it sits dark, grey and tilted. The vents and the caps take the crystal's colour, so the whole plinth shows it from the other side of the clearing. The glow dims on the faces turned away, so it reads as cut facets.
- **Cost.** Six meshes: four merged by material (the steel, the lighter plates, the amber, the lights), the crystal and the ring. Counted like the tables above (Balanced, every pass, software GL), in view it adds 11 draws and about 24 thousand triangles: `shot=core` 105 draws and 747 thousand triangles against 94 and 724 thousand with the Core hidden, `shot=reactor` 106 and 752 thousand against 95 and 729 thousand. From `shot=lake`, where it is out of the main view, it still adds 5 draws and 11 thousand triangles, in the passes that are not the main view. Most of the triangles are the rounded corners of the small boxes (300 each); fewer segments on the thinnest trims would take about a third off if the frame ever needs it.

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, taken with the page's `?debug` hooks (`__ashbound.mp.warp` to nightfall, `__ashbound.mp.hurtCore` to wound it). Each reproduces from its URL, for example `/?shot=core&time=night&debug&quality=balanced&freeze=1&stats=0`.

![The Core in its states](phase-4/core-states.jpg)

| Image                                        | What to look at                                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [core-day](phase-4/core-day.jpg)             | `shot=core`: the Core from the south-east rim at golden hour. The low sun gives the steel warm edges; the amber bands and the cyan vents are the only saturated colour on the dark floor of the crater. |
| [reactor-day](phase-4/reactor-day.jpg)       | `shot=reactor`: from a few steps away with the sun behind the camera. The crystal's facets, the ring, the vents, and a plinth that is whole on this side.                                               |
| [core-night](phase-4/core-night.jpg)         | The first night: the moon on the steel, the cyan crystal the brightest thing in the clearing, and the Core's gauge under the clock, whole.                                                              |
| [core-fallen](phase-4/core-fallen.jpg)       | The Core has fallen: the crystal is dark and tilted, the lights are out, the gauge reads 0 in grey, the banner and a toast say so.                                                                      |
| [core-pause](phase-4/core-pause.jpg)         | Esc after the fall: the pause card names the end of the run and the nights survived (until 4h, which put the Overrun card in its place).                                                                |
| [reactor-states](phase-4/reactor-states.jpg) | The reactor close up at night, whole, worn (amber), failing (red) and fallen.                                                                                                                           |
| [core-gauge](phase-4/core-gauge.jpg)         | The gauge under the clock, enlarged, in its four states.                                                                                                                                                |

### Known gaps in the Core

- The wreckage and the scorched patch round it, and the faint amber-red mist of the crash site, are not drawn: the Core stands alone in the crater.
- The crystal casts no light on the ground or the steel. The scene has no point lights (the atmosphere carries the sun and the sky), so the glow only blooms. A fake, a light patch on the ground, is the likely answer if it is missed.
- Seen only on software-rendered pictures. How it reads on a real display, and how the bloom treats the crystal there, is for the first look on a real GPU.

## Phase 4c: Health and Energy

The two meters in the top-left corner are the player's own now, and each of them has a way to say it is running low without a number (reference 07 has none either). The choices are in [decisions](decisions.md#phase-4c-health-and-energy-2026-10-23); the colours are the HUD's own palette, so nothing here is new paint.

- **Health.** Three pale mint segments that empty from the right. Below a quarter the fill turns coral red and breathes slowly, close to the red of the Core's gauge when it is critical, until the player mends.
- **Energy.** The slim blue bar with the white cap. Below a quarter it turns amber (close to the Core gauge's worn tone), which is also where it starts to slow the player, so the colour never says "fine" while the legs are already heavy. With none left the frame of the bar breathes dark red.
- **Statuses.** Round icons under the bars with a short caption after a small triangle. A good one is green with an arrow up ("Charging", with the Core's crystal as its icon, while the player stands in the Core's field) and a bad one is amber with an arrow down ("Low energy", "Out of energy", with a bolt). They come and go with the state and are never made up: the flask, mushroom and shield icons and the "Rested" buff of the look spike are gone.
- **A wound.** The Health bar flashes coral for half a second and the edges of the screen redden for a little longer, in a soft vignette that leaves the middle of the view clear, so the player can still see what hit them. `prefers-reduced-motion` turns the breathing and the flashes off and leaves the colours.

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, taken with the page's `?debug` hooks (`__ashbound.mp.hurtPlayer`, `__ashbound.mp.setVitals`). The flash of a wound lasts under a second, so its picture holds the animation a little way in. The Charging picture is taken beside the Core at the first night, with the mouse taken so the run is on.

![The corner of the HUD in six states](phase-4/vitals-states.jpg)

| Image                                              | What to look at                                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [vitals-full](phase-4/vitals-full.jpg)             | The lake at golden hour with full bars and no icons: the corner looks as it did before the numbers were real.                                                                        |
| [vitals-hit](phase-4/vitals-hit.jpg)               | A wound of 38 points a moment after it lands: two and a bit segments, the bar flashing and the edges of the screen red.                                                              |
| [vitals-low-health](phase-4/vitals-low-health.jpg) | Under a quarter of Health: one short segment in red.                                                                                                                                 |
| [vitals-low-energy](phase-4/vitals-low-energy.jpg) | 14 Energy: the bar is amber and the "Low energy" icon is up. Walking and sprinting are already about 15 percent slower and a held click repeats at about three quarters of its rate. |
| [vitals-empty](phase-4/vitals-empty.jpg)           | No Energy: "Out of energy", the frame of the bar breathing dark red. Walking is at 65 percent and a held click at half the rate.                                                     |
| [vitals-charging](phase-4/vitals-charging.jpg)     | Beside the Core at night with 17 Energy: "Charging" above "Low energy", the one lifting as the other lasts.                                                                          |
| [vitals-states](phase-4/vitals-states.jpg)         | The corner cut out of each of the six and enlarged.                                                                                                                                  |

## Phase 4d: the crawler

The first machine sets how the rest of them will look: low and dark against the lit ground, so that at a distance it is a silhouette with a few lights on it, and close up a small walker you can read at a glance. It is drawn from code like the Core (no assets, so `CREDITS.md` is unchanged) and in the Core's palette: dark steel, amber trim, and a hot light where the sensors are. The choices are in [decisions](decisions.md#phase-4d-the-crawler-2026-10-23).

### The crawler

- **Shape.** A hull of dark blue-grey steel 0.9 blocks long with a plate and a thin amber spine on its back, the engine behind it, a head in front with a red strip for an eye and a pair of pale jaws, and six legs of bars with amber joints that spread to 1.7 blocks across. It stands 0.7 blocks high: below a player's waist, so a crowd of them reads as something on the ground, not as people.
- **Steel and lights.** The steel is the Core's steel, fairly metallic, so the low sun puts warm edges on it and the night makes it navy. The joints and the spine glow a little and breathe; the eye is the brightest point on the machine, so a crowd at night reads as a field of red points before it reads as shapes. A hit lights the whole machine white-hot for a moment, and the lights flicker as its health fails.
- **Movement.** The legs step in two tripods (front-left, middle-right and back-left, then the others). The stride follows how far the machine has walked and the swing follows its speed, so one that is slowing shuffles and one that has stopped stands. A bite is a lunge of the body with the jaws snapping, and a machine arrives by rising out of the ground over 0.6 seconds, so a spawn does not pop. Each differs in size by up to 5 percent from its id.
- **Cost.** One instanced mesh of 720 triangles a machine: one draw call, and one more into the sun's shadow map, however many there are. The field is not culled (one bounding sphere would have to cover the whole valley), so a full field of 100 costs the same wherever the camera looks: 72 thousand triangles in the camera's pass and as many again in the shadow pass, about 144 thousand on top of a Balanced frame of about 750 thousand (every pass counted, as in the tables above), a fifth at the worst. The vertex work is a handful of arithmetic operations a vertex. No real GPU has timed it yet.

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, taken with the page's `?debug` hooks (`__ashbound.mp.spawnCrawlerAt`, `spawnCrawlers`, `warp`, `hurtCore`). The machines are put where they stand while the run is held, so each picture is exact. A software frame takes seconds and a crawler walks a long way in that time, so the pack on the road is walked in hops of the clock (`mp.warp`) and photographed on the first frame after a hop, while the legs are mid-stride; the night pictures hold the camera with `game.setPhoto`, off the player, so the machines are not drawn to it.

![The crawlers in six pictures: close up, on the march, at a wall, through the gap, at the Core, and a field of seventy-two](phase-4/crawlers-states.jpg)

| Image                                            | What to look at                                                                                                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [crawlers-closeup](phase-4/crawlers-closeup.jpg) | Three of them at golden hour from a few steps away, facing the camera: the hull, the amber spine and joints, the red strip of the eye, the legs spread to either side. The amber is the Core's amber, and it reads yellow in this sun. |
| [crawlers-march](phase-4/crawlers-march.jpg)     | The first night's dusk: a pack of six on the road to the Core, the reactor at the right edge. The legs are mid-stride, and the amber is what finds them in the grass.                                                                  |
| [crawlers-wall](phase-4/crawlers-wall.jpg)       | A ring of scrap blocks round the Core and five crawlers at its western side, chewing. The Core is whole (1000) and nothing has broken through yet.                                                                                     |
| [crawlers-breach](phase-4/crawlers-breach.jpg)   | Some seconds later: two blocks are gone, the machines are through the gap and at the Core's foot, and the crystal has turned amber at 405.                                                                                             |
| [crawlers-bite](phase-4/crawlers-bite.jpg)       | At the Core's west face, a row of them against its foot, the crystal cyan at 595 on its way down.                                                                                                                                      |
| [crawlers-crowd](phase-4/crawlers-crowd.jpg)     | Seventy-two round the Core from the south-east rim, near the full field of a hundred: the eyes and the amber read as a swarm of lights before they read as shapes.                                                                     |
| [crawlers-states](phase-4/crawlers-states.jpg)   | The six together.                                                                                                                                                                                                                      |

### Known gaps in the crawler

- The body stays level on a slope, so the feet can sink into the ground or hover over it by a few tenths of a block on the steepest ground a crawler climbs. A ground height for each foot would fix it; nothing in the picture says it matters yet.
- There is no sound (Phase 6) and no health bar: a hit shows as the flash, and failing health as the flicker of the lights. What hurts one is the pulse blaster, drawn in [Phase 4e](#phase-4e-the-blasters-light).
- There is only one kind. The armored, flying and breacher machines of the spec come with Phase 5, and stand in as crawlers until then.
- Seen only in software-rendered pictures. How the glow of the joints and the eye sits with the bloom on a real display is for the first look on a real GPU.

## Phase 4e: the blaster's light

The pulse blaster is the first thing in the game that is drawn only as light: the bolt, the sparks where it lands and the burst of a machine that falls are added on top of the picture and glow, and nothing in the scene is lit by them. The palette is the game's own: a white-hot core with a breath of colour round it, the amber of the Core's trim and the crawler's joints where a machine is hit, and the shooter's seat colour wherever else a bolt ends, so that in a game of four every bolt says whose it is. Nothing here is an asset, so `CREDITS.md` is unchanged. The choices are in [decisions](decisions.md#phase-4e-the-pulse-blaster-2026-10-23).

### The light

- **The bolt.** A streak that leaves the gun with its tail behind it: the head flies at 170 blocks a second and the tail trails 8 blocks, tapering to nothing, a white core in a halo of the shooter's colour. It is drawn the same few pixels wide wherever it is, with a core of three or four and a halo of about ten at 720p (wider with distance, so a far bolt still shows and a near one never fills the screen), and it fades in over its first four blocks, so that it does not begin as a smear in front of the player. A bolt shows for at least a tenth of a second, however near its mark. A shot at the longest range, 40 blocks, takes a quarter of a second to arrive, and what happens where it lands waits for it.
- **The muzzle.** A four-pointed flash for 0.08 seconds and four sparks, where the gun is held: 0.55 blocks ahead of the eyes, a quarter of a block to the right and a fifth below, which is the lower right of the view in first person and the avatar's right hand in third.
- **The strike.** Where a bolt ends: a flash that swells to a block and a quarter across in 0.14 seconds and ten sparks thrown back off the mark, which leap, fall and go out in about half a second. Amber on a machine, the shooter's colour on a block, the ground or the Core.
- **The kill.** When a machine falls, the burst: a hot core and a flash that swells to over three blocks across in 0.22 seconds, and thirty sparks flung every way at once, in a deep orange. It plays where the machine stood, and the machine is gone at that moment. Far flashes and sparks are drawn larger (up to two and a half times) so that they still read, and none is larger on the screen than a few dozen pixels, so one at the camera does not fill it.
- **Cost.** Two instanced meshes, one for the bolts and one for the sparks and flashes, so a firefight is two draw calls whatever it holds, added into the HDR target above the bloom's threshold. Nothing is lit by them and nothing casts a shadow. Everything an effect does while it plays (the streak flying, the flash swelling, a spark's flight and fall) is worked out in the vertex shader from the moment it was born, so the CPU writes a few numbers when something happens and nothing while it plays out. The buffers are rings of 64 bolts and 768 sparks, each one quad, so 832 quads (1,664 triangles) at the very most, and the meshes are in the scene from the start, drawing nothing, so the first shot of a session builds no programs.

### In the hands

- **Slot 5.** The blaster's icon, a pale pistol with a cyan-lit barrel, takes the fifth place of the hotbar on the plain dark slot the tools use (the blocks sit on the cyan blueprint grid), and is picked like any slot. Slots 6 to 8 stay the placeholders they were.
- **The sight.** A thin white ring with a dot at the middle and a tick at each quarter, so that it reads as a weapon and not as the build cursor, and the caption above the hotbar says "Pulse Blaster" and "Uses 0.6 Energy a shot" for a moment after the choice.
- **The hit marker.** Four ticks cross the ring of the sight for a quarter of a second when a shot hits a machine: white and small for a hit, larger and amber for the kill. It is a fade and not a movement, so it stays when the player asks for less motion.
- **The start card.** The keys list gains the blaster without a new row, so the card still fits a 1280 by 720 window without scrolling: the labels of the click and choose rows now read "Break or place; LMB fires the pulse blaster" and "Choose a block, or 5 for the pulse blaster", on two lines each. (A line of its own made the card 25 px too tall.)

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, at the first night's dusk (the day picture and the HUD ones by day), taken with the page's `?debug` hooks (`__ashbound.mp.fire`, `fireAtMachine`, `spawnCrawlerAt`, `warp`). A bolt's light lives a fifth of a second and a software frame takes several seconds, so the page's animation clock was replaced for the pictures: each frame advances it by a sixtieth of a second, and the clock is stopped for the photograph, so every picture holds an effect at an exact age. The hit marker is held a little way into its flash for the same reason.

![The blaster in six pictures](phase-4/blaster-states.jpg)

| Image                                          | What to look at                                                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [blaster-bolt](phase-4/blaster-bolt.jpg)       | A shot seen from the side, three frames after the click: the flash at the muzzle on the left, the streak with its white core and a bright head, and the crawler on the right already lit white-hot by the hit. |
| [blaster-strike](phase-4/blaster-strike.jpg)   | Two frames later the head has reached the machine: the flash on it, the tail still behind.                                                                                                                     |
| [blaster-kill](phase-4/blaster-kill.jpg)       | The third shot: the burst where the machine stood, a bright core with sparks flung every way. It is a tenth of a second old, so the sparks are still close.                                                    |
| [blaster-first](phase-4/blaster-first.jpg)     | First person, the frame after the click: the flash and four sparks at the lower right where the gun is held, and the bolt leaving along the line of sight to the ring of the sight.                            |
| [blaster-third](phase-4/blaster-third.jpg)     | Third person, the same moment: the flash at the avatar's right hand.                                                                                                                                           |
| [blaster-day](phase-4/blaster-day.jpg)         | The side view by day (Day 1, 8:00): a pale yellow line over the green of the grass, less punch than at dusk and still easy to follow.                                                                          |
| [blaster-hud](phase-4/blaster-hud.jpg)         | Key 5 by day: slot 5 lit, the sight with its four ticks, and "Pulse Blaster, Uses 0.6 Energy a shot" above the hotbar.                                                                                         |
| [blaster-hitmark](phase-4/blaster-hitmark.jpg) | The sight enlarged: the white ticks of a hit, and the larger amber ticks of the kill.                                                                                                                          |
| [blaster-card](phase-4/blaster-card.jpg)       | The start card at 1280 by 720 with the two relabelled rows, and nothing cut off at the foot.                                                                                                                   |
| [blaster-states](phase-4/blaster-states.jpg)   | Six of them together.                                                                                                                                                                                          |

### Known gaps in the blaster's light

- There is no gun in the hands or on the avatar. First person shows only the flash at the lower right, and third person the flash at the hand; there is no recoil, and the avatars do not raise an arm. A model, with its own flash and a reload, belongs with the other tools of Phase 5.
- A shot lights nothing: the scene has no point lights, so the ground under a strike and the machine it hits do not brighten, and the glow is the bloom's alone (as with the Core's crystal). A fake, a patch of light that fades, is the likely answer if it is missed.
- A bolt in first person is a short streak along the line of sight, not a long beam: it leaves a hand at the edge of the view and flies away from the camera, so most of it is foreshortened. That is how it looks to the shooter; to everyone else it crosses their view.
- No sound (Phase 6) and no damage numbers.
- Seen only in software-rendered pictures. How wide the bolt reads and how the bloom takes the flashes on a real display is for the first look on a real GPU.

## Phase 4f: the waves

The waves add no art of their own: the machines are the crawlers of 4d, and the only new thing on the screen is a line of text. What 4f changes is when they come and from where, which a chart shows better than a photograph. The choices are in [decisions](decisions.md#phase-4f-the-waves-2026-10-23).

### What the crew sees

- **The warning.** A toast above the hotbar, in the style of the others (a dark rounded bar with light text), ten seconds before each wave: "Wave 1 of 3: 4 machines in ten seconds". It is one element that lives 1.6 seconds and is shared with the other messages (nightfall, dawn, the Core falling), so a second message replaces the first.
- **The wave.** Four to seven crawlers, a few more later in the game, come out of the ground one after another at the edge of the valley, 46 blocks from the Core, all on one side of it, and walk the cheapest way to it. They are the instanced mesh of 4d, so a bigger night costs the same draw call.

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, `?debug&night=4`, driven with the page's debug hooks (`__ashbound.mp.warp` to reach the warning and the machines, `enemies()` to read where they are). The march picture is held in golden light (`time=golden`) because the sky would otherwise follow the clock into the night over the jumps of the clock that walk the machines, and the camera is held above the grass, which hides a crawler from the ground. The chart is drawn from the positions of every machine of each wave, read off the running game right after the last of the wave came out of the ground, not from the plan.

![The waves in four pictures](phase-4/waves-states.jpg)

| Image                                      | What to look at                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [waves-warning](phase-4/waves-warning.jpg) | Night 4, four seconds in: the toast "Wave 1 of 3: 4 machines in ten seconds" above the hotbar, the Core whole and the clock at 3:56.                                                              |
| [waves-march](phase-4/waves-march.jpg)     | The first wave of night 4, nine seconds after it came out of the ground: four crawlers crossing the clearing from the west toward the Core (the reactor at the right edge), seen from above.      |
| [waves-sides](phase-4/waves-sides.jpg)     | Where each wave of night 4 (three waves) and night 9 (four) came in: the Core in the middle, the ring 46 blocks out, each wave a colour. Each keeps to one side, and the next comes from another. |
| [waves-states](phase-4/waves-states.jpg)   | The four together.                                                                                                                                                                                |

### Known gaps in the waves

- The warning is one line that is gone in 1.6 seconds. A wave indicator that stays on the HUD and the rising stinger the spec asks for ten seconds ahead are Phase 6.
- A machine appears at the edge of the valley with no effect, usually out of sight in the forest. A flash or a plume of dust where it comes up is polish for Phase 6; for now the warning is the only sign of a wave coming.
- The armored, flying and base-targeting kinds are drawn and fight as crawlers until Phase 5.
- Seen only in software-rendered pictures, and the crowd of a late night (six waves of seven or more) has not been looked at.

## Phase 4g: going down and coming back

Going down adds a pill under the Core's gauge and a screen, and both are made of parts the HUD already has (the gauge's pill, the status icons, the toast, the wound's red), so nothing here is new paint. The choices are in [decisions](decisions.md#phase-4g-going-down-and-coming-back-2026-10-23).

### What the crew sees

- **The respawns.** A pill under the Core's gauge: a heart, "Respawns", a pip for each place in the crew's pool (three for each player in the room) and the number. The filled pips are the pale mint of the Health bar while there are two or more; at the last one the pip and the number turn amber, and with none the number turns coral red and the three empty pips are ringed in red (a pip that is not there cannot carry a colour). The pill flashes red for a moment each time the Core spends one. By day, while the pool is full and the run goes on, it is hidden; at night, and once one has been spent, it stays.
- **Down.** The edges of the screen go dark red in the soft vignette of a wound, with the middle left clear (the player can still see the fight), and a plain dim over all of it. In the middle: "You are down" in capitals, a line that says what is going to happen ("The Core brings you back in") and the seconds in large figures. With nothing in the pool the figures give way to "The crew is out of respawns. The dawn brings more". The crosshair and the caption over the hotbar go, and the hotbar dims, because the hands are stopped.
- **Back.** The screen clears and the Health and Energy bars are where the Core left them (full and half), with a new status under them: a steel shield and, after the small amber triangle of a bad status, "Shaken 0:45" counting down. A toast says it ("The Core brought you back, shaken · 1 respawn left"); on the others' screens another names the player.
- **Lost.** When every player is down and the pool is empty the same screen says "Outpost overrun" and why, the banner at the top right says "The whole crew is down", and the pause card on Esc said how the run ended, as it did when the Core fell (until 4h, when the Overrun card took its place). The Core is left as it stood.

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, `?debug&night=1&waves=0`, driven with the page's debug hooks (`__ashbound.mp.setRespawns`, `hurtPlayer`, `warp`). The run is held while the mouse is free, so each picture is the state that was set up, and the toast is held on screen because it would fade in less time than a frame takes here. The pause card is the last picture; the others have it hidden.

![Going down and coming back in six pictures](phase-4/respawn-states.jpg)

| Image                                            | What to look at                                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [respawn-pill-low](phase-4/respawn-pill-low.jpg) | Night, the last respawn: the pill under the Core's gauge with one amber pip of three.                                                                           |
| [respawn-down](phase-4/respawn-down.jpg)         | Down some way from the base with four seconds to go: the dark red edges, the countdown in the middle, the Health bar empty, the hotbar dimmed and no crosshair. |
| [respawn-wait](phase-4/respawn-wait.jpg)         | The same with nothing in the pool: the line says the dawn brings more, and the pill reads 0 in red over three ringed pips.                                      |
| [respawn-back](phase-4/respawn-back.jpg)         | Back at the base, looking at the Core: Health full, Energy half, "Shaken 0:45" under the bars, the pill down to two, and the toast.                             |
| [respawn-overrun](phase-4/respawn-overrun.jpg)   | The whole crew down with nothing left: "Outpost overrun", the cause under it, the banner and the Core untouched.                                                |
| [respawn-pause](phase-4/respawn-pause.jpg)       | Esc after it, before 4h: the pause card said "Outpost Overrun on Night 1 · the whole crew went down · 0 nights survived".                                       |
| [respawn-pills](phase-4/respawn-pills.jpg)       | The pill cut out and enlarged in its three tones: two of three, the last one (amber), none (red).                                                               |
| [respawn-states](phase-4/respawn-states.jpg)     | Six of the pictures together.                                                                                                                                   |

### Known gaps in going down

- A downed player's avatar still stands where they fell on the other screens. A body lying down, or a marker over it so the crew knows whom to cover, is polish for Phase 6, and so are the sounds (a low hum as they fall, a chime as the Core brings them back).
- Being brought back is a cut: the view jumps to the seat. A short fade or the Core's light drawing the player in is Phase 6. Nothing protects the player the moment they are back either: a crowd at the seat can put them down again at once, and that spends another charge. A breath of safety (and a light on the seat to say so) is for play-testing to ask for.
- Seen only in software-rendered pictures; the vignette is the one place the HUD asks the GPU for a large soft gradient, and how it reads on a real display is for the first look there.

## Phase 4h: the Outpost Overrun card

A lost run ends in one card, and the card starts the next run. It is made of the HUD's own parts (the pause card's dark slate frame, the coral red of the Core's fallen gauge for the title, the amber outline of the Play button for Retry), so nothing here is new paint. The choices are in [decisions](decisions.md#phase-4h-the-outpost-overrun-card-with-retry-and-new-run-2026-10-24).

### What the crew sees

- **The card.** In the middle of the dimmed world, in the pause card's frame: the small amber kicker "Ashbound Outpost", the title "Outpost Overrun" in coral red, one sentence on how it ended ("The Outpost Core fell on Night 3." or "Every player was down on Night 2 and the crew had no respawns left."), then the number the run is judged by in a wide, warm-tinted tile of its own (the nights survived in large figures over a small capitals label, "2 NIGHTS SURVIVED"), and a row of smaller tiles under it: Time held, Machines destroyed, Blocks placed, Materials gathered and Respawns used (Materials gathered came with [Phase 5a](#phase-5a-salvage), so the pictures below, which are 4h's, show four). Research earned joined that row in [Phase 5c](#phase-5c-research), and the spec's upgrades join it in 5e. The HUD behind the card goes on telling the same story: the Core's gauge is empty, the banner says "The Outpost Core has fallen" (or "The whole crew is down") and the respawn pill shows what the crew had left.
- **Retry and New Run.** Two buttons under the tiles: Retry in the amber outline of the Play button, New Run quiet beside it, and a line that says what each does. Pressing one dims both and the line says "Starting the next run…" until the run is up (the buttons come back after eight seconds if it never is).
- **A guest.** The same card with no buttons: the line under the tiles says "Waiting for Host to start the next run." with the host's name. The room card at the top right stays above it, so a guest can still leave.
- **After Retry or New Run.** The card is gone and the screen is at the start of a run: the clock at Day 1 7:59 (it starts at 8:00 and has run a moment), the Core's gauge hidden again, the respawn pill showing the charges the crew brings and the player at their seat. Retry is the same valley, with the same land, road and trees, the Core where it was and nothing built. New Run is another valley.

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, `?debug&waves=0&time=golden` (the sky is held at golden hour, or it would follow the clock into the night the run is warped to), driven with the page's debug hooks (`__ashbound.mp.warp`, `hurtPlayer`, `hurtCore`, `placeNear`, `spawnCrawlerAt`, `fireAtMachine`). The run is held while the mouse is free, so each picture is the state that was set up: four machines shot down, a hut of 24 blocks built by the seat, the player felled once and brought back, and then the Core falling on night 3 (the second card is a second run, lost to the whole crew at night 2). Retry and New Run were clicked for real. The three world views are taken from one camera, six blocks to the side of the seat and three and a half up, looking between the hut's place and the Core. The guest's card is a second page in a room, through a local PeerServer.

![The Outpost Overrun card and what follows it, in six pictures](phase-4/overrun-states.jpg)

| Image                                        | What to look at                                                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [overrun-core](phase-4/overrun-core.jpg)     | The Core fell on night 3: two nights survived, 32:15 held, four machines destroyed, 24 blocks placed, one respawn used, Retry in amber and New Run beside it, and the line that says what each does.                                             |
| [overrun-card](phase-4/overrun-card.jpg)     | The same card cut out and enlarged.                                                                                                                                                                                                              |
| [overrun-crew](phase-4/overrun-crew.jpg)     | A second run lost on night 2 with the pool empty (three respawns used, one night survived): the same card with another sentence, the respawn pill red at 0 and the banner "The whole crew is down".                                              |
| [overrun-guest](phase-4/overrun-guest.jpg)   | A guest's screen when the host's Core falls on night 3 (two nights survived, nothing else counted here): the same card with no buttons, "Waiting for Host to start the next run." where they would be, and the room card still at the top right. |
| [overrun-built](phase-4/overrun-built.jpg)   | Behind the first card: the hut the crew built (scrap walls, a composite roof) at the right, the Core's cage at the left with its crystal dark, "CORE 0" in the gauge.                                                                            |
| [overrun-retry](phase-4/overrun-retry.jpg)   | After Retry, the same camera: the same land, the same road and trees, the Core lit and whole, the hut gone, Day 1 7:59.                                                                                                                          |
| [overrun-new](phase-4/overrun-new.jpg)       | After New Run, the same camera in another valley: rock outcrops and the lake at the right, the Core where the new crash site is, Day 1 7:59.                                                                                                     |
| [overrun-states](phase-4/overrun-states.jpg) | Six of the pictures together.                                                                                                                                                                                                                    |

### Known gaps in the Overrun card

- Only what the run already knows is counted: nights, time held, machines destroyed, blocks placed, materials gathered (since 5a) and respawns used. Research earned arrived with 5c ([Phase 5c](#phase-5c-research)); upgrades completed (SPEC section 9) arrive with 5e.
- The card appears at once, with no fade and no sound, and the world behind it is dimmed but not stopped from being looked at for a moment first (the mouse is freed a second and a half after the loss, so a playing crew sees the wreck first). A slower reveal and the loss's stinger are Phase 6.
- The room card is always open in a room, 330 pixels wide at the top right, and sits above the Overrun card so that a guest can still leave: in a window under about 1,300 pixels wide it covers the right edge of the card, and in one under about 660 it covers the buttons too (there is nothing to fold in a room). A usual window is clear of it.
- A guest cannot ask for Retry or New Run; the host chooses. A vote is not in the spec.
- There is no way out to a title screen yet: the room panel and closing the tab are it.
- Seen only in software-rendered pictures. The tiles and the type are the HUD's, so how they read on a real display is for the first look there.

## Phase 5a: salvage

Salvage puts one new thing in the valley, the heap, and three on the screen: a card under the crosshair, a line of toast and a number in the hotbar. The screen parts are made of the HUD's own pieces and the heap is painted in the Scrap blocks' palette, so nothing here is new paint. The choices are in [decisions](decisions.md#phase-5a-salvage-2026-10-24).

### What the crew sees

- **The heap.** Wreckage from the crash, built from boxes in code (no assets): about 2.9 blocks across and 1.7 tall at its usual size, and each heap is 0.85 to 1.25 times that. A buckled hull plate of patchwork Scrap with rust, teal paint and grey primer, an arc of the station's frame, a bent steel beam, and scorched rubble with a few embers still lit. One of three dressings sits on top, by the heap's number: hazard-striped crates with a cyan beacon, two barrels and a bent pipe, or a broken console whose cracked screen still flickers. The paint is the Scrap block's own, so a player who has stripped a heap knows what they were given.
- **The lamp.** A thin dark mast leans out of every heap to 4.4 blocks, with a short cross-arm and a small amber lamp that breathes. The valley's grass stands up to a block and a third and swallows a pile (the first model, a block tall, was lost in it), so the lamps are how a heap is found from across the valley.
- **A strip.** The heap flashes white-hot for about a third of a second and throws a spray of scrap sparks, and a layer of it comes away with each strip (on a heap of four: the dressing on top first, then the crates and rubble under it, then the beam, and the plate, the arc and the mast with the last, which shrinks them away as the heap sinks into the ground). The picture says how much is left, so a heap with two of its four strips taken is half of itself.
- **A dawn.** The heaps a new day uncovers come up out of the ground in about a second, the mast and the lamp first.
- **The card.** With the cursor on a heap in reach its edges glow warm amber, and a small dark card sits a little under the crosshair: a pale key cap "E", "Strip debris" in bold and "3 strips left" in soft type ("last strip" for the last one). A heap out of reach has no glow and no card. When the pool has no room, the caption above the hotbar says "The pool is full" in coral.
- **The toast.** "+9 Scrap" in the toast's usual dark bar, followed by " · the pool is full" when the pool took only part of the strip and " · that heap is stripped bare" for the last. Only the player who stripped sees it.
- **The count.** The first four hotbar slots carry the pool's count in the corner (30 Scrap to begin with, shared by the crew); a count of none is dimmed.
- **The tile.** The Outpost Overrun card's row has a fifth tile, "Materials gathered". The key list on the pause card has a row for E.

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, `?debug&waves=0&time=golden`, driven with the page's debug hooks (`__ashbound.mp.harvest` to strip without aiming, `heaps` and `heapsShown` to find and read them, `warp` to the dawn, `hurtCore` to end the run). The page's animation clock is replaced by one that moves a set step a frame, which holds a short effect at the age it was run to: the strip's flash is shown 0.18 s in, the last strip 0.08 s in, a dawn heap about three quarters of the way up. The run is held while the mouse is free, so each picture is the state that was set up. The pictures of the heap alone have the HUD hidden, and the layers and the dawn are taken from a camera hung 2.7 blocks above the grass, because the grass hides the foot of a heap from a player's eye (the other pictures are from a player's eye). The aim card and the strip are a player pressing the real E key with the mouse taken.

![Salvage in six pictures](phase-5/salvage-states.jpg)

| Image                                          | What to look at                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [salvage-crates](phase-5/salvage-crates.jpg)   | The crates dressing from a player's eye, 4.4 blocks away at golden hour: hazard-striped crates, the beam across the top, and the mast leaning out with its lamp. Other heaps' lamps show on their masts behind it.                                                                       |
| [salvage-barrels](phase-5/salvage-barrels.jpg) | The barrels dressing: two painted barrels and a bent pipe over the hull plate, the mast against the sun, and the Core's cage at the right edge.                                                                                                                                          |
| [salvage-console](phase-5/salvage-console.jpg) | The console dressing seen into the light: the cabinet in Scrap paint and its screen's cyan glow behind the beam.                                                                                                                                                                         |
| [salvage-layers](phase-5/salvage-layers.jpg)   | One heap of four strips, from above the grass. Whole; one strip (the crate and its beacon are gone); two (the hazard-striped crates under it); three (the beam, leaving the plate, the arc and the mast); the last strip 0.08 s in, white-hot and shrinking with sparks; and bare grass. |
| [salvage-prompt](phase-5/salvage-prompt.jpg)   | Aiming at a heap three blocks away: its edges lit amber, "E Strip debris · 3 strips left" under the crosshair, the first hotbar slot showing the pool's 30 Scrap, and the pause card's key list with its new E row at the lower right.                                                   |
| [salvage-strip](phase-5/salvage-strip.jpg)     | 0.18 s after pressing E: the heap still white-hot with sparks round it, the toast "+9 Scrap" above the hotbar, "2 strips left" on the card, and the count at 39.                                                                                                                         |
| [salvage-far](phase-5/salvage-far.jpg)         | From above the grass looking across the valley: several heaps in view, and the lamps on their masts are what show them among the trees and the grass.                                                                                                                                    |
| [salvage-dawn](phase-5/salvage-dawn.jpg)       | A heap a dawn uncovered, 0.7 s into its rise (the mast and the lamp are up and the body is coming out of the ground), and a moment later when it is up.                                                                                                                                  |
| [salvage-results](phase-5/salvage-results.jpg) | The Outpost Overrun card after a run that stripped three heaps: the fifth tile, "Materials gathered", reads 74, and the hotbar behind it shows the pool at 104.                                                                                                                          |
| [salvage-states](phase-5/salvage-states.jpg)   | Six of the pictures together.                                                                                                                                                                                                                                                            |

### Cost

One instanced mesh of 828 triangles a heap, drawn whole in every pass that draws the world, whatever is in view. Counted like the tables above (Balanced, every pass, software GL), from the far view: 22 heaps add 3 draw calls and 54.6 thousand triangles to a frame (97 draws and 781 thousand, against 94 and 726 thousand with the field hidden), about 7.5 percent. That is 2,484 triangles a heap, because three passes draw it. Each dawn adds four heaps, 10 thousand triangles; the 70 of the last dawn would add 174 thousand, about 24 percent, which is a number to watch rather than one to worry about on a dedicated GPU. Leaving out the heaps behind the camera or beyond the fog is the first thing to try if a real machine needs the triangles back. Nothing here is measured on a real GPU.

### Known gaps in salvage

- A block built in a heap's cell used to bury the heap, because nothing reserved the cell. That is closed in [5b](#phase-5b-costs): the ground round a heap with strips left refuses a block, and a dawn leaves a built-over heap down until the ground is free.
- Nothing was charged in 5a, so the pool only went up and the hotbar's counts had no use. That is closed in [5b](#phase-5b-costs) too: every block takes its price from the pool.
- A player walks through a heap, as through a machine. Collision for an odd shape is not worth it for a pile that is gone in a few strips.
- There is one look of the wreck in three dressings. A wider range is for later; heaps that give anything other than Scrap came with 5c ([Phase 5c](#phase-5c-research)).
- A strip has no sound, and neither has a lamp's hum; both are Phase 6 with the rest of the audio.
- The aim glow, the white-hot flash and the lamps' bloom are judged on software-rendered pictures. How they read on a real display is for the first look on a real GPU.

## Phase 5b: costs

Costs give the pool something to do: every block the crew places takes its price from it, and every block they break puts the price back. Nothing new is drawn. The ghost block, the line under the block's name and the hotbar's counts were all there already, and 5b gives them something to say, in the HUD's own colours. The choices are in [decisions](decisions.md#phase-5b-costs-2026-10-24).

### What the crew sees

- **A block the pool can pay for** looks as it always has: the ghost in cyan, the crosshair's ring cyan, and under the block's name the small line "Cost 1 Scrap".
- **A block it cannot pay for** is the ghost in the warm red of any refused placement, the ring red, and the line under the block's name turned coral and naming what is short: "Not enough Scrap", and "Not enough Advanced Alloy" for the dearer blocks, whose counts start at none (a count of none is dimmed; research opens them in 5c). A right click on a red ghost sends nothing and shows the same words for a moment, and if the host turns a click down (someone else spent the last Scrap a moment before) it sends the same words back.
- **A heap's ground.** A block cannot go close to a heap that still has strips left, about one and three-quarter blocks from its middle at the usual size (the pile's size scales it): the ghost is red and the line says "Debris is in the way". Stripping the heap bare with E clears the ground, and the same cursor spot goes cyan again.
- **The count.** The first four hotbar slots (30 Scrap to begin with, shared by the crew) go down by one for each block placed and up by one for each block broken, whoever placed it.
- **A guest's screen** reads its copy of the pool, at most 200 milliseconds old, so its ghost goes red and clears as the crew's pool changes, with nothing for the guest to do.

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, `?debug&waves=0&time=golden`, driven with the page's debug hooks (`__ashbound.mp.setPool` to set what the pool holds, `placeNear` and `breakBlock` to build and break, `harvest` to strip a heap, `build.aim` to read what the cursor would be refused for). The page's animation clock is replaced by one that moves a set step a frame, which holds the light still for a picture, and the mouse is taken and Build Mode is on, so each picture is a state that was set up. The ghost pictures stand in front of a wall of fourteen Scrap blocks, two rows, with a gap at the crosshair. The heap pair is one camera, 4.2 blocks from the pile and three above the grass, with the player's cursor on the ground beside it (the grass hides the foot of a pile from a player's own eye, and a block in grass is partly hidden too); the second picture is the same camera after the heap was stripped bare, and its clock reads later because stripping took a few seconds. The wide pictures have the hotbar and the line over it enlarged underneath, so the counts and the words can be read.

![What building costs, in six pictures](phase-5/costs-states.jpg)

| Image                                                | What to look at                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [costs-ghost](phase-5/costs-ghost.jpg)               | Left to right, one cursor spot in the gap of the wall. The pool holds 12 Scrap: a cyan ghost and "Cost 1 Scrap". The Scrap is gone: the ghost is red and the line says "Not enough Scrap", with the first slot at a dimmed 0. Scrap back to 12 and the Advanced Alloy slot chosen: red, "Not enough Advanced Alloy". |
| [costs-ghost-short](phase-5/costs-ghost-short.jpg)   | The middle picture at full size: the red ghost in the gap, the red ring at the crosshair, "Not enough Scrap" under "Scrap Block", and the four block counts dimmed to 0.                                                                                                                                             |
| [costs-heap](phase-5/costs-heap.jpg)                 | Left, the cursor on the ground beside a heap that has three strips left: the ghost is red and the line says "Debris is in the way". Right, the same camera after the heap was stripped bare: grass where it stood and the same spot cyan, "Cost 1 Scrap".                                                            |
| [costs-heap-refused](phase-5/costs-heap-refused.jpg) | The refused picture at full size: the whole pile (a crate with its beacon, the beam, the hull plate), the dirt road at the right, the red ghost at the pile's foot and the line over the hotbar.                                                                                                                     |
| [costs-pool](phase-5/costs-pool.jpg)                 | The pool counting along: 30 Scrap and nothing built; 18 after twelve blocks (two rows of six) went up; 24 after the top row was broken, which gave six back.                                                                                                                                                         |
| [costs-states](phase-5/costs-states.jpg)             | Six of the pictures together.                                                                                                                                                                                                                                                                                        |

### Known gaps in costs

- A red ghost is the same red whatever refused it (the pool, a heap, a player in the way, reach), and only the line over the hotbar says which. A price chip on the ghost, or a colour of its own for a pool that is short, is for play-testing to ask for.
- A heap's column cannot be seen: a player learns how much ground a pile keeps by being refused. A faint ring on the ground while a block is aimed near a heap would show it.
- The dearer slots (Composite, Alloy, Energy-Infused) showed a dimmed 0 and refused every block until the crew had a way to get them, so they looked broken. 5c gave them a padlock and a "needs research" line ([Phase 5c](#phase-5c-research)).
- The counts jump when the pool changes: no tick, no small plus or minus beside the number and no sound for a block bought or given back. Those are Phase 6.
- Every shape of a material costs the same, so a slab and a wedge (half a block each) cost a whole block's price. A price for each is a number for play and for 5j.
- Seen only in software-rendered pictures. The ghost's colours and the red ring are judged there; how they read on a real display is for the first look on a real GPU.

## Phase 5c: research

Research puts three new things on the screen, a pill, a padlock and two lines of words, and repaints the one thing the valley has to show for it, the heap. Nothing is a new asset: the screen parts are the HUD's own pieces, and the heap's grades are colours in the same shader. The choices are in [decisions](decisions.md#phase-5c-research-2026-10-24).

### What the crew sees

- **The pill.** A third pill joins the column under the day and night clock, below the Core's gauge (at night) and the respawn charges: a small atom, "RESEARCH" in spaced capitals, a lavender bar and the points over the next row's, `12/20`. It is up while Build Mode is on, where the materials are chosen, and for ten seconds after the points change, so a player who does not build still sees what a dawn paid; it flashes lavender when the points rise. At the top of the ladder the bar is full and paler, and the words are the plain number, `100`.
- **A padlock.** A hotbar slot whose material has not been researched is dim and flat, with a small bronze padlock where its count would be (a count would only say none) and its block faint behind the lock, so a player can still tell the slots apart. Slots 2 to 4 start that way. The key still picks the slot: the ghost is the red of any refused placement and a right click sends nothing.
- **The words under the piece in hand.** Under the block's name, where the line says "Cost 1 Scrap" for a block the crew can pay for and "Not enough Scrap" for one it cannot, a block of a material not researched yet says "Needs research · 12 of 20": the points the crew has and the points that open it. When the points reach the row, the same slot says "Cost 1 Reinforced Composite" (or "Not enough Reinforced Composite" while the pool has none). The host sends the same news, "Reinforced Composite needs research", if a click gets to it anyway.
- **The toasts.** At a dawn that pays, a small dark bar under the clock's pills says "Research +12" and, 1.6 seconds later, "Reinforced Composite unlocked" when the points reached a row. The toast has a queue now (the Core falling and a wave coming use it too), so the second message waits for the first instead of replacing it; at most three wait.
- **The card under the crosshair.** A heap of anything but Scrap says what it gives: "Strip debris · Reinforced Composite · 2 strips left".
- **The tile.** The Outpost Overrun card has a sixth tile, "Research earned", between "Materials gathered" and "Respawns used". Six tiles lay out as two rows of three, not one row of six narrow ones.
- **The heaps.** A heap is dressed by what its strips give. Scrap is as 5a made it. Reinforced Composite is layered grey-green panels, dark where the layers part, with a cyan strip down the side of most of them and a cyan lamp on its mast. Advanced Alloy is dark steel brushed in one direction, with an amber inlay running round each panel just inside its edge and a white lamp. The frame of a better heap takes some of its tint, and the low orange sun is taken less warm by a better heap, as the blocks of the same materials are, so that Composite does not go olive in it and the steel does not go to wood. The model is the same, so a better heap is the same size, has the same layers that come away with a strip and costs the same to draw; only the dress and the lamp differ. The lamp is the cue from across the valley: amber for Scrap, cyan for Composite, white for Alloy.

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, `?debug&waves=0&time=golden`, driven with the page's debug hooks (`__ashbound.mp.setResearch` and `setPool` to set what the crew holds, `warp` to a dawn, `hurtCore` to end the run, `heaps` and `heapsShown` to find and read the heaps). The page's animation clock is replaced by one that moves a set step a frame, which holds a toast or a flash still for a picture; the toast's 1.6 seconds are held by the script so that each message can be taken in turn. The hotbar pictures stand in front of the wall of Scrap blocks of the costs pictures, with the same gap at the crosshair, and have the hotbar and the line over it enlarged underneath, so the padlocks and the words can be read. The pill pictures are the clock's column and the hotbar, enlarged, at 0, 20, 55 and 100 points. The pictures of heaps stand the camera on the side of the pile away from its mast: 4.4 blocks out and 2.7 above the grass for the near ones, 6.5 out and looking up at the lamp for the lamp ones, and 18 out and 9 above the grass for the far ones (the grass swallows a heap seen from a player's own eye). Each grade is a different heap in a different part of the valley, so the light on each differs: the Scrap one lies on the dirt road, the Composite one by the hill, and the Alloy ones in the forest's shade (the lamp picture is of one heap and the far pictures of another, where the trees leave the lamp clear). The far pictures at night are taken with the clock set to night (`stage.setMoment`). They are taken in a run that starts at the tenth night with the points to open every tier (`?night=10&research=9999`), so that all three grades lie in the valley.

![Research in six pictures](phase-5/research-states.jpg)

| Image                                            | What to look at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [research-locked](phase-5/research-locked.jpg)   | Three pictures from one spot with no points, each with the hotbar and the line over it enlarged underneath. Scrap Block in hand: the cyan ghost and "Cost 1 Scrap". Reinforced Composite Block: the ghost in the red of a refused placement and "Needs research · 0 of 20". Advanced Alloy Block: "Needs research · 0 of 55". Slots 2 to 4 are dim with a padlock each, and the chosen one has the white ring.                                                                                                        |
| [research-opened](phase-5/research-opened.jpg)   | Left: at night with 20 of 55 points, the pill reads `20/55`, slot 2 is open and shows its 12 Composite, the line says "Cost 1 Reinforced Composite", and the cyan ghost is a block the host will take. Right: the next day with 32 points, the pill reads `32/55` and Advanced Alloy still says "Needs research · 32 of 55".                                                                                                                                                                                          |
| [research-pill](phase-5/research-pill.jpg)       | The clock's column and the hotbar, enlarged, at 0, 20, 55 and 100 points: an empty bar and `0/20`; about a third full and `20/55` with Composite open; more than half full and `55/100` with Alloy open (its slot reads 0); and at the top a full, paler bar and the plain `100`, with the fourth slot open too.                                                                                                                                                                                                      |
| [research-toasts](phase-5/research-toasts.jpg)   | Left: "Research +20" under the clock's pills as the points rise to 20, the pill at `20/55`. Right: 1.6 seconds later, "Reinforced Composite unlocked", the second of the two bars of a dawn that pays, waiting its turn in the queue.                                                                                                                                                                                                                                                                                 |
| [research-results](phase-5/research-results.jpg) | The Outpost Overrun card after a run that held two nights with the Core untouched in both: the sixth tile, "Research earned", reads 24 (two nights of 12) between "Materials gathered" and "Respawns used", and the six tiles lie as two rows of three.                                                                                                                                                                                                                                                               |
| [research-heaps](phase-5/research-heaps.jpg)     | One heap of each grade from 4.4 blocks away, from the side away from its mast. Left, Scrap on the dirt road: patchwork rust, teal paint and primer, the crates' cyan beacon. Middle, Reinforced Composite by the hill: layered grey-green panels with a cyan strip down most of them and a dark, blue-tinted beam. Right, Advanced Alloy in the forest's shade: dark steel brushed one way with an amber inlay round each panel. All three are the one model, so the layers come away with a strip in the same order. |
| [research-lamps](phase-5/research-lamps.jpg)     | The lamp on each mast from 6.5 blocks: amber on Scrap, cyan on Composite, warm white on Alloy. Other heaps' lamps stand in the background: amber on the Scrap ones and, right of the pine in the left picture, a cyan one.                                                                                                                                                                                                                                                                                            |
| [research-far](phase-5/research-far.jpg)         | The valley from 18 blocks out and 9 above the grass, at golden hour. Left: a Composite heap at the middle with its cyan lamp and strips, among Scrap heaps with amber lamps. Right: an Alloy heap in the shade at the middle (its own lamp is behind a tree), a Composite heap's strips at the right edge, and at the top left, far off, an Alloy lamp, cream white next to the amber ones near the camera.                                                                                                           |
| [research-night](phase-5/research-night.jpg)     | The same two views with the clock set to night. The lamps and the Composite strips are what is lit: amber, cyan and white lamps, and the strips down the Composite panels glowing cyan. The Alloy inlay is barely lit, so across the valley it is the lamp that shows an Alloy heap.                                                                                                                                                                                                                                  |
| [research-states](phase-5/research-states.jpg)   | Six of the pictures together: a padlocked slot with its words, the unlock toast, the card's sixth tile, and a heap of each grade.                                                                                                                                                                                                                                                                                                                                                                                     |

### Cost

Nothing is added to the draw. A heap is still one instanced mesh of 828 triangles, drawn once in every pass that draws the world; the grade is one more float for each instance (128 at most, 512 bytes), uploaded with the others when the list changes, and the surface shader reads it to choose the dress, so the counts in [Phase 5a](#phase-5a-salvage) stand: 22 heaps add 3 draw calls and 54.6 thousand triangles to a frame, and each dawn adds four heaps. A better dress is a few more operations for each fragment than Scrap's, on the small part of the screen that a heap covers. Nothing here is measured on a real GPU; the shader's own cost is for the first look on one, with `?bench=1`.

### Known gaps in research

- The padlock is the same for every locked material and does not say how far off the unlock is. The line over the hotbar says it for the piece in hand and the pill for the next row; the whole ladder and what each row opens belong with the Terminal's panel (5d).
- A heap of a grade the crew has not researched is not uncovered at its dawn, and nothing says one is waiting, so a crew a night short of Alloy meets a valley with fewer new heaps and no reason why.
- A better heap is told by colour (the grey-green and the steel, the strips and the inlay, above all the lamp) and not by its outline, which is the model's. A Scrap heap's crates carry a cyan beacon of their own, low on the pile, which is the cyan of a Composite lamp at the head of its mast. Within reach the card names the grade.
- A lamp shows only over open ground. Alloy lies where the trees are, so from the valley an Alloy lamp is often behind a canopy, and the pictures needed some looking for to find one in the clear.
- Energy-Infused opens at 100 points and has nothing to fill it until the special machines of 5i, so the fourth slot reads a plain 0 once its padlock is gone.
- An unlock is two toasts: no sound, no flash on the slot, no screen. The sound is Phase 6.
- The pill's lavender is a new accent on the HUD. The references show no research readout to take a colour from, so it is a guess set beside the Core's cyan and the clock's amber, to be judged on a real display.
- Seen only in software-rendered pictures. The steel's brushing, the strips' glow and the lamps' colours (which the bloom and the tone mapper change) are judged there; how they read on a real display is for the first look on a real GPU.

## Phase 5d1: the Research Terminal

The Research Terminal is the first functional module: a model drawn in code that stands in one cell, and the first thing the crew builds that is not a block. Nothing else on the screen is new. The hotbar slot, the line over it, the ghost and the outline are the ones building already draws; what is new is the thing they point at. The choices are in [decisions](decisions.md#phase-5d1-modules-and-the-research-terminal-2026-10-26).

### The Terminal

- **Shape.** A field console on a steel pad, a little under a cell wide (0.8 of it) and about a cell tall with its masts. A foundation block and a rounded base carry a lighter cap and a cabinet at the back that stands to about 0.85 of a cell, with a lit screen on its front. A desk slopes away from the cabinet toward the player with a second screen laid in it and a row of five amber keys, and two thin masts stand on the cabinet's top, one with a steady amber cap and the other with a beacon that blinks. Each side of the cabinet has two amber bands and its back four upright cyan light bars, so the Terminal reads from every side: from the front it is a screen and keys, from behind four bars of light.
- **Steel and light.** The Core's palette: dark blue-grey, fairly metallic steel with a lighter trim, amber on what is worked (the keys, the bands, the beacon) and cyan on what is powered (the strip round the pad, the one along the desk's edge, the bars on the back and the lines of text). The golden sun gives the steel warm edges and the night makes it navy, as with the Core. The screens are dark teal glass with bright cyan lines on them: a first version with flat bright cyan screens read as blank panels, and the text is what makes them read as screens from across a clearing. There is no power in the game yet, so a Terminal is always on; the lights are the look the other modules take when they are.
- **It moves a little.** The screens shimmer, the strips and the readout breathe, and the beacon blinks every 2.2 seconds, all from the stage's animation clock, so a frozen picture shows the same Terminal at the same moment and a running page shows a console that is on.
- **It faces the player.** Placing it turns its front toward the player (screens and keys, so the first thing a player sees of their own Terminal is the front) and R turns it a quarter turn at a time, through four facings. The ghost is the model in the same turn, so what the player aims is what stands.
- **It stands in the ground.** The valley's ground is smooth and cuts a cell at any height, and a model on a cell's floor would hover over a slope or sink into a rise: the first picture of a Terminal in the cell the ground cut at 82 percent was a thin rod over the grass. The pad stands on a foundation block that reaches almost a cell below the floor, so where the Terminal's cell floats over the ground, the foundation is the plinth it stands on (up to three-quarters of a cell tall on a steep slope), and where the ground reaches a little into the cell, the foundation is buried and the pad sits on the grass. Where the ground would cover more than a quarter of the cell, the cursor puts the Terminal in the cell above. On a block, or on the upper half of a slab, the foundation is inside it and the pad sits on its top.
- **A Terminal that is aimed at** is outlined by its body box (0.8 by 0.9 by 0.8 of a cell), which is also what movement stands against; the masts and the beacon rise a little above the box.

### Screenshots

Headless Chromium on software GL at 1280 by 720, Balanced, `freeze=1`, `?debug&waves=0&time=golden&stock=200`, with the Terminals built through the page's debug hooks (`__ashbound.mp.place` and `placeNear`: the host's own command path) and the camera put where it can see them (`game.setPhoto`: 2.3 blocks out and 2.3 above the cell's floor, because the grass stands taller than a block and hides a low camera), the page's animation clock replaced by one that moves a set step a frame. The night pictures are the same view with the clock set to night (`stage.setMoment`). The ghost pictures are a player's own view with Build Mode on, the module slot chosen and the hotbar and the line over it enlarged underneath; the first has 100 Scrap in the pool, the second 39 (one short of the price), and in the third a Scrap block stands in the cell under the cursor and the pool holds 99.

![The Research Terminal in four pictures](phase-5/terminal-states.jpg)

| Image                                            | What to look at                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [terminal-front](phase-5/terminal-front.jpg)     | The Terminal from its front at golden hour, standing in the grass at the edge of the clearing with a heap behind it: the cabinet and its screen with lines of text, the sloped desk with the second screen and the five amber keys, the cyan strip round the pad, the beacon on a mast.                                                                           |
| [terminal-night](phase-5/terminal-night.jpg)     | The same view at night. The steel is navy and the lit parts are what is seen: both screens, the strips, the amber keys and bands.                                                                                                                                                                                                                                 |
| [terminal-back](phase-5/terminal-back.jpg)       | From behind, on the slope above the lake: the four cyan bars on the cabinet's back, the two masts with their amber lights, and the pad standing on the hill with its foot in the slope.                                                                                                                                                                           |
| [terminal-facings](phase-5/terminal-facings.jpg) | Four Terminals side by side, each turned a quarter turn further than the one before: its front, one side, its back and the other side, so every face of the model is seen. The ground differs from cell to cell, so the foundation shows as a plinth of a different height under each pad.                                                                        |
| [terminal-base](phase-5/terminal-base.jpg)       | Beside the Core at golden hour: two Terminals in the crater, one on the ground and one on a Scrap block, next to the Core's plinth, to show them at the scale of the rest of the base. The Core is about four times as tall.                                                                                                                                      |
| [terminal-ghost](phase-5/terminal-ghost.jpg)     | Three pictures from a player's eyes, with the hotbar and the line over it enlarged underneath. Left: the cyan ghost with its outline, "Research Terminal" and "Cost 40 Scrap", slot 6 chosen. Middle: the pool is one short and the ghost is the red of a refused placement, "Not enough Scrap". Right: the cell holds a block and the ghost stands on top of it. |
| [terminal-states](phase-5/terminal-states.jpg)   | Four of the pictures together: the front by day, the front at night, the back on the slope and the pair beside the Core.                                                                                                                                                                                                                                          |

### Cost

A Terminal is six meshes (steel, trim, amber, cyan lights, screen glass and beacon), 1,544 triangles in all, built once and shared by every Terminal. Counted like the tables above (Balanced, every pass, software GL), from the crash clearing looking at open ground, a frame is 97 draws and 776.7 thousand triangles with nothing built. One Terminal in view takes it to 109 and 779.8 thousand, two to 121 and 782.9 thousand and three to 133 and 785.9 thousand: each adds 12 draws and 3,088 triangles, because it is drawn twice, once in the main view and once in the shadow pass. With the three behind the camera, the shadow pass still draws them: 18 more draws and 4.6 thousand triangles, 6 draws and 1,544 triangles each. The triangles are a small part of a frame (0.4 percent for each Terminal), but the draws are the number to watch: a dozen Terminals in view would add 144, more than the rest of that frame has. The lit material reads the model matrix, so a module cannot be instanced the way the heaps are. The first things to try if a real machine needs the draws back are letting the thin lit parts (the light strips, screens, keys and beacon) skip the shadow pass, which takes 4 of the 12 draws away, and instancing a module kind once the turret (5f) is built many times. Nothing here is measured on a real GPU.

### Known gaps in the Terminal

- **The plinth.** On a slope the foundation shows as a plinth under the pad, up to three-quarters of a cell tall where the ground cuts the cell's floor just under the cursor's threshold (a quarter of a cell: `MODULE_SINK`). A raised threshold (0.4 to 0.5) would put more Terminals in the ground and fewer on a tall plinth, and is a number to change if play prefers it. An upper slab carrying a Terminal shows a stub of foundation under the slab's half.
- **No power state.** The Terminal is always lit. A module that is off, or that is working, is for the generator and the node (5g), and amber for "working" is waiting for the turret.
- **Twelve draws a module in view.** Every Terminal is a group of six meshes sharing one model and one set of materials, drawn in the main view and in the shadow pass, and the lit material reads the model matrix, so it cannot be instanced. A base with a dozen of them adds 144 draws to a frame ([Cost](#cost-2)), which is the point where the turret (5f) will want a cheaper kind of its own.
- **No sound.** Placing it, the keys and the screens are silent. Sound is Phase 6.
- **One model, one level.** An upgraded Terminal (5e) is the same model until the upgrade's own look comes with it.
- Seen only in software-rendered pictures. The screens' glow and the cyan strips (which the bloom and the tone mapper change) are judged there; how they read on a real display is for the first look on a real GPU.
