// Economy: round rewards and the buy menu. The player starts each match with $800;
// kills, plants and round results pay out, and the buy menu spends it between rounds.
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';

export const REWARDS = {
  kill: 300,
  plant: 300,
  roundWin: 3250,
  roundLoss: 1900,
};

export const BUY_ITEMS = [
  { key: '1', id: 'rifle', label: 'AR-77 Longshot', price: WEAPONS.rifle.price, desc: '30-round rifle · accurate, hard-hitting' },
  { key: '2', id: 'smg', label: 'SMG Hornet', price: WEAPONS.smg.price, desc: 'Fast close-range spray · 25 rounds' },
  { key: '3', id: 'shotgun', label: 'Breacher-12', price: WEAPONS.shotgun.price, desc: '8-pellet burst · devastating up close' },
  { key: '4', id: 'grenade', label: 'Frag Grenade', price: GRENADE_PRICE, desc: 'Press G to throw · 85 damage in 5 m' },
  { key: '5', id: 'armor', label: 'Kevlar Vest', price: ARMOR_PRICE, desc: 'Halves damage taken this round' },
];

export function createEconomy() {
  return {
    money: 800,
    canAfford(price) {
      return this.money >= price;
    },
    spend(price) {
      if (!this.canAfford(price)) return false;
      this.money -= price;
      return true;
    },
    earn(amount) {
      this.money += amount;
    },
    reset() {
      this.money = 800;
    },
  };
}
