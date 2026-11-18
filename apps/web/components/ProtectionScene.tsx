'use client';

import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import type { Group, Material, Shape, Texture } from 'three';
import './protection-scene.css';

type Three = typeof import('three');

const signature =
  'M 15,111 C 7,135 53,151 92,120 C 146,79 159,11 136,18 C 100,29 73,130 89,148 C 105,166 161,103 167,88 C 169,102 154,131 164,127 C 189,121 214,75 215,81 C 216,90 195,127 208,124 C 231,117 241,89 247,95 C 250,99 239,115 249,115 C 260,115 274,101 276,101 C 273,111 279,116 292,109 C 319,97 339,92 359,93 M 80,160 C 155,130 254,130 345,131 C 376,130 394,125 412,118';
const pageWidth = 2.94;
const pageHeight = 4.0;
const faceDepth = 0.115;
const field = { x: -0.06, y: -0.99, width: 2.34, height: 0.64 };

function outline(T: Three, width: number, height: number, radius: number, fold = 0): Shape {
  const path = new T.Shape();
  const x = width / 2;
  const y = height / 2;
  path.moveTo(-x + radius, -y);
  path.lineTo(x - radius, -y);
  path.quadraticCurveTo(x, -y, x, -y + radius);
  if (fold) {
    path.lineTo(x, y - fold);
    path.lineTo(x - fold, y);
  } else {
    path.lineTo(x, y - radius);
    path.quadraticCurveTo(x, y, x - radius, y);
  }
  path.lineTo(-x + radius, y);
  path.quadraticCurveTo(-x, y, -x, y - radius);
  path.lineTo(-x, -y + radius);
  path.quadraticCurveTo(-x, -y, -x + radius, -y);
  path.closePath();
  return path;
}

function solid(T: Three, shape: Shape, depth: number, bevel: number, material: Material | Material[]) {
  const geometry = new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 12,
  });
  return new T.Mesh(geometry, material);
}

// Softboxes around the object produce controlled studio reflections on the bevels and shackle.
function studioLight(T: Three, renderer: InstanceType<Three['WebGLRenderer']>) {
  const studio = new T.Scene();
  studio.background = new T.Color('#243b50');
  const surface = new T.PlaneGeometry(1, 1);
  const panels: Material[] = [];
  const strip = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    color: string,
    brightness: number,
  ) => {
    const material = new T.MeshBasicMaterial({
      color: new T.Color(color).multiplyScalar(brightness),
      side: T.DoubleSide,
      toneMapped: false,
    });
    panels.push(material);
    const panel = new T.Mesh(surface, material);
    panel.position.set(x, y, z);
    panel.scale.set(w, h, 1);
    panel.lookAt(0, 0, 0);
    studio.add(panel);
  };
  strip(-3.4, 4.4, 3, 1.4, 7, '#f0fffd', 5);
  strip(4.3, 1.5, 2.5, 1.7, 7, '#9cfff3', 3);
  strip(-4, -1.4, 0, 3.4, 1.3, '#538eef', 2.4);
  strip(0.3, 5.3, -1.9, 5, 2, '#ffffff', 4.5);
  strip(0.6, -4, 4, 4, 0.8, '#bde1ff', 2.5);
  const generator = new T.PMREMGenerator(renderer);
  const environment = generator.fromScene(studio, 0.055, 0.1, 30);
  generator.dispose();
  surface.dispose();
  panels.forEach((material) => material.dispose());
  return environment;
}

function canvas(width: number, height: number) {
  const image = document.createElement('canvas');
  image.width = width;
  image.height = height;
  const context = image.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable');
  return { image, context };
}

function ink(T: Three, shape: Shape) {
  const { image, context: c } = canvas(882, 1200);
  const finish = c.createLinearGradient(0, 40, image.width, 1080);
  finish.addColorStop(0, '#a7c5cf');
  finish.addColorStop(0.18, '#e1eff0');
  finish.addColorStop(0.42, '#c8dae0');
  finish.addColorStop(0.69, '#98b9c5');
  finish.addColorStop(1, '#d5e9e9');
  c.fillStyle = finish;
  c.fillRect(0, 0, image.width, image.height);
  // Fine directional brushing, like a satin finish on a display model.
  for (let y = 0; y < image.height; y += 3) {
    c.fillStyle = `rgba(44,88,101,${0.009 + (Math.sin(y * 0.473) + 1) * 0.01})`;
    c.fillRect(0, y, image.width, 1);
  }
  c.fillStyle = '#204655';
  c.font = '600 22px monospace';
  c.fillText('DOCUMENT  /  SIGNING COPY', 75, 138);
  c.font = '500 98px Georgia, serif';
  c.fillText('Agreement', 67, 281);
  const rule = (x: number, y: number, length: number, height = 4) => c.fillRect(x, y, length, height);
  rule(73, 322, 730);
  c.font = '600 21px monospace';
  c.fillText('01  PARTIES', 74, 389);
  c.fillText('02  TERMS', 74, 605);
  c.fillText('SIGNATURE', 74, 760);
  c.fillStyle = '#557582';
  for (const [y, length] of [
    [429, 600],
    [453, 684],
    [477, 412],
    [501, 527],
    [647, 653],
    [671, 494],
  ]) {
    rule(75, y, length, 5);
  }
  rule(74, 1091, 730, 2);
  c.font = '600 17px monospace';
  c.fillText('ELECTRONIC DOCUMENT', 74, 1132);
  c.fillText('01 / 01', 702, 1132);
  const map = new T.CanvasTexture(image);
  map.colorSpace = T.SRGBColorSpace;
  const geometry = new T.ShapeGeometry(shape);
  const uv = geometry.attributes.uv;
  const vertices = geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, vertices.getX(i) / pageWidth + 0.5, vertices.getY(i) / pageHeight + 0.5);
  }
  const mesh = new T.Mesh(
    geometry,
    new T.MeshPhysicalMaterial({
      map,
      metalness: 0.32,
      roughness: 0.42,
      clearcoat: 0.46,
      clearcoatRoughness: 0.27,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  mesh.position.z = faceDepth + 0.022;
  return mesh;
}

function signedInset(T: Three) {
  // Sample the pen stroke into the panel itself. Its recessed slopes catch the light as it turns.
  const { image, context } = canvas(660, 180);
  context.translate(9, 4);
  context.scale(1.5, 1);
  context.strokeStyle = '#fff';
  context.lineWidth = 5.5;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke(new Path2D(signature));
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const geometry = new T.PlaneGeometry(field.width + 0.013, field.height + 0.013, 264, 72);
  const points = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const base = new T.Color('#315a68');
  const silver = new T.Color('#d3fcff');
  const color = new T.Color();
  const colors: number[] = [];
  for (let i = 0; i < points.count; i++) {
    const x = Math.round(uv.getX(i) * (image.width - 1));
    const y = Math.round((1 - uv.getY(i)) * (image.height - 1));
    const depth = pixels[(y * image.width + x) * 4 + 3] / 255;
    points.setZ(i, -depth * 0.023);
    color.copy(base).lerp(silver, depth);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const inset = new T.Mesh(
    geometry,
    new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.31, metalness: 0.43 }),
  );
  inset.position.set(field.x, field.y, faceDepth - 0.004);
  return inset;
}

function documentModel(T: Three) {
  const stack = new T.Group();
  const steel = new T.MeshPhysicalMaterial({
    color: '#94b8ce',
    metalness: 0.88,
    roughness: 0.19,
    clearcoat: 0.6,
  });
  const edge = new T.MeshPhysicalMaterial({
    color: '#7cd5de',
    metalness: 0.84,
    roughness: 0.18,
    clearcoat: 0.7,
  });
  const satin = new T.MeshPhysicalMaterial({
    color: '#bdd3d7',
    metalness: 0.29,
    roughness: 0.45,
    clearcoat: 0.36,
  });
  const backMaterial = new T.MeshPhysicalMaterial({
    color: '#15445a',
    metalness: 0.64,
    roughness: 0.24,
    clearcoat: 1,
  });
  const middleMaterial = new T.MeshPhysicalMaterial({
    color: '#67a1b0',
    metalness: 0.65,
    roughness: 0.24,
    clearcoat: 0.7,
  });
  const back = solid(T, outline(T, 3, 4, 0.11, 0.38), 0.1, 0.026, [backMaterial, edge]);
  back.rotation.z = -0.17;
  back.position.set(0.4, 0.17, -0.48);
  stack.add(back);
  const middle = solid(T, outline(T, 2.98, 4, 0.1, 0.39), 0.065, 0.021, [middleMaterial, steel]);
  middle.rotation.z = -0.07;
  middle.position.set(0.18, 0.1, -0.22);
  stack.add(middle);
  const shape = outline(T, pageWidth, pageHeight, 0.095, 0.46);
  const cutout = outline(T, field.width, field.height, 0.04);
  const hole = new T.Path(
    cutout
      .getPoints(10)
      .map((p) => p.add(new T.Vector2(field.x, field.y)))
      .reverse(),
  );
  shape.holes.push(hole);
  stack.add(solid(T, shape, faceDepth, 0.019, [satin, steel]), ink(T, shape), signedInset(T));

  const fold = new T.BufferGeometry();
  fold.setAttribute(
    'position',
    new T.Float32BufferAttribute([0, 0, 0.15, 0.42, 0, 0.01, 0, 0.42, 0.01], 3),
  );
  const shades = ['#a6cbd4', '#74a5b5', '#f3faf6'].map((color) => new T.Color(color).toArray());
  fold.setAttribute('color', new T.Float32BufferAttribute(shades.flat(), 3));
  fold.computeVertexNormals();
  const foldedCorner = new T.Mesh(
    fold,
    new T.MeshStandardMaterial({
      metalness: 0.63,
      roughness: 0.3,
      vertexColors: true,
      side: T.DoubleSide,
    }),
  );
  foldedCorner.position.set(pageWidth / 2 - 0.44, pageHeight / 2 - 0.445, faceDepth + 0.02);
  stack.add(foldedCorner);
  return stack;
}

function lockModel(T: Three) {
  const lock = new T.Group();
  const chrome = new T.MeshPhysicalMaterial({
    color: '#d1e6ee',
    roughness: 0.13,
    metalness: 0.96,
    clearcoat: 0.8,
  });
  const teal = new T.MeshPhysicalMaterial({
    color: '#456f7c',
    roughness: 0.3,
    metalness: 0.6,
    clearcoat: 0.86,
    clearcoatRoughness: 0.27,
  });
  const rim = new T.MeshStandardMaterial({ color: '#89d7df', roughness: 0.21, metalness: 0.88 });
  const dark = new T.MeshStandardMaterial({ color: '#0d2736', roughness: 0.38, metalness: 0.48 });
  const r = 0.37;
  const shackle = new T.CurvePath<InstanceType<Three['Vector3']>>();
  const v = (x: number, y: number) => new T.Vector3(x, y, 0);
  shackle.add(new T.LineCurve3(v(-r, 0.245), v(-r, 0.73)));
  const bend = 0.55228475 * r;
  shackle.add(
    new T.CubicBezierCurve3(v(-r, 0.73), v(-r, 0.73 + bend), v(-bend, 0.73 + r), v(0, 0.73 + r)),
  );
  shackle.add(new T.CubicBezierCurve3(v(0, 0.73 + r), v(bend, 0.73 + r), v(r, 0.73 + bend), v(r, 0.73)));
  shackle.add(new T.LineCurve3(v(r, 0.73), v(r, 0.245)));
  const handle = new T.Mesh(new T.TubeGeometry(shackle, 72, 0.106, 20, false), chrome);
  handle.position.z = 0.13;
  lock.add(handle);
  const housing = solid(T, outline(T, 1.13, 0.89, 0.14), 0.31, 0.056, [teal, chrome]);
  lock.add(housing);
  const escutcheon = outline(T, 0.99, 0.75, 0.1);
  const key = new T.Path();
  key.absarc(0, 0.055, 0.104, -1.04, Math.PI + 1.04, false);
  key.lineTo(-0.076, -0.174);
  key.lineTo(0.076, -0.174);
  key.closePath();
  escutcheon.holes.push(key);
  const front = solid(T, escutcheon, 0.035, 0.018, [teal, rim]);
  front.position.z = 0.376;
  lock.add(front);
  const well = new T.Mesh(new T.PlaneGeometry(0.35, 0.46), dark);
  well.position.z = 0.369;
  lock.add(well);
  const bezel = new T.Mesh(new T.TorusGeometry(0.255, 0.016, 10, 80), rim);
  bezel.position.z = 0.43;
  lock.add(bezel);
  const rivet = new T.SphereGeometry(0.024, 10, 6);
  for (const x of [-0.411, 0.411]) {
    for (const y of [-0.291, 0.291]) {
      const head = new T.Mesh(rivet, chrome);
      head.scale.z = 0.42;
      head.position.set(x, y, 0.435);
      lock.add(head);
    }
  }
  lock.position.set(1.07, -1.04, 0.48);
  lock.rotation.set(0.035, 0.2, 0.06);
  return lock;
}

function orbit(
  T: Three,
  radius: number,
  opacity: number,
  start = 0,
  end = Math.PI * 2,
  color = '#69c8d4',
) {
  const points = new T.EllipseCurve(0, 0, radius, radius, start, end, false, 0).getPoints(160);
  const geometry = new T.BufferGeometry().setFromPoints(points.map((p) => new T.Vector3(p.x, p.y, 0)));
  return new T.Line(
    geometry,
    new T.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }),
  );
}

function addOrbits(T: Three, group: Group) {
  const band = new T.Group();
  band.rotation.set(1.12, -0.19, -0.22);
  band.position.y = -0.38;
  group.add(band);
  band.add(
    orbit(T, 2.73, 0.35),
    orbit(T, 2.81, 0.13, 0.32, 5.74),
    orbit(T, 2.73, 0.85, 2.67, 3.34, '#b0fafa'),
  );
  const glint = new T.Mesh(
    new T.SphereGeometry(0.045, 12, 8),
    new T.MeshBasicMaterial({ color: '#b5ffff', toneMapped: false }),
  );
  const { image, context } = canvas(32, 32);
  const glow = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  glow.addColorStop(0, '#dcffff');
  glow.addColorStop(0.28, '#9ff9ffb3');
  glow.addColorStop(1, '#85f0fa00');
  context.fillStyle = glow;
  context.fillRect(0, 0, 32, 32);
  const spark = new T.Sprite(
    new T.SpriteMaterial({
      map: new T.CanvasTexture(image),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: T.AdditiveBlending,
    }),
  );
  spark.scale.set(0.19, 0.19, 1);
  glint.add(spark);
  band.add(glint);
  const outer = new T.Group();
  outer.rotation.set(-0.48, 0.88, -0.36);
  outer.add(orbit(T, 2.67, 0.15, -0.86, 3.94));
  group.add(outer);
  const base = new T.Group();
  base.rotation.set(-1.31, 0.02, 0.14);
  base.position.set(0.14, -2.05, -0.14);
  base.add(orbit(T, 2.03, 0.28), orbit(T, 2.3, 0.17, 0.35, 5.61), orbit(T, 2.4, 0.1));
  const ticks: number[] = [];
  for (let i = 0; i < 72; i++) {
    const angle = (i * Math.PI) / 36;
    const end = i % 6 === 0 ? 2.24 : 2.16;
    ticks.push(
      2.1 * Math.cos(angle),
      2.1 * Math.sin(angle),
      0,
      end * Math.cos(angle),
      end * Math.sin(angle),
      0,
    );
  }
  const graduation = new T.BufferGeometry();
  graduation.setAttribute('position', new T.Float32BufferAttribute(ticks, 3));
  base.add(
    new T.LineSegments(
      graduation,
      new T.LineBasicMaterial({ color: '#72b9c7', transparent: true, opacity: 0.46 }),
    ),
  );
  group.add(base);
  return glint;
}

function makeScene(T: Three, root: HTMLDivElement, screen: HTMLDivElement, initialPlaying: boolean) {
  const layer = document.createElement('canvas');
  const options = {
    alpha: true,
    antialias: true,
    powerPreference: 'low-power' as const,
    premultipliedAlpha: true,
  };
  const context = layer.getContext('webgl2', options) as WebGL2RenderingContext | null;
  if (!context) return;
  const renderer = new T.WebGLRenderer({ ...options, canvas: layer, context });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  screen.appendChild(layer);
  const stage = new T.Scene();
  const camera = new T.PerspectiveCamera(31, 1, 0.1, 35);
  camera.position.z = 11;
  const environment = studioLight(T, renderer);
  stage.environment = environment.texture;
  stage.add(new T.HemisphereLight('#d3f3ff', '#0c2436', 1.03));
  const keyLight = new T.DirectionalLight('#f2f8ff', 2.0);
  keyLight.position.set(-3, 4, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  Object.assign(keyLight.shadow.camera, {
    left: -3.25,
    right: 3.25,
    bottom: -3.25,
    top: 3.25,
    near: 1,
    far: 15,
  });
  keyLight.shadow.bias = -0.00025;
  keyLight.shadow.normalBias = 0.012;
  stage.add(keyLight);
  const sideLight = new T.DirectionalLight('#63e7ee', 1.05);
  sideLight.position.set(4, 0.7, -1);
  stage.add(sideLight);
  const focus = new T.Group();
  const dossier = documentModel(T);
  dossier.add(lockModel(T));
  dossier.traverse((object) => {
    if (object instanceof T.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  focus.add(dossier);
  const glint = addOrbits(T, focus);
  stage.add(focus);
  const scan = new T.PointLight('#83edff', 0.67, 2.1, 2);
  dossier.add(scan);
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let playing = initialPlaying;
  let visible = true;
  let lost = false;
  let frame = 0;
  let previous = 0;
  let elapsed = 0;
  const pointer = new T.Vector2();
  const easedPointer = new T.Vector2();

  const animating = () => playing && !preference.matches && visible && !window.document.hidden && !lost;
  const paint = () => {
    if (lost) return;
    const angle = elapsed * 0.18 + 2.43;
    glint.position.set(2.73 * Math.cos(angle), 2.73 * Math.sin(angle), 0);
    easedPointer.lerp(pointer, 0.06);
    dossier.rotation.set(
      0.145 + Math.sin(elapsed * 0.43) * 0.031 + easedPointer.y * 0.035,
      -0.47 + Math.sin(elapsed * 0.34) * 0.1 + easedPointer.x * 0.1,
      0.145 + Math.sin(elapsed * 0.35) * 0.031,
    );
    dossier.position.y = 0.07 + Math.sin(elapsed * 0.75) * 0.067;
    scan.position.set(
      -1.15 + Math.sin(elapsed * 0.43) * 0.95,
      0.7 + Math.sin(elapsed * 0.57) * 1.18,
      0.65,
    );
    renderer.render(stage, camera);
    root.dataset.ready = 'true';
  };
  const tick = (now: number) => {
    frame = 0;
    if (!animating()) return;
    if (!previous || now - previous >= 31) {
      elapsed += previous ? Math.min((now - previous) / 1000, 0.08) : 0;
      previous = now;
      paint();
    }
    frame = window.requestAnimationFrame(tick);
  };
  const sync = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    if (visible && !window.document.hidden) paint();
    if (animating()) frame = window.requestAnimationFrame(tick);
  };
  const resize = () => {
    const { width, height } = root.getBoundingClientRect();
    if (!width || !height) return;
    const aspect = width / height;
    const focusX = parseFloat(getComputedStyle(root).getPropertyValue('--ps-focus-x')) / 100;
    const centered = focusX === 0.5;
    const viewHeight = centered ? Math.max(5.88, 4.58 / aspect) : Math.max(6.5, 9.25 / aspect);
    camera.aspect = aspect;
    camera.fov = 2 * T.MathUtils.radToDeg(Math.atan(viewHeight / (2 * camera.position.z)));
    camera.setViewOffset(width, height, width * (0.5 - focusX), 0, width, height);
    camera.updateProjectionMatrix();
    focus.position.set(-0.12, 0.03, 0);
    root.dataset.centered = String(centered);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65, 2100 / width));
    renderer.setSize(width, height, false);
    sync();
  };
  const move = (event: PointerEvent) => {
    if (!animating() || event.pointerType !== 'mouse') return;
    const box = root.getBoundingClientRect();
    pointer.set(
      T.MathUtils.clamp(((event.clientX - box.left) * 2) / box.width - 1, -1, 1),
      T.MathUtils.clamp(1 - ((event.clientY - box.top) * 2) / box.height, -1, 1),
    );
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    root.dataset.ready = 'false';
    sync();
  };
  layer.addEventListener('webglcontextlost', contextLost);
  window.addEventListener('pointermove', move, { passive: true });
  preference.addEventListener('change', sync);
  window.document.addEventListener('visibilitychange', sync);
  const bounds = new ResizeObserver(resize);
  bounds.observe(root);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  intersection.observe(root);
  resize();
  return {
    setPlaying(value: boolean) {
      playing = value;
      sync();
    },
    dispose() {
      lost = true;
      root.dataset.ready = 'false';
      window.cancelAnimationFrame(frame);
      bounds.disconnect();
      intersection.disconnect();
      preference.removeEventListener('change', sync);
      window.document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pointermove', move);
      layer.removeEventListener('webglcontextlost', contextLost);
      const geometries = new Set<InstanceType<Three['BufferGeometry']>>();
      const materials = new Set<Material>();
      const textures = new Set<Texture>();
      stage.traverse((object) => {
        if (object instanceof T.Mesh || object instanceof T.Line || object instanceof T.Sprite) {
          if (!(object instanceof T.Sprite)) geometries.add(object.geometry);
          const entries = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of entries) {
            materials.add(material);
            for (const value of Object.values(material)) {
              if (value instanceof T.Texture) textures.add(value);
            }
          }
        }
      });
      textures.forEach((t) => t.dispose());
      materials.forEach((m) => m.dispose());
      geometries.forEach((g) => g.dispose());
      environment.dispose();
      keyLight.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      layer.remove();
    },
  };
}

function Fallback() {
  return (
    <div className="ps-fallback">
      <div className="ps-fallback-center">
        <div className="ps-orbit ps-orbit-outer" />
        <div className="ps-orbit ps-orbit-foot" />
        <div className="ps-float">
          <div className="ps-dossier">
            <div className="ps-sheet ps-back" />
            <div className="ps-sheet ps-middle" />
            <div className="ps-sheet ps-front">
              <span className="ps-fold" />
              <span className="ps-kicker">Document / Signing copy</span>
              <span className="ps-document-title">Agreement</span>
              <div className="ps-lines">
                <span>01&nbsp; Parties</span>
                <i />
                <i />
                <i />
                <span>02&nbsp; Terms</span>
                <i />
                <i />
              </div>
              <span className="ps-sign-label">Signature</span>
              <svg
                className="ps-signature"
                viewBox="0 0 430 180"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d={signature}
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="ps-lock">
              <i className="ps-shackle" />
              <span className="ps-lock-body">
                <i />
              </span>
            </div>
          </div>
        </div>
        <div className="ps-orbit ps-orbit-front" />
      </div>
    </div>
  );
}

/** Decorative, local-only artwork. The same dossier is available in CSS before WebGL initializes. */
export function ProtectionScene({ playing }: { playing: boolean }): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const playback = useRef(playing);
  const runtime = useRef<ReturnType<typeof makeScene>>(undefined);
  useEffect(() => {
    playback.current = playing;
    runtime.current?.setPlaying(playing);
  }, [playing]);
  useEffect(() => {
    let mounted = true;
    void import('three')
      .then((T) => {
        if (mounted && root.current && screen.current)
          runtime.current = makeScene(T, root.current, screen.current, playback.current);
      })
      .catch(() => {
        if (mounted && root.current) root.current.dataset.ready = 'false';
      });
    return () => {
      mounted = false;
      runtime.current?.dispose();
      runtime.current = undefined;
    };
  }, []);
  return (
    <div ref={root} className="protection-scene" data-playing={playing} aria-hidden="true">
      <div className="ps-atmosphere" />
      <div className="ps-survey-grid" />
      <Fallback />
      <div className="ps-screen" ref={screen} />
    </div>
  );
}
