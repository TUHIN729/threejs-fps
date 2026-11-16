// HUD: every DOM readout the player sees — health, armour, ammo, money, timer,
// round score, alive counts, kill feed, bomb status, prompts and the buy menu.
// Updates are cheap text/width writes; nothing here touches the simulation.
import { BUY_ITEMS } from './economy.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    health: $('health-value'), healthBar: $('health-bar'),
    armor: $('armor-value'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammoBox: $('ammo'),
    money: $('money-value'),
    timer: $('timer-value'),
    scoreV: $('score-vanguard'), scoreE: $('score-ember'),
    aliveV: $('alive-vanguard'), aliveE: $('alive-ember'),
    roundLabel: $('round-label'),
    feed: $('feed'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    damage: $('damage-flash'),
    prompt: $('prompt'), promptText: $('prompt-text'),
    channel: $('channel'), channelBar: $('channel-bar'), channelLabel: $('channel-label'),
    bomb: $('bomb-status'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'),
    buy: $('buy-menu'), buyMoney: $('buy-money'), buyItems: $('buy-items'),
    help: $('help-line'),
  };
  let hitTimer = 0;
  let damageTimer = 0;

  function setOverlay(kind, data = {}) {
    els.overlay.hidden = false;
    if (kind === 'start') {
      els.overlayTitle.textContent = 'EMBERLINE';
      els.overlayCopy.textContent = 'Foundry Yard — plant the spike at Site A or Site B, or wipe out the Ember crew. First to 5 rounds takes the match.';
      els.play.textContent = 'Click to play';
    } else if (kind === 'paused') {
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = 'Click to keep playing. Your round is waiting.';
      els.play.textContent = 'Resume';
    } else if (kind === 'round') {
      els.overlayTitle.textContent = data.title;
      els.overlayCopy.textContent = data.copy;
      els.play.textContent = 'Next round';
    } else if (kind === 'end') {
      els.overlayTitle.textContent = data.title;
      els.overlayCopy.textContent = data.copy;
      els.play.textContent = 'Play again';
    }
  }

  return {
    setHealth(hp, armor) {
      els.health.textContent = Math.max(0, Math.ceil(hp));
      els.healthBar.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      els.healthBar.classList.toggle('low', hp <= 30);
      els.armor.textContent = armor > 0 ? `+${armor}` : '—';
    },
    setAmmo(mag, reserve, reloading) {
      els.ammoMag.textContent = mag;
      els.ammoReserve.textContent = `/ ${reserve}${reloading ? ' · reloading' : ''}`;
      els.ammoBox.classList.toggle('empty', mag === 0);
    },
    setMoney(m) {
      els.money.textContent = `$${m}`;
    },
    setTimer(seconds, urgent) {
      const s = Math.max(0, Math.ceil(seconds));
      els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      els.timer.classList.toggle('urgent', urgent);
    },
    setScore(v, e) {
      els.scoreV.textContent = v;
      els.scoreE.textContent = e;
    },
    setAlive(v, e) {
      els.aliveV.textContent = v;
      els.aliveE.textContent = e;
    },
    setRound(n, max) {
      els.roundLabel.textContent = `ROUND ${n}/${max}`;
    },
    setWeapon(name) {
      $('weapon-name').textContent = name;
    },
    setGrenades(n) {
      $('grenade-count').textContent = n > 0 ? `GRENADES ${n} [G]` : 'NO GRENADES';
    },
    setCrosshairSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(kill) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 140);
    },
    damageFlash() {
      els.damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => els.damage.classList.remove('on'), 220);
    },
    showPrompt(text) {
      els.promptText.textContent = text;
      els.prompt.hidden = false;
    },
    hidePrompt() {
      els.prompt.hidden = true;
    },
    showChannel(label, progress) {
      els.channel.hidden = false;
      els.channelLabel.textContent = label;
      els.channelBar.style.width = `${Math.round(progress * 100)}%`;
    },
    hideChannel() {
      els.channel.hidden = true;
    },
    setBomb(text, kind) {
      els.bomb.textContent = text;
      els.bomb.className = kind ? `bomb-${kind}` : '';
    },
    feedLine(text, good) {
      const line = document.createElement('div');
      line.className = good ? 'feed-good' : 'feed-bad';
      line.textContent = text;
      els.feed.prepend(line);
      while (els.feed.children.length > 5) els.feed.removeChild(els.feed.lastChild);
    },
    showBuy(money) {
      els.buy.hidden = false;
      els.buyMoney.textContent = `$${money}`;
      els.buyItems.innerHTML = '';
      for (const item of BUY_ITEMS) {
        const row = document.createElement('div');
        row.className = 'buy-row';
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.label}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
        els.buyItems.appendChild(row);
      }
    },
    hideBuy() {
      els.buy.hidden = true;
    },
    showHelp(text) {
      els.help.textContent = text;
    },
    setOverlay,
    hideOverlay() {
      els.overlay.hidden = true;
    },
    onPlay(handler) {
      els.play.addEventListener('click', handler);
    },
  };
}
