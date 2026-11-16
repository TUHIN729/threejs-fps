// The player: first-person movement with acceleration, friction, crouching, jumping
// and axis-separated AABB collision against the map's colliders. No rendering here —
// main.js copies this state onto the camera each frame.
import * as THREE from 'three';

const RADIUS = 0.35;
const HEIGHT_STAND = 1.7;
const HEIGHT_CROUCH = 1.15;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const WALK_SPEED = 4.6;
const CROUCH_SPEED = 2.2;
const SPRINT_SPEED = 6.2;
const ACCEL = 42;
const FRICTION = 11;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;

export function createPlayer(colliders, spawn) {
  const state = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    onGround: true,
    health: 100,
    alive: true,
    recoilPitch: 0,
    recoilYaw: 0,
  };

  // Move a box (half extents rx, height h) along one axis, stopping at colliders.
  function collideAxis(axis, delta) {
    if (delta === 0) return;
    state.position[axis] += delta;
    const h = state.crouched ? HEIGHT_CROUCH : HEIGHT_STAND;
    const min = new THREE.Vector3(
      state.position.x - RADIUS, state.position.y, state.position.z - RADIUS,
    );
    const max = new THREE.Vector3(
      state.position.x + RADIUS, state.position.y + h, state.position.z + RADIUS,
    );
    for (const box of colliders) {
      if (max.x <= box.min.x || min.x >= box.max.x) continue;
      if (max.y <= box.min.y || min.y >= box.max.y) continue;
      if (max.z <= box.min.z || min.z >= box.max.z) continue;
      if (axis === 'x') {
        state.position.x = delta > 0 ? box.min.x - RADIUS - 0.001 : box.max.x + RADIUS + 0.001;
      } else if (axis === 'z') {
        state.position.z = delta > 0 ? box.min.z - RADIUS - 0.001 : box.max.z + RADIUS + 0.001;
      } else if (axis === 'y') {
        if (delta > 0) state.position.y = box.min.y - h - 0.001;
        else { state.position.y = box.max.y; state.onGround = true; state.velocity.y = 0; }
      }
      min.set(state.position.x - RADIUS, state.position.y, state.position.z - RADIUS);
      max.set(state.position.x + RADIUS, state.position.y + h, state.position.z + RADIUS);
    }
  }

  return {
    state,
    look(dx, dy) {
      const sens = 0.0021;
      state.yaw -= dx * sens;
      state.pitch -= dy * sens;
      state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch));
    },
    addRecoil(pitch, yaw) {
      state.recoilPitch += pitch;
      state.recoilYaw += yaw;
    },
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
    reset(spawnPoint, yaw) {
      state.position.set(spawnPoint.x, 0, spawnPoint.z);
      state.velocity.set(0, 0, 0);
      state.yaw = yaw;
      state.pitch = 0;
      state.health = 100;
      state.alive = true;
      state.crouched = false;
      state.eye = EYE_STAND;
      state.recoilPitch = 0;
      state.recoilYaw = 0;
    },
    step(dt, keys) {
      if (!state.alive) return;
      const wantCrouch = keys.has('ControlLeft') || keys.has('KeyC');
      state.crouched = wantCrouch;
      const targetEye = wantCrouch ? EYE_CROUCH : EYE_STAND;
      state.eye += (targetEye - state.eye) * Math.min(1, dt * 12);

      // Wish direction from keys, rotated by yaw.
      const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      let wx = -sin * forward + cos * strafe;
      let wz = -cos * forward - sin * strafe;
      const len = Math.hypot(wx, wz);
      if (len > 0) { wx /= len; wz /= len; }

      const sprinting = keys.has('ShiftLeft') && forward > 0 && !wantCrouch;
      const maxSpeed = wantCrouch ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
      state.velocity.x += wx * ACCEL * dt;
      state.velocity.z += wz * ACCEL * dt;
      // Friction when no input, and clamp to max speed.
      if (len === 0) {
        const f = Math.max(0, 1 - FRICTION * dt);
        state.velocity.x *= f;
        state.velocity.z *= f;
      }
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      if (speed > maxSpeed) {
        state.velocity.x *= maxSpeed / speed;
        state.velocity.z *= maxSpeed / speed;
      }

      if (keys.has('Space') && state.onGround) {
        state.velocity.y = JUMP_SPEED;
        state.onGround = false;
      }
      state.velocity.y -= GRAVITY * dt;

      collideAxis('x', state.velocity.x * dt);
      collideAxis('z', state.velocity.z * dt);
      state.onGround = false;
      collideAxis('y', state.velocity.y * dt);
      if (state.position.y < 0) {
        state.position.y = 0;
        state.velocity.y = 0;
        state.onGround = true;
      }

      // Recoil recovery: the kick decays back toward zero.
      state.recoilPitch *= Math.max(0, 1 - dt * 7);
      state.recoilYaw *= Math.max(0, 1 - dt * 7);
    },
  };
}
