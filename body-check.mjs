import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildPirate } from './world.js';
import { createGame, PLAYER_HEIGHT, walkingHeight } from './game.js';
import { updatePirateBody, solveTwoBone, canReachHand } from './player-body.js';
import { CLIMB_PATHS, sampleClimbPath } from './climb-paths.js';
import { updateClimbContacts } from './player-controller.js';

const { pirate, rig } = buildPirate(), ship = new THREE.Group(), scene = new THREE.Scene();
scene.add(ship, pirate);
const game = createGame(); game.player.yaw = 0; game.player.grounded = true;
const bounds = new THREE.Box3().setFromObject(pirate);
assert(Math.abs(bounds.max.y - bounds.min.y - PLAYER_HEIGHT) < .04, 'Character retains 1.62 m scale');
pirate.position.set(game.player.x, game.player.y, game.player.z);
updatePirateBody({ game, ship, pirate, firstPerson: true });
assert(!rig.head.visible && pirate.visible, 'First person hides the head, retaining the body');
assert(!rig.torso.visible && !rig.outerwear.visible && rig.pelvis.visible, 'The owner sees trousers without self-occluding upper clothes');
for (const name of ['leftFoot', 'rightFoot']) assert(Math.abs(rig.chains[name].contact.getWorldPosition(new THREE.Vector3()).y - game.player.y) < .002, 'Soles sit on the floor');
const camera = new THREE.PerspectiveCamera(62, 16 / 9, .03, 400);
camera.position.copy(pirate.position); camera.position.y += 1.43; camera.rotation.set(0, Math.PI, 0, 'YXZ'); camera.updateMatrixWorld();
const handNdc = rig.chains.rightHand.contact.getWorldPosition(new THREE.Vector3()).project(camera);
assert(Math.abs(handNdc.x) < 1 && Math.abs(handNdc.y) < 1, 'Idle right hand is in the first-person frame');
camera.rotation.x = -1.13; camera.updateMatrixWorld();
for (const name of ['leftFoot', 'rightFoot']) {
  const footNdc = rig.chains[name].contact.getWorldPosition(new THREE.Vector3()).project(camera);
  assert(Math.abs(footNdc.x) < 1 && Math.abs(footNdc.y) < 1, 'Looking down shows both soles');
}
const visibleMeshes = []; pirate.traverseVisible(o => { if (o.isMesh) visibleMeshes.push(o); });
for (const name of ['leftFoot', 'rightFoot']) {
  const ankle = rig.chains[name].end;
  const toe = ankle.localToWorld(new THREE.Vector3(0, -.07, .18));
  const ray = new THREE.Raycaster(camera.position, toe.clone().sub(camera.position).normalize(), 0, camera.position.distanceTo(toe) + .02);
  const first = ray.intersectObjects(visibleMeshes, false)[0];
  assert(first && first.object.parent === ankle, 'Visible boots are not covered by the character own shirt or waist');
}
const chain = rig.chains.rightHand;
const l1 = chain.lower.position.length(), l2 = chain.end.position.length();
const excess = solveTwoBone(chain, new THREE.Vector3(0, 8, 0), new THREE.Vector3(1, 0, 0));
assert(excess > 6); assert.equal(chain.lower.position.length(), l1); assert.equal(chain.end.position.length(), l2);
assert(rig.chains.leftHand.upper.position.x > 0 && rig.chains.rightHand.upper.position.x < 0, 'Anatomical left agrees with camera left');

ship.position.set(9, .045, -7); ship.rotation.y = .73; ship.updateMatrixWorld(true);
const root = new THREE.Vector3(-4, 2.4, 1); pirate.position.copy(root).applyMatrix4(ship.matrixWorld);
game.player.yaw = .73;
game.climb = { contacts: {
  leftHand: [-3.77, 3.60, 1.32], rightHand: [-4.23, 3.60, 1.32],
  leftFoot: [-3.89, 2.54, 1.22], rightFoot: [-4.11, 2.54, 1.22], space: 'ship'
} };
const report = updatePirateBody({ game, ship, pirate, elapsed: 2, delta: 1 / 60 });
assert.equal(Object.keys(report.contacts).length, 4);
assert(report.maxContactError < .0001, 'All four contacts survive rotated/heaving ship transforms');
assert.equal(report.unreachable.length, 0);
const saved = Object.fromEntries(Object.entries(rig.chains).map(([name, c]) => [name, c.contact.getWorldPosition(new THREE.Vector3())]));
for (let i = 0; i < 60; i++) updatePirateBody({ game, ship, pirate, elapsed: 2 + i, delta: 1 / 60, paused: true });
for (const [name, c] of Object.entries(rig.chains)) assert(c.contact.getWorldPosition(new THREE.Vector3()).distanceTo(saved[name]) < .00001, 'Paused contacts do not drift');

game.climb = null; game.mode = 'boat';
updatePirateBody({ game, ship, pirate, elapsed: 3, delta: 1 / 60 });
assert.equal(pirate.scale.x, rig.baseScale, 'Sitting bends knees instead of shrinking the character');
assert(rig.body.position.y < -.3, 'Boat pose lowers the pelvis');
assert(rig.chains.leftFoot.lower.quaternion.angleTo(new THREE.Quaternion()) > .5, 'Sitting bends the knee');
ship.position.set(0, 0, 0); ship.rotation.y = 0; ship.updateMatrixWorld(true);
game.mode = 'helm'; game.player.yaw = Math.PI / 2;
const wheel = new THREE.Group(); wheel.position.set(-12, 5.60, 0); ship.add(wheel);
for (let i = 0; i <= 20; i++) {
  wheel.rotation.x = -.7 + i * .07; pirate.position.set(-12.46, 4.55, 0);
  const d = updatePirateBody({ game, ship, pirate, wheel, delta: 1 / 60 });
  assert(d.contacts.leftHand.error < .0001 && d.contacts.rightHand.error < .0001, 'Rim grip stays reachable throughout steering');
}
game.mode = 'deck'; game.player.yaw = Math.PI / 2; game.player.x = 0; game.player.z = 0; game.player.grounded = true;
for (let i = 0; i < 140; i++) {
  game.player.x += .025; game.player.y = walkingHeight(game.player.x, game.player.z, 2.4);
  pirate.position.set(game.player.x, game.player.y, game.player.z);
  const d = updatePirateBody({ game, ship, pirate, lookYaw: Math.PI / 2, gait: i * .025 * 3.4, gaitAmount: 1, delta: 1 / 60 });
  assert.equal(d.unreachable.filter(x => x.limb.endsWith('Foot')).length, 0, 'Walking strides do not overextend legs');
}
const rider = buildPirate().pirate, carrier = new THREE.Group(), ride = createGame(), planted = {};
ride.player.x = 0; ride.player.z = 0; ride.player.y = 2.4; ride.player.grounded = true;
for (let i = 0; i < 600; i++) {
  ride.ship.heading = i * .002; carrier.rotation.y = ride.ship.heading; carrier.position.set(i * .003, Math.sin(i * .01) * .045, 0); carrier.updateMatrixWorld(true);
  rider.position.set(0, 2.4, 0).applyMatrix4(carrier.matrixWorld);
  updatePirateBody({ game: ride, ship: carrier, pirate: rider, lookYaw: ride.ship.heading, delta: 1 / 60 });
  for (const name of ['leftFoot', 'rightFoot']) {
    const p = rider.rig.chains[name].contact.getWorldPosition(new THREE.Vector3()); carrier.worldToLocal(p);
    if (!i) planted[name] = p.clone(); else assert(p.distanceTo(planted[name]) < .001, 'Standing feet follow carrier rotation and heave without drift');
  }
}
game.mode = 'deck'; pirate.position.set(0, 2.4, 0); game.player.y = 2.4; game.player.yaw = 0;
for (const equipped of ['chart', 'telescope', 'lantern', 'rope']) {
  const d = updatePirateBody({ game, ship, pirate, equipped, delta: 1 / 60, actionTarget: { nearWall: true } });
  assert(rig.items[equipped].visible && d.nearWall);
  assert.equal(Object.values(rig.items).filter(x => x.visible).length, 1);
}
pirate.traverse(object => {
  if (!object.isMesh) return;
  for (const attribute of Object.values(object.geometry.attributes)) assert(attribute.array.every(Number.isFinite));
  assert.equal(object.material.depthTest, true, 'Hands/items use environment depth');
});

// Action selection and animation must use the same shoulder, socket and bone lengths.
const actor = buildPirate().pirate, actionGame = createGame(), actionShip = new THREE.Group();
actor.position.set(0, 2.4, 0); actionGame.player.yaw = 0;
updatePirateBody({ game: actionGame, ship: actionShip, pirate: actor });
const palmTarget = new THREE.Vector3(-.24, 3.40, .35);
assert(canReachHand(actor, palmTarget, { hand: 'rightHand' }).reachable, 'Nearby target is reachable by the real hand');
assert(!canReachHand(actor, [0, 3.5, 1.4]).reachable, 'A long interaction radius cannot extend the arm');
const standingShoulder = canReachHand(actor, palmTarget, { hand: 'rightHand' }).shoulder[1];
actionGame.player.crouched = true;
updatePirateBody({ game: actionGame, ship: actionShip, pirate: actor });
const crouchedShoulder = canReachHand(actor, [0, 2.9, .2], { hand: 'rightHand' }).shoulder[1];
assert(Math.abs(standingShoulder - crouchedShoulder - .5) < .0001, 'Crouch reach follows the lowered shoulder');
actionGame.player.crouched = false;
updatePirateBody({ game: actionGame, ship: actionShip, pirate: actor });
actionGame.handAction = { time: .175, hand: 'rightHand' };
updatePirateBody({ game: actionGame, ship: actionShip, pirate: actor, actionTarget: { point: palmTarget, hand: 'rightHand' } });
assert(actor.rig.chains.rightHand.contact.getWorldPosition(new THREE.Vector3()).distanceTo(palmTarget) < .0001, 'The selected action hand reaches the authored contact at the animation peak');
actionGame.handAction.time = 0;
const continuousTarget = palmTarget.clone().add(new THREE.Vector3(.03, -.04, .02));
updatePirateBody({ game: actionGame, ship: actionShip, pirate: actor, actionTarget: { point: continuousTarget, hand: 'rightHand', continuous: true } });
assert(actor.rig.chains.rightHand.contact.getWorldPosition(new THREE.Vector3()).distanceTo(continuousTarget) < .0001, 'A continuous action keeps the real palm at the updated contact after the one-shot timer ends');
for (const name of ['leftHand', 'rightHand']) {
  assert.equal(actor.rig.chains[name].fingers.length, 0, 'The requested block hands omit finger geometry');
  const palmMesh = actor.rig.chains[name].end.children.find(o => o.isMesh && o.material === actor.rig.materials.skin);
  assert(palmMesh, 'Each hand retains its own skin mesh');
  palmMesh.geometry.computeBoundingBox();
  const size = palmMesh.geometry.boundingBox.getSize(new THREE.Vector3());
  assert(['x', 'y', 'z'].every(axis => Math.abs(size[axis] - .12) < .00001), 'Both palms remain simple cubes after batching');
}
const helmPoint = new THREE.Vector3(-12.02, 5.60 + .47 * Math.cos(1.22), .47 * Math.sin(1.22));
assert(canReachHand(actor, helmPoint, { position: [-12.46, 4.55, 0], yaw: Math.PI / 2 }).reachable, 'Swept helm approach uses a genuinely reachable candidate pose');

// Sample the real controller contacts in both directions, with a rotating/heaving carrier.
// This catches stale rung targets that synthetic IK contacts cannot expose.
const paths = [];
for (const path of CLIMB_PATHS) for (const direction of [1, -1]) for (const movingShip of [false, true]) {
  const g = createGame(), vessel = new THREE.Group(), climber = buildPirate().pirate;
  g.climb = { path, ladder: path, progress: direction === 1 ? 0 : 1, gait: 0, phase: 'climb' };
  const count = Math.ceil(path.length / .0125), previous = {};
  const result = { path: path.id, direction, movingShip, samples: count + 1, maxContactError: 0, maxSupportError: 0, maxSupportJump: 0, missingContacts: [], missingSupport: [], pauseDrift: 0 };
  for (let i = 0; i <= count; i++) {
    const t = i / count, progress = direction === 1 ? t : 1 - t, point = sampleClimbPath(path, progress);
    const heading = movingShip ? .37 + i * .003 : 0;
    vessel.rotation.y = heading; vessel.position.set(movingShip ? 9 + i * .002 : 0, movingShip ? Math.sin(i * .04) * .045 : 0, movingShip ? -7 + i * .001 : 0); vessel.updateMatrixWorld(true);
    g.ship.heading = heading;
    Object.assign(g.player, { x: point[0], y: point[1], z: point[2], yaw: Math.atan2(path.face[0], path.face[2]) + (path.space === 'ship' ? heading : 0), grounded: false });
    g.climb.progress = progress; g.climb.gait = t * path.length;
    climber.position.fromArray(point); if (path.space === 'ship') climber.position.applyMatrix4(vessel.matrixWorld);
    updateClimbContacts(g);
    const d = updatePirateBody({ game: g, ship: vessel, pirate: climber, delta: 1 / 60 });
    result.maxContactError = Math.max(result.maxContactError, d.maxContactError);
    result.maxSupportError = Math.max(result.maxSupportError, d.maxSupportError);
    const names = Object.keys(d.contacts), support = names.filter(name => d.contacts[name].phase === 'support');
    if (names.length < 4) result.missingContacts.push({ progress, names });
    if (!support.some(name => name.endsWith('Hand')) || !support.some(name => name.endsWith('Foot'))) result.missingSupport.push({ progress, support });
    for (const name of names) {
      const p = g.climb.contacts[name], phase = d.contacts[name].phase, old = previous[name];
      if (phase === 'support' && old?.phase === 'support') {
        const jump = Math.hypot(...p.map((v, j) => v - old.point[j]));
        if (jump > result.maxSupportJump) { result.maxSupportJump = jump; result.worstSupportJump = { progress, limb: name, from: old.point, to: [...p], state: structuredClone(g.climb.contactStates[name]) }; }
      }
      previous[name] = { phase, point: [...p] };
    }
    if (i % 31 === 0) {
      const saved = Object.fromEntries(names.map(name => [name, climber.rig.chains[name].contact.getWorldPosition(new THREE.Vector3())]));
      for (let frame = 0; frame < 4; frame++) {
        updateClimbContacts(g);
        updatePirateBody({ game: g, ship: vessel, pirate: climber, delta: 0, paused: true });
        for (const name of names) result.pauseDrift = Math.max(result.pauseDrift, climber.rig.chains[name].contact.getWorldPosition(new THREE.Vector3()).distanceTo(saved[name]));
      }
    }
  }
  for (const key of ['maxContactError', 'maxSupportError', 'maxSupportJump', 'pauseDrift']) result[key] = Number(result[key].toFixed(6));
  paths.push(result);
}
mkdirSync('artifacts/interaction-20261008', { recursive: true });
writeFileSync('artifacts/interaction-20261008/body-contact-check.json', JSON.stringify({ height: PLAYER_HEIGHT, scale: rig.baseScale, syntheticContactError: report.maxContactError, paths }, null, 2) + '\n');
const failures = paths.filter(p => p.maxContactError > (p.path.includes('shroud') ? .03 : .02) || p.maxSupportError > (p.path.includes('shroud') ? .03 : .02) || p.missingContacts.length || p.missingSupport.length || p.pauseDrift > .001 || p.maxSupportJump > .001);
assert.equal(failures.length, 0, `Real climb contacts failed: ${JSON.stringify(failures.map(({ path, direction, movingShip, maxSupportError, maxSupportJump, pauseDrift, missingContacts, missingSupport }) => ({ path, direction, movingShip, maxSupportError, maxSupportJump, pauseDrift, missingContacts: missingContacts.length, missingSupport: missingSupport.length })))}`);
console.log('PASS pirate scale, first-person hands/boots, rigid IK, real action reach, sitting, held items, and all seven climb paths in both directions on stationary/moving carriers.');
console.log(JSON.stringify({ contactError: report.maxContactError, scale: rig.baseScale, realPathCases: paths.length, samples: paths.reduce((n, p) => n + p.samples, 0), maxSupportError: Math.max(...paths.map(p => p.maxSupportError)) }));
