import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLAND, STATIONS, islandHeight, PLAYER_HEIGHT } from './game.js';
import { hullHalfWidthAt } from './ship-layout.js';
import { CLIMB_PATHS } from './climb-paths.js';
import { buildShipInterior } from './ship-interior.js';
import { buildLifeboat } from './ship-boat.js';

// Bake only direct static meshes: cabin, hanging ropes and oars retain their own visibility/pivots.
function batchStatic(group) {
  const batches = new Map();
  for (const object of [...group.children]) {
    if (!object.isMesh) continue;
    object.updateMatrix();
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrix);
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    if (!batches.has(object.material)) batches.set(object.material, []);
    batches.get(object.material).push(geometry);
    group.remove(object); object.geometry.dispose();
  }
  for (const [material, geometries] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.name = `${group.name || 'static'}-${material.name || 'material'}`;
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    geometries.forEach((geometry) => geometry.dispose());
  }
}

export function buildWorld(scene, ship, woodTexture) {
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .85, ...extra });
  const wood = material('#8b6645', { map: woodTexture });
  const dark = material('#362c26', { map: woodTexture });
  const iron = material('#32383a', { metalness: .65, roughness: .5 });
  const brass = material('#be994e', { metalness: .6, roughness: .4 });
  const rope = material('#b9a67c');
  const sand = new THREE.Color('#dec699'), grass = new THREE.Color('#617748');
  const lamp = material('#f9c77d', { emissive: '#ffaa44', emissiveIntensity: .9 });
  function mesh(parent, geometry, mat, position = [0, 0, 0]) {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(...position); object.castShadow = true; object.receiveShadow = true;
    parent.add(object); return object;
  }
  const box = (parent, size, position, mat = wood) => mesh(parent, new THREE.BoxGeometry(...size), mat, position);
  function pole(parent, a, b, radius, mat = wood) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const object = mesh(parent, new THREE.CylinderGeometry(radius * .9, radius, start.distanceTo(end), 7), mat, start.clone().add(end).multiplyScalar(.5).toArray());
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize()); return object;
  }
  function cable(parent, points, radius, mat = rope) {
    return mesh(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point))), 24, radius, 5, false), mat);
  }
  function lantern(parent, x, y, z) {
    box(parent, [.2, .27, .2], [x, y, z], lamp);
    for (const dx of [-.115, .115]) for (const dz of [-.115, .115]) pole(parent, [x + dx, y - .16, z + dz], [x + dx, y + .16, z + dz], .018, iron);
    mesh(parent, new THREE.ConeGeometry(.2, .16, 4), iron, [x, y + .23, z]).rotation.y = Math.PI / 4;
    box(parent, [.27, .05, .27], [x, y - .17, z], iron);
    mesh(parent, new THREE.TorusGeometry(.065, .012, 4, 10), brass, [x, y + .38, z]);
  }
  const island = new THREE.Group(); island.name = 'birth-island'; scene.add(island);
  const points = [], colors = [], uvs = [], indices = [], rings = 32, segments = 96;
  for (let ring = 0; ring <= rings; ring++) for (let i = 0; i <= segments; i++) {
    const r = ring / rings * 1.08, angle = i / segments * Math.PI * 2;
    const x = Math.cos(angle) * ISLAND.rx * r, z = ISLAND.z + Math.sin(angle) * ISLAND.rz * r;
    points.push(x, islandHeight(x, z), z);
    const patch = Math.sin(x * .6 + Math.sin(z * .45)) * Math.cos(z * .43 - x * .21);
    const beach = THREE.MathUtils.smoothstep(r + patch * .05, .60, .88);
    const path = (1 - THREE.MathUtils.smoothstep(Math.abs(x - .3 * Math.sin(z)), .45, 1.4)) * THREE.MathUtils.smoothstep(z, -29, -24);
    const color = grass.clone().lerp(sand, Math.max(beach, path * .86));
    color.multiplyScalar(.94 + patch * .065); colors.push(color.r, color.g, color.b);
    uvs.push(x / 3, z / 3);
    if (ring < rings && i < segments) {
      const a = ring * (segments + 1) + i, b = a + segments + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const ground = new THREE.BufferGeometry();
  ground.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  ground.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  ground.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  ground.setIndex(indices); ground.computeVertexNormals();
  const grainPixels = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < grainPixels.length; i += 4) {
    const grain = 220 + Math.floor((Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) * 17);
    grainPixels.set([grain, grain, grain, 255], i);
  }
  const grain = new THREE.DataTexture(grainPixels, 64, 64); grain.needsUpdate = true;
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.generateMipmaps = true;
  grain.minFilter = THREE.LinearMipmapLinearFilter; grain.magFilter = THREE.LinearFilter; grain.colorSpace = THREE.SRGBColorSpace;
  const terrain = material('#ffffff', { vertexColors: true, map: grain, bumpMap: grain, bumpScale: .035, roughness: 1 }); terrain.name = 'ground';
  mesh(island, ground, terrain);
  const leafMat = material('#47753a', { side: THREE.DoubleSide });
  const leafLight = material('#6b8b43', { side: THREE.DoubleSide });
  // Palms ring the shore of the 48 x 52 m island, scaled to match the 32 m ship.
  for (const [x, z, height, lean] of [[-11, -46, 12, 1.4], [10, -50, 13, -1.1], [-8, -62, 14, 1.7], [13, -64, 10.5, -1.3], [-13, -62, 9.5, 1.1], [4, -70, 11, .8], [-4, -36, 10, -.9]]) {
    const y = islandHeight(x, z);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, y, z), new THREE.Vector3(x + lean * .3, y + height * .5, z), new THREE.Vector3(x + lean, y + height, z)]);
    mesh(island, new THREE.TubeGeometry(curve, 9, .34, 6, false), wood);
    for (let h = .7; h < height - .7; h += 1.05) {
      const center = curve.getPoint(h / height);
      const band = mesh(island, new THREE.TorusGeometry(.343, .026, 3, 7), dark, center.toArray()); band.rotation.x = Math.PI / 2;
    }
    // Feathered fronds droop around a curved midrib; the gaps read as palms from the deck.
    for (let j = 0; j < 9; j++) {
      const a = j / 9 * Math.PI * 2 + x * .4, length = 5.5 + .7 * Math.sin(j * 2.1 + z);
      const frond = (t, side = 0) => {
        const width = side * Math.sin(Math.PI * t) * 1.3;
        return [x + lean + Math.cos(a) * length * t - Math.sin(a) * width, y + height + 1.2 * Math.sin(Math.PI * t) - 1.9 * t * t - Math.abs(width) * .2, z + Math.sin(a) * length * t + Math.cos(a) * width];
      };
      const blades = [];
      for (let k = 1; k <= 9; k++) for (const side of [-1, 1]) {
        const t = k / 11;
        blades.push(...frond(t - .045), ...frond(t + .035), ...frond(Math.min(1, t + .13), side));
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3)); geometry.computeVertexNormals();
      mesh(island, geometry, j % 3 ? leafMat : leafLight);
      cable(island, Array.from({ length: 9 }, (_, i) => frond(i / 8)), .032, leafMat);
    }
    for (const dz of [-.34, .29]) mesh(island, new THREE.IcosahedronGeometry(.44), dark, [x + lean, y + height - .45, z + dz]);
  }
  const rockMat = material('#7f8577');
  for (const [x, z, size] of [[-17, -40, 2.4], [17, -46, 3.1], [-11, -74, 3.3], [9, -74, 1.8], [18, -64, 2.2]]) {
    const rock = mesh(island, new THREE.DodecahedronGeometry(size, 0), rockMat, [x, islandHeight(x, z) + size * .35, z]);
    rock.scale.set(1.2, .75, .85); rock.rotation.set(.3, x, .2);
  }
  // Small beach anchors break the perfect color rings without changing the walkable shoreline.
  for (let i = 0; i < 40; i++) {
    const a = i * 2.39996, radius = .72 + (i % 4) * .047;
    const x = Math.cos(a) * ISLAND.rx * radius, z = ISLAND.z + Math.sin(a) * ISLAND.rz * radius;
    if (Math.abs(x) < 4.4 && z > -52) continue;
    const stone = mesh(island, new THREE.DodecahedronGeometry(.18 + (i % 3) * .09), rockMat, [x, islandHeight(x, z) + .1, z]);
    stone.scale.set(1.6, .55, 1); stone.rotation.y = a;
  }

  // Pier: deck 3.6 m above the water, standing off the port bow.
  const dock = new THREE.Group(); dock.name = 'simple-dock'; scene.add(dock);
  dock.position.y=-1.17;
  for (let z = -35.4; z < -8.6; z += .74) box(dock, [6.8, .34, .68], [0, 3.5, z]);
  for (let x = -14.8; x < 14.8; x += .74) box(dock, [.68, .34, 3.5], [x, 3.5, -9.1]);
  for (const z of [-34.4, -26.7, -19, -11.1]) for (const x of [-2.9, 2.9]) {
    pole(dock, [x, -1, z], [x, 4.45, z], .3, dark);
    mesh(dock, new THREE.CylinderGeometry(.42, .42, .22, 8), wood, [x, 4.5, z]);
  }
  for (const x of [-14.6, -7.4, 7.4, 14.6]) pole(dock, [x, -2, -9.1], [x, 4.3, -9.1], .35, dark);
  for (const z of [-34.4, -26.7, -19]) for (const x of [-2.9, 2.9]) cable(dock, [[x, 4.1, z], [x, 3.66, z + 3.8], [x, 4.1, z + 7.6]], .08);
  for (const x of [-2.4, 2.4]) box(dock, [.38, .54, 26], [x, 2.9, -22]);
  box(dock, [30, .54, .44], [0, 2.9, -9.1], dark);
  for (const x of [-14.6, -7.4, 7.4, 14.6]) {
    mesh(dock, new THREE.CylinderGeometry(.4, .4, .22, 8), iron, [x, 3.85, -9.1]);
    pole(dock, [x - .52, 4.1, -9.1], [x + .52, 4.1, -9.1], .12, iron);
  }
  for (const [x, z] of [[-9.4, -9.0], [9.9, -9.0], [2.3, -27.8]]) {
    for (let ring = 0; ring < 4; ring++) {
      const coil = mesh(dock, new THREE.TorusGeometry(.33 + ring * .09, .05, 4, 22), rope, [x, 3.72, z]); coil.rotation.x = Math.PI / 2;
    }
    cable(dock, [[x + .58, 3.74, z], [x + .78, 3.76, z + .33], [x + 1.0, 3.72, z + .15]], .046);
  }
  lantern(dock, -2.9, 5.3, -34.4); lantern(dock, 14.6, 4.95, -9.1);
  for (const x of [11.8, 13.7]) pole(dock, [x, -.8, -7.3], [x, 5.1, -7.3], .12, wood);
  for (const rung of CLIMB_PATHS.find(path=>path.id==='dock').rungs) pole(dock, rung.a.map((v,i)=>v-(i===1?dock.position.y:0)),rung.b.map((v,i)=>v-(i===1?dock.position.y:0)), .1, wood);
  for (const [x, z] of [[-2.2, -22], [2.2, -30.8], [8.4, -9.0]]) {
    box(dock, [1.54, 1.44, 1.44], [x, 4.5, z]);
    for (const dx of [-.55, .55]) box(dock, [.12, 1.48, 1.48], [x + dx, 4.5, z], dark);
    for (const dz of [-.73, .73]) {
      pole(dock, [x - .6, 4.0, z + dz], [x + .6, 4.85, z + dz], .055, dark);
      box(dock, [.4, .1, .1], [x, 4.55, z + dz], iron);
    }
  }
  // Gangplank from the pier head to the port bulwark.
  const gangplank = new THREE.Group(); scene.add(gangplank);
  for (let z = -9.1; z < -4.1; z += .37) {
    const y = 2.5 + THREE.MathUtils.clamp((z + 9.1) / 5.0, 0, 1) * -.1;
    box(gangplank, [3.0, .15, .34], [.6, y - .09, z]);
  }
  for (const x of [-.66, 1.86]) pole(gangplank, [x, 2.4, -9.2], [x, 2.3, -4.1], .13, dark);

  const fittings = new THREE.Group(); fittings.name = 'game-fittings'; ship.add(fittings);
  // The permanent boarding ladder reaches the corrected 2.4 m main deck.
  const ladderZ = hullHalfWidthAt(-1.6, 2.4) + .24;
  for (const x of [-2.2, -1.0]) pole(fittings, [x, -.65, ladderZ], [x, 4.85, ladderZ], .055, dark);
  for (const rung of CLIMB_PATHS.find(path=>path.id==='board').rungs) pole(fittings, rung.a, rung.b, .045, wood);
  const shared = ship.userData.materials || {};
  const interior = buildShipInterior(ship, shared, woodTexture);
  const boatModel = buildLifeboat(scene, ship, shared, woodTexture);
  fittings.add(boatModel.davits);
  // Keep the fall-ropes as the existing independently visible fittings child.
  fittings.add(boatModel.ropes);
  const { boat, oars, ropes } = boatModel;
  const { cabin, brig, cabinDoor, cellDoors } = interior;

  const markers = [];
  for (const station of STATIONS) {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#122b32dd'; ctx.beginPath(); ctx.roundRect(4, 4, 72, 72, 15); ctx.fill();
    ctx.strokeStyle = '#d0aa6566'; ctx.stroke();
    ctx.font = '32px Segoe UI'; ctx.fillStyle = '#e5bf78'; ctx.fillText('手', 30, 52);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.position.set(station.x, station.y + .8, station.z); sprite.scale.set(.38, .38, 1); ship.add(sprite);
    sprite.renderOrder = 8; markers.push({ ...station, object: sprite });
  }
  [island, dock, gangplank, fittings].forEach(batchStatic);
  return { island, dock, gangplank, markers, fittings, ...interior, ...boatModel };

}

export function buildPirate() {
  const pirate = new THREE.Group(); pirate.name = 'only-pirate';
  const body = new THREE.Group(); body.name = 'pirate-body'; pirate.add(body);
  const torso = new THREE.Group(); torso.name = 'upper-coat-and-shirt'; body.add(torso);
  const outerwear = new THREE.Group(); outerwear.name = 'coat-tails-belt-and-scabbard'; body.add(outerwear);
  const pelvis = new THREE.Group(); pelvis.name = 'trouser-waist'; body.add(pelvis);
  const head = new THREE.Group(); head.name = 'head-and-tricorn'; body.add(head);
  const skin = new THREE.MeshStandardMaterial({ color: '#c9956f', roughness: .85 });
  const coat = new THREE.MeshStandardMaterial({ color: '#822f32', roughness: .9, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: '#28272a', roughness: .9 });
  const leather = new THREE.MeshStandardMaterial({ color: '#433225', roughness: .85 });
  const gold = new THREE.MeshStandardMaterial({ color: '#c5a45b', metalness: .55, roughness: .45 });
  const cloth = new THREE.MeshStandardMaterial({ color: '#e0d0af', roughness: 1 });
  const rope = new THREE.MeshStandardMaterial({ color: '#b4a078', roughness: 1 });
  function add(geometry, material, position = [0, 0, 0], parent = outerwear) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  const box = (size, at, mat, parent = outerwear) => add(new THREE.BoxGeometry(...size), mat, at, parent);
  const joint = (name, parent, at) => { const g = new THREE.Group(); g.name = name; g.position.set(...at); parent.add(g); return g; };
  add(new THREE.CylinderGeometry(.235, .28, .65, 10), coat, [0, 1.05, 0], torso);
  box([.19, .37, .035], [0, 1.15, .237], cloth, torso);
  box([.23, .085, .08], [0, 1.40, .08], cloth, torso);
  for (const side of [-1, 1]) {
    const lapel = box([.10, .31, .04], [side * .12, 1.22, .24], gold, torso); lapel.rotation.z = side * .34;
    for (const y of [.98, 1.10]) add(new THREE.SphereGeometry(.022, 6, 4), gold, [side * .12, y, .267], torso);
  }
  const tailPositions = [], tailIndices = [];
  for (let i = 0; i <= 12; i++) {
    const angle = .65 + i / 12 * (Math.PI * 2 - 1.3);
    tailPositions.push(Math.sin(angle) * .27, .87, Math.cos(angle) * .23, Math.sin(angle) * .35, .54 + .07 * Math.cos(angle), Math.cos(angle) * .31);
    if (i < 12) { const a = i * 2; tailIndices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  const tails = new THREE.BufferGeometry(); tails.setAttribute('position', new THREE.Float32BufferAttribute(tailPositions, 3)); tails.setIndex(tailIndices); tails.computeVertexNormals();
  add(tails, coat);
  add(new THREE.CylinderGeometry(.292, .292, .10, 10), leather, [0, .83, 0]).scale.z = .9;
  box([.11, .1, .055], [0, .82, .26], gold);
  box([.06, .054, .06], [0, .82, .27], leather);
  box([.34, .15, .20], [0, .765, -.025], dark, pelvis);
  // Face eyes sit at the same 1.43 m as the gameplay camera; the tricorn still sets 1.62 m overall height.
  add(new THREE.CylinderGeometry(.09, .10, .14, 8), skin, [0, 1.445, 0], head);
  add(new THREE.SphereGeometry(.215, 12, 8), skin, [0, 1.685, 0], head);
  add(new THREE.SphereGeometry(.135, 8, 6), dark, [0, 1.575, .12], head).scale.set(1.12, .72, .65);
  add(new THREE.SphereGeometry(.045, 6, 4), skin, [0, 1.675, .21], head);
  box([.085, .055, .04], [.1, 1.69, .2], dark, head);
  box([.025, .025, .02], [-.08, 1.69, .216], dark, head);
  add(new THREE.TorusGeometry(.032, .01, 4, 10), gold, [-.212, 1.645, 0], head);
  const hatPoints = [], hatIndices = [], brimPath = [];
  for (let i = 0; i <= 6; i++) {
    const angle = i / 6 * Math.PI * 2, corner = i % 2 === 0;
    const radius = corner ? .41 : .265, height = corner ? 1.86 : 1.74;
    const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
    hatPoints.push(Math.sin(angle) * .19, 1.75, Math.cos(angle) * .19, x, height, z, x, height - .035, z);
    brimPath.push(new THREE.Vector3(x, height + .005, z));
    if (i < 6) { const a = i * 3; hatIndices.push(a, a + 3, a + 1, a + 3, a + 4, a + 1, a + 1, a + 4, a + 2, a + 4, a + 5, a + 2); }
  }
  const brim = new THREE.BufferGeometry(); brim.setAttribute('position', new THREE.Float32BufferAttribute(hatPoints, 3)); brim.setIndex(hatIndices); brim.computeVertexNormals();
  add(brim, dark, [0, 0, 0], head);
  add(new THREE.SphereGeometry(.235, 10, 6), dark, [0, 1.78, 0], head).scale.set(1, .55, 1);
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(brimPath, true), 36, .012, 4, true), gold, [0, 0, 0], head);
  box([.06, .06, .035], [0, 1.88, .375], gold, head);

  const legs = [], arms = [], chains = {};
  for (const [label, side] of [['left', 1], ['right', -1]]) {
    const upper = joint(`${label}-hip`, body, [side * .13, .76, 0]);
    const lower = joint(`${label}-knee`, upper, [0, -.36, 0]);
    const end = joint(`${label}-ankle`, lower, [0, -.31, 0]);
    const contact = joint(`${label}-sole-contact`, end, [0, -.09, 0]);
    add(new THREE.CylinderGeometry(.087, .080, .33, 8), dark, [0, -.17, 0], upper);
    add(new THREE.SphereGeometry(.080, 8, 6), dark, [0, 0, 0], lower);
    add(new THREE.CylinderGeometry(.097, .10, .26, 8), leather, [0, -.145, 0], lower);
    add(new THREE.CylinderGeometry(.116, .116, .055, 8), leather, [0, -.025, 0], lower);
    box([.18, .14, .29], [0, -.004, .055], leather, end);
    box([.187, .025, .30], [0, -.0775, .055], dark, end);
    chains[`${label}Foot`] = { upper, lower, end, contact, l1: .36, l2: .31, side, fingers: [] }; legs.push(upper);
    const shoulder = joint(`${label}-shoulder`, body, [side * .28, 1.39, 0]);
    const elbow = joint(`${label}-elbow`, shoulder, [0, -.34, 0]);
    const wrist = joint(`${label}-wrist`, elbow, [0, -.31, 0]);
    const palm = joint(`${label}-palm-contact`, wrist, [0, -.045, 0]);
    add(new THREE.SphereGeometry(.101, 8, 6), coat, [0, -.045, 0], shoulder);
    add(new THREE.CylinderGeometry(.090, .070, .30, 8), coat, [0, -.175, 0], shoulder);
    add(new THREE.SphereGeometry(.07, 8, 6), coat, [0, 0, 0], elbow);
    add(new THREE.CylinderGeometry(.07, .055, .26, 8), coat, [0, -.13, 0], elbow);
    box([.14, .055, .13], [0, -.27, 0], cloth, elbow);
    box([.12, .12, .12], [0, -.045, 0], skin, wrist).name = `${label}-block-hand`;
    chains[`${label}Hand`] = { upper: shoulder, lower: elbow, end: wrist, contact: palm, l1: .34, l2: .31, side, fingers: [] }; arms.push(shoulder);
    // A batch never crosses a shoulder/elbow/wrist or hip/knee/ankle pivot.
    [upper, lower, end, shoulder, elbow, wrist].forEach(batchStatic);
  }
  const scabbard = new THREE.CatmullRomCurve3([new THREE.Vector3(-.34, .87, -.02), new THREE.Vector3(-.44, .62, -.035), new THREE.Vector3(-.45, .41, -.07), new THREE.Vector3(-.38, .31, -.09)]);
  add(new THREE.TubeGeometry(scabbard, 10, .041, 6, false), leather);
  const swordHandle = add(new THREE.CylinderGeometry(.035, .035, .20, 6), leather, [-.30, .99, -.015]); swordHandle.rotation.z = -.3;
  box([.19, .035, .075], [-.34, .89, -.02], gold);
  add(new THREE.SphereGeometry(.045, 6, 4), gold, [-.27, 1.095, -.015]);
  add(new THREE.SphereGeometry(.045, 6, 4), gold, [-.38, .31, -.09]);
  [body, head, torso, outerwear, pelvis].forEach(batchStatic);

  const items = {};
  for (const name of ['chart', 'telescope', 'lantern', 'rope']) { items[name] = joint(`held-${name}`, body, [0, 1.4, .45]); items[name].visible = false; }
  const parchment = new THREE.MeshStandardMaterial({ color: '#dac694', roughness: 1, side: THREE.DoubleSide });
  const ink = new THREE.MeshStandardMaterial({ color: '#68523c', roughness: 1 });
  box([.50, .34, .012], [0, 0, 0], parchment, items.chart);
  for (const x of [-.205, .205]) box([.008, .27, .003], [x, 0, .008], ink, items.chart);
  for (const y of [-.12, -.06, 0, .06, .12]) box([.43, .0025, .003], [0, y, .008], ink, items.chart);
  const coastline = new THREE.CatmullRomCurve3([[-.13, -.08], [-.10, -.03], [-.14, .04], [-.08, .09], [-.025, .06], [.015, -.015], [-.04, -.085], [-.13, -.08]].map(([x, y]) => new THREE.Vector3(x, y, .009)));
  add(new THREE.TubeGeometry(coastline, 24, .006, 4, false), ink, [0, 0, 0], items.chart);
  add(new THREE.TorusGeometry(.031, .003, 4, 12), ink, [.13, .055, .01], items.chart);
  box([.003, .085, .003], [.13, .055, .01], ink, items.chart);
  const lens = new THREE.MeshStandardMaterial({ color: '#3d7280', metalness: .45, roughness: .2 });
  for (const [z, r, length, mat] of [[.04, .047, .12, leather], [.13, .044, .17, gold], [.23, .038, .11, gold]]) {
    add(new THREE.CylinderGeometry(r, r, length, 12), mat, [0, 0, z], items.telescope).rotation.x = Math.PI / 2;
  }
  add(new THREE.CircleGeometry(.035, 16), lens, [0, 0, .286], items.telescope);
  for (const z of [-.025, .10, .285]) add(new THREE.TorusGeometry(z === .285 ? .043 : .05, .006, 5, 12), gold, [0, 0, z], items.telescope);
  const glass = new THREE.MeshStandardMaterial({ color: '#e9ba65', emissive: '#dd7e2b', emissiveIntensity: .7, roughness: .35 });
  add(new THREE.TorusGeometry(.055, .010, 5, 12), dark, [0, -.07, 0], items.lantern);
  box([.17, .21, .14], [0, -.24, 0], glass, items.lantern);
  for (const x of [-.091, .091]) for (const z of [-.076, .076]) box([.014, .245, .014], [x, -.24, z], dark, items.lantern);
  for (const y of [-.365, -.115]) box([.20, .025, .175], [0, y, 0], dark, items.lantern);
  add(new THREE.ConeGeometry(.135, .085, 4), dark, [0, -.075, 0], items.lantern).rotation.y = Math.PI / 4;
  const lanternLight = new THREE.PointLight('#ffbd73', .7, 2.5, 2); lanternLight.position.set(0, -.23, 0); items.lantern.add(lanternLight);
  for (let i = 0; i < 5; i++) add(new THREE.TorusGeometry(.09 + i * .018, .011, 5, 20), rope, [0, -.17, i * .014], items.rope);
  box([.035, .07, .12], [0, -.04, .028], leather, items.rope);
  Object.values(items).forEach(batchStatic);
  pirate.scale.setScalar(PLAYER_HEIGHT / 1.91);
  const rig = { body, torso, outerwear, pelvis, head, chains, items, lanternLight, lanternGlass: glass, materials: { skin, coat, cloth, dark, leather, gold }, height: PLAYER_HEIGHT, baseScale: PLAYER_HEIGHT / 1.91 };
  // Keep Object3D references off userData so exporters can still serialize the character.
  pirate.rig = rig;
  pirate.userData.bodyDiagnostics = { pose: 'idle', contacts: {}, unreachable: [] };
  return { pirate, legs, arms, rig };
}
