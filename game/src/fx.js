// Transient visual effects: tracers, muzzle flashes, impact sparks, blood puffs and
// the spike explosion. Everything is pooled and reused — no allocation in hot loops.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_PARTICLES = 320;

export function createEffects(scene) {
  const tracerPool = [];
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
    const line = new THREE.Line(tracerGeo.clone(), mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  // One shared Points cloud for all impact particles.
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pCol = new Float32Array(MAX_PARTICLES * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    particles.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1 });
    pPos[i * 3 + 1] = -100;
  }
  let particleCursor = 0;

  // Muzzle flash: a small additive sprite quad parented to the camera rig.
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
  flash.visible = false;
  scene.add(flash);
  let flashLife = 0;

  // Explosion light + expanding ring, reused for every detonation.
  const boomLight = new THREE.PointLight(0xff8a2e, 0, 26, 1.6);
  scene.add(boomLight);
  let boomLife = 0;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffa63d, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  const tmpColor = new THREE.Color();

  function spawnParticle(x, y, z, vx, vy, vz, life, color) {
    const p = particles[particleCursor];
    particleCursor = (particleCursor + 1) % MAX_PARTICLES;
    p.alive = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.max = life;
    tmpColor.set(color);
    p.r = tmpColor.r; p.g = tmpColor.g; p.b = tmpColor.b;
  }

  return {
    tracer(from, to, color = 0xffd27a) {
      const t = tracerPool[tracerCursor];
      tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
      const pos = t.line.geometry.attributes.position;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      t.line.material.color.set(color);
      t.line.material.opacity = 0.9;
      t.line.visible = true;
      t.life = 0.09;
    },
    impact(point, normal, kind = 'wall') {
      const color = kind === 'flesh' ? 0xb02020 : kind === 'spark' ? 0xffc46b : 0x9aa3ad;
      const count = kind === 'flesh' ? 10 : 7;
      for (let i = 0; i < count; i += 1) {
        spawnParticle(
          point.x, point.y, point.z,
          normal.x * 2 + (Math.random() - 0.5) * 3,
          normal.y * 2 + Math.random() * 2.5,
          normal.z * 2 + (Math.random() - 0.5) * 3,
          0.35 + Math.random() * 0.3, color,
        );
      }
    },
    muzzle(at, dir) {
      flash.position.copy(at).addScaledVector(dir, 0.15);
      flash.lookAt(at.clone().addScaledVector(dir, 2));
      flash.material.opacity = 0.95;
      flash.visible = true;
      flashLife = 0.05;
      flash.scale.setScalar(0.8 + Math.random() * 0.5);
    },
    explosion(at) {
      boomLight.position.copy(at).add(new THREE.Vector3(0, 1.5, 0));
      boomLight.intensity = 60;
      boomLife = 0.7;
      ring.position.copy(at).setY(0.12);
      ring.visible = true;
      ring.scale.setScalar(0.5);
      ringMat.opacity = 0.9;
      for (let i = 0; i < 90; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 7;
        spawnParticle(
          at.x, at.y + 0.3, at.z,
          Math.cos(a) * speed, 2 + Math.random() * 6, Math.sin(a) * speed,
          0.6 + Math.random() * 0.7, Math.random() < 0.5 ? 0xff8a2e : 0xffc46b,
        );
      }
    },
    step(dt) {
      for (const t of tracerPool) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
          if (t.life <= 0) t.line.visible = false;
        }
      }
      if (flashLife > 0) {
        flashLife -= dt;
        flash.material.opacity = Math.max(0, flashLife / 0.05) * 0.95;
        if (flashLife <= 0) flash.visible = false;
      }
      if (boomLife > 0) {
        boomLife -= dt;
        boomLight.intensity = Math.max(0, boomLife / 0.7) * 60;
        const s = ring.scale.x + dt * 26;
        ring.scale.setScalar(s);
        ringMat.opacity = Math.max(0, boomLife / 0.7) * 0.9;
        if (boomLife <= 0) ring.visible = false;
      }
      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        const p = particles[i];
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
          pPos[i * 3 + 1] = -100;
          continue;
        }
        p.vy -= 9.8 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0.03) { p.y = 0.03; p.vy = 0; }
        pPos[i * 3] = p.x;
        pPos[i * 3 + 1] = p.y;
        pPos[i * 3 + 2] = p.z;
        const fade = p.life / p.max;
        pCol[i * 3] = p.r * fade;
        pCol[i * 3 + 1] = p.g * fade;
        pCol[i * 3 + 2] = p.b * fade;
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
    },
  };
}
