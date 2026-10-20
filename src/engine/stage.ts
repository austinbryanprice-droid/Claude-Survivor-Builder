import { Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const MAX_PIXEL_RATIO = 2;
const BACKGROUND = '#1a2633';

export interface Stage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Renders the scene once. The first call sets `data-ready` on <html> so tests can wait for it. */
  render(): void;
  /** Calls `onFrame` with the display timestamp (ms) once per frame; without it, just renders. */
  start(onFrame?: (timeMs: number) => void): void;
  dispose(): void;
}

/** Owns the renderer, scene and camera for one canvas. */
export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const camera = new PerspectiveCamera(70, 1, 0.1, 500);

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let announced = false;
  const render = (): void => {
    renderer.render(scene, camera);
    if (!announced) {
      announced = true;
      document.documentElement.dataset.ready = 'true';
    }
  };

  return {
    renderer,
    scene,
    camera,
    render,
    start: (onFrame) => renderer.setAnimationLoop(onFrame ?? render),
    dispose: () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      renderer.dispose();
    },
  };
}
