// The 3D dice scene, loaded only through `import("./scene")` from ./index.ts
// (CL8). Purely visual: the server already rolled. cannon-es throws the dice
// once, off screen and synchronously; the face that ends up on top is then
// labelled with the server's value and the recorded throw is played back, so
// the dice always settle on the values the server returned.

import { Body, ConvexPolyhedron, Material, Plane, Quaternion as CQuaternion, Vec3, World, ContactMaterial } from "cannon-es";
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  OrthographicCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  TetrahedronGeometry,
  Vector3,
  WebGLRenderer,
  type Texture,
} from "three";

import type { DieRole, RolledDie } from "@/lib/domain/duality";

import { playRollSound } from "../sound";
import type { Play3dRequest } from "./index";

const HEIGHT_PX = 220;
const STEP = 1 / 60;
// At most 2.5 s of animation, so a roll's result never waits long.
const MAX_STEPS = 150;
const RADIUS = 0.9;

const ROLE_COLOR: Record<DieRole, { body: string; ink: string }> = {
  hope: { body: "#e2b93b", ink: "#3b2c00" },
  fear: { body: "#4b3591", ink: "#f3edff" },
  advantage: { body: "#3d7a4a", ink: "#f2fbf3" },
  help: { body: "#3d7a4a", ink: "#f2fbf3" },
  disadvantage: { body: "#a14040", ink: "#fff1f1" },
  extra: { body: "#7a6a52", ink: "#fbf6ec" },
  damage: { body: "#f1e4cf", ink: "#4a2c10" },
};

type Face = { normal: Vector3; center: Vector3; size: number };
type Shape = { geometry: BufferGeometry; faces: Face[]; vertices: Vector3[]; triangles: number[][] };

/** The d10's pentagonal trapezohedron: two poles and a zig-zag ring whose height keeps every kite planar. */
function d10Geometry(r: number): BufferGeometry {
  const c = Math.cos(Math.PI / 5);
  const h = (1 - c) / (1 + c);
  const ring = Array.from({ length: 10 }, (_, k) => new Vector3(Math.cos((k * Math.PI) / 5), k % 2 === 0 ? -h : h, Math.sin((k * Math.PI) / 5)));
  const top = new Vector3(0, 1, 0);
  const bottom = new Vector3(0, -1, 0);
  const at = (k: number) => ring[(k + 10) % 10]!;
  const kites: Vector3[][] = [];
  for (let k = 0; k < 10; k += 2) kites.push([top, at(k + 1), at(k), at(k - 1)]);
  for (let k = 1; k < 10; k += 2) kites.push([bottom, at(k - 1), at(k), at(k + 1)]);
  const positions: number[] = [];
  for (const kite of kites) {
    const [a, b, d, e] = kite as [Vector3, Vector3, Vector3, Vector3];
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a));
    const outward = normal.dot(a.clone().add(b).add(d).add(e)) > 0;
    const tris = outward
      ? [
          [a, b, d],
          [a, d, e],
        ]
      : [
          [a, d, b],
          [a, e, d],
        ];
    for (const tri of tris) for (const v of tri) positions.push(v.x * r, v.y * r, v.z * r);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

function baseGeometry(sides: number): BufferGeometry {
  switch (sides) {
    case 4:
      return new TetrahedronGeometry(RADIUS * 1.15);
    case 6:
      return new BoxGeometry(RADIUS * 1.2, RADIUS * 1.2, RADIUS * 1.2).toNonIndexed();
    case 8:
      return new OctahedronGeometry(RADIUS);
    case 10:
      return d10Geometry(RADIUS);
    case 12:
      return new DodecahedronGeometry(RADIUS);
    default:
      return new IcosahedronGeometry(RADIUS);
  }
}

/** Groups the geometry's triangles into the die's faces (same normal) and dedupes vertices for the physics hull. */
function buildShape(sides: number): Shape {
  const geometry = baseGeometry(sides);
  geometry.computeVertexNormals();
  const pos = geometry.getAttribute("position");
  const vertices: Vector3[] = [];
  const keyOf = (v: Vector3) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
  const index = new Map<string, number>();
  const triangles: number[][] = [];
  const groups: { normal: Vector3; points: Vector3[] }[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const tri = [0, 1, 2].map((o) => new Vector3(pos.getX(t + o), pos.getY(t + o), pos.getZ(t + o))) as [Vector3, Vector3, Vector3];
    triangles.push(
      tri.map((v) => {
        const key = keyOf(v);
        let i = index.get(key);
        if (i === undefined) {
          i = vertices.length;
          index.set(key, i);
          vertices.push(v);
        }
        return i;
      }),
    );
    const normal = new Vector3().subVectors(tri[1], tri[0]).cross(new Vector3().subVectors(tri[2], tri[0])).normalize();
    const group = groups.find((g) => g.normal.dot(normal) > 0.999);
    if (group) group.points.push(...tri);
    else groups.push({ normal, points: [...tri] });
  }
  const faces = groups.map(({ normal, points }) => {
    const unique = [...new Map(points.map((p) => [keyOf(p), p])).values()];
    const center = unique.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(unique.length);
    const nearest = Math.min(...unique.map((p) => p.distanceTo(center)));
    return { normal, center, size: 2 * nearest * Math.cos(Math.PI / unique.length) * 1.05 };
  });
  return { geometry, faces, vertices, triangles };
}

const textures = new Map<string, Texture>();

function numberTexture(n: number, ink: string): Texture {
  const key = `${n}|${ink}`;
  const cached = textures.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("no 2d context");
  g.fillStyle = ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `bold ${n >= 10 ? 72 : 92}px Georgia, serif`;
  g.fillText(String(n), 64, 62);
  if (n === 6 || n === 9) g.fillRect(40, 104, 48, 7);
  const texture = new CanvasTexture(canvas);
  textures.set(key, texture);
  return texture;
}

/** The value printed on each face: the server's value on the face that ended up on top, other numbers elsewhere. */
function faceLabels(faceCount: number, sides: number, value: number, top: number, d4: boolean): number[] {
  const others = Array.from({ length: Math.max(1, sides) }, (_, i) => i + 1).filter((n) => n !== value);
  if (others.length === 0) others.push(value);
  let next = 0;
  return Array.from({ length: faceCount }, (_, i) => {
    // A d4 rests on a face: its value reads on the three faces that point up.
    if (d4 ? i !== top : i === top) return value;
    return others[next++ % others.length]!;
  });
}

type Frame = { p: Vec3[]; q: CQuaternion[] };

/** Throws the dice in a walled box and records every step until they rest. */
function simulate(shapes: Shape[], halfW: number, halfD: number): Frame[] {
  const world = new World({ gravity: new Vec3(0, -50, 0), allowSleep: true });
  const diceMaterial = new Material("dice");
  const tableMaterial = new Material("table");
  world.addContactMaterial(new ContactMaterial(diceMaterial, tableMaterial, { friction: 0.3, restitution: 0.35 }));
  world.addContactMaterial(new ContactMaterial(diceMaterial, diceMaterial, { friction: 0.2, restitution: 0.3 }));
  const walls: [Vec3, Vec3, number][] = [
    [new Vec3(0, 0, 0), new Vec3(1, 0, 0), -Math.PI / 2],
    [new Vec3(-halfW, 0, 0), new Vec3(0, 1, 0), Math.PI / 2],
    [new Vec3(halfW, 0, 0), new Vec3(0, 1, 0), -Math.PI / 2],
    [new Vec3(0, 0, -halfD), new Vec3(0, 1, 0), 0],
    [new Vec3(0, 0, halfD), new Vec3(0, 1, 0), Math.PI],
  ];
  for (const [position, axis, angle] of walls) {
    const wall = new Body({ mass: 0, material: tableMaterial, shape: new Plane(), position });
    wall.quaternion.setFromAxisAngle(axis, angle);
    world.addBody(wall);
  }
  const bodies = shapes.map((shape, i) => {
    const hull = new ConvexPolyhedron({ vertices: shape.vertices.map((v) => new Vec3(v.x, v.y, v.z)), faces: shape.triangles });
    const body = new Body({ mass: 1, material: diceMaterial, shape: hull, sleepSpeedLimit: 0.3, sleepTimeLimit: 0.2, angularDamping: 0.25, linearDamping: 0.12 });
    const row = i % 3;
    body.position.set(-halfW + 1.2 + Math.floor(i / 3) * 0.6, 2.5 + (i % 2) * 1.2, (row - 1) * Math.min(1.6, halfD * 0.5));
    body.quaternion.setFromEuler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    body.velocity.set(14 + Math.random() * 8, -2 - Math.random() * 3, (Math.random() - 0.5) * 8);
    body.angularVelocity.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    world.addBody(body);
    return body;
  });
  const frames: Frame[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    world.step(STEP);
    frames.push({ p: bodies.map((b) => b.position.clone()), q: bodies.map((b) => b.quaternion.clone()) });
    if (step > 30 && bodies.every((b) => b.sleepState === Body.SLEEPING)) break;
  }
  return frames;
}

function describe(dice: readonly RolledDie[]): string {
  return dice.map((d) => `${d.role} d${d.sides} ${d.value}${d.dropped ? " (not counted)" : ""}`).join(", ");
}

let current: (() => void) | null = null;

/** Renders the throw into `container` and resolves once the dice show `request.dice`. */
export async function playScene(container: HTMLElement, { dice, sound }: Play3dRequest): Promise<boolean> {
  current?.();
  current = null;
  // An empty stage may be hidden (`empty:hidden`); its parent gives the width then.
  const width = container.clientWidth || container.parentElement?.clientWidth || 0;
  if (width <= 0) return false;

  const halfD = 3.4 * Math.max(1, Math.sqrt(dice.length / 6));
  const halfW = halfD * (width / HEIGHT_PX);
  const shapes = dice.map((d) => buildShape(d.sides));
  // A wide stage keeps the dice in a centred tray rather than across the whole row.
  const frames = simulate(shapes, Math.min(halfW, halfD * 2.5) - 0.3, halfD - 0.3);
  const last = frames[frames.length - 1]!;

  const disposables: { dispose(): void }[] = [];
  const scene = new Scene();
  const camera = new OrthographicCamera(-halfW, halfW, halfD, -halfD, 0.1, 100);
  camera.position.set(0, 30, 4);
  camera.lookAt(0, 0, 0);
  scene.add(new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 20, 6);
  scene.add(sun);

  const meshes = dice.map((die, i) => {
    const shape = shapes[i]!;
    const colors = ROLE_COLOR[die.role];
    const body = new MeshStandardMaterial({ color: colors.body, flatShading: true, roughness: 0.55, transparent: !!die.dropped, opacity: die.dropped ? 0.45 : 1 });
    disposables.push(shape.geometry, body);
    const group = new Group();
    group.add(new Mesh(shape.geometry, body));
    // The face that rests on top (on the bottom for a d4) in the recorded final pose.
    const q = last.q[i]!;
    const rest = new Quaternion(q.x, q.y, q.z, q.w);
    const worldY = shape.faces.map((f) => f.normal.clone().applyQuaternion(rest).y);
    const pick = die.sides === 4 ? Math.min(...worldY) : Math.max(...worldY);
    const top = worldY.indexOf(pick);
    const labels = faceLabels(shape.faces.length, die.sides, die.value, top, die.sides === 4);
    shape.faces.forEach((face, f) => {
      const plane = new PlaneGeometry(face.size, face.size);
      const material = new MeshBasicMaterial({ map: numberTexture(labels[f]!, colors.ink), transparent: true, depthWrite: false });
      disposables.push(plane, material);
      const label = new Mesh(plane, material);
      label.position.copy(face.center).addScaledVector(face.normal, 0.01);
      // The top face's number reads upright on screen once the die rests.
      const screenUp = new Vector3(0, 0, -1).applyQuaternion(rest.clone().invert()).projectOnPlane(face.normal);
      if (f === top && die.sides !== 4 && screenUp.lengthSq() > 1e-6) {
        const y = screenUp.normalize();
        label.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(y, face.normal), y, face.normal));
      } else {
        label.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), face.normal);
      }
      group.add(label);
    });
    scene.add(group);
    return group;
  });
  // Created last, so nothing earlier can fail while it holds a WebGL context.
  // preserveDrawingBuffer keeps the settled dice on screen after compositing.
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  disposables.push(renderer);
  const pose = (frame: Frame) => {
    meshes.forEach((m, i) => {
      const p = frame.p[i]!;
      const q = frame.q[i]!;
      m.position.set(p.x, p.y, p.z);
      m.quaternion.set(q.x, q.y, q.z, q.w);
    });
    renderer.render(scene, camera);
  };

  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `3D dice: ${describe(dice)}`);
  canvas.dataset.testid = "dice-3d";
  canvas.dataset.values = dice.map((d) => d.value).join(",");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = `${HEIGHT_PX}px`;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, HEIGHT_PX, false);
  container.replaceChildren(canvas);

  let raf = 0;
  let timer = 0;
  let disposed = false;
  const dispose = () => {
    disposed = true;
    window.cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    for (const d of disposables) d.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
  current = dispose;

  if (sound) playRollSound();
  const duration = frames.length * STEP * 1000;
  return new Promise<boolean>((resolve) => {
    let start: number | null = null;
    let done = false;
    const finish = (shown: boolean) => {
      if (done) return;
      done = true;
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      let ok = shown;
      if (ok && !disposed) {
        try {
          pose(last);
        } catch {
          ok = false;
        }
      }
      // A render failure leaves no blank canvas behind: the caller shows 2D.
      if (!ok && !disposed) {
        dispose();
        if (current === dispose) current = null;
      }
      resolve(ok);
    };
    const tick = (now: number) => {
      start ??= now;
      const i = Math.floor((now - start) / (STEP * 1000));
      if (disposed || i >= frames.length - 1) return finish(true);
      try {
        pose(frames[i]!);
      } catch {
        return finish(false);
      }
      raf = window.requestAnimationFrame(tick);
    };
    // Background tabs pause animation frames; the result must still show.
    timer = window.setTimeout(() => finish(true), duration + 1000);
    raf = window.requestAnimationFrame(tick);
  });
}
