// Bots: waypoint navigation, line-of-sight perception, burst fire with spread,
// hearing (gunfire pulls nearby bots), and the objective jobs — holding a site,
// planting the spike, defusing it. Allies and enemies share this brain; only their
// orders differ.
import * as THREE from 'three';
import { findPath } from './state.js';
import { WEAPONS, fireHitscan } from './weapons.js';

const BOT_SPEED = 3.4;
const BOT_PUSH_SPEED = 4.3;
const BOT_RADIUS = 0.38;
const BOT_HEIGHT = 1.72;
const SIGHT_RANGE = 46;
const SIGHT_FOV = 1.9; // radians of half-angle
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.65;

const ALLY_NAMES = ['Rook', 'Sable'];
const FOE_NAMES = ['Ash', 'Cinder', 'Flint', 'Onyx'];
const FOE_WEAPON = ['rifle', 'rifle', 'smg', 'rifle'];
const ALLY_WEAPON = ['rifle', 'smg'];

function botModel(teamColor) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.85 });
  const vest = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6, metalness: 0.2 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.34), suit);
  body.position.y = 1.02;
  body.castShadow = true;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.4, 0.38), vest);
  chest.position.y = 1.14;
  chest.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin);
  head.position.y = 1.62;
  head.castShadow = true;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.38), dark);
  helmet.position.y = 1.8;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.05), new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 0.9 }));
  visor.position.set(0, 1.64, -0.18);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), dark);
  gun.position.set(0.18, 1.28, -0.42);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), dark);
  legL.position.set(-0.15, 0.31, 0);
  const legR = legL.clone();
  legR.position.x = 0.15;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.14), suit);
  armL.position.set(-0.34, 1.15, 0.15);
  const armR = armL.clone();
  armR.position.x = 0.34;

  group.add(body, chest, head, helmet, visor, gun, legL, legR, armL, armR);
  body.userData.agentPart = 'body';
  head.userData.agentPart = 'head';
  return { group, body, head, legL, legR, gun, mats: { suit, vest } };
}

export function createBots(scene, map) {
  const agents = [];
  const hitMeshes = [];

  function makeAgent(id, name, team, weaponId, spawn, site) {
    const color = team === 'vanguard' ? 0xf0a830 : 0xe5484d;
    const model = botModel(color);
    model.group.position.copy(spawn);
    scene.add(model.group);
    const agent = {
      id, name, team, site,
      group: model.group,
      bodyMesh: model.body,
      headMesh: model.head,
      legL: model.legL, legR: model.legR,
      gun: model.gun,
      flashMat: model.mats.vest,
      position: model.group.position,
      yaw: 0,
      health: 100,
      armor: 0,
      alive: true,
      weapon: WEAPONS[weaponId],
      mag: WEAPONS[weaponId].mag,
      reserve: WEAPONS[weaponId].reserve,
      // AI state
      mode: 'push',
      path: [],
      pathTarget: -1,
      patrolIndex: 0,
      target: null,
      lastSeenPos: new THREE.Vector3(),
      lastSeenTime: -99,
      reactUntil: 0,
      burstLeft: 0,
      shotTimer: 0,
      strafeDir: 1,
      strafeTimer: 0,
      perceiveTimer: Math.random() * 0.15,
      channel: null, // { kind: 'plant'|'defuse', progress, needed }
      heardPos: null,
      heardTime: -99,
      walkPhase: 0,
      moving: false,
      fallT: 0,
      isPlayer: false,
    };
    model.body.userData.agent = agent;
    model.head.userData.agent = agent;
    hitMeshes.push(model.body, model.head);
    agents.push(agent);
    return agent;
  }

  function spawnAll(round) {
    // Clear old groups.
    for (const a of agents) scene.remove(a.group);
    agents.length = 0;
    hitMeshes.length = 0;
    const vSpawns = map.spawns.vanguard;
    const eSpawns = map.spawns.ember;
    // Allies: one pushes A, one pushes B.
    makeAgent('ally-0', ALLY_NAMES[0], 'vanguard', ALLY_WEAPON[0], vSpawns[0], 'A');
    makeAgent('ally-1', ALLY_NAMES[1], 'vanguard', ALLY_WEAPON[1], vSpawns[2], 'B');
    // Defenders: two hold A, two hold B.
    makeAgent('foe-0', FOE_NAMES[0], 'ember', FOE_WEAPON[0], eSpawns[0], 'A');
    makeAgent('foe-1', FOE_NAMES[1], 'ember', FOE_WEAPON[1], eSpawns[1], 'A');
    makeAgent('foe-2', FOE_NAMES[2], 'ember', FOE_WEAPON[2], eSpawns[2], 'B');
    makeAgent('foe-3', FOE_NAMES[3], 'ember', FOE_WEAPON[3], eSpawns[3], 'B');
    void round;
  }

  function nearestWaypointId(x, z) {
    return map.nearestWaypoint(x, z);
  }

  function setDestination(agent, waypointId) {
    const from = nearestWaypointId(agent.position.x, agent.position.z);
    agent.path = findPath(map.waypoints, from, waypointId);
    agent.pathTarget = waypointId;
  }

  function siteWaypoint(site) {
    return site === 'A' ? 12 : 13;
  }

  // Circle-vs-box slide in the XZ plane, shared by every bot move.
  function moveAgent(agent, dx, dz, dt) {
    const tryMove = (axis, delta) => {
      if (delta === 0) return true;
      agent.position[axis] += delta;
      for (const box of map.colliders) {
        if (agent.position.y + BOT_HEIGHT <= box.min.y || agent.position.y >= box.max.y) continue;
        const cx = Math.max(box.min.x, Math.min(agent.position.x, box.max.x));
        const cz = Math.max(box.min.z, Math.min(agent.position.z, box.max.z));
        const ddx = agent.position.x - cx;
        const ddz = agent.position.z - cz;
        if (ddx * ddx + ddz * ddz < BOT_RADIUS * BOT_RADIUS) {
          agent.position[axis] -= delta;
          return false;
        }
      }
      return true;
    };
    tryMove('x', dx * dt);
    tryMove('z', dz * dt);
  }

  function canSee(agent, targetPos, targetEyeY, world) {
    const eye = new THREE.Vector3(agent.position.x, agent.position.y + 1.55, agent.position.z);
    const to = new THREE.Vector3(targetPos.x, targetEyeY, targetPos.z);
    const dir = to.clone().sub(eye);
    const dist = dir.length();
    if (dist > SIGHT_RANGE) return false;
    dir.normalize();
    // Field of view: bots notice what is roughly in front of them, or very close.
    const forward = new THREE.Vector3(-Math.sin(agent.yaw), 0, -Math.cos(agent.yaw));
    const dot = forward.x * dir.x + forward.z * dir.z;
    if (dist > 6 && dot < Math.cos(SIGHT_FOV)) return false;
    world.raycaster.set(eye, dir);
    world.raycaster.far = dist;
    const hits = world.raycaster.intersectObjects(world.shootables, false);
    world.raycaster.far = 120;
    return hits.length === 0;
  }

  function perceive(agent, world, time) {
    agent.perceiveTimer -= 1 / 60;
    if (agent.perceiveTimer > 0) return;
    agent.perceiveTimer = 0.15 + Math.random() * 0.05;
    let best = null;
    let bestDist = Infinity;
    const enemies = world.enemiesOf(agent);
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const eyeY = enemy.isPlayer ? enemy.position.y + enemy.eye : enemy.position.y + 1.4;
      const dx = enemy.position.x - agent.position.x;
      const dz = enemy.position.z - agent.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= bestDist) continue;
      if (canSee(agent, enemy.position, eyeY, world)) {
        best = enemy;
        bestDist = dist;
      }
    }
    if (best) {
      if (agent.target !== best) {
        agent.reactUntil = time + REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN);
      }
      agent.target = best;
      agent.lastSeenPos.copy(best.position);
      agent.lastSeenTime = time;
    } else if (agent.target && time - agent.lastSeenTime > 1.4) {
      agent.target = null;
    }
  }

  function faceToward(agent, x, z, dt, rate = 6) {
    const want = Math.atan2(-(x - agent.position.x), -(z - agent.position.z));
    let diff = want - agent.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    agent.yaw += THREE.MathUtils.clamp(diff, -rate * dt, rate * dt);
  }

  function followPath(agent, dt, speed) {
    if (agent.path.length === 0) return true;
    const wp = map.waypoints[agent.path[0]];
    const dx = wp.x - agent.position.x;
    const dz = wp.z - agent.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      agent.path.shift();
      return agent.path.length === 0;
    }
    const vx = (dx / dist) * speed;
    const vz = (dz / dist) * speed;
    moveAgent(agent, vx, vz, dt);
    faceToward(agent, wp.x, wp.z, dt, 5);
    agent.moving = true;
    return false;
  }

  function shootAt(agent, world, dt) {
    if (agent.shotTimer > 0) {
      agent.shotTimer -= dt;
      return;
    }
    if (agent.burstLeft <= 0) {
      agent.burstLeft = 2 + Math.floor(Math.random() * 3);
      agent.shotTimer = 0.45 + Math.random() * 0.5;
      return;
    }
    agent.burstLeft -= 1;
    agent.shotTimer = 0.13;
    if (agent.mag <= 0) {
      agent.mag = agent.weapon.mag;
      agent.reserve -= agent.weapon.mag;
      agent.shotTimer = 1.6;
      return;
    }
    agent.mag -= 1;
    const target = agent.target;
    const eyeY = target.isPlayer ? target.position.y + target.eye - 0.15 : target.position.y + 1.25;
    const muzzle = new THREE.Vector3(
      agent.position.x + Math.sin(agent.yaw) * -0.2,
      agent.position.y + 1.32,
      agent.position.z + Math.cos(agent.yaw) * -0.2,
    );
    const dir = new THREE.Vector3(target.position.x - muzzle.x, eyeY - muzzle.y, target.position.z - muzzle.z).normalize();
    const dist = agent.position.distanceTo(target.position);
    const spread = 0.018 + dist * 0.0011 + (agent.moving ? 0.012 : 0);
    let hitAnything = false;
    world.raycaster.far = 120;
    fireHitscan(world.raycaster, world.bulletTargets, muzzle, dir, spread, 1, (hit) => {
      hitAnything = true;
      const end = hit.point;
      world.fx.tracer(muzzle, end, agent.team === 'ember' ? 0xff9a7a : 0xffd27a);
      if (hit.object.userData.agent) {
        const victim = hit.object.userData.agent;
        const isHead = hit.object.userData.agentPart === 'head';
        const dmg = agent.weapon.damage * (isHead ? agent.weapon.headMult : 1);
        world.damageAgent(victim, agent, dmg, isHead);
        world.fx.impact(hit.point, hit.face?.normal ?? new THREE.Vector3(0, 1, 0), 'flesh');
      } else {
        world.fx.impact(hit.point, hit.face?.normal ?? new THREE.Vector3(0, 1, 0), 'spark');
      }
    });
    if (!hitAnything) {
      const end = muzzle.clone().addScaledVector(dir, 45);
      world.fx.tracer(muzzle, end, agent.team === 'ember' ? 0xff9a7a : 0xffd27a);
    }
    world.audio.shot('enemy');
    agent.gunFlash = 0.05;
  }

  return {
    agents,
    hitMeshes,
    spawnAll,
    setDestination,
    siteWaypoint,
    hearNoise(agent, pos, time) {
      agent.heardPos = pos.clone();
      agent.heardTime = time;
    },
    step(dt, world, time) {
      for (const agent of agents) {
        if (!agent.alive) {
          // Fall-over death animation, then rest.
          if (agent.fallT < 1) {
            agent.fallT = Math.min(1, agent.fallT + dt * 2.4);
            agent.group.rotation.x = -Math.PI / 2 * agent.fallT * 0.9;
            agent.group.position.y = agent.position.y + 0.15 * agent.fallT;
          }
          continue;
        }
        if (agent.target && !agent.target.alive) agent.target = null;
        perceive(agent, world, time);
        const planted = world.state.phase === 'planted';
        const spikeSite = world.state.plantedSite;
        const isCarrier = world.spikeCarrier === agent;

        // --- Decide mode ---
        let mode = agent.mode;
        if (agent.target) mode = 'engage';
        else if (agent.team === 'ember' && planted && spikeSite) mode = 'defuse';
        else if (isCarrier) mode = 'plant';
        else if (agent.team === 'vanguard' && planted && spikeSite) mode = 'defend';
        else if (agent.team === 'vanguard') mode = 'push';
        else mode = 'hold';
        agent.mode = mode;

        agent.moving = false;
        agent.channel = null;

        if (mode === 'engage' && agent.target) {
          const t = agent.target;
          faceToward(agent, t.position.x, t.position.z, dt, 7);
          const dist = agent.position.distanceTo(t.position);
          // Strafe and keep a fighting distance.
          agent.strafeTimer -= dt;
          if (agent.strafeTimer <= 0) {
            agent.strafeDir = Math.random() < 0.5 ? -1 : 1;
            agent.strafeTimer = 0.9 + Math.random() * 1.1;
          }
          const fx = -Math.sin(agent.yaw);
          const fz = -Math.cos(agent.yaw);
          let mx = 0;
          let mz = 0;
          if (dist > 20) { mx += fx; mz += fz; }
          else if (dist < 7) { mx -= fx; mz -= fz; }
          mx += -fz * agent.strafeDir * 0.7;
          mz += fx * agent.strafeDir * 0.7;
          const ml = Math.hypot(mx, mz) || 1;
          moveAgent(agent, (mx / ml) * BOT_SPEED * 0.8, (mz / ml) * BOT_SPEED * 0.8, dt);
          agent.moving = true;
          if (time >= agent.reactUntil) shootAt(agent, world, dt);
        } else if (mode === 'defuse') {
          const site = world.map.sites[spikeSite];
          const dSite = Math.hypot(site.center.x - agent.position.x, site.center.z - agent.position.z);
          if (dSite > 2.2) {
            if (agent.pathTarget !== siteWaypoint(spikeSite)) setDestination(agent, siteWaypoint(spikeSite));
            followPath(agent, dt, BOT_PUSH_SPEED);
          } else {
            faceToward(agent, site.center.x, site.center.z, dt);
            agent.channel = { kind: 'defuse', progress: agent.channelProgress ?? 0, needed: 5 };
          }
        } else if (mode === 'plant') {
          const site = world.map.sites[agent.site];
          const dSite = Math.hypot(site.center.x - agent.position.x, site.center.z - agent.position.z);
          if (dSite > 1.5) {
            if (agent.pathTarget !== siteWaypoint(agent.site)) setDestination(agent, siteWaypoint(agent.site));
            followPath(agent, dt, BOT_PUSH_SPEED);
          } else {
            agent.channel = { kind: 'plant', progress: agent.channelProgress ?? 0, needed: 3 };
          }
        } else if (mode === 'defend') {
          const site = world.map.sites[spikeSite];
          const dSite = Math.hypot(site.center.x - agent.position.x, site.center.z - agent.position.z);
          if (dSite > 6) {
            if (agent.pathTarget !== siteWaypoint(spikeSite)) setDestination(agent, siteWaypoint(spikeSite));
            followPath(agent, dt, BOT_SPEED);
          } else {
            // Hold a corner of the site, scanning.
            agent.yaw += Math.sin(time * 0.5 + agent.id.charCodeAt(5)) * dt * 0.4;
          }
        } else if (mode === 'push') {
          if (agent.pathTarget !== siteWaypoint(agent.site)) setDestination(agent, siteWaypoint(agent.site));
          const arrived = followPath(agent, dt, BOT_PUSH_SPEED);
          if (arrived) {
            // Reached the site: patrol its corners.
            agent.patrolIndex = (agent.patrolIndex + 1) % 2;
            const site = world.map.sites[agent.site];
            const corner = agent.patrolIndex === 0
              ? { x: site.center.x - 3, z: site.center.z + 2 }
              : { x: site.center.x + 3, z: site.center.z - 2 };
            const wp = map.nearestWaypoint(corner.x, corner.z);
            setDestination(agent, wp);
          }
        } else {
          // hold: patrol between the site and its approach waypoint.
          const holdWp = agent.site === 'A' ? [12, 14] : [13, 15];
          const goal = holdWp[agent.patrolIndex % holdWp.length];
          if (agent.pathTarget !== goal) setDestination(agent, goal);
          const arrived = followPath(agent, dt, BOT_SPEED);
          if (arrived) agent.patrolIndex += 1;
        }

        // Investigate heard gunfire when idle.
        if (!agent.target && agent.heardPos && time - agent.heardTime < 4 && (mode === 'hold' || mode === 'push')) {
          const d = Math.hypot(agent.heardPos.x - agent.position.x, agent.heardPos.z - agent.position.z);
          if (d > 3) {
            const wp = map.nearestWaypoint(agent.heardPos.x, agent.heardPos.z);
            if (agent.pathTarget !== wp) setDestination(agent, wp);
            followPath(agent, dt, BOT_PUSH_SPEED);
          }
        }

        // Walk-cycle animation.
        if (agent.moving) {
          agent.walkPhase += dt * 11;
          const swing = Math.sin(agent.walkPhase) * 0.45;
          agent.legL.rotation.x = swing;
          agent.legR.rotation.x = -swing;
        } else {
          agent.legL.rotation.x *= 0.8;
          agent.legR.rotation.x *= 0.8;
        }
        agent.group.rotation.y = agent.yaw;
        agent.group.position.y = agent.position.y;
      }
    },
  };
}
