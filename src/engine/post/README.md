# post

The post-processing chain that runs after the scene is drawn into a half-float target: bloom (`bloom.ts`), quarter-resolution light shafts (`shafts.ts`, Ultra only) and the final composite (`composite.ts`) with tone mapping, FXAA, a split-tone grade, vignette and dither. `fullscreen.ts` is the shared full-screen triangle.
