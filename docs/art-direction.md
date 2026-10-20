# Art direction

The owner wants the look to match the visual references as closely as possible: graphics, details, textures, aesthetics, fidelity and the HUD. This document says how, in words, because the reference images are third-party screenshots and stay out of this repository. From the look spike onward, our own in-engine screenshots become the references that pull requests compare against.

Two limits from the spec still apply (section 1): a stable 60 FPS at 1080p on mid-range laptops and integrated graphics, and only CC0, generated or clearly licensed assets. The look is bought with budget. The Balanced preset is tuned to hold the frame rate; Ultra goes closest to the references.

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

These are starting values for the look spike to tune against screenshots.

## Light and atmosphere

1. **Sun.** One warm directional light with soft shadows from a shadow map that follows the player. The sun has a visible disc and glow.
2. **Fill.** A hemisphere light: sky color above, warm ground bounce below. Ambient occlusion is baked into vertex colors for terrain and structures, so no screen-space AO is needed on Balanced.
3. **Sky.** A gradient dome with procedural clouds that catch the sun on their undersides.
4. **Haze.** Height fog and distance haze tinted toward the sun, with colored mist pockets in hollows and over the crash site.
5. **Shafts, bloom and grade.** Half-resolution light shafts and bloom, then a final color grade with a light vignette. Strong grading (reference 08) is the cheapest way to look rich on integrated graphics.

## Terrain, foliage and water

- **Terrain.** A smooth mesh from the seeded density field, with collision from the same field, shaded with triplanar textures that blend by slope and height: grass on flats, rock on steep faces, dirt on worn paths, ash at the crash site. If the look spike shows the cost is too high, the fallback is a smoothed heightfield.
- **Foliage.** Instanced trees (pines and a broadleaf) with two levels of detail and distant impostors, grass cards and flowers that sway in the wind, and scattered boulders. Density scales with the preset.
- **Water.** One lake with a sky-colored fresnel, ripples and sun glitter. Ultra adds a half-resolution planar reflection for the still-water look of references 01 and 02.

## Structures and materials

Structures keep the spec's dark metal with amber and cyan accents, built with the construction language of references 04 and 05.

- **Geometry.** Thick pieces: walls read as deep, with inset panels and frame trim. Every face is inset and chamfered by 0.05 to 0.12 units, and faces are not merged, so seams stay visible. Slabs and wedges give sloped roofs and strong silhouettes.
- **Tiers.** Scrap is patchwork salvaged plates with rust and rivets. Composite is layered grey-green panels with cyan edge strips. Alloy is brushed dark steel with amber inlays. Energy-Infused is dark with pulsing cyan veins. An upgrade must change the look, not only the stats.
- **Modules.** Turrets, generator, node, storage, terminal, bed and light are generated glTF models that feel engineered and modular. They glow cyan when powered and amber when active.
- **Materials.** Procedural, with detail normals from Balanced up. Weathering, wear and exposed wiring come from a shared material library, not per-piece textures.

## HUD

Reference images 04 and 07 are the model. The HUD is HTML and CSS over the canvas with original icons, in dark translucent panels with thin light borders, soft amber accents, cream text and rounded key caps.

- **Top left.** A wide Health bar with a slimmer Energy bar under it, then a column of round status icons (buffs and debuffs) with timers beside them.
- **Top center.** A thin compass strip with cardinal letters and tick marks, a diamond waypoint marker with a distance (the Outpost Core), and a small day, night and wave indicator.
- **Top right.** An objective banner: a small caps category over a bold objective line (for example "Night 3" over "Defend the Core"), with a round emblem at the end and a key hint underneath.
- **Bottom center.** The hotbar: square slots numbered 1 to 9 in the corner, item icons, stack counts at the lower right, a charge or durability bar under each, and a bright frame on the selected slot. Above it, the held item's name and a key hint.
- **Bottom right.** A translucent status panel with the area's name (for example "Powered area") and key hints such as the camera toggle.
- **Overlays.** Inventory and research use the same panel style, with cyan and amber accents (spec section 10).

## Quality presets

| Element         | Low                          | Balanced                        | Ultra                                    |
| --------------- | ---------------------------- | ------------------------------- | ---------------------------------------- |
| Shadows         | Blob shadows                 | One filtered shadow map         | Two cascades                             |
| Haze and light  | Fog only                     | Adds mist pockets and sun glow  | Adds light shafts                        |
| Bloom and grade | Grade only                   | Half-resolution bloom and grade | Full-resolution bloom and grade          |
| Water           | Flat tint                    | Ripples and glitter             | Adds a half-resolution planar reflection |
| Terrain         | 8 chunks, two texture layers | 10 chunks, four layers          | 12 chunks, four layers, detail normals   |
| Foliage density | 25 percent                   | 60 percent                      | 100 percent                              |

The numbers are starting values. Balanced is the default and is tuned for 60 FPS at 1080p on a mid-range laptop; the owner confirms it on real hardware with the benchmark switch. Presets change from a menu and a `?quality=` URL switch.

## Rules of thumb

- Match lighting and atmosphere first; they carry most of the reference look and cost the least.
- Pick the cheaper effect when two look alike, and measure before adding the next one.
- Never ship an asset that is not generated in code, CC0 or clearly licensed, and list every external asset in `CREDITS.md`.
- Do not commit reference images, screenshots of other games or anything traced from them.
