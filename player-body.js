import * as THREE from 'three';
import { groundHeight, walkingHeight } from './game.js';

const DOWN = new THREE.Vector3(0, -1, 0), IDENTITY = new THREE.Quaternion();
const a = new THREE.Vector3(), target = new THREE.Vector3(), direction = new THREE.Vector3();
const bend = new THREE.Vector3(), elbow = new THREE.Vector3(), end = new THREE.Vector3();
const offset = new THREE.Vector3(), segment = new THREE.Vector3(), worldPoint = new THREE.Vector3();
const upperRotation = new THREE.Quaternion(), lowerRotation = new THREE.Quaternion();
const endRotation = new THREE.Quaternion(), localPoint = new THREE.Vector3();
const armPole = new THREE.Vector3(), legPole = new THREE.Vector3(0, .05, 1), desiredWorld = new THREE.Vector3(), X_AXIS = new THREE.Vector3(1, 0, 0);
const floorRayOrigin = new THREE.Vector3(), FLOOR_DOWN = new THREE.Vector3(0, -1, 0);
const reachMatrix = new THREE.Matrix4(), reachInverse = new THREE.Matrix4(), reachPoint = new THREE.Vector3();
const reachPosition = new THREE.Vector3(), reachScale = new THREE.Vector3(), reachRotation = new THREE.Quaternion(), Y_AXIS = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const wrap = v => Math.atan2(Math.sin(v), Math.cos(v));

// All positions are in the chain parent's coordinates. Lengths never change to reach a target.
export function solveTwoBone(chain, contactTarget, pole, contactRotation = IDENTITY) {
  a.copy(chain.upper.position);
  offset.copy(chain.contact.position).applyQuaternion(contactRotation);
  target.copy(contactTarget).sub(offset);
  direction.copy(target).sub(a);
  const requested = direction.length(), max = chain.l1 + chain.l2 - .00001;
  const distance = THREE.MathUtils.clamp(requested, Math.abs(chain.l1 - chain.l2) + .00001, max);
  if (requested < .000001) direction.set(0, -1, 0); else direction.multiplyScalar(1 / requested);
  end.copy(a).addScaledVector(direction, distance);
  bend.copy(pole).addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < .000001) { bend.set(0, 0, 1); bend.addScaledVector(direction, -bend.dot(direction)); }
  if (bend.lengthSq() < .000001) { bend.set(1, 0, 0); bend.addScaledVector(direction, -bend.dot(direction)); }
  bend.normalize();
  const along = (chain.l1 * chain.l1 - chain.l2 * chain.l2 + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, chain.l1 * chain.l1 - along * along));
  elbow.copy(a).addScaledVector(direction, along).addScaledVector(bend, height);
  segment.copy(elbow).sub(a).normalize(); upperRotation.setFromUnitVectors(DOWN, segment);
  segment.copy(end).sub(elbow).normalize(); lowerRotation.setFromUnitVectors(DOWN, segment);
  chain.upper.quaternion.copy(upperRotation);
  chain.lower.quaternion.copy(upperRotation).invert().multiply(lowerRotation);
  chain.end.quaternion.copy(lowerRotation).invert().multiply(contactRotation);
  return Math.abs(requested - distance);
}

/** Test the same wrist/shoulder lengths as IK; optional world pose checks a swept approach before committing it. */
export function canReachHand(pirate, point, { position = null, yaw = null, hand = null } = {}) {
  const rig = pirate.rig; if (!rig || !point) return { reachable: false, hand: null, distance: Infinity, minimumDistance: 0, maximumDistance: 0 };
  pirate.updateWorldMatrix(true, true); rig.body.updateMatrix();
  if (position || Number.isFinite(yaw)) {
    if (position) { if (Array.isArray(position)) reachPosition.fromArray(position); else reachPosition.copy(position); }
    else pirate.getWorldPosition(reachPosition);
    if (Number.isFinite(yaw)) reachRotation.setFromAxisAngle(Y_AXIS, yaw); else pirate.getWorldQuaternion(reachRotation);
    pirate.getWorldScale(reachScale); reachMatrix.compose(reachPosition, reachRotation, reachScale).multiply(rig.body.matrix);
  } else reachMatrix.copy(rig.body.matrixWorld);
  reachInverse.copy(reachMatrix).invert();
  if (Array.isArray(point)) reachPoint.fromArray(point); else reachPoint.copy(point);
  reachPoint.applyMatrix4(reachInverse);
  const scale = reachMatrix.getMaxScaleOnAxis(), names = hand ? [hand.endsWith('Hand') ? hand : `${hand}Hand`] : ['leftHand', 'rightHand'];
  let best = null;
  for (const name of names) {
    const chain = rig.chains[name]; if (!chain) continue;
    // Interaction uses a forward-facing palm, with fingers curled around the authored contact.
    offset.copy(chain.contact.position);
    localPoint.copy(reachPoint).sub(offset).sub(chain.upper.position);
    const distance = localPoint.length() * scale, minimumDistance = (Math.abs(chain.l1 - chain.l2) + .00001) * scale, maximumDistance = (chain.l1 + chain.l2 - .00001) * scale;
    const reachable = distance >= minimumDistance && distance <= maximumDistance;
    if (best && (best.reachable && !reachable || best.reachable === reachable && best.distance <= distance)) continue;
    worldPoint.copy(chain.upper.position).applyMatrix4(reachMatrix);
    best = { reachable, hand: name, distance, minimumDistance, maximumDistance, shoulder: worldPoint.toArray() };
  }
  return best || { reachable: false, hand: null, distance: Infinity, minimumDistance: 0, maximumDistance: 0 };
}

function stateFor(rig) {
  if (!rig.state) {
    rig.state = { yaw: null, support: '', mode: '', feet: {}, lastGait: 0, targets: {} };
    for (const name of Object.keys(rig.chains)) rig.state.targets[name] = new THREE.Vector3();
    for (const name of ['leftFoot', 'rightFoot']) rig.state.feet[name] = { planted: false, point: new THREE.Vector3(), from: new THREE.Vector3(), phase: 0 };
  }
  return rig.state;
}

function supportToWorld(point, ship, support, out) { out.copy(point); if (support === 'ship') out.applyMatrix4(ship.matrixWorld); return out; }
function worldToSupport(point, ship, support, out) { out.copy(point); if (support === 'ship') ship.worldToLocal(out); return out; }
function floorAt(game, ship, support, point) {
  if (game.controller?.raycast) {
    floorRayOrigin.copy(point); floorRayOrigin.y += .28;
    const hit = game.controller.raycast(floorRayOrigin, FLOOR_DOWN, .65);
    if (hit) return floorRayOrigin.y - hit.distance;
  }
  if (support === 'ship') {
    ship.worldToLocal(localPoint.copy(point));
    const y = game.mode === 'cabin' ? game.player.y : walkingHeight(localPoint.x, localPoint.z, game.player.y);
    // Use the carrier matrix for floors and contacts, including ship heave.
    localPoint.y = y; return localPoint.applyMatrix4(ship.matrixWorld).y;
  }
  return groundHeight(game, point.x, point.z);
}

function walkingFoot({ name, game, ship, pirate, rig, state, support, gait, gaitAmount, moving, turning }) {
  const chain = rig.chains[name], foot = state.feet[name], target = state.targets[name];
  const phase = ((gait * 2.6 + (chain.side < 0 ? Math.PI : 0)) % TAU + TAU) % TAU;
  const stance = phase < Math.PI;
  const stride = .19 * Math.min(1, gaitAmount) / rig.baseScale;
  target.set(chain.side * .13, 0, moving ? stride : .035);
  pirate.localToWorld(worldPoint.copy(target));
  worldPoint.y = floorAt(game, ship, support, worldPoint);
  if (!moving || turning || state.mode !== game.mode || state.support !== support) {
    // Replant when the body turns in place or changes carrier; never drag feet from an old carrier.
    worldToSupport(worldPoint, ship, support, foot.point); foot.planted = false;
    foot.from.copy(foot.point);
  } else if (stance) {
    if (!foot.planted) { worldToSupport(worldPoint, ship, support, foot.point); foot.planted = true; }
    supportToWorld(foot.point, ship, support, worldPoint);
    foot.from.copy(foot.point);
  } else {
    foot.planted = false;
    const t = (phase - Math.PI) / Math.PI, smooth = t * t * (3 - 2 * t);
    worldToSupport(worldPoint, ship, support, localPoint);
    localPoint.sub(foot.from).multiplyScalar(smooth).add(foot.from);
    supportToWorld(localPoint, ship, support, worldPoint);
    worldPoint.y += Math.sin(t * Math.PI) * .085 * gaitAmount;
  }
  rig.body.worldToLocal(target.copy(worldPoint)); foot.phase = phase;
  return target;
}

/** One world-space body, also in first person. Head/hat alone are hidden from the owner's camera. */
export function updatePirateBody({ game, ship, pirate, lookYaw = game.player.yaw, lookPitch = 0, gait = 0, gaitAmount = 0, elapsed = 0, delta = 0, paused = false, equipped = null, actionTarget = null, wheel = null, firstPerson = true }) {
  const rig = pirate.rig; if (!rig) return null;
  const state = stateFor(rig), dt = paused ? 0 : delta;
  const locked = Boolean(game.climb) || ['helm', 'boat'].includes(game.mode);
  const desiredYaw = game.mode === 'helm' ? game.ship.heading + Math.PI / 2 : game.mode === 'boat' ? game.boat.heading + Math.PI / 2 : game.climb ? game.player.yaw : lookYaw;
  if (state.yaw === null) state.yaw = desiredYaw;
  else if (state.support === 'ship' && ['deck', 'cabin'].includes(game.mode) && !game.climb && Number.isFinite(state.lastShipHeading)) state.yaw += game.ship.heading - state.lastShipHeading;
  const gap = wrap(desiredYaw - state.yaw), moving = paused ? Boolean(state.moving) : gaitAmount > .045 && Math.abs(gait - state.lastGait) > .00001 && !game.climb;
  const turning = !locked && Math.abs(gap) > .34;
  if (locked) state.yaw = desiredYaw;
  else if (moving || Math.abs(gap) > .68) state.yaw += gap * (1 - Math.exp(-Math.max(dt, .001) * 15));
  pirate.rotation.y = state.yaw; pirate.scale.setScalar(rig.baseScale); pirate.visible = true;
  rig.head.visible = !firstPerson;
  // Self-occluding wide outer clothes are omitted for the owner; trousers, all joints and boots remain.
  rig.torso.visible = !firstPerson;
  rig.outerwear.visible = !firstPerson;
  const crouch = Boolean(game.player.crouched), airborne = game.player.grounded === false || Math.abs(game.player.vy || 0) > .01;
  const floorOffset = game.controller && !airborne && ['deck', 'cabin', 'land', 'helm'].includes(game.mode) ? .012 : 0;
  const bodyDrop = game.mode === 'boat' ? .31 : crouch ? .50 + floorOffset : (moving ? .028 : 0) + floorOffset;
  rig.body.position.y = -bodyDrop / rig.baseScale;
  ship.updateWorldMatrix(true, false); pirate.updateWorldMatrix(true, true);
  const support = game.climb?.contacts?.space || (['deck', 'cabin', 'helm'].includes(game.mode) ? 'ship' : 'world');
  const contacts = game.climb?.contacts;
  const pose = game.climb ? 'climbing' : game.mode === 'boat' ? 'seatedBoat' : game.mode === 'helm' ? 'helm' : game.mode === 'swim' ? 'swimming' : crouch ? 'crouched' : moving ? 'walking' : 'idle';
  const diagnostics = { pose, contacts: {}, unreachable: [], maxContactError: 0, maxSupportError: 0, nearWall: false, equipped: locked ? null : equipped };
  const nearWall = actionTarget?.nearWall === true || (typeof actionTarget?.nearWall === 'number' && actionTarget.nearWall < .48);
  const retract = nearWall ? .30 : 0; diagnostics.nearWall = nearWall;
  const held = locked || game.mode === 'swim' ? null : equipped;
  for (const [name, chain] of Object.entries(rig.chains)) {
    const hand = name.endsWith('Hand'), right = name === 'rightHand', point = state.targets[name];
    const hasContact = Array.isArray(contacts?.[name]);
    let gripping = hasContact || (hand && (held || game.mode === 'helm'));
    if (hasContact) {
      desiredWorld.fromArray(contacts[name]); if (contacts.space === 'ship') desiredWorld.applyMatrix4(ship.matrixWorld);
      point.copy(desiredWorld); rig.body.worldToLocal(point);
    } else if (hand && game.mode === 'helm' && wheel) {
      // The real inner rim lies in local YZ. Side grips remain reachable across the steering range.
      wheel.updateWorldMatrix(true, false);
      const angle = -chain.side * 1.22;
      desiredWorld.set(-.02, .47 * Math.cos(angle), .47 * Math.sin(angle)).applyMatrix4(wheel.matrixWorld);
      point.copy(desiredWorld); rig.body.worldToLocal(point); gripping = true;
    } else if (!hand && ['deck', 'cabin', 'helm', 'land'].includes(game.mode) && !airborne) {
      walkingFoot({ name, game, ship, pirate, rig, state, support, gait, gaitAmount, moving, turning });
    } else if (!hand && game.mode === 'boat') point.set(chain.side * .13, .30, .40);
    else if (hand && game.mode === 'boat') point.set(chain.side * .38, 1.01, .44 + Math.sin(elapsed * 4) * .12 * Math.min(1, Math.abs(game.boat.speed)));
    else if (!hand && game.mode === 'swim') point.set(chain.side * .16, .12, -.18 + Math.sin(elapsed * 5 + chain.side) * .13);
    else if (hand && game.mode === 'swim') point.set(chain.side * .37, 1.0 + Math.sin(elapsed * 5 + (right ? 0 : Math.PI)) * .18, .35);
    else if (!hand && airborne) point.set(chain.side * .13, .20, .13);
    else if (hand && held === 'chart') point.set(chain.side * .245, 1.40, .46 - retract);
    else if (hand && right && held === 'telescope') point.set(-.16, game.world.scopeRaised ? 1.64 : 1.40, game.world.scopeRaised ? .23 : .46 - retract);
    else if (hand && right && held === 'lantern') point.set(-.34, 1.40, .48 - retract);
    else if (hand && right && held === 'rope') point.set(-.30, 1.39, .46 - retract);
    else if (hand && right && firstPerson) {
      const lowerHand = THREE.MathUtils.smoothstep(-lookPitch, .40, 1.0);
      point.set(-.29, THREE.MathUtils.lerp(1.39, .83, lowerHand), THREE.MathUtils.lerp(.58, .08, lowerHand) - retract * (1 - lowerHand));
    }
    else if (hand) point.set(chain.side * .30, .82 + Math.sin(gait * 2.6 + chain.side) * .06 * gaitAmount, .08 - Math.sin(gait * 2.6 + chain.side) * .11 * gaitAmount);
    else point.set(chain.side * .13, 0, .035);
    const continuous = actionTarget?.continuous === true;
    const actingHand = hand && name === (actionTarget?.hand || game.handAction?.hand || 'rightHand') && actionTarget?.point && !locked && (continuous || game.handAction?.time > 0);
    if (actingHand) {
      desiredWorld.copy(actionTarget.point);
      rig.body.worldToLocal(localPoint.copy(desiredWorld));
      const action = continuous ? 1 : Math.sin(Math.PI * THREE.MathUtils.clamp(1 - game.handAction.time / .35, 0, 1));
      point.lerp(localPoint, action); gripping = continuous || action > .55;
    }
    endRotation.identity();
    if (hand && !hasContact && game.mode !== 'helm' && !actingHand) endRotation.setFromAxisAngle(X_AXIS, right && firstPerson ? -.6 : -.08);
    armPole.set(chain.side * .7, -.18, -.1);
    const reachError = solveTwoBone(chain, point, hand ? armPole : legPole, endRotation) * rig.baseScale;
    if (reachError > .02) diagnostics.unreachable.push({ limb: name, excess: Number(reachError.toFixed(4)) });
    for (let i = 0; i < chain.fingers.length; i++) {
      const finger = chain.fingers[i], curl = gripping ? (i === 4 ? .65 : 1.15) : .10;
      finger.rotation.x = curl;
    }
    if (hasContact || (hand && game.mode === 'helm' && wheel)) {
      chain.contact.updateWorldMatrix(true, false); chain.contact.getWorldPosition(worldPoint);
      const error = worldPoint.distanceTo(desiredWorld);
      const phase = game.climb?.contactPhases?.[name] || (contacts?.[`${name}Anchored`] === false ? 'swing' : 'support');
      diagnostics.contacts[name] = { error: Number(error.toFixed(5)), actual: worldPoint.toArray(), desired: desiredWorld.toArray(), phase };
      diagnostics.maxContactError = Math.max(diagnostics.maxContactError, error);
      if (phase === 'support') diagnostics.maxSupportError = Math.max(diagnostics.maxSupportError, error);
    }
  }
  // Held objects stay in the same depth-tested world as the hands, never a HUD overlay.
  rig.body.updateWorldMatrix(true, true);
  for (const [name, object] of Object.entries(rig.items)) object.visible = name === held;
  if (held === 'chart') {
    rig.items.chart.position.set(0, 1.38, .49 - retract); rig.items.chart.rotation.set(-.5, 0, 0);
  } else if (held && rig.items[held]) {
    const palm = rig.chains.rightHand.contact;
    palm.getWorldPosition(worldPoint); rig.body.worldToLocal(worldPoint);
    rig.items[held].position.copy(worldPoint);
    rig.items[held].quaternion.identity();
    if (held === 'telescope') rig.items[held].rotation.x = nearWall ? 1.15 : -lookPitch * .3;
    if (held === 'lantern') rig.items[held].rotation.z = Math.sin(gait * 2.6) * .05 * gaitAmount;
  }
  const lanternOn = game.world.portableLanternOn !== false;
  rig.lanternLight.visible = held === 'lantern' && lanternOn;
  rig.lanternGlass.emissiveIntensity = lanternOn ? .7 : 0;
  state.lastGait = gait; state.lastShipHeading = game.ship.heading; state.mode = game.mode; state.support = support; state.moving = moving;
  diagnostics.maxContactError = Number(diagnostics.maxContactError.toFixed(5));
  diagnostics.maxSupportError = Number(diagnostics.maxSupportError.toFixed(5));
  pirate.userData.bodyDiagnostics = diagnostics;
  return diagnostics;
}
