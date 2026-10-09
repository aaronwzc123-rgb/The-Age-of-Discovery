export const ITEMS = {
  chart: { name: '随身海图', icon: '图', max: 1, protected: true },
  telescope: { name: '黄铜望远镜', icon: '镜', max: 1 },
  lantern: { name: '手提灯', icon: '灯', max: 1 },
  rope: { name: '麻绳卷', icon: '绳', max: 12 },
};
export const STORAGE_KEY = 'black-tide-voyage-v1';
export function createInventory() {
  const slots = Array(27).fill(null); slots[0] = { type: 'chart', count: 1 };
  const captain = Array(18).fill(null), hold = Array(18).fill(null);
  captain[0] = { type: 'lantern', count: 1 }; captain[1] = { type: 'rope', count: 3 };
  hold[0] = { type: 'rope', count: 6 };
  return { slots, selected: 0, stowed: true, cursor: null, source: null,
    containers: { captain, hold }, drops: [], nextDrop: 1, lanternOn: true };
}
export function equippedItem(game) {
  return game.inventory.stowed || game.climb ? null : game.inventory.slots[game.inventory.selected]?.type || null;
}
export function selectItem(game, index) {
  game.inventory.selected = (index + 9) % 9; game.inventory.stowed = false; game.world.scopeRaised = false;
}
export function addItem(slots, type, count = 1) {
  if (!ITEMS[type] || !Number.isInteger(count) || count < 1) return false;
  const capacity = slots.reduce((n, slot) => n + (!slot ? ITEMS[type].max : slot.type === type ? ITEMS[type].max - slot.count : 0), 0);
  if (capacity < count) return false;
  for (const slot of slots) if (slot?.type === type) {
    const moved = Math.min(count, ITEMS[type].max - slot.count); slot.count += moved; count -= moved;
  }
  for (let i = 0; count && i < slots.length; i++) if (!slots[i]) {
    const moved = Math.min(count, ITEMS[type].max); slots[i] = { type, count: moved }; count -= moved;
  }
  return true;
}
const areaSlots = (bag, area) => area === 'player' ? bag.slots : bag.containers[area];
export function moveSlot(game, area, index, { right = false, quick = false, container = null } = {}) {
  const bag = game.inventory, slots = areaSlots(bag, area);
  if (!slots || index < 0 || index >= slots.length) return false;
  const slot = slots[index];
  if (quick && slot && !bag.cursor) {
    const destination = area === 'player' ? bag.containers[container] : bag.slots;
    if (!destination || !addItem(destination, slot.type, slot.count)) return false;
    slots[index] = null; return true;
  }
  if (!bag.cursor) {
    if (!slot) return false;
    const count = right ? Math.ceil(slot.count / 2) : slot.count;
    bag.cursor = { type: slot.type, count }; bag.source = { area, index };
    slot.count -= count; if (!slot.count) slots[index] = null;
  } else if (!slot || slot.type === bag.cursor.type) {
    const count = Math.min(right ? 1 : bag.cursor.count, ITEMS[bag.cursor.type].max - (slot?.count || 0));
    if (!count) return false;
    slots[index] = { type: bag.cursor.type, count: (slot?.count || 0) + count };
    bag.cursor.count -= count; if (!bag.cursor.count) { bag.cursor = null; bag.source = null; }
  } else if (!right) {
    slots[index] = bag.cursor; bag.cursor = slot; bag.source = { area, index };
  } else return false;
  game.world.scopeRaised = false; return true;
}
export function returnCursor(game) {
  const bag = game.inventory;
  if (!bag.cursor) return true;
  const item = bag.cursor, source = bag.source, slots = source && areaSlots(bag, source.area);
  if (slots && !slots[source.index]) { slots[source.index] = item; bag.cursor = null; bag.source = null; return true; }
  for (const destination of [slots, bag.slots, ...Object.values(bag.containers)]) {
    if (destination && addItem(destination, item.type, item.count)) { bag.cursor = null; bag.source = null; return true; }
  }
  return false;
}
export function dropSelected(game, position, space = 'ship') {
  const bag = game.inventory, slot = bag.slots[bag.selected];
  if (!slot || ITEMS[slot.type].protected || bag.stowed || game.climb || ['helm', 'boat'].includes(game.mode)) return false;
  bag.drops.push({ id: `drop-${bag.nextDrop++}`, type: slot.type, position: [...position], space });
  if (!--slot.count) bag.slots[bag.selected] = null;
  game.world.scopeRaised = false; return true;
}
export function pickDrop(game, id) {
  const bag = game.inventory, index = bag.drops.findIndex(drop => drop.id === id);
  if (index < 0 || !addItem(bag.slots, bag.drops[index].type)) return false;
  bag.drops.splice(index, 1); return true;
}
export function inventoryTotals(game) {
  const bag = game.inventory, totals = {};
  const entries = [...bag.slots, ...Object.values(bag.containers).flat(), bag.cursor,
    ...bag.drops.map(drop => ({ type: drop.type, count: 1 }))];
  for (const slot of entries) if (slot) totals[slot.type] = (totals[slot.type] || 0) + slot.count;
  if (!game.world.hasTelescope) totals.telescope = (totals.telescope || 0) + 1;
  return totals;
}
export function saveVoyage(game, storage = globalThis.localStorage) {
  if (!storage || !returnCursor(game)) return false;
  const world = { ...game.world, scopeRaised: false };
  const snapshot = { version: 1, inventory: game.inventory, ship: game.ship, world,
    boat: game.boat, voyage: game.voyage, cellsOpen: game.cellsOpen };
  try { storage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); return true; } catch { return false; }
}
export function restoreVoyage(game, storage = globalThis.localStorage) {
  try {
    const text = storage?.getItem(STORAGE_KEY); if (!text) return false;
    const saved = JSON.parse(text), bag = saved.inventory;
    const record = value => value && typeof value === 'object' && !Array.isArray(value);
    const numbers = (value, keys) => record(value) && keys.every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e6);
    const flags = (value, keys) => record(value) && keys.every(key => typeof value[key] === 'boolean');
    const validSlots = (slots, size) => Array.isArray(slots) && slots.length === size && slots.every(slot => !slot ||
      (ITEMS[slot.type] && Number.isInteger(slot.count) && slot.count > 0 && slot.count <= ITEMS[slot.type].max));
    if (saved.version !== 1 || !validSlots(bag?.slots, 27) || !validSlots(bag?.containers?.captain, 18) ||
      !validSlots(bag?.containers?.hold, 18) || !Number.isInteger(bag.selected) || bag.selected < 0 || bag.selected > 8 ||
      !Array.isArray(bag.drops) || bag.drops.length > 11 || bag.drops.some(d => !record(d) || !/^drop-[1-9]\d*$/.test(d.id) || !ITEMS[d.type] || !Array.isArray(d.position) || d.position.length !== 3 || !d.position.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6) || !['ship', 'world'].includes(d.space)) ||
      !Number.isSafeInteger(bag.nextDrop) || bag.nextDrop < 1 || bag.drops.some(d => Number(d.id.slice(5)) >= bag.nextDrop) || bag.cursor ||
      typeof bag.stowed !== 'boolean' || typeof bag.lanternOn !== 'boolean' ||
      !numbers(saved.ship, ['x','z','heading','speed','throttle','anchorLift','anchorTarget','rudder']) ||
      ![saved.ship.anchorLift,saved.ship.anchorTarget].every(v => v >= 0 && v <= 1) ||
      !numbers(saved.boat, ['x','z','heading','speed','lowering']) || saved.boat.lowering < 0 || saved.boat.lowering > 1 || !flags(saved.boat,['deployed','lowerTarget']) ||
      !flags(saved.world,['hatchOpen','cargoOpen','cabinDoorOpen','boatRopesReleased','capstanBraked','hasTelescope','scopeRaised']) ||
      !['lower','hold','captain'].includes(saved.world.room) || !record(saved.world.lamps) || !Object.values(saved.world.lamps).every(v => typeof v === 'boolean') ||
      !Array.isArray(saved.world.sailsSet) || saved.world.sailsSet.length !== 11 || !saved.world.sailsSet.every(v => typeof v === 'boolean') ||
      [['cabinDoorAngle',-1.35,0],['hatchAngle',-1.42,0],['cargoOffset',0,1.9]].some(([key,min,max]) => key in saved.world && (!Number.isFinite(saved.world[key]) || saved.world[key] < min || saved.world[key] > max)) ||
      ('cellDoorAngles' in saved.world && (!Array.isArray(saved.world.cellDoorAngles) || saved.world.cellDoorAngles.length !== 4 || !saved.world.cellDoorAngles.every(v => Number.isFinite(v) && Math.abs(v) <= 1.42))) ||
      !numbers(saved.voyage,['distance']) || saved.voyage.distance < 0 || !flags(saved.voyage,['cabin','chart','anchor','sailed','moored']) ||
      !Array.isArray(saved.cellsOpen) || saved.cellsOpen.length !== 4 || !saved.cellsOpen.every(v => typeof v === 'boolean')) return false;
    const probe = { inventory: bag, world: saved.world }, totals = inventoryTotals(probe);
    if (totals.chart !== 1 || totals.telescope !== 1 || totals.lantern !== 1 || totals.rope !== 9 || new Set(bag.drops.map(d => d.id)).size !== bag.drops.length) return false;
    game.inventory = {...createInventory(), slots:bag.slots, containers:{captain:bag.containers.captain,hold:bag.containers.hold},
      selected:bag.selected, stowed:true, lanternOn:bag.lanternOn, drops:bag.drops, nextDrop:bag.nextDrop};
    const copyKnown = (destination, source) => { for (const key of Object.keys(destination)) if (key in source) destination[key] = source[key]; };
    copyKnown(game.ship,saved.ship);Object.assign(game.ship,{speed:0,throttle:0,rudder:0});
    copyKnown(game.world,saved.world);game.world.scopeRaised=false;
    copyKnown(game.boat,saved.boat);game.boat.speed=0;
    copyKnown(game.voyage,saved.voyage);game.cellsOpen=saved.cellsOpen;
    // Resume at the clear main-deck spawn, never halfway through a ladder/IK action.
    game.mode = 'deck'; game.climb = null; game.player.x = .6; game.player.z = .35; game.player.y = 2.4; game.player.vy = 0;
    return true;
  } catch { return false; }
}
