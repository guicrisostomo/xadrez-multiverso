// Tabuleiro 3D com Three.js: peças modeladas por revolução (lathe), câmera orbital,
// seleção por raycasting e animação dos lances.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = {
  light: 0xe9dcc0, dark: 0x9c6f4a, sel: 0xf2d14b, last: 0xc9cf6a, check: 0xe0463f,
  target: 0x3fbf6f, frame: 0x3b2a1e,
};

const V = (x, y) => new THREE.Vector2(x, y);
const lathe = pts => new THREE.LatheGeometry(pts.map(([x, y]) => V(x, y)), 32);

const PROFILES = {
  P: [[0, 0], [0.32, 0], [0.32, 0.06], [0.26, 0.1], [0.2, 0.14], [0.12, 0.3], [0.1, 0.38], [0.17, 0.4], [0.17, 0.44], [0, 0.44]],
  R: [[0, 0], [0.36, 0], [0.36, 0.07], [0.3, 0.11], [0.25, 0.16], [0.21, 0.55], [0.28, 0.6], [0.28, 0.74], [0, 0.74]],
  B: [[0, 0], [0.35, 0], [0.35, 0.07], [0.29, 0.11], [0.23, 0.15], [0.13, 0.48], [0.12, 0.56], [0.19, 0.58], [0.19, 0.62], [0.1, 0.64], [0, 0.64]],
  N: [[0, 0], [0.36, 0], [0.36, 0.07], [0.3, 0.11], [0.25, 0.16], [0.22, 0.3], [0, 0.3]],
  Q: [[0, 0], [0.38, 0], [0.38, 0.07], [0.32, 0.11], [0.26, 0.16], [0.15, 0.6], [0.13, 0.76], [0.22, 0.8], [0.22, 0.85], [0.16, 0.9], [0, 0.92]],
  K: [[0, 0], [0.38, 0], [0.38, 0.07], [0.32, 0.11], [0.26, 0.16], [0.16, 0.64], [0.14, 0.8], [0.23, 0.85], [0.23, 0.89], [0.19, 0.97], [0, 0.99]],
  M: [[0, 0], [0.34, 0], [0.34, 0.06], [0.28, 0.1], [0.22, 0.15], [0.2, 0.24], [0, 0.24]],
};

export class Board3D {
  constructor(host, onSquareClick) {
    this.onSquareClick = onSquareClick;
    this.el = document.createElement('div');
    this.el.className = 'board3d';
    host.appendChild(this.el);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.el.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.enablePan = false;

    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x30283a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
    this.scene.add(sun);

    this.boardGroup = new THREE.Group();
    this.pieceGroup = new THREE.Group();
    this.markGroup = new THREE.Group();
    this.scene.add(this.boardGroup, this.pieceGroup, this.markGroup);

    this.geo = {};
    this.mats = {};
    this.anims = [];
    this.raycaster = new THREE.Raycaster();

    let down = null;
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      this.pick(e);
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    const loop = t => {
      this.raf = requestAnimationFrame(loop);
      this.tick(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  mat(color) {
    if (!this.mats[color]) this.mats[color] = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.12 });
    return this.mats[color];
  }

  pos(s, r, c) {
    return new THREE.Vector3(c - (s.w - 1) / 2, 0, r - (s.h - 1) / 2);
  }

  buildBoard(s) {
    this.boardGroup.clear();
    this.squares = new Map();
    const sqGeo = new THREE.BoxGeometry(1, 0.2, 1);
    for (let r = 0; r < s.h; r++) {
      for (let c = 0; c < s.w; c++) {
        if (s.holes.has(r * s.w + c)) continue;
        const m = new THREE.Mesh(sqGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }));
        m.position.copy(this.pos(s, r, c)).setY(-0.1);
        m.receiveShadow = true;
        m.userData.sq = { r, c };
        m.userData.base = (r + c) % 2 ? COLORS.dark : COLORS.light;
        this.boardGroup.add(m);
        this.squares.set(`${r},${c}`, m);
      }
    }
    // Moldura sob as casas
    const frameMat = new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.6 });
    if (s.holes.size) {
      const arm = (w, d) => new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), frameMat);
      const a = arm(8.6, s.h + 0.6), b = arm(s.w + 0.6, 8.6);
      a.position.y = b.position.y = -0.2;
      this.boardGroup.add(a, b);
    } else {
      const f = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.6, 0.3, s.h + 0.6), frameMat);
      f.position.y = -0.2;
      this.boardGroup.add(f);
    }
  }

  horseHead(m) {
    const g = new THREE.Group();
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.26), m);
    neck.position.set(0, 0.2, -0.02);
    neck.rotation.x = -0.25;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.17, 0.36), m);
    head.position.set(0, 0.38, 0.1);
    head.rotation.x = 0.25;
    const ears = [-0.055, 0.055].map(x => {
      const e = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 8), m);
      e.position.set(x, 0.5, -0.04);
      return e;
    });
    g.add(neck, head, ...ears);
    return g;
  }

  makePiece(t, color) {
    const m = this.mat(color);
    const g = new THREE.Group();
    const add = (mesh, y = 0, x = 0, z = 0) => { mesh.position.set(x, y, z); g.add(mesh); return mesh; };
    const prof = t === 'A' ? 'B' : t === 'C' ? 'R' : t === 'Z' ? 'Q' : t;
    if (!this.geo[prof]) this.geo[prof] = lathe(PROFILES[prof]);
    add(new THREE.Mesh(this.geo[prof], m));
    const sphere = (rad, y) => add(new THREE.Mesh(new THREE.SphereGeometry(rad, 20, 14), m), y);

    switch (t) {
      case 'P': sphere(0.14, 0.53); break;
      case 'R':
      case 'C':
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), m), 0.78, Math.cos(a) * 0.2, Math.sin(a) * 0.2);
        }
        if (t === 'C') { const h = this.horseHead(m); h.scale.setScalar(0.75); h.position.y = 0.74; g.add(h); }
        break;
      case 'B': sphere(0.15, 0.76).scale.set(1, 1.3, 1); sphere(0.045, 0.97); break;
      case 'A': { sphere(0.13, 0.74).scale.set(1, 1.2, 1); const h = this.horseHead(m); h.scale.setScalar(0.65); h.position.y = 0.8; g.add(h); break; }
      case 'N': { const h = this.horseHead(m); h.scale.setScalar(1.15); h.position.y = 0.26; g.add(h); break; }
      case 'Q':
      case 'Z':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), m), 0.9, Math.cos(a) * 0.18, Math.sin(a) * 0.18);
        }
        if (t === 'Q') sphere(0.07, 1.0);
        else { const h = this.horseHead(m); h.scale.setScalar(0.6); h.position.y = 0.9; g.add(h); }
        break;
      case 'K':
        add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), m), 1.11);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.07), m), 1.14);
        break;
      case 'M': {
        const body = sphere(0.2, 0.42); body.scale.set(0.9, 0.6, 1.35);
        sphere(0.1, 0.56).position.z = -0.1;
        sphere(0.1, 0.56).position.z = 0.08;
        const neck = add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.32, 0.09), m), 0.62, 0, 0.27);
        neck.rotation.x = 0.35;
        add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.2), m), 0.8, 0, 0.36);
        break;
      }
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  setCamera(s, player, extraTurns = 0) {
    const [fr, fc] = player ? player.forward : [-1, 0];
    const dist = Math.max(s.w, s.h) * 1.25;
    const ang = Math.atan2(-fc, -fr) + extraTurns * Math.PI / 2;
    this.camera.position.set(Math.sin(ang) * dist * 0.72, dist * 1.05, Math.cos(ang) * dist * 0.72);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  render(s, ui = {}) {
    const boardKey = `${s.variantId}:${s.w}x${s.h}`;
    if (this.boardKey !== boardKey) {
      this.buildBoard(s);
      this.boardKey = boardKey;
      this.viewKey = null;
      this.resize();
    }
    const viewKey = `${ui.viewPlayer}:${ui.rot || 0}`;
    if (this.viewKey !== viewKey) {
      this.setCamera(s, s.players[ui.viewPlayer], ui.rot || 0);
      this.viewKey = viewKey;
    }

    const lm = ui.lastMove;
    const checks = new Set((ui.checks || []).map(k => `${k.r},${k.c}`));
    for (const [k, mesh] of this.squares) {
      const { r, c } = mesh.userData.sq;
      let color = mesh.userData.base;
      if (lm && ((lm.fr === r && lm.fc === c) || (lm.tr === r && lm.tc === c))) color = COLORS.last;
      if (checks.has(k)) color = COLORS.check;
      if (ui.selected && ui.selected.r === r && ui.selected.c === c) color = COLORS.sel;
      mesh.material.color.setHex(color);
    }

    this.markGroup.clear();
    const dotGeo = this.geo.dot || (this.geo.dot = new THREE.CylinderGeometry(0.14, 0.14, 0.03, 20));
    const ringGeo = this.geo.ring || (this.geo.ring = new THREE.TorusGeometry(0.4, 0.04, 8, 32));
    const markMat = this.geo.markMat || (this.geo.markMat = new THREE.MeshBasicMaterial({ color: COLORS.target, transparent: true, opacity: 0.85 }));
    for (const m of ui.targets || []) {
      const capture = s.board[m.tr][m.tc] || m.ep;
      const mark = new THREE.Mesh(capture ? ringGeo : dotGeo, markMat);
      mark.position.copy(this.pos(s, m.tr, m.tc)).setY(0.02);
      if (capture) mark.rotation.x = Math.PI / 2;
      mark.userData.sq = { r: m.tr, c: m.tc };
      this.markGroup.add(mark);
    }

    this.pieceGroup.clear();
    this.anims = [];
    const moveKey = lm ? `${s.ply}:${lm.fr},${lm.fc}>${lm.tr},${lm.tc}` : null;
    const animate = moveKey && moveKey !== this.lastMoveKey;
    this.lastMoveKey = moveKey;
    for (let r = 0; r < s.h; r++) {
      for (let c = 0; c < s.w; c++) {
        const pc = s.board[r][c];
        if (!pc) continue;
        const pl = s.players[pc.o];
        const obj = this.makePiece(pc.t, pl.color);
        obj.position.copy(this.pos(s, r, c));
        obj.rotation.y = Math.atan2(pl.forward[1], pl.forward[0]);
        obj.traverse(o => { o.userData.sq = { r, c }; });
        this.pieceGroup.add(obj);
        if (animate && lm.tr === r && lm.tc === c) {
          const from = this.pos(s, lm.fr, lm.fc);
          this.anims.push({ obj, from, to: obj.position.clone(), t0: performance.now(), jump: 'NAZCM'.includes(pc.t) });
          obj.position.copy(from);
        }
      }
    }
  }

  tick(now) {
    for (const a of this.anims) {
      const k = Math.min(1, (now - a.t0) / 320);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      a.obj.position.lerpVectors(a.from, a.to, e);
      a.obj.position.y = a.jump ? Math.sin(Math.PI * k) * 0.8 : 0;
    }
    this.anims = this.anims.filter(a => now - a.t0 < 320);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([this.markGroup, this.pieceGroup, this.boardGroup], true);
    const hit = hits.find(h => h.object.userData.sq);
    if (hit) this.onSquareClick(hit.object.userData.sq.r, hit.object.userData.sq.c);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.el.remove();
  }
}
