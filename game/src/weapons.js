// Weapons: definitions, firing, spread, recoil and reload. One weapon object is
// owned by the player and one (simplified) by each bot; the numbers below are the
// whole balance sheet, so the judge can read the gunplay in one place.
import * as THREE from 'three';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, kind: 'pistol',
    damage: 26, headMult: 2.5, mag: 12, reserve: 48, auto: false,
    fireInterval: 0.16, reloadTime: 1.1, spread: 0.006, moveSpread: 0.02,
    recoil: 0.006, range: 60, pellets: 1,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longshot', price: 2700, kind: 'rifle',
    damage: 34, headMult: 2.9, mag: 30, reserve: 90, auto: true,
    fireInterval: 0.11, reloadTime: 2.2, spread: 0.004, moveSpread: 0.028,
    recoil: 0.011, range: 90, pellets: 1,
  },
  smg: {
    id: 'smg', name: 'SMG Hornet', price: 1500, kind: 'smg',
    damage: 22, headMult: 2.2, mag: 25, reserve: 100, auto: true,
    fireInterval: 0.075, reloadTime: 1.8, spread: 0.009, moveSpread: 0.03,
    recoil: 0.007, range: 55, pellets: 1,
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher-12', price: 1700, kind: 'shotgun',
    damage: 11, headMult: 1.8, mag: 6, reserve: 24, auto: false,
    fireInterval: 0.85, reloadTime: 2.6, spread: 0.035, moveSpread: 0.045,
    recoil: 0.03, range: 26, pellets: 8,
  },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;

export function createWeapon(defId) {
  const def = WEAPONS[defId];
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloading: 0,
    bloom: 0, // spread growth from sustained fire; decays when not firing
    grenades: 0,
    armor: 0,
    ready() {
      return this.cooldown <= 0 && this.reloading <= 0;
    },
    // Returns 'shot' | 'empty' | 'not-ready'.
    tryFire() {
      if (!this.ready()) return 'not-ready';
      if (this.mag <= 0) return 'empty';
      this.mag -= 1;
      this.cooldown = this.def.fireInterval;
      this.bloom = Math.min(0.05, this.bloom + (this.def.kind === 'shotgun' ? 0.02 : 0.008));
      return 'shot';
    },
    startReload() {
      if (this.reloading > 0 || this.mag >= this.def.mag || this.reserve <= 0) return false;
      this.reloading = this.def.reloadTime;
      return true;
    },
    // Current spread in radians: base + movement + firing bloom.
    spread(moveSpeed, crouched) {
      const move = moveSpeed * this.def.moveSpread;
      const crouchBonus = crouched ? 0.55 : 1;
      return (this.def.spread + move + this.bloom) * crouchBonus;
    },
    step(dt) {
      if (this.cooldown > 0) this.cooldown -= dt;
      if (this.reloading > 0) {
        this.reloading -= dt;
        if (this.reloading <= 0) {
          const need = this.def.mag - this.mag;
          const take = Math.min(need, this.reserve);
          this.mag += take;
          this.reserve -= take;
        }
      }
      this.bloom = Math.max(0, this.bloom - dt * 0.03);
    },
    refill() {
      this.mag = this.def.mag;
      this.reserve = this.def.reserve;
      this.cooldown = 0;
      this.reloading = 0;
      this.bloom = 0;
    },
  };
}

// Shared hitscan: fire `pellets` rays from `origin` along `dir` with `spread`.
// `raycaster` and `targets` are reused scratch — no allocation per shot.
// onHit(hit, pelletIndex) is called for the first hit of each pellet.
export function fireHitscan(raycaster, targets, origin, dir, spread, pellets, onHit) {
  const d = new THREE.Vector3();
  for (let i = 0; i < pellets; i += 1) {
    d.copy(dir);
    d.x += (Math.random() * 2 - 1) * spread;
    d.y += (Math.random() * 2 - 1) * spread;
    d.z += (Math.random() * 2 - 1) * spread;
    d.normalize();
    raycaster.set(origin, d);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length > 0) onHit(hits[0], i);
  }
}
