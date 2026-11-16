// EMBERLINE map: "Foundry Yard". An original 44 x 30 m industrial yard — two lanes
// (A west, B east) plus a mid choke, two plant sites, attacker spawn south, defender
// spawn north. Boxes are both the visible geometry and the colliders; the waypoint
// graph below is what the bots navigate on. No textures are loaded: the ground pattern
// is painted on a canvas at runtime.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOUNDS = { minX: -22, maxX: 22, minZ: -15, maxZ: 15 };

// Waypoints: id -> [x, z]. Edges are listed beside them.
const WAYPOINTS = [
  [0, 12.5], [-16, 12], [16, 12], [0, 8], [-16, 6], [16, 6], [0, 4],
  [-17, -2], [17, -2], [0, -1], [-8, -3], [8, -3], [-17, -9], [17, -9],
  [-12, -9], [12, -9], [-20, -12], [20, -12], [0, -11], [-8, -11],
  [8, -11], [0, -13.5], [-6, 7], [6, 7], [-10, 12], [10, 12],
  [-15, -4], [15, -4],
];
const EDGES = {
  0: [1, 2, 3], 1: [0, 4, 24], 2: [0, 5, 25], 3: [0, 6, 22, 23],
  4: [1, 7, 22], 5: [2, 8, 23], 6: [3, 9, 11], 7: [4, 26, 14],
  8: [5, 27, 15], 9: [6, 18, 10, 11], 10: [9, 14], 11: [6, 9, 15],
  12: [14, 16, 26], 13: [15, 17, 27], 14: [7, 10, 12, 19],
  15: [8, 11, 13, 20], 16: [12, 19], 17: [13, 20], 18: [9, 19, 20, 21],
  19: [14, 16, 18], 20: [15, 17, 18], 21: [18], 22: [3, 4],
  23: [3, 5], 24: [1], 25: [2], 26: [7, 12], 27: [8, 13],
};

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  g.fillStyle = '#262a31';
  g.fillRect(0, 0, 512, 512);
  // Concrete speckle.
  for (let i = 0; i < 2600; i += 1) {
    const v = 30 + Math.floor(Math.random() * 26);
    g.fillStyle = `rgb(${v},${v + 3},${v + 7})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // Expansion-joint grid.
  g.strokeStyle = 'rgba(12,14,18,0.85)';
  g.lineWidth = 3;
  for (let i = 0; i <= 4; i += 1) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke();
  }
  // Faded lane paint.
  g.strokeStyle = 'rgba(240,168,48,0.28)';
  g.lineWidth = 5;
  g.setLineDash([26, 18]);
  g.beginPath(); g.moveTo(256, 512); g.lineTo(256, 0); g.stroke();
  g.setLineDash([]);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: opts.rough ?? 0.9, metalness: opts.metal ?? 0.05,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
  });
  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.02 }),
    wall: mat(PALETTE.wall), wallTop: mat(PALETTE.wallTop, { rough: 0.7 }),
    rust: mat(PALETTE.rust, { rough: 0.85 }),
    contA: mat(PALETTE.containerA, { rough: 0.6, metal: 0.35 }),
    contB: mat(PALETTE.containerB, { rough: 0.6, metal: 0.35 }),
    contC: mat(PALETTE.containerC, { rough: 0.6, metal: 0.35 }),
    crate: mat(PALETTE.crate, { rough: 0.95 }),
    metal: mat(PALETTE.metal, { rough: 0.45, metal: 0.6 }),
    hazard: mat(PALETTE.hazard, { rough: 0.7 }),
    siteA: mat(PALETTE.siteA, { transparent: true, opacity: 0.16, emissive: PALETTE.siteA, emissiveIntensity: 0.35 }),
    siteB: mat(PALETTE.siteB, { transparent: true, opacity: 0.16, emissive: PALETTE.siteB, emissiveIntensity: 0.35 }),
    lamp: mat('#111418', { emissive: '#ffd9a0', emissiveIntensity: 2.2 }),
    dark: mat('#101216', { rough: 1 }),
  };

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground slab.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(46, 32), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3(new THREE.Vector3(-23, -0.5, -16), new THREE.Vector3(23, 0, 16)));

  // Perimeter walls.
  box(45.2, 4.2, 0.6, 0, 2.1, -15.3, mats.wall);
  box(45.2, 4.2, 0.6, 0, 2.1, 15.3, mats.wall);
  box(0.6, 4.2, 31.2, -22.3, 2.1, 0, mats.wall);
  box(0.6, 4.2, 31.2, 22.3, 2.1, 0, mats.wall);
  // Wall caps.
  box(45.2, 0.18, 0.9, 0, 4.3, -15.3, mats.wallTop, false);
  box(45.2, 0.18, 0.9, 0, 4.3, 15.3, mats.wallTop, false);
  box(0.9, 0.18, 31.2, -22.3, 4.3, 0, mats.wallTop, false);
  box(0.9, 0.18, 31.2, 22.3, 4.3, 0, mats.wallTop, false);

  // Mid choke wall at z = 2 with a 4 m central doorway.
  box(7, 3.4, 0.6, -5.5, 1.7, 2, mats.rust);
  box(7, 3.4, 0.6, 5.5, 1.7, 2, mats.rust);
  box(0.5, 3.4, 0.6, -2, 1.7, 2, mats.hazard);
  box(0.5, 3.4, 0.6, 2, 1.7, 2, mats.hazard);
  // Central pillar in mid-north, clear of the waypoint lanes.
  box(1.4, 3.6, 1.4, 3.5, 1.8, -4, mats.metal);

  // North approach walls: force the push through mid or the lane edges.
  box(6, 3.2, 0.6, -9, 1.6, -6, mats.wall);
  box(6, 3.2, 0.6, 9, 1.6, -6, mats.wall);

  // Site A (west) cover.
  box(2.6, 2.6, 2.6, -18.5, 1.3, -6.5, mats.contA);
  box(1.3, 1.3, 1.3, -16.5, 0.65, -11.8, mats.crate);
  box(1.3, 1.3, 1.3, -16.5, 0.65, -10.4, mats.crate);
  box(1.3, 1.3, 1.3, -16.5, 1.95, -11.1, mats.crate);
  box(4.5, 1.1, 0.5, -19.5, 0.55, -12.3, mats.wall);
  box(0.5, 1.1, 3.5, -12.5, 0.55, -12, mats.wall);
  // Site B (east) cover — mirrored, different paint.
  box(2.6, 2.6, 2.6, 18.5, 1.3, -6.5, mats.contB);
  box(1.3, 1.3, 1.3, 16.5, 0.65, -11.8, mats.crate);
  box(1.3, 1.3, 1.3, 16.5, 0.65, -10.4, mats.crate);
  box(1.3, 1.3, 1.3, 16.5, 1.95, -11.1, mats.crate);
  box(4.5, 1.1, 0.5, 19.5, 0.55, -12.3, mats.wall);
  box(0.5, 1.1, 3.5, 12.5, 0.55, -12, mats.wall);

  // Lane cover.
  box(1.3, 1.3, 1.3, -14.5, 0.65, 4.5, mats.crate);
  box(1.3, 1.3, 1.3, -18, 0.65, 8, mats.crate);
  box(1.3, 1.3, 1.3, -18, 1.95, 8, mats.crate);
  box(4, 1.1, 0.5, -14, 0.55, 0, mats.wall);
  box(1.3, 1.3, 1.3, 14.5, 0.65, 4.5, mats.crate);
  box(1.3, 1.3, 1.3, 18, 0.65, 8, mats.crate);
  box(1.3, 1.3, 1.3, 18, 1.95, 8, mats.crate);
  box(4, 1.1, 0.5, 14, 0.55, 0, mats.wall);
  // Mid cover.
  box(1.3, 1.3, 1.3, -3.5, 0.65, 6.5, mats.crate);
  box(1.3, 1.3, 1.3, 3.5, 0.65, 6.5, mats.crate);
  box(2.6, 2.6, 1.2, -8, 1.3, 8.5, mats.contC);
  box(2.6, 2.6, 1.2, 8, 1.3, 8.5, mats.contC);
  // Spawn cover.
  box(3, 1.1, 0.5, -4, 0.55, 11, mats.wall);
  box(3, 1.1, 0.5, 4, 0.55, 11, mats.wall);
  box(1.3, 1.3, 1.3, -6, 0.65, -12.5, mats.crate);
  box(1.3, 1.3, 1.3, 6, 0.65, -12.5, mats.crate);

  // Site floor markers (walkable, no collision).
  const siteAZone = new THREE.Mesh(new THREE.PlaneGeometry(8, 6.5), mats.siteA);
  siteAZone.rotation.x = -Math.PI / 2;
  siteAZone.position.set(-17, 0.02, -9);
  group.add(siteAZone);
  const siteBZone = new THREE.Mesh(new THREE.PlaneGeometry(8, 6.5), mats.siteB);
  siteBZone.rotation.x = -Math.PI / 2;
  siteBZone.position.set(17, 0.02, -9);
  group.add(siteBZone);

  // Floodlight poles with emissive heads (decorative light comes from the sun).
  const poles = [];
  for (const [x, z] of [[-20, 13], [20, 13], [-20, -13], [20, -13], [0, 13]]) {
    const pole = box(0.18, 5.2, 0.18, x, 2.6, z, mats.metal, false);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.5), mats.lamp);
    head.position.set(x, 5.3, z);
    head.castShadow = false;
    group.add(head);
    poles.push(head);
  }

  // Distant skyline silhouettes outside the walls, for depth at a glance.
  const skyline = new THREE.Group();
  for (let i = 0; i < 26; i += 1) {
    const h = 6 + Math.random() * 16;
    const w = 4 + Math.random() * 6;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mats.dark);
    const angle = (i / 26) * Math.PI * 2;
    const r = 46 + Math.random() * 22;
    mesh.position.set(Math.cos(angle) * r, h / 2 - 0.5, Math.sin(angle) * r);
    skyline.add(mesh);
  }
  scene.add(skyline);

  // Lighting: low amber sun, cool sky fill, and a warm bounce.
  const hemi = new THREE.HemisphereLight(new THREE.Color('#8fa3b8'), new THREE.Color('#2a2118'), 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.7);
  sun.position.set(18, 26, 14);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5f7ea6'), 0.5);
  fill.position.set(-14, 12, -18);
  scene.add(fill);

  // Blinking site beacons (animated in step()).
  const beaconA = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xf0a830 }),
  );
  beaconA.position.set(-17, 4.6, -9);
  scene.add(beaconA);
  const beaconB = beaconA.clone();
  beaconB.material = new THREE.MeshBasicMaterial({ color: 0x4fc3b8 });
  beaconB.position.set(17, 4.6, -9);
  scene.add(beaconB);

  const sites = {
    A: { name: 'A', center: new THREE.Vector3(-17, 0, -9), half: { x: 4, z: 3.25 }, color: '#f0a830' },
    B: { name: 'B', center: new THREE.Vector3(17, 0, -9), half: { x: 4, z: 3.25 }, color: '#4fc3b8' },
  };
  const spawns = {
    vanguard: [
      new THREE.Vector3(-2.5, 0, 13.5), new THREE.Vector3(0, 0, 14), new THREE.Vector3(2.5, 0, 13.5),
    ],
    ember: [
      new THREE.Vector3(-2.5, 0, -13.5), new THREE.Vector3(0, 0, -14), new THREE.Vector3(2.5, 0, -13.5),
      new THREE.Vector3(-9, 0, -13.5),
    ],
  };

  let time = 0;
  return {
    colliders,
    shootables,
    bounds: BOUNDS,
    sites,
    spawns,
    waypoints: WAYPOINTS.map(([x, z], id) => ({ id, x, z, neighbors: EDGES[id] ?? [] })),
    nearestWaypoint(x, z) {
      let best = 0;
      let bestD = Infinity;
      for (const w of WAYPOINTS) {
        const d = (w[0] - x) ** 2 + (w[1] - z) ** 2;
        if (d < bestD) { bestD = d; best = WAYPOINTS.indexOf(w); }
      }
      return best;
    },
    step(dt) {
      time += dt;
      const pulse = 0.6 + 0.4 * Math.sin(time * 2.4);
      beaconA.material.color.setScalar(0);
      beaconA.material.color.setRGB(0.94 * pulse, 0.66 * pulse, 0.19 * pulse);
      beaconB.material.color.setRGB(0.31 * pulse, 0.76 * pulse, 0.72 * pulse);
    },
  };
}
