// EMBERLINE — Foundry Yard. Boot, the fixed-step loop, round/match flow, the spike
// objective, grenades, and the player's shooting. Bots live in bots.js, the map in
// map.js; this file only wires them together and owns the match state.
// ?shot=start|play|plant|buy with &seed=N stages a deterministic frame for a
// screenshot, renders it twice, then freezes and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap } from './map.js';
import { createState, PHASE } from './state.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createWeapon, fireHitscan } from './weapons.js';
import { createBots } from './bots.js';
import { createEconomy, REWARDS, BUY_ITEMS } from './economy.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './fx.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a2029');
scene.fog = new THREE.Fog(new THREE.Color('#1a2029'), 30, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

// ---------- World, state, actors ----------
const map = createMap(scene);
const state = createState();
const economy = createEconomy();
const hud = createHud();
const audio = createAudio();
const fx = createEffects(scene);
const bots = createBots(scene, map);
const player = createPlayer(map.colliders, map.spawns.vanguard[1]);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;

// The player's own hitboxes, so bots can shoot back. Transparent, never rendered.
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerBodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.05, 0.7), hitMat);
const playerHeadBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.4), hitMat);
scene.add(playerBodyBox, playerHeadBox);

const playerAgent = {
  isPlayer: true, name: 'You', team: 'vanguard',
  position: player.state.position,
  get eye() { return player.state.eye; },
  get alive() { return player.state.alive; },
};
playerBodyBox.userData.agent = playerAgent;
playerBodyBox.userData.agentPart = 'body';
playerHeadBox.userData.agent = playerAgent;
playerHeadBox.userData.agentPart = 'head';

const weapons = { pistol: createWeapon('pistol'), primary: null };
let currentWeapon = weapons.pistol;
let grenades = 0;
let spikeCarrier = 'player'; // 'player' or a bot agent
let plantProgress = 0;
let defuseBeep = 0;
let started = false;
let frozen = false;
let buyOpen = false;
let lastTime = performance.now();
let accumulator = 0;
let stepCount = 0;
let stepDistance = 0;
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const grenadeList = [];

// Bullet targets: walls + every living agent's hitboxes. Rebuilt on spawn/death.
let bulletTargets = [];
function rebuildBulletTargets() {
  bulletTargets = map.shootables.concat(bots.hitMeshes, [playerBodyBox, playerHeadBox]);
}

function enemiesOf(agent) {
  if (agent.team === 'vanguard') return bots.agents.filter((a) => a.team === 'ember');
  const foes = bots.agents.filter((a) => a.team === 'vanguard');
  return player.state.alive ? foes.concat([playerAgent]) : foes;
}

const botWorld = {
  state, map, raycaster, fx, audio,
  get spikeCarrier() { return spikeCarrier === 'player' ? null : spikeCarrier; },
  shootables: map.shootables,
  get bulletTargets() { return bulletTargets; },
  enemiesOf,
  damageAgent,
};

// ---------- Damage / death ----------
function damageAgent(victim, attacker, dmg, isHead) {
  if (!victim.alive) return;
  const armored = victim.isPlayer ? currentArmor() : victim.armor;
  const finalDmg = armored > 0 ? dmg * 0.5 : dmg;
  if (victim.isPlayer) {
    player.state.health -= finalDmg;
    hud.damageFlash();
    audio.hurt();
    if (player.state.health <= 0) {
      player.state.health = 0;
      player.state.alive = false;
      state.deaths.player += 1;
      hud.feedLine(`${attacker.name} ▸ You`, false);
      if (spikeCarrier === 'player') transferSpike();
      checkRoundEnd();
    }
  } else {
    victim.health -= finalDmg;
    // Taking damage interrupts a plant/defuse channel.
    victim.channelProgress = 0;
    // Hit flash on the team-coloured vest, restored a blink later.
    if (victim.flashMat) {
      victim.flashMat.emissive.setHex(0x881111);
      setTimeout(() => victim.flashMat.emissive.setHex(0x000000), 90);
    }
    if (victim.health <= 0) {
      victim.health = 0;
      victim.alive = false;
      victim.channelProgress = 0;
      const killerName = attacker.isPlayer ? 'You' : attacker.name;
      hud.feedLine(`${killerName} ▸ ${victim.name}${isHead ? ' (headshot)' : ''}`, attacker.isPlayer);
      if (attacker.isPlayer) {
        state.kills.player += 1;
        economy.earn(REWARDS.kill);
        audio.hit(true);
        hud.hitMarker(true);
      }
      if (spikeCarrier === victim) transferSpike();
      rebuildBulletTargets();
      checkRoundEnd();
    } else if (attacker.isPlayer) {
      audio.hit(false);
      hud.hitMarker(false);
    }
  }
}

function currentArmor() {
  return playerArmor;
}
let playerArmor = 0;

function transferSpike() {
  const allies = bots.agents.filter((a) => a.team === 'vanguard' && a.alive);
  if (allies.length === 0) {
    spikeCarrier = null;
    return;
  }
  // Nearest living ally takes the spike and heads for the closest site.
  let best = allies[0];
  let bestD = Infinity;
  for (const ally of allies) {
    const d = ally.position.distanceTo(player.state.position);
    if (d < bestD) { bestD = d; best = ally; }
  }
  spikeCarrier = best;
  const dA = Math.hypot(map.sites.A.center.x - best.position.x, map.sites.A.center.z - best.position.z);
  const dB = Math.hypot(map.sites.B.center.x - best.position.x, map.sites.B.center.z - best.position.z);
  best.site = dA < dB ? 'A' : 'B';
  hud.feedLine(`${best.name} picked up the spike`, true);
}

// ---------- Rounds ----------
function startRound() {
  bots.spawnAll(state.round);
  rebuildBulletTargets();
  const yaw = 0; // face north, into the yard (-z, toward the Ember spawn)
  player.reset(map.spawns.vanguard[1], yaw);
  playerArmor = 0;
  for (const w of Object.values(weapons)) if (w) w.refill();
  grenades = 0;
  spikeCarrier = 'player';
  plantProgress = 0;
  state.phase = PHASE.BUY;
  state.roundTime = state.buyTime;
  state.plantedSite = null;
  state.plantTimer = 0;
  hud.setRound(state.round, state.maxRounds);
  hud.setScore(state.roundWins.vanguard, state.roundWins.ember);
  hud.setMoney(economy.money);
  hud.setHealth(100, 0);
  hud.setAmmo(currentWeapon.mag, currentWeapon.reserve, false);
  hud.setWeapon(currentWeapon.def.name);
  hud.setGrenades(0);
  hud.setBomb('YOU CARRY THE SPIKE', 'bomb-carrier');
  hud.showBuy(economy.money);
  buyOpen = true;
  updateAliveHud();
}

function endRound(winner, reason) {
  if (state.phase === PHASE.ROUND_END || state.phase === PHASE.MATCH_END) return;
  state.phase = PHASE.ROUND_END;
  state.roundTime = 4;
  state.winner = winner;
  state.winReason = reason;
  state.roundWins[winner] += 1;
  if (winner === 'vanguard') {
    economy.earn(REWARDS.roundWin);
    audio.roundWin();
  } else {
    economy.earn(REWARDS.roundLoss);
    audio.roundLose();
  }
  hud.setScore(state.roundWins.vanguard, state.roundWins.ember);
  hud.setMoney(economy.money);
  hud.hideBuy();
  hud.hideChannel();
  hud.hidePrompt();
  buyOpen = false;
  const vanguardWon = winner === 'vanguard';
  const title = vanguardWon ? 'ROUND WON' : 'ROUND LOST';
  hud.feedLine(`${title} — ${reason}`, vanguardWon);
  if (state.roundWins[winner] >= state.winsToTake || state.round >= state.maxRounds) {
    state.phase = PHASE.MATCH_END;
    const matchWon = state.roundWins.vanguard > state.roundWins.ember;
    hud.setOverlay('end', {
      title: matchWon ? 'MATCH WON' : 'MATCH LOST',
      copy: `Vanguard ${state.roundWins.vanguard} — ${state.roundWins.ember} Ember. ${reason}. ${matchWon ? 'Foundry Yard is yours.' : 'The Ember crew holds the yard — run it back.'}`,
    });
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    hud.setOverlay('round', { title, copy: `${reason}. Next round starts in a few seconds — spend your $${economy.money} wisely.` });
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function checkRoundEnd() {
  if (state.phase !== PHASE.LIVE && state.phase !== PHASE.PLANTED) return;
  const vanguardAlive = bots.agents.filter((a) => a.team === 'vanguard' && a.alive).length + (player.state.alive ? 1 : 0);
  const emberAlive = bots.agents.filter((a) => a.team === 'ember' && a.alive).length;
  if (emberAlive === 0) endRound('vanguard', 'Ember crew eliminated');
  else if (vanguardAlive === 0) endRound('ember', 'Vanguard eliminated');
}

function updateAliveHud() {
  const v = bots.agents.filter((a) => a.team === 'vanguard' && a.alive).length + (player.state.alive ? 1 : 0);
  const e = bots.agents.filter((a) => a.team === 'ember' && a.alive).length;
  hud.setAlive(v, e);
}

// ---------- Player shooting ----------
function playerShoot() {
  const result = currentWeapon.tryFire();
  if (result === 'empty') {
    audio.dryFire();
    currentWeapon.startReload();
    return;
  }
  if (result !== 'shot') return;
  camera.getWorldDirection(direction);
  const origin = camera.position.clone();
  const spread = currentWeapon.spread(player.groundSpeed(), player.state.crouched);
  const muzzle = origin.clone().addScaledVector(direction, 0.7);
  muzzle.y -= 0.12;
  fx.muzzle(muzzle, direction);
  audio.shot(currentWeapon.def.kind);
  for (const agent of bots.agents) {
    if (!agent.alive || agent.team === 'vanguard') continue;
    if (agent.position.distanceTo(player.state.position) < 26) {
      bots.hearNoise(agent, player.state.position, state.elapsed);
    }
  }
  let hitAnything = false;
  raycaster.far = 120;
  fireHitscan(raycaster, bulletTargets, origin, direction, spread, currentWeapon.def.pellets, (hit) => {
    hitAnything = true;
    fx.tracer(muzzle, hit.point);
    if (hit.object.userData.agent) {
      const victim = hit.object.userData.agent;
      const isHead = hit.object.userData.agentPart === 'head';
      if (victim.isPlayer) return; // cannot hit yourself
      const dmg = currentWeapon.def.damage * (isHead ? currentWeapon.def.headMult : 1);
      damageAgent(victim, playerAgent, dmg, isHead);
      fx.impact(hit.point, hit.face?.normal ?? new THREE.Vector3(0, 1, 0), 'flesh');
    } else {
      fx.impact(hit.point, hit.face?.normal ?? new THREE.Vector3(0, 1, 0), 'spark');
    }
  });
  if (!hitAnything) {
    tmpVec.copy(origin).addScaledVector(direction, 60);
    fx.tracer(muzzle, tmpVec);
  }
  player.addRecoil(
    currentWeapon.def.recoil * (0.8 + random() * 0.5),
    (random() * 2 - 1) * currentWeapon.def.recoil * 0.5,
  );
  hud.setAmmo(currentWeapon.mag, currentWeapon.reserve, currentWeapon.reloading > 0);
}

// ---------- Grenades ----------
function throwGrenade() {
  if (grenades <= 0 || state.phase !== PHASE.LIVE && state.phase !== PHASE.PLANTED) return;
  grenades -= 1;
  hud.setGrenades(grenades);
  audio.grenade();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2e4d2a, roughness: 0.6 }));
  mesh.castShadow = true;
  camera.getWorldDirection(direction);
  mesh.position.copy(camera.position).addScaledVector(direction, 0.6);
  scene.add(mesh);
  grenadeList.push({
    mesh,
    vel: direction.clone().multiplyScalar(17).add(new THREE.Vector3(0, 4.5, 0)),
    fuse: 1.6,
  });
}

function stepGrenades(dt) {
  for (let i = grenadeList.length - 1; i >= 0; i -= 1) {
    const g = grenadeList[i];
    g.fuse -= dt;
    g.vel.y -= 18 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    const p = g.mesh.position;
    // Ground bounce.
    if (p.y < 0.12) {
      p.y = 0.12;
      g.vel.y = Math.abs(g.vel.y) * 0.45;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    // Wall bounce (point vs expanded boxes).
    for (const box of map.colliders) {
      if (p.x > box.min.x - 0.12 && p.x < box.max.x + 0.12 && p.y > box.min.y && p.y < box.max.y && p.z > box.min.z - 0.12 && p.z < box.max.z + 0.12) {
        const dxl = p.x - (box.min.x - 0.12);
        const dxr = (box.max.x + 0.12) - p.x;
        const dzl = p.z - (box.min.z - 0.12);
        const dzr = (box.max.z + 0.12) - p.z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl || m === dxr) g.vel.x *= -0.45;
        else g.vel.z *= -0.45;
        break;
      }
    }
    if (g.fuse <= 0) {
      explodeGrenade(g);
      scene.remove(g.mesh);
      grenadeList.splice(i, 1);
    }
  }
}

function explodeGrenade(g) {
  const at = g.mesh.position.clone();
  fx.explosion(at);
  audio.explosion();
  const victims = [playerAgent, ...bots.agents];
  for (const victim of victims) {
    if (!victim.alive) continue;
    const d = victim.position.distanceTo(at);
    if (d > 5.5) continue;
    const dmg = 85 * (1 - d / 5.5) + 10;
    damageAgent(victim, playerAgent, dmg, false);
  }
}

// ---------- Spike plant / defuse ----------
function siteAt(pos) {
  for (const site of Object.values(map.sites)) {
    if (Math.abs(pos.x - site.center.x) <= site.half.x + 0.5 && Math.abs(pos.z - site.center.z) <= site.half.z + 0.5) {
      return site;
    }
  }
  return null;
}

let spikeMesh = null;
function showSpike(site) {
  if (!spikeMesh) {
    spikeMesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.35), new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.4 }));
    body.position.y = 0.25;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xe5484d }));
    light.position.y = 0.58;
    spikeMesh.add(body, light);
    spikeMesh.userData.light = light;
    scene.add(spikeMesh);
  }
  spikeMesh.position.set(site.center.x, 0, site.center.z);
  spikeMesh.visible = true;
}

function plantSpike(site) {
  state.phase = PHASE.PLANTED;
  state.plantedSite = site.name;
  state.plantTimer = state.plantTime;
  economy.earn(REWARDS.plant);
  hud.setMoney(economy.money);
  hud.setBomb(`SPIKE PLANTED — SITE ${site.name}`, 'bomb-planted');
  hud.feedLine(`Spike planted at Site ${site.name}`, true);
  audio.plant();
  showSpike(site);
}

function stepObjective(dt) {
  // Player planting (hold E inside a site while carrying the spike).
  const planting = state.phase === PHASE.LIVE && spikeCarrier === 'player' && player.state.alive
    && input.state.keys.has('KeyE') && siteAt(player.state.position);
  if (planting) {
    plantProgress += dt;
    hud.showChannel('PLANTING SPIKE', plantProgress / 3);
    if (plantProgress >= 3) {
      plantProgress = 0;
      hud.hideChannel();
      plantSpike(siteAt(player.state.position));
    }
  } else {
    plantProgress = Math.max(0, plantProgress - dt * 2);
    if (!planting) hud.hideChannel();
  }

  // Bot channels (plant by an ally carrier, defuse by a defender).
  for (const agent of bots.agents) {
    if (!agent.alive || !agent.channel) {
      agent.channelProgress = 0;
      continue;
    }
    agent.channelProgress = (agent.channelProgress ?? 0) + dt;
    if (agent.channel.kind === 'plant' && agent.channelProgress >= 3) {
      agent.channelProgress = 0;
      plantSpike(map.sites[agent.site]);
    } else if (agent.channel.kind === 'defuse' && agent.channelProgress >= 5) {
      agent.channelProgress = 0;
      endRound('ember', 'Spike defused');
    }
  }

  // Planted spike beeping + detonation.
  if (state.phase === PHASE.PLANTED) {
    state.plantTimer -= dt;
    defuseBeep -= dt;
    if (defuseBeep <= 0) {
      defuseBeep = state.plantTimer < 10 ? 0.5 : 1.0;
      audio.beep(state.plantTimer < 10);
      if (spikeMesh) spikeMesh.userData.light.material.color.setHex(state.plantTimer < 10 ? 0xffffff : 0xe5484d);
    }
    if (state.plantTimer <= 0) {
      const site = map.sites[state.plantedSite];
      fx.explosion(new THREE.Vector3(site.center.x, 0.5, site.center.z));
      audio.explosion();
      if (spikeMesh) spikeMesh.visible = false;
      endRound('vanguard', 'Spike detonated');
    }
  }
}

// ---------- Buy menu ----------
function buyItem(item) {
  if (state.phase !== PHASE.BUY) return;
  if (!economy.spend(item.price)) {
    audio.denied();
    return;
  }
  audio.buy();
  if (item.id === 'grenade') {
    grenades += 1;
    hud.setGrenades(grenades);
  } else if (item.id === 'armor') {
    playerArmor = 100;
    hud.setHealth(player.state.health, playerArmor);
  } else {
    weapons.primary = createWeapon(item.id);
    currentWeapon = weapons.primary;
    hud.setWeapon(currentWeapon.def.name);
    hud.setAmmo(currentWeapon.mag, currentWeapon.reserve, false);
  }
  hud.setMoney(economy.money);
  hud.showBuy(economy.money);
}

// ---------- Fixed step ----------
function step(dt) {
  state.elapsed += dt;
  stepCount += 1;
  map.step(dt);
  fx.step(dt);

  // Before the player clicks in, the yard waits: no timers, no bot movement.
  if (!started) return;

  // Phase timers.
  if (state.phase === PHASE.BUY) {
    state.roundTime -= dt;
    if (state.roundTime <= 0) {
      state.phase = PHASE.LIVE;
      state.roundTime = state.roundLength;
      hud.hideBuy();
      buyOpen = false;
      hud.showHelp('Plant the spike at A or B — or eliminate the Ember crew.');
      if (!input.state.locked) hud.setOverlay('paused');
    }
  } else if (state.phase === PHASE.LIVE) {
    state.roundTime -= dt;
    if (state.roundTime <= 0) endRound('ember', 'Time expired — spike never planted');
  }

  // Player.
  if (state.phase !== PHASE.MATCH_END && started) {
    player.step(dt, input.state.keys);
  }
  currentWeapon.step(dt);

  // Bots.
  bots.step(dt, botWorld, state.elapsed);

  // Objective + grenades.
  if (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED) stepObjective(dt);
  stepGrenades(dt);

  // Footsteps.
  const speed = player.groundSpeed();
  if (speed > 1 && player.state.onGround) {
    stepDistance += speed * dt;
    if (stepDistance > 2.4) {
      stepDistance = 0;
      audio.step();
    }
  }

  // Sync the player's hitboxes with the body.
  const eyeY = player.state.position.y + player.state.eye;
  playerBodyBox.position.set(player.state.position.x, player.state.position.y + 0.85, player.state.position.z);
  playerHeadBox.position.set(player.state.position.x, eyeY - 0.1, player.state.position.z);
  updateAliveHud();
}

function syncCamera() {
  const p = player.state;
  camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
  camera.rotation.set(p.pitch + p.recoilPitch, p.yaw + p.recoilYaw, 0, 'YXZ');
}

// ---------- Frame ----------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (started && input.state.locked) player.look(look.x, look.y);

    // Edge-triggered keys.
    if (started) {
      if (input.state.keys.has('KeyR')) {
        if (currentWeapon.startReload()) audio.reload();
      }
      if (input.state.keys.has('KeyB') && state.phase === PHASE.BUY) {
        buyOpen = !buyOpen;
        if (buyOpen) { hud.showBuy(economy.money); if (document.pointerLockElement) document.exitPointerLock(); }
        else { hud.hideBuy(); input.requestLock(); }
        input.state.keys.delete('KeyB');
      }
      if (input.state.keys.has('Digit1') && weapons.primary) {
        currentWeapon = weapons.primary;
        hud.setWeapon(currentWeapon.def.name);
        hud.setAmmo(currentWeapon.mag, currentWeapon.reserve, false);
        input.state.keys.delete('Digit1');
      }
      if (input.state.keys.has('Digit2')) {
        currentWeapon = weapons.pistol;
        hud.setWeapon(currentWeapon.def.name);
        hud.setAmmo(currentWeapon.mag, currentWeapon.reserve, false);
        input.state.keys.delete('Digit2');
      }
      if (input.state.keys.has('KeyG')) {
        throwGrenade();
        input.state.keys.delete('KeyG');
      }
      if (input.state.keys.has('KeyM')) {
        audio.toggleMute();
        input.state.keys.delete('KeyM');
      }
      if (input.state.firing && input.state.locked && player.state.alive
        && (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED)) {
        playerShoot();
      }
    }

    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
  updateHudFrame();
}

function updateHudFrame() {
  const p = player.state;
  hud.setHealth(p.health, playerArmor);
  if (state.phase === PHASE.BUY) hud.setTimer(state.roundTime, state.roundTime < 5);
  else if (state.phase === PHASE.LIVE) hud.setTimer(state.roundTime, state.roundTime < 10);
  else if (state.phase === PHASE.PLANTED) hud.setTimer(state.plantTimer, state.plantTimer < 10);
  else hud.setTimer(0, false);
  hud.setCrosshairSpread(4 + player.groundSpeed() * 1.6 + currentWeapon.bloom * 220);
  hud.setAmmo(currentWeapon.mag, currentWeapon.reserve, currentWeapon.reloading > 0);
  if (state.phase === PHASE.LIVE && spikeCarrier === 'player' && player.state.alive) {
    const site = siteAt(player.state.position);
    if (site) hud.showPrompt(`HOLD E — PLANT SPIKE AT SITE ${site.name}`);
    else hud.hidePrompt();
  } else if (state.phase === PHASE.PLANTED) {
    hud.showPrompt(`DEFEND THE SPIKE — SITE ${state.plantedSite}`);
  } else {
    hud.hidePrompt();
  }
}

// ---------- Overlay / lock ----------
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
  } else if (state.phase === PHASE.MATCH_END || state.phase === PHASE.ROUND_END) {
    // The round/match overlay is already up.
  } else if (!started) {
    hud.setOverlay('start');
  } else if (buyOpen) {
    // Buying with the menu open: leave the screen clear, no pause overlay.
  } else {
    hud.setOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (state.phase === PHASE.MATCH_END) {
    // Full reset.
    state.round = 1;
    state.roundWins.vanguard = 0;
    state.roundWins.ember = 0;
    state.kills.player = 0;
    state.deaths.player = 0;
    economy.reset();
    weapons.primary = null;
    currentWeapon = weapons.pistol;
    startRound();
  } else if (state.phase === PHASE.ROUND_END) {
    // Skip the wait: jump straight into the next round.
    state.round += 1;
    startRound();
  }
  input.requestLock();
});

// Buy-menu number keys (buy phase only).
window.addEventListener('keydown', (event) => {
  if (shot || !buyOpen || state.phase !== PHASE.BUY) return;
  const item = BUY_ITEMS.find((b) => b.key === event.code.replace('Digit', ''));
  if (item) buyItem(item);
  if (event.code === 'Escape') {
    buyOpen = false;
    hud.hideBuy();
    input.requestLock();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Deterministic screenshot staging ----------
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    updateHudFrame();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function aimAt(point) {
  const p = player.state;
  const dx = point.x - p.position.x;
  const dy = point.y - (p.position.y + p.eye);
  const dz = point.z - p.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function runShot(name) {
  started = true;
  hud.hideOverlay();
  hud.hideBuy();
  buyOpen = false;
  if (name === 'start') {
    player.state.position.set(0, 0, 13.5);
    player.state.yaw = 0;
    player.state.pitch = 0.02;
    settle(20);
    hud.setOverlay('start');
    paintTwiceThenReady();
    return;
  }
  if (name === 'buy') {
    player.state.position.set(0, 0, 13.5);
    player.state.yaw = 0;
    settle(10);
    economy.money = 4200;
    hud.setMoney(4200);
    hud.showBuy(4200);
    buyOpen = true;
    paintTwiceThenReady();
    return;
  }
  // Live play scenes.
  state.phase = PHASE.LIVE;
  state.roundTime = 87;
  settle(30);
  if (name === 'play') {
    // Mid-yard firefight: two Ember bots ahead, one ally beside the player.
    const foe = bots.agents.find((a) => a.id === 'foe-0');
    const foe2 = bots.agents.find((a) => a.id === 'foe-2');
    foe.position.set(-2.5, 0, -2);
    foe.yaw = 0;
    foe2.position.set(4, 0, -6);
    foe2.yaw = 0.4;
    player.state.position.set(0, 0, 8);
    settle(12);
    aimAt(new THREE.Vector3(-2.5, 1.4, -2));
    playerShoot();
    settle(6);
    aimAt(new THREE.Vector3(1, 1.4, -4));
    paintTwiceThenReady();
    return;
  }
  if (name === 'plant') {
    const site = map.sites.A;
    player.state.position.set(-12, 0, -5);
    settle(10);
    plantSpike(site);
    const foe = bots.agents.find((a) => a.id === 'foe-1');
    foe.position.set(-14.5, 0, -12.5);
    foe.yaw = -2.8;
    settle(20);
    aimAt(new THREE.Vector3(-17, 0.5, -9));
    paintTwiceThenReady();
    return;
  }
  paintTwiceThenReady();
}

// Debug handle for automated validation (not part of the game UI).
window.__game = {
  state, player, bots, economy, map,
  get currentWeapon() { return currentWeapon; },
  get spikeCarrier() { return spikeCarrier; },
  get started() { return started; },
  get plantProgress() { return plantProgress; },
  get grenades() { return grenades; },
  startRound, endRound, plantSpike, damageAgent,
  get bulletTargets() { return bulletTargets; },
  get camera() { return camera; },
  shoot: playerShoot,
  buy: buyItem,
  // Deterministic sim control: run N fixed steps at once, and sync the camera
  // to the player's aim immediately (no frame-timing dependence).
  settle(steps) {
    for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
  },
  syncCamera,
  // Recompute every world matrix now (a teleported bot's matrix is stale
  // until the next render, and raycasts read the matrices).
  refresh() {
    scene.updateMatrixWorld(true);
  },
};

// ---------- Boot ----------
startRound();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
