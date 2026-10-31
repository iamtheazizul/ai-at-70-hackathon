// 3D view, rebuilt from the saved 2D positions. Uses the global THREE (loaded in index.html).
// Coordinates: plan x → X, plan y → Z, 1 unit = 1 cell = 2 ft; heights in ft / 2.

import { DEPTS } from "../core/constants.js";
import { dimsOf, shelfFt, isHit } from "../core/model.js";
import { RES } from "../routing/floorGrid.js";
import { app, hooks, setView } from "./app.js";
import { $, css } from "./dom.js";

let T = null; // three.js objects once initialised

function size() {
  if (!T) return;
  const w = T.box.clientWidth || 600, h = Math.max(360, Math.min(620, w * 0.62));
  T.renderer.setSize(w, h);
  T.camera.aspect = w / h;
  T.camera.updateProjectionMatrix();
}

export function resetCamera() {
  if (!T) return;
  const { W, H } = dimsOf(app.S), d = Math.max(W, H);
  T.camera.position.set(-d * 0.12, d * 0.62, d * 0.72);
  T.controls.target.set(0, 0, 2);
  T.controls.update();
}

function init() {
  const THREE = window.THREE, box = $("#view3d");
  if (!THREE || !THREE.OrbitControls) { $("#view3dMsg").textContent = "The 3D library didn't load. Check your connection and reopen the page."; return false; }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch (e) { $("#view3dMsg").textContent = "This browser can't show 3D graphics (WebGL is off)."; return false; }
  $("#view3dMsg")?.remove();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  box.appendChild(renderer.domElement);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.08;
  controls.minDistance = 6;
  controls.maxDistance = 180;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a8e, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.65);
  sun.position.set(-18, 40, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
  scene.add(sun);
  const group = new THREE.Group();
  scene.add(group);

  T = { THREE, renderer, scene, camera, controls, group, box, pick: [] };
  resetCamera();
  new ResizeObserver(size).observe(box);
  size();
  (function loop() { if (app.mode3d) { controls.update(); renderer.render(scene, camera); } requestAnimationFrame(loop); })();

  // click a shelf to select it (ignore drags used for orbiting)
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    down = null;
    const r = renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(m, camera);
    const hit = rc.intersectObjects(T.pick, false)[0];
    hooks.select(hit ? hit.object.userData.id : null);
  });
  return true;
}

function roundRect(x, a, b, w, h, r) {
  x.beginPath(); x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
}

function labelSprite(no, name) {
  const { THREE } = T, c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const x = c.getContext("2d");
  let tagW = 0;
  if (no) {
    tagW = Math.max(96, String(no).length * 42 + 44);
    x.fillStyle = css("--tag"); roundRect(x, 4, 14, tagW, 100, 14); x.fill();
    x.fillStyle = css("--tag-ink"); x.font = "700 64px 'JetBrains Mono', monospace"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(no, 4 + tagW / 2, 66);
  }
  x.fillStyle = "rgba(20,28,24,.82)"; roundRect(x, tagW + 10, 26, 498 - tagW, 76, 12); x.fill();
  x.fillStyle = "#fff"; x.font = "700 40px 'Atkinson Hyperlegible', sans-serif"; x.textAlign = "left"; x.textBaseline = "middle";
  let s = name;
  while (x.measureText(s).width > 470 - tagW && s.length > 2) s = s.slice(0, -2) + "…";
  x.fillText(s, tagW + 26, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(6.4, 1.6, 1);
  sp.renderOrder = 10;
  return sp;
}

export function build3d(q) {
  if (!T && !init()) return;
  const { THREE, group, scene } = T, S = app.S, { W, H } = dimsOf(S);
  group.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  group.clear();
  T.pick = [];
  scene.background = new THREE.Color(css("--panel"));
  const ox = -W / 2, oz = -H / 2;
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0, ...o });

  // floor + grid
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), std(css("--floor")));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
  const pts = [];
  for (let i = 0; i <= W; i++) pts.push(ox + i, 0.01, oz, ox + i, 0.01, oz + H);
  for (let j = 0; j <= H; j++) pts.push(ox, 0.01, oz + j, ox + W, 0.01, oz + j);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  group.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: css("--grid") })));

  // low perimeter walls with a gap at the entrance
  const wallMat = std(css("--line")), wh = 1.2, wt = 0.3;
  const wall = (x, z, w, d) => {
    if (w <= 0) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wh, d), wallMat);
    m.position.set(ox + x + w / 2, wh / 2, oz + z + d / 2);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  const door = (S.fixtures || []).find((f) => f.kind === "door");
  wall(0, -wt, W, wt); wall(-wt, -wt, wt, H + 2 * wt); wall(W, -wt, wt, H + 2 * wt);
  if (door) { wall(0, H, door.x, wt); wall(door.x + door.w, H, W - door.x - door.w, wt); } else wall(0, H, W, wt);

  // checkout counters + entrance marker
  (S.fixtures || []).forEach((f) => {
    if (f.kind === "door") {
      const ar = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 3), std(css("--accent")));
      ar.rotation.x = -Math.PI / 2; ar.position.set(ox + f.x + f.w / 2, 0.05, oz + H - 1.4); group.add(ar);
      return;
    }
    const vertical = f.h > f.w, len = vertical ? f.h : f.w, n = Math.max(1, Math.floor(len / 3));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(vertical ? new THREE.BoxGeometry(f.w, 1.75, 1.4) : new THREE.BoxGeometry(1.4, 1.75, f.h), std(css("--muted")));
      m.position.set(vertical ? ox + f.x + f.w / 2 : ox + f.x + i * (f.w / n) + f.w / n / 2, 0.875, vertical ? oz + f.y + i * (f.h / n) + f.h / n / 2 : oz + f.y + f.h / 2);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    const sp = labelSprite("", f.name);
    sp.position.set(ox + f.x + f.w / 2, 3, oz + f.y + f.h / 2);
    group.add(sp);
  });

  // shelves
  S.aisles.forEach((a) => {
    if (a.x == null) return;
    const hit = isHit(a, q), dim = q && !hit, h = shelfFt(a) / 2;
    const col = new THREE.Color(a.color || DEPTS[a.dept] || DEPTS.Other);
    const mat = std(col, { transparent: !!dim, opacity: dim ? 0.18 : 1, emissive: hit && q ? new THREE.Color(css("--tag")) : new THREE.Color(0), emissiveIntensity: hit && q ? 0.35 : 0 });
    const cx = ox + a.x + a.w / 2, cz = oz + a.y + a.h / 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(a.w, h, a.h), mat);
    body.position.set(cx, h / 2, cz);
    body.castShadow = !dim; body.receiveShadow = true; body.userData.id = a.id;
    group.add(body); T.pick.push(body);
    if (!dim) {
      const ledge = std(col.clone().multiplyScalar(0.6)), n = Math.max(2, Math.round(shelfFt(a) / 1.5));
      for (let i = 1; i < n; i++) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(a.w + 0.12, 0.06, a.h + 0.12), ledge);
        l.position.set(cx, (h * i) / n, cz); group.add(l);
      }
    }
    if (app.sel === a.id) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(a.w + 0.25, h + 0.25, a.h + 0.25)), new THREE.LineBasicMaterial({ color: css("--ink") }));
      e.position.copy(body.position); group.add(e);
    }
    if (!dim || app.sel === a.id) { const sp = labelSprite(a.no, a.name); sp.position.set(cx, h + 1.3, cz); group.add(sp); }
  });

  // planned route as a strip on the floor
  if (app.trip) {
    const mat = std(css("--accent"), { emissive: new THREE.Color(css("--accent")), emissiveIntensity: 0.4 });
    app.trip.legs.forEach((l) => {
      for (let k = 1; k < l.cells.length; k++) {
        const [x1, z1] = l.cells[k - 1].map((n) => (n + 0.5) * RES), [x2, z2] = l.cells[k].map((n) => (n + 0.5) * RES);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x2 - x1) + 0.25, 0.08, Math.abs(z2 - z1) + 0.25), mat);
        seg.position.set(ox + (x1 + x2) / 2, 0.06, oz + (z1 + z2) / 2);
        group.add(seg);
      }
    });
  }
}

export function setMode(three) {
  app.mode3d = three;
  $("#v2").setAttribute("aria-pressed", !three);
  $("#v3").setAttribute("aria-pressed", three);
  $("#view2d").hidden = three; $("#view3d").hidden = !three; $("#hint3d").hidden = !three;
  $("#snapWrap").hidden = three; $("#btnCam").hidden = !three;
  setView(three ? "3d" : "2d");
  hooks.render();
  if (three) { size(); resetCamera(); }
}

export function initView3d() {
  $("#v2").onclick = () => setMode(false);
  $("#v3").onclick = () => setMode(true);
  $("#btnCam").onclick = resetCamera;
}
