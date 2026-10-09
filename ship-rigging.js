import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MASTS, hullWidth, mainDeckHeight } from './ship-layout.js';
import { SHROUD_GEOMETRY } from './climb-paths.js';

// Legacy ship coordinates: +X bow, +Z starboard, one unit per metre.
export function buildRigging(ship, materials, helpers = {}) {
  const staticRigging = new THREE.Group();
  staticRigging.name = 'structural-rigging'; ship.add(staticRigging);
  const animated = new THREE.Group();
  animated.name = 'sails-and-flags'; ship.add(animated);
  const sails = [], flags = [], running = [], paths = [];
  const counts = { masts: 3, squareSails: 0, triangularSails: 0, horizontalYards: 0, lateenYards: 0, deadeyes: 0, shrouds: 0, ratlines: 0, blocks: 0, platformAccessLadders: 3, authoredRepairPatches: 0 };
  const mastWood = materials.mastWood || materials.wood;
  const up = new THREE.Vector3(0, 1, 0);
  const v3 = p => new THREE.Vector3(...p);
  function mesh(geometry, material, position = [0, 0, 0], parent = staticRigging, name = '') {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position); object.name = name;
    object.castShadow = true; object.receiveShadow = true; parent.add(object);
    return object;
  }
  function woodUV(geometry, length, radius = .12) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * radius * Math.PI, uv.getY(i) * length / 4);
    return geometry;
  }
  function pole(a, b, r, material = materials.wood, rTop = r, parent = staticRigging, name = '', radial = 10) {
    const start = v3(a), end = v3(b), delta = end.clone().sub(start), length = delta.length();
    const geometry = new THREE.CylinderGeometry(rTop, r, length, radial, 1);
    if (material === materials.rope || material === materials.tarRope) {
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * length / .22);
    } else woodUV(geometry, length, r);
    const object = mesh(geometry, material, start.add(end).multiplyScalar(.5).toArray(), parent, name);
    object.quaternion.setFromUnitVectors(up, delta.normalize());
    if (r < .017) object.castShadow = false;
    return object;
  }
  function box(size, pos, material = materials.wood, parent = staticRigging, name = '') {
    return mesh(new THREE.BoxGeometry(...size), material, pos, parent, name);
  }
  function cord(points, r = .012, material = materials.rope, parent = staticRigging, name = '') {
    const curve = points.length === 2 ? new THREE.LineCurve3(v3(points[0]), v3(points[1])) : new THREE.CatmullRomCurve3(points.map(v3));
    const segments = points.length === 2 ? 1 : Math.min(24, Math.max(4, points.length * 2));
    const geometry = new THREE.TubeGeometry(curve, segments, r, r < .014 ? 3 : 5, false);
    const uv = geometry.attributes.uv, length = curve.getLength();
    // Tube U follows the rope, unlike cylinder V.
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i) * length / .22);
    const object = mesh(geometry, material, [0, 0, 0], parent, name);
    object.castShadow = r >= .018;
    if (name && parent === staticRigging) paths.push({ name, points });
    return object;
  }
  function ring(radius, tube, pos, material, parent = staticRigging, orient = 'z') {
    const object = mesh(new THREE.TorusGeometry(radius, tube, 3, 12), material, pos, parent);
    if (orient === 'y') object.rotation.x = Math.PI / 2;
    if (orient === 'x') object.rotation.y = Math.PI / 2;
    return object;
  }
  function block(pos, size = .17, parent = staticRigging, name = 'wooden-single-block') {
    counts.blocks++;
    const group = new THREE.Group(); group.position.set(...pos); group.name = name; parent.add(group);
    // Two cheeks leave a real wheel slot; the line bends around the exposed sheave.
    for (const z of [-size * .25, size * .25]) {
      const cheek = mesh(new THREE.CapsuleGeometry(size * .28, size * .48, 2, 6), materials.weathered, [0, 0, z], group);
      cheek.scale.z = .30;
    }
    mesh(new THREE.CylinderGeometry(size * .26, size * .26, size * .23, 8), materials.darkWood, [0, 0, 0], group).rotation.x = Math.PI / 2;
    ring(size * .36, size * .045, [0, 0, 0], materials.tarRope, group);
    ring(size * .12, .007, [0, size * .63, 0], materials.iron, group);
    return group;
  }
  function batch(parent, keep = new Set()) {
    parent.updateMatrixWorld(true);
    const inverse = parent.matrixWorld.clone().invert(), batches = new Map(), removed = [];
    parent.traverse(object => {
      if (!object.isMesh || keep.has(object) || Array.isArray(object.material)) return;
      const source = object.geometry.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld));
      const geometry = source.index ? source.toNonIndexed() : source;
      if (source !== geometry) source.dispose();
      if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
      if (!batches.has(object.material)) batches.set(object.material, []);
      batches.get(object.material).push(geometry); removed.push(object);
    });
    for (const object of removed) { object.removeFromParent(); object.geometry.dispose(); }
    for (const [material, geometries] of batches) {
      const object = mesh(mergeGeometries(geometries), material, [0, 0, 0], parent, `rigging-batch-${material.userData.role}`);
      object.castShadow = material !== materials.rope && material !== materials.tarRope;
      geometries.forEach(g => g.dispose());
    }
  }

  // Three real holes, rather than black spots, through a grooved hardwood deadeye.
  const deadeyeShape = new THREE.Shape();
  deadeyeShape.absarc(0, 0, .112, 0, Math.PI * 2, false);
  for (const [x, y] of [[-.045, -.026], [.045, -.026], [0, .045]]) {
    const hole = new THREE.Path(); hole.absarc(x, y, .021, 0, Math.PI * 2, true); deadeyeShape.holes.push(hole);
  }
  const deadeyeGeometry = new THREE.ExtrudeGeometry(deadeyeShape, { depth: .065, bevelEnabled: true, bevelSize: .004, bevelThickness: .004, bevelSegments: 1, curveSegments: 6, steps: 1 });
  deadeyeGeometry.translate(0, 0, -.0325);
  function deadeyePair(x, y, z, side) {
    for (const cy of [y, y + .46]) {
      mesh(deadeyeGeometry.clone(), materials.darkWood, [x, cy, z], staticRigging, 'three-hole-deadeye');
      ring(.11, .011, [x, cy, z], materials.tarRope); counts.deadeyes++;
    }
    const holeX = [-.045, 0, .045], lowY = [-.026, .045, -.026];
    for (let i = 0; i < 3; i++) {
      // Six taut parts of one lanyard visibly thread the paired holes.
      cord([[x + holeX[i], y + lowY[i], z + .04], [x + holeX[2 - i], y + .46 + lowY[2 - i], z + .04]], .006);
      cord([[x + holeX[i], y + lowY[i], z - .04], [x + holeX[i], y + .46 + lowY[i], z - .04]], .006);
    }
    pole([x, y - .1, z], [x, y - 1.18, z - side * .15], .027, materials.iron, .025, staticRigging, 'deadeye-chainplate', 5);
    ring(.062, .014, [x, y - 1.18, z - side * .15], materials.iron);
  }

  function platform(mast, index) {
    const size = index === 1 ? 1 : .84;
    const accessZ = [ .82, .87, .62 ][index];
    const shape = new THREE.Shape();
    shape.moveTo(-1.1 * size, -.58 * size);
    shape.lineTo(1.1 * size, -.58 * size);
    // An open outer notch receives the ladder; the inboard step-off remains solid.
    shape.lineTo(1.1 * size, -.05 * size);
    shape.lineTo(accessZ, -.05 * size);
    shape.lineTo(accessZ, .74 * size);
    const notchAngle = Math.asin((.74 - .43) / .84);
    shape.lineTo(1.1 * size * Math.cos(notchAngle), .74 * size);
    shape.absellipse(0, .43 * size, 1.1 * size, .84 * size, notchAngle, Math.PI, false, 0);
    shape.closePath();
    const mastHole = new THREE.Path(); mastHole.absarc(0, 0, mast.radius * .8 + .035, 0, Math.PI * 2, true); shape.holes.push(mastHole);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: .12, bevelEnabled: false, curveSegments: 10 });
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) { const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i); positions.setXYZ(i, y, z - .12, x); }
    geometry.computeVertexNormals();
    mesh(geometry, materials.deckWood, [mast.x, mast.nest, 0], staticRigging, `${index === 1 ? 'main' : index === 0 ? 'fore' : 'mizzen'}-mast-platform`);
    for (const x of [-.5, .65]) {
      pole([mast.x + x * size, mast.nest - .15, -1.03 * size], [mast.x + x * size, mast.nest - .15, 1.03 * size], .085, materials.darkWood);
      for (const side of [-1, 1]) pole([mast.x, mast.nest - .72, side * .2], [mast.x + x * size, mast.nest - .15, side * .97 * size], .065);
    }
    const arc = Array.from({ length: 17 }, (_, i) => {
      const a = i / 16 * Math.PI;
      return [mast.x + (.43 + .84 * Math.sin(a)) * size, mast.nest + .13, 1.1 * Math.cos(a) * size];
    });
    cord(arc, .043, materials.weathered);
    cord(arc.map(([x, y, z]) => [x, y + .57, z]), .02, materials.rope);
    for (let i = 0; i < 17; i += 4) {
      const [x, y, z] = arc[i]; pole([x, y, z], [x, y + .58, z], .028, materials.darkWood);
    }
    // Access opening, rear rail and a canvas bag attached to the platform.
    pole([mast.x + .69 * size, mast.nest + .12, .3 * size], [mast.x + .69 * size, mast.nest + .62, .3 * size], .03, materials.darkWood);
    // The shrouds converge inboard. This short futtock ladder bridges them into
    // the outer starboard notch. The captain then steps inboard onto solid wood.
    const access=SHROUD_GEOMETRY[index];
    for(const dx of[-.24,.24])cord([...([access.futtockA,access.futtockMid,access.futtockB].map(p=>[p[0]+dx,p[1],p[2]])),[access.futtockB[0]+dx,mast.nest+1.10,access.futtockB[2]]],.012,materials.tarRope,staticRigging,'mast-platform-access-side');
    for(const r of access.futtock)cord([r.a,r.b],.008,materials.rope,staticRigging,'mast-platform-access-step');
    for(const r of access.handrails)cord([r.a,r.b],.014,materials.tarRope,staticRigging,'mast-platform-grab-rail');
    box([.35, .26, .23], [mast.x + .64 * size, mast.nest + .13, -.64 * size], materials.patch);
    cord([[mast.x + .66 * size, mast.nest + .27, -.63 * size], [mast.x + .77 * size, mast.nest + .42, -.65 * size], [mast.x + .83 * size, mast.nest + .7, -.67 * size]], .009);
  }

  for (const [index, mast] of MASTS.entries()) {
    const bottom = -1.72;
    pole([mast.x, bottom, 0], [mast.x, mast.nest + .92, 0], mast.radius, mastWood, mast.radius * .66, staticRigging, 'lower-mast', 18);
    const upperEnd = index === 2 ? mast.top - 2.6 : mast.top - 5;
    pole([mast.x - .055, mast.nest - .4, .035], [mast.x - .055, upperEnd + .4, .035], mast.radius * .61, materials.weathered, mast.radius * .35, staticRigging, 'overlapping-topmast', 14);
    pole([mast.x - .10, upperEnd - .45, .055], [mast.x - .10, mast.top, .055], mast.radius * .31, mastWood, .045, staticRigging, 'topgallant-mast', 10);
    for (const y of [mast.nest + .66, upperEnd + .2]) {
      box([mast.radius * 1.9, .19, mast.radius * 2.1], [mast.x, y, .03], materials.darkWood);
      for (const dy of [-.075, .075]) ring(mast.radius * .76, .016, [mast.x, y + dy, .02], materials.tarRope, staticRigging, 'y');
    }
    const deckY = index === 2 ? 4.55 : mainDeckHeight(mast.x);
    ring(mast.radius + .028, .027, [mast.x, deckY + .11, 0], materials.patch, staticRigging, 'y');
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      box([.11, .18, .16], [mast.x + Math.cos(a) * (mast.radius + .045), deckY + .08, Math.sin(a) * (mast.radius + .045)], materials.weathered).rotation.y = -a;
    }
    platform(mast, index);

    // Channels aft of each mast keep the gun mouths and central gangway clear.
    const startX = mast.x - .3, spacing = .46, total = spacing * (mast.shrouds - 1);
    for (const side of [-1, 1]) {
      const channelY = index === 2 ? 4.25 : 2.25;
      const centerX = startX - total / 2, channelZ = side * (hullWidth(centerX) * .91 + .3);
      box([total + .5, .13, .47], [centerX, channelY, channelZ], materials.darkWood, staticRigging, 'rigging-channel');
      for (const x of [startX + .08, startX - total - .08]) {
        pole([x, channelY - .62, channelZ - side * .3], [x, channelY, channelZ + side * .17], .06, materials.wood);
      }
      const feet = [], tops = [];
      for (let j = 0; j < mast.shrouds; j++) {
        const x = startX - spacing * j, z = side * (hullWidth(x) * .91 + .48), y = channelY + .23;
        deadeyePair(x, y, z, side);
        const foot = [x, y + .57, z], top = [mast.x - .14 - j * .024, mast.nest + .27, side * .15];
        feet.push(foot); tops.push(top);
        cord([foot, top], .021, materials.tarRope, staticRigging, `mast-${index}-shroud-${side}-${j}`); counts.shrouds++;
        // Upper shrouds close the support triangle down onto the platform.
        if (j < 3) cord([[mast.x - .04, upperEnd + .1, side * .065], [mast.x - .32 - j * .16, mast.nest + .15, side * .85]], .014, materials.tarRope);
      }
      const first = feet[0], last = feet[feet.length - 1], topFirst = tops[0], topLast = tops[tops.length - 1];
      for (let y = first[1] + .31, row = 0; y < mast.nest - (side===1?2.25:.15); y += .36, row++) {
        const t = (y - first[1]) / (topFirst[1] - first[1]);
        const a = v3(first).lerp(v3(topFirst), t), b = v3(last).lerp(v3(topLast), t);
        cord([a.toArray(), [(a.x + b.x) / 2, y - .025, (a.z + b.z) / 2], b.toArray()], .008, materials.rope, staticRigging, 'shroud-ratline'); counts.ratlines++;
        if (row < 6) for (const p of [a, b]) ring(.025, .006, p.toArray(), materials.rope);
      }
      if(side===1){const access=SHROUD_GEOMETRY[index];for(const r of access.lowRungs)cord([r.a,r.b],.012,materials.rope,staticRigging,'shroud-entry-step');for(const dx of[-.27,.27])cord([[access.path.entry[0]+dx,deckY,access.feet[0][2]],[access.path.entry[0]+dx,first[1]+.31,access.feet[0][2]]],.018,materials.tarRope,staticRigging,'shroud-entry-side');}
    }
    // A belaying rack with identifiable working ends, not unexplained rope piles.
    for (const side of [-1, 1]) {
      const z = side * .78;
      for (const x of [mast.x - .55, mast.x + .55]) pole([x, deckY, z], [x, deckY + .81, z], .075, materials.darkWood);
      box([1.28, .10, .16], [mast.x, deckY + .77, z], materials.weathered);
      for (let j = 0; j < 5; j++) {
        const x = mast.x - .46 + j * .23;
        pole([x, deckY + .55, z], [x, deckY + 1.01, z], .019, materials.weathered, .023);
        if (j % 2 === 0) {
          cord([[x, deckY + .84, z], [x - .075, deckY + .5, z + side * .07], [x, deckY + .23, z + side * .09], [x + .075, deckY + .51, z + side * .06], [x, deckY + .83, z]], .012);
          cord([[x, deckY + .84, z], [x - .09, deckY + .49, z + side * .085], [x, deckY + .26, z + side * .11], [x + .09, deckY + .53, z + side * .08], [x, deckY + .84, z]], .012);
        }
      }
    }
  }
  deadeyeGeometry.dispose();

  // Stays attach forward to lower mast structure or stem fittings.
  cord([[-1, 29.5, 0], [7.5, 13.3, 0]], .037, materials.tarRope, staticRigging, 'main-topmast-stay');
  cord([[-1, 14.5, .04], [13.8, 3.65, .04]], .035, materials.tarRope, staticRigging, 'main-lower-stay');
  cord([[-10, 20.5, 0], [-1, 14.2, 0]], .028, materials.tarRope, staticRigging, 'mizzen-stay');
  cord([[7.5, 25.5, 0], [22, 6.1, 0]], .03, materials.tarRope, staticRigging, 'fore-top-stay');
  cord([[7.5, 13.3, -.06], [17.7, 4.78, -.06]], .032, materials.tarRope, staticRigging, 'fore-lower-stay');

  const bowspritA = [14.05, 3.58, 0], bowspritB = [22, 6.05, 0];
  pole(bowspritA, bowspritB, .24, materials.wood, .105, staticRigging, 'bowsprit', 16);
  for (let i = 0; i < 6; i++) {
    const p = v3(bowspritA).lerp(v3(bowspritB), .05 + i * .013);
    const hoop = ring(.242, .018, p.toArray(), materials.rope, staticRigging, 'x');
    hoop.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v3(bowspritB).sub(v3(bowspritA)).normalize());
  }
  cord([[21.5, 5.9, 0], [18.75, .65, 0], [16.15, -.35, 0]], .035, materials.tarRope, staticRigging, 'bowsprit-bobstay');
  for (const side of [-1, 1]) {
    cord([[21.4, 5.87, side * .06], [17.9, 4.2, side * .52], [14.8, 3.0, side * .86]], .027, materials.tarRope, staticRigging, 'bowsprit-side-stay');
    block([14.8, 3.1, side * .85], .21);
  }

  function squarePoint(u, v, width, height, topRatio) {
    const span = width * (topRatio + (1 - topRatio) * v);
    const belly = -width * .055 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    const crease = .025 * Math.sin(u * 54 + v * 5) * Math.pow(Math.abs(u - .5) * 2, 5) * Math.sin(Math.PI * v);
    return [belly + crease, -height * v + .15 * Math.sin(Math.PI * u) * Math.pow(v, 3), (u - .5) * span];
  }
  function squareSail(mastIndex, headY, width, footY, name, topRatio = .88) {
    const mast = MASTS[mastIndex], height = headY - footY;
    const isSprit = name === 'bowsprit-spritsail';
    const rigGroup = new THREE.Group(); rigGroup.name = `${name}-yard-and-sail`; rigGroup.position.set(isSprit ? 18.55 : mast.x + .05, headY, 0); rigGroup.rotation.y = -.08; animated.add(rigGroup);
    const stateGroup = new THREE.Group(); stateGroup.name = `${name}-furl-state`; rigGroup.add(stateGroup);
    const group = new THREE.Group(); group.name = `${name}-furlable-canvas`; stateGroup.add(group);
    const geometry = new THREE.PlaneGeometry(width, height, 28, 20);
    const positions = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
      const u = uv.getX(i), v = 1 - uv.getY(i);
      positions.setXYZ(i, ...squarePoint(u, v, width * .94, height, topRatio));
      uv.setX(i, u * width / 14);
    }
    geometry.computeVertexNormals();
    let canvasGeometry = geometry, canvasMaterial = materials.sail;
    const repairs = { 'fore-course': [.78, .84, .46, .62], 'main-course': [.16, .82, .52, .65], 'main-topsail': [.70, .55, .35, .46] };
    if (repairs[name]) {
      const [centerU, centerV, patchW, patchH] = repairs[name];
      const repair = new THREE.PlaneGeometry(1, 1, 4, 4), rp = repair.attributes.position, ru = repair.attributes.uv;
      for (let i = 0; i < rp.count; i++) {
        const u = centerU + (ru.getX(i) - .5) * patchW / (width * .94), v = centerV + (.5 - ru.getY(i)) * patchH / height;
        const p = squarePoint(u, v, width * .94, height, topRatio); p[0] -= .052; rp.setXYZ(i, ...p);
      }
      repair.computeVertexNormals();
      canvasGeometry = mergeGeometries([geometry, repair]);
      const colors = new Float32Array(canvasGeometry.attributes.position.count * 3).fill(1);
      for (let i = positions.count * 3; i < colors.length; i += 3) { colors[i] = .71; colors[i + 1] = .72; colors[i + 2] = .68; }
      canvasGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      canvasGeometry.parameters = { height }; canvasMaterial = materials.repairedSail || materials.sail;
      for (const side of [-1, 1]) for (let stitch = 0; stitch < 7; stitch++) {
        const u = centerU + side * patchW / (width * .94) * .46, v = centerV + (stitch / 6 - .5) * patchH / height * .9;
        const a = squarePoint(u, v, width * .94, height, topRatio), b = squarePoint(u, v + .018 / height, width * .94, height, topRatio);
        a[0] -= .06; b[0] -= .06; cord([a, b], .003, materials.rope, group, 'repair-patch-stitch');
      }
      geometry.dispose(); repair.dispose(); counts.authoredRepairPatches++;
    }
    const cloth = mesh(canvasGeometry, canvasMaterial, [0, 0, 0], group, name); cloth.castShadow = true;
    const sail = { mesh: cloth, rest: canvasGeometry.attributes.position.array.slice(), phase: mast.x, kind: 'square', height, group: stateGroup, canvasRoot: group, rigGroup, headY, index: sails.length, width: width * .94, topRatio, pinX: mast.x, corners: [] };
    sails.push(sail); counts.squareSails++;
    // Yards taper from a thick centre to thin tips, held by a sling and lift tackles.
    for (const side of [-1, 1]) pole([0, .07, 0], [0, .07, side * width / 2], width > 10 ? .155 : .11, mastWood, .048, rigGroup, `${name}-yard-arm`, 10);
    counts.horizontalYards++;
    for (let i = 0; i < 5; i++) ring(width > 10 ? .17 : .125, .012, [0, .07, -.16 + i * .08], materials.tarRope, rigGroup);
    for (const side of [-1, 1]) {
      const yardEnd = [0, .07, side * width * .48], supportY = isSprit ? .2 : Math.min(mast.top - headY - .4, 3.3);
      cord([yardEnd, [-.055, Math.max(isSprit ? .2 : .5, supportY), side * .05]], .012, materials.rope, rigGroup, 'yard-lift');
      block([-.055, Math.max(isSprit ? .2 : .5, supportY), side * .05], .15, rigGroup);
      const braceEnd = isSprit ? [-3.6, 3.45 - headY, side * .82] : [-2.4, -headY + (mastIndex === 2 ? 5.3 : 3.15), side * Math.min(3.3, hullWidth(mast.x - 2.4) * .82)];
      rigGroup.updateMatrix();
      const fixedBraceEnd = v3(braceEnd).applyMatrix4(rigGroup.matrix);
      block(fixedBraceEnd.toArray(), .15);
      running.push({ sail, corner: v3(yardEnd), end: fixedBraceEnd, kind: 'brace', segments: 2 });
      cord([fixedBraceEnd.toArray(), [mast.x - .4, mastIndex === 2 ? 5.4 : 3.25, side * .78]], .009, materials.rope, staticRigging, 'yard-brace-return-to-pin');
    }
    for (const [edge, constant] of [['head', 0], ['foot', 1]]) {
      cord(Array.from({ length: 17 }, (_, i) => squarePoint(i / 16, constant, width * .94, height, topRatio)), .013, materials.rope, group, `${name}-${edge}-bolt-rope`);
    }
    for (const u of [0, 1]) cord(Array.from({ length: 11 }, (_, i) => squarePoint(u, i / 10, width * .94, height, topRatio)), .013, materials.rope, group);
    const ties = Math.ceil(width / .55);
    for (let i = 0; i <= ties; i++) {
      const p = squarePoint(i / ties, 0, width * .94, height, topRatio);
      cord([[p[0], .15, p[2]], [p[0] - .13, .03, p[2]], [p[0], -.10, p[2]]], .007, materials.rope, rigGroup);
    }
    for (const v of [.39, .66]) {
      const band = [];
      for (let i = 0; i <= 20; i++) band.push(squarePoint(i / 20, v, width * .94, height, topRatio));
      cord(band.map(([x, y, z]) => [x - .01, y, z]), .013, materials.patch, group);
      for (let i = 1; i < ties; i++) {
        const p = squarePoint(i / ties, v, width * .94, height, topRatio);
        p[0] -= .018;
        running.push({ sail, corner: v3(p), kind: 'reef-tail', tailLength: .23 + (i % 3) * .03, segments: 1, radius: .005 });
      }
    }
    for (const u of [0, 1]) {
      const corner = squarePoint(u, 1, width * .94, height, topRatio);
      reinforce(group, corner, [corner[0] - .007, corner[1] + .4, corner[2]], [corner[0] - .007, corner[1] + .05, corner[2] + (u ? -.42 : .42)]);
      const eye = ring(.056, .012, [corner[0] - .025, corner[1] + .06, corner[2] + (u ? -.06 : .06)], materials.rope, group, 'x');
      eye.castShadow = false; sail.corners.push(corner);
      dynamicSheet(sail, corner, u ? 1 : -1, isSprit ? 14.8 : mast.x - .85);
    }
    batch(group, new Set([cloth]));
    batch(rigGroup, new Set([cloth, ...group.children]));
    prepareCanvas(sail);
    return sail;
  }
  function reinforce(parent, a, b, c) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0], 2));
    geometry.setIndex([0, 1, 2]); geometry.computeVertexNormals();
    mesh(geometry, materials.patch, [0, 0, 0], parent, 'sewn-corner-reinforcement').castShadow = false;
  }
  function dynamicSheet(sail, corner, side, x) {
    const deckY = x < -8 ? 4.55 : x > 12.5 ? 3.1 : mainDeckHeight(x);
    const end = [x, deckY + .82, side * Math.min(3.35, hullWidth(x) * .78)];
    block(end, .18);
    const pin = [sail.pinX - .4, sail.pinX < -8 ? 5.4 : 3.25, side * .78];
    cord([end, [end[0] - .2, deckY + .4, end[2] - side * .2], pin], .009, materials.rope, staticRigging, `sail-${sail.index}-sheet-return`);
    running.push({ sail, corner: v3(corner), end: v3(end), kind: 'sheet', segments: 1 });
  }

  function restPoint(sail, u, v, out) {
    if (sail.kind === 'square') {
      const span = sail.width * (sail.topRatio + (1 - sail.topRatio) * v);
      const belly = -sail.width * .055 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      const crease = .025 * Math.sin(u * 54 + v * 5) * (Math.abs(u - .5) * 2) ** 5 * Math.sin(Math.PI * v);
      return out.set(belly + crease, -sail.height * v + .15 * Math.sin(Math.PI * u) * v ** 3, (u - .5) * span);
    }
    const w = Math.max(0, 1 - u - v);
    out.copy(sail.triangleB).multiplyScalar(u).addScaledVector(sail.triangleC, v);
    const free = sail.fixedEdge === 'ab' ? v : u;
    out.z += .58 * 27 * u * v * w + .016 * Math.sin(u * 55 + v * 23) * Math.pow(1 - Math.min(u, v, w) * 3, 6) * Math.sin((u + v) * Math.PI) * Math.min(1, free * 8);
    return out;
  }
  function canvasParameters(sail, x, y, z) {
    let u, v;
    if (sail.kind === 'square') {
      v = THREE.MathUtils.clamp(-y / sail.height, 0, 1);
      for (let i = 0; i < 5; i++) {
        u = THREE.MathUtils.clamp(z / (sail.width * (sail.topRatio + (1 - sail.topRatio) * v)) + .5, 0, 1);
        v = THREE.MathUtils.clamp((-y + .15 * Math.sin(Math.PI * u) * v ** 3) / sail.height, 0, 1);
      }
    } else {
      const b = sail.triangleB, c = sail.triangleC, det = b.x * c.y - b.y * c.x;
      u = THREE.MathUtils.clamp((x * c.y - y * c.x) / det, 0, 1);
      v = THREE.MathUtils.clamp((b.x * y - b.y * x) / det, 0, 1);
      if (u + v > 1) { const sum = u + v; u /= sum; v /= sum; }
    }
    const base = restPoint(sail, u, v, new THREE.Vector3());
    return [u, v, x - base.x, y - base.y, z - base.z];
  }
  function prepareCanvas(sail) {
    sail.bundleRadius = sail.kind === 'square' ? .22 * (sail.height / 8) ** .25 : .17;
    sail.parts = sail.canvasRoot.children.filter(o => o.isMesh).map(object => {
      const p = object.geometry.attributes.position, params = new Float32Array(p.count * 5);
      for (let i = 0; i < p.count; i++) params.set(canvasParameters(sail, p.getX(i), p.getY(i), p.getZ(i)), i * 5);
      p.setUsage(THREE.DynamicDrawUsage); object.frustumCulled = false;
      return { object, params };
    });
    sail.bundleAxis = sail.kind === 'square' ? new THREE.Vector3(0, 0, 1) : (sail.fixedEdge === 'ab' ? sail.triangleB : sail.triangleC).clone().normalize();
    sail.bundleSide = sail.kind === 'square' ? new THREE.Vector3(1, 0, 0) : (sail.fixedEdge === 'ab' ? sail.triangleC : sail.triangleB).clone();
    if (sail.kind === 'triangle') sail.bundleSide.addScaledVector(sail.bundleAxis, -sail.bundleSide.dot(sail.bundleAxis)).normalize();
    sail.bundleCross = new THREE.Vector3().crossVectors(sail.bundleAxis, sail.bundleSide).normalize();
    const bundleGeometry = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)), 20, .2, 8, false);
    sail.bundleCapStart = bundleGeometry.attributes.position.count;
    const cappedPositions = new Float32Array((sail.bundleCapStart + 2) * 3), cappedUV = new Float32Array((sail.bundleCapStart + 2) * 2), capIndices = [...bundleGeometry.index.array];
    cappedPositions.set(bundleGeometry.attributes.position.array); cappedUV.set(bundleGeometry.attributes.uv.array);
    cappedUV.set([0, 0, 1, 0], sail.bundleCapStart * 2);
    for (const end of [0, 1]) for (let i = 0; i < 8; i++) {
      const ring = end ? 20 * 9 : 0, center = sail.bundleCapStart + end;
      capIndices.push(center, ring + (end ? i : i + 1), ring + (end ? i + 1 : i));
    }
    bundleGeometry.setAttribute('position', new THREE.BufferAttribute(cappedPositions, 3)); bundleGeometry.setAttribute('uv', new THREE.BufferAttribute(cappedUV, 2)); bundleGeometry.deleteAttribute('normal'); bundleGeometry.setIndex(capIndices);
    bundleGeometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    sail.bundle = mesh(bundleGeometry, materials.sail, [0, 0, 0], sail.canvasRoot, `${sail.mesh.name}-gathered-canvas`);
    sail.bundle.frustumCulled = false;
    const tieCount = sail.kind === 'square' ? Math.ceil(sail.width / 1.6) : 6, tieParams = [], tieIndices = [];
    for (let tie = 0; tie < tieCount; tie++) {
      const base = tieParams.length / 3, s = (tie + .5) / tieCount;
      for (let ring = 0; ring < 8; ring++) for (let section = 0; section < 3; section++) tieParams.push(s, ring / 8 * Math.PI * 2, section / 3 * Math.PI * 2);
      for (let ring = 0; ring < 8; ring++) for (let section = 0; section < 3; section++) {
        const a = base + ring * 3 + section, b = base + ((ring + 1) % 8) * 3 + section;
        const c = base + ring * 3 + (section + 1) % 3, d = base + ((ring + 1) % 8) * 3 + (section + 1) % 3;
        tieIndices.push(a, b, c, b, d, c);
      }
    }
    const ties = new THREE.BufferGeometry();
    ties.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tieParams.length), 3).setUsage(THREE.DynamicDrawUsage));
    ties.setAttribute('uv', new THREE.Float32BufferAttribute(tieParams.flatMap((_, i) => i % 3 ? [] : [tieParams[i + 1] / (Math.PI * 2), tieParams[i + 2] / (Math.PI * 2)]), 2));
    ties.setIndex(tieIndices);
    sail.tieParams = tieParams;
    sail.ties = mesh(ties, materials.rope, [0, 0, 0], sail.canvasRoot, `${sail.mesh.name}-furl-gaskets`);
    sail.ties.castShadow = false; sail.ties.frustumCulled = false;
    sail.mesh.userData.fixedEdge = sail.kind === 'square' ? 'head' : sail.fixedEdge;
    sail.mesh.userData.furlBundle = sail.bundle.name;
  }
  const surface = new THREE.Vector3(), bundleCenter = new THREE.Vector3(), radial = new THREE.Vector3();
  function surfacePoint(sail, u, v, q, time, strength, out) {
    if (sail.kind === 'square') {
      const activeV = Math.min(v, q);
      restPoint(sail, u, activeV, out);
      if (v > q && q < .9999) {
        const r = bundleRadius(sail, q, u), fold = (v - q) / (1 - q) * Math.PI * 6, phase = Math.sin(u * 23) * .2;
        out.x += r * (Math.cos(fold + phase) - Math.cos(phase));
        out.y += r * .7 * (Math.sin(fold + phase) - Math.sin(phase));
      }
      // Both head and foot corners are constrained; only the fabric between them moves.
      const flutter = Math.sin(Math.PI * activeV / Math.max(q, .0001)) * (.35 + .65 * Math.sin(Math.PI * u));
      out.x += Math.sin(time * 1.1 + u * 7 + sail.phase) * .045 * flutter * q * strength;
    } else {
      restPoint(sail, u, v, out);
      const free = sail.fixedEdge === 'ab' ? v : u;
      const along = out.dot(sail.bundleAxis);
      const across = out.dot(sail.bundleSide), belly = out.z;
      out.copy(sail.bundleAxis).multiplyScalar(along).addScaledVector(sail.bundleSide, across * q);
      out.z = belly * q;
      const flutter = free * (1 - free) * Math.sin(Math.PI * (u + v));
      out.z += Math.sin(time * 1.1 + (u + v) * 6 + sail.phase) * .16 * flutter * q * strength;
    }
    return out;
  }
  function bundleRadius(sail, q, s) {
    return sail.bundleRadius * Math.sqrt(1 - q) * (1 + .07 * Math.sin(s * 37) + .035 * Math.sin(s * 71));
  }
  function bundleRingRadius(radius, s, angle) {
    return radius * (1 + .085 * Math.cos(angle * 3 + s * 21) + .025 * Math.sin(angle * 5 - s * 37));
  }
  function bundleFrame(sail, q, s, out) {
    if (sail.kind === 'square') { restPoint(sail, s, q, out); out.x -= .06; }
    else { out.copy(sail.fixedEdge === 'ab' ? sail.triangleB : sail.triangleC).multiplyScalar(s); out.addScaledVector(sail.bundleSide, .025); out.z += .035; }
    return bundleRadius(sail, q, s);
  }

  squareSail(0, 12, 14, 4, 'fore-course', .98);
  squareSail(0, 20, 11.5, 12.9, 'fore-topsail', .74);
  squareSail(0, 24, 7.5, 20.6, 'fore-topgallant', .74);
  squareSail(1, 13, 16, 4.5, 'main-course', .98);
  squareSail(1, 22, 13, 13.85, 'main-topsail', .74);
  squareSail(1, 27, 8.5, 22.7, 'main-topgallant', .74);
  squareSail(2, 18, 6.5, 13.4, 'mizzen-topsail', .74);
  // Ninth yard (after the spritsail yard) has no large mizzen course.
  for (const side of [-1, 1]) {
    pole([-10, 12.2, 0], [-10, 12.2, side * 2.9], .11, mastWood, .05, staticRigging, 'bare-mizzen-lower-yard', 10);
    cord([[-10, 12.2, side * 2.8], [-10, 17.7, side * .07]], .011, materials.rope, staticRigging, 'bare-mizzen-yard-lift');
  }
  counts.horizontalYards++;

  function triangleSail(points, name, phase) {
    const [a, b, c] = points.map(v3), height = a.y - Math.min(b.y, c.y);
    const rigGroup = new THREE.Group(); rigGroup.name = `${name}-rig`; rigGroup.position.copy(a); animated.add(rigGroup);
    const stateGroup = new THREE.Group(); stateGroup.name = `${name}-furl-state`; rigGroup.add(stateGroup);
    const group = new THREE.Group(); group.name = `${name}-furlable-canvas`; stateGroup.add(group);
    const positions = [], uvs = [], indices = [], rows = [], divisions = 22;
    const point = (u, v) => {
      const p = a.clone().lerp(b, u).add(c.clone().sub(a).multiplyScalar(v)).sub(a);
      const w = Math.max(0, 1 - u - v);
      p.z += .58 * 27 * u * v * w;
      const free = name === 'mizzen-lateen' ? v : u;
      p.z += .016 * Math.sin(u * 55 + v * 23) * Math.pow(1 - Math.min(u, v, w) * 3, 6) * Math.sin((u + v) * Math.PI) * Math.min(1, free * 8);
      return p.toArray();
    };
    for (let i = 0; i <= divisions; i++) {
      rows.push(positions.length / 3);
      for (let j = 0; j <= divisions - i; j++) {
        const u = i / divisions, v = j / divisions;
        positions.push(...point(u, v)); uvs.push(v * Math.max(3.5, Math.abs(c.x - b.x)) / 14, 1 - u);
      }
    }
    for (let i = 0; i < divisions; i++) {
      for (let j = 0; j < divisions - i; j++) {
        const p = rows[i] + j, q = rows[i + 1] + j;
        indices.push(p, q, p + 1);
        if (j < divisions - i - 1) indices.push(p + 1, q, q + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.parameters = { height }; geometry.computeVertexNormals();
    const cloth = mesh(geometry, materials.sail, [0, 0, 0], group, name);
    const sail = { mesh: cloth, rest: geometry.attributes.position.array.slice(), phase, kind: 'triangle', height, group: stateGroup, canvasRoot: group, rigGroup, headY: a.y, index: sails.length, pinX: name === 'mizzen-lateen' ? -10 : 7.5, corners: [point(1, 0), point(0, 1)], triangleB: b.clone().sub(a), triangleC: c.clone().sub(a), fixedEdge: name === 'mizzen-lateen' ? 'ab' : 'ac' };
    sails.push(sail); counts.triangularSails++;
    if (name !== 'mizzen-lateen') cord([a.toArray(), c.toArray()], .022, materials.tarRope, staticRigging, `${name}-supporting-stay`);
    for (const edge of [t => point(t, 0), t => point(0, t), t => point(t, 1 - t)]) cord(Array.from({ length: 17 }, (_, i) => edge(i / 16)), .014, materials.rope, group, `${name}-bolt-rope`);
    for (const [u, v] of [[0, 0], [1, 0], [0, 1]]) {
      const p = point(u, v), inward = point(u * .94 + .02, v * .94 + .02), near = point(u * .94 + .045, v * .94 + .005);
      reinforce(group, [p[0], p[1], p[2] + .012], [inward[0], inward[1], inward[2] + .012], [near[0], near[1], near[2] + .012]);
      ring(.052, .011, [p[0], p[1] + (u + v ? .045 : -.045), p[2] + .02], materials.rope, group);
    }
    for (let i = 2; i < 18; i++) {
      const p = point(i / 22, .17);
      running.push({ sail, corner: v3(p), kind: 'reef-tail', tailLength: .20 + (i % 3) * .025, segments: 1, radius: .005 });
    }
    block([a.x, a.y + .15, a.z], .19);
    const heel = name === 'mizzen-lateen' ? [-10.46, 5.38, .78] : [7.96, 3.25, .78];
    cord([[a.x, a.y + .15, a.z], [heel[0], heel[1], heel[2]]], .011, materials.rope, staticRigging, `${name}-halyard-to-pin`);
    for (const [i, p] of sail.corners.entries()) dynamicSheet(sail, p, i ? 1 : -1, name === 'mizzen-lateen' ? -12.5 : 12.2);
    batch(group, new Set([cloth]));
    prepareCanvas(sail);
    return sail;
  }
  const lateenA = [-7, 16, .13], lateenB = [-14.8, 8.3, .13];
  pole(lateenA, lateenB, .135, mastWood, .055, staticRigging, 'mizzen-lateen-yard', 12); counts.lateenYards++;
  cord([[-10, 20.1, 0], [-7.45, 15.55, .13]], .015, materials.rope, staticRigging, 'lateen-yard-lift');
  cord([[-10, 18.5, 0], [-13.8, 9.3, .13]], .013, materials.rope, staticRigging, 'lateen-yard-brace');
  triangleSail([lateenA, lateenB, [-7.6, 8.25, .13]], 'mizzen-lateen', -10);
  // The lower square sail sits outside the hull, safely below the bowsprit.
  squareSail(0, 4.95, 8, 1.7, 'bowsprit-spritsail', .98);
  triangleSail([[7.45, 24.25, .16], [10.7, 12.4, .16], [18.1, 6.5, .16]], 'fore-upper-staysail', 5.7);
  triangleSail([[7.6, 20.15, -.16], [17.1, 6.02, -.16], [21.65, 6.18, -.16]], 'jib', 8.1);

  for (const [index, mast] of MASTS.entries()) {
    const width = index === 1 ? 2.8 : index === 0 ? 2.25 : 1.9, height = width * .51;
    const flagGroup = new THREE.Group(); flagGroup.position.set(mast.x - .1, mast.top - .12, .05); flagGroup.name = 'jolly-roger-flag'; animated.add(flagGroup);
    const point = (u, v) => [-u * width + .036 * Math.sin(v * 31) * Math.pow(u, 18), -v * height - .15 * u + .025 * Math.sin(u * 8) * v, .13 * Math.sin(u * 7 + index) * u + .085 * u];
    const geometry = new THREE.PlaneGeometry(width, height, 24, 10);
    const positions = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) positions.setXYZ(i, ...point(uv.getX(i), 1 - uv.getY(i)));
    geometry.computeVertexNormals();
    const emblem = new THREE.PlaneGeometry(1, 1, 14, 10), ep = emblem.attributes.position, euv = emblem.attributes.uv;
    for (let i = 0; i < ep.count; i++) { const p = point(.25 + euv.getX(i) * .49, .16 + (1 - euv.getY(i)) * .66); p[2] += .005; ep.setXYZ(i, ...p); }
    emblem.computeVertexNormals();
    const backEmblem = emblem.clone();
    const backPositions = backEmblem.attributes.position;
    for (let i = 0; i < backPositions.count; i++) backPositions.setZ(i, backPositions.getZ(i) - .01);
    backEmblem.computeVertexNormals();
    const merged = mergeGeometries([geometry, emblem, backEmblem], true); geometry.dispose(); emblem.dispose(); backEmblem.dispose();
    const object = mesh(merged, [materials.flag, materials.flagSkull, materials.flagSkull], [0, 0, 0], flagGroup, 'weathered-black-flag'); object.castShadow = true;
    flags.push({ mesh: object, rest: merged.attributes.position.array.slice(), width, height });
    for (const y of [-.12, -height + .08]) ring(.055, .008, [0, y, .06], materials.rope, flagGroup, 'y');
  }

  // A removable telescope rests in a small wooden cradle on the main platform.
  const telescope = new THREE.Group(); telescope.name = 'telescope'; telescope.position.set(-.34, 14.51, -.64); telescope.rotation.z = -.30; telescope.rotation.y = .16; telescope.userData.usable = true; ship.add(telescope);
  pole([-.27, 0, 0], [.32, 0, 0], .051, materials.brass, .060, telescope, 'telescope-barrel', 12);
  pole([.31, 0, 0], [.49, 0, 0], .072, materials.brass, .081, telescope, '', 12);
  pole([-.38, 0, 0], [-.27, 0, 0], .047, materials.darkWood, .048, telescope, '', 10);
  mesh(new THREE.CircleGeometry(.073, 12), materials.glass, [.494, 0, 0], telescope).rotation.y = Math.PI / 2;
  box([.52, .09, .19], [-.34, 14.32, -.64], materials.darkWood);
  for (const x of [-.53, -.15]) box([.075, .275, .16], [x, 14.1375, -.64], materials.darkWood);

  // One dynamic buffer keeps all moving sheets/braces connected without a draw
  // call per rope. Deck blocks remain in ship coordinates when a yard turns.
  let segmentCount = 0;
  for (const line of running) { line.offset = segmentCount * 8; segmentCount += line.segments; }
  const ropePositions = new Float32Array(segmentCount * 8 * 3), ropeNormals = new Float32Array(ropePositions.length), ropeUV = new Float32Array(segmentCount * 8 * 2), ropeIndices = [];
  for (let segment = 0; segment < segmentCount; segment++) for (let k = 0; k < 4; k++) {
    const base = segment * 8, next = (k + 1) % 4;
    ropeIndices.push(base + k, base + next, base + 4 + k, base + next, base + 4 + next, base + 4 + k);
  }
  const movingGeometry = new THREE.BufferGeometry();
  movingGeometry.setAttribute('position', new THREE.BufferAttribute(ropePositions, 3).setUsage(THREE.DynamicDrawUsage));
  movingGeometry.setAttribute('normal', new THREE.BufferAttribute(ropeNormals, 3).setUsage(THREE.DynamicDrawUsage));
  movingGeometry.setAttribute('uv', new THREE.BufferAttribute(ropeUV, 2).setUsage(THREE.DynamicDrawUsage));
  movingGeometry.setIndex(ropeIndices);
  const movingRigging = mesh(movingGeometry, materials.rope, [0, 0, 0], animated, 'moving-sheets-and-yard-braces');
  movingRigging.castShadow = false; movingRigging.frustumCulled = false;
  movingRigging.userData.lines = running.map(line => ({ sail: line.sail.index, kind: line.kind, vertex: line.offset, segments: line.segments, ...(line.end ? { fixedEnd: line.end.toArray() } : { tailLength: line.tailLength }) }));
  const endpoint = new THREE.Vector3(), direction = new THREE.Vector3(), sideVector = new THREE.Vector3(), crossVector = new THREE.Vector3(), middle = new THREE.Vector3();
  const alternateUp = new THREE.Vector3(0, 0, 1);
  function writeSegment(offset, a, b, radius = .01) {
    direction.copy(b).sub(a); const length = Math.max(.001, direction.length()); direction.multiplyScalar(1 / length);
    sideVector.crossVectors(direction, Math.abs(direction.y) > .95 ? alternateUp : up).normalize();
    crossVector.crossVectors(direction, sideVector).normalize();
    for (let end = 0; end < 2; end++) for (let k = 0; k < 4; k++) {
      const angle = k / 4 * Math.PI * 2, ca = Math.cos(angle), sa = Math.sin(angle);
      const nx = sideVector.x * ca + crossVector.x * sa, ny = sideVector.y * ca + crossVector.y * sa, nz = sideVector.z * ca + crossVector.z * sa;
      const i = offset + end * 4 + k, center = end ? b : a;
      ropePositions[i * 3] = center.x + nx * radius; ropePositions[i * 3 + 1] = center.y + ny * radius; ropePositions[i * 3 + 2] = center.z + nz * radius;
      ropeNormals[i * 3] = nx; ropeNormals[i * 3 + 1] = ny; ropeNormals[i * 3 + 2] = nz;
      ropeUV[i * 2] = k / 4; ropeUV[i * 2 + 1] = end * length / .22;
    }
  }
  let sailTime = 0, windStrength = 1;
  function updateCanvas(sail, time, strength, normals = false) {
    const q = (sail.group.scale.y - .06) / .94;
    for (const { object, params } of sail.parts) {
      const p = object.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const j = i * 5;
        surfacePoint(sail, params[j], params[j + 1], q, time, strength, surface);
        p.setXYZ(i, surface.x + params[j + 2], surface.y + params[j + 3], surface.z + params[j + 4]);
      }
      p.needsUpdate = true;
      object.geometry.boundingBox = null;
      if (normals) object.geometry.computeVertexNormals();
    }
    sail.bundle.visible = sail.ties.visible = q < .98;
    // GLB has no core visibility flag; zero-size dormant bundles also survive
    // the complete-ship export, which deliberately includes hidden interiors.
    sail.bundle.scale.setScalar(sail.bundle.visible ? 1 : 0); sail.ties.scale.copy(sail.bundle.scale);
    if (sail.bundleQ !== q) {
      sail.bundleQ = q;
      const p = sail.bundle.geometry.attributes.position, uv = sail.bundle.geometry.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const s = uv.getX(i), angle = uv.getY(i) * Math.PI * 2, r = bundleFrame(sail, q, s, bundleCenter);
        radial.copy(sail.bundleSide).multiplyScalar(Math.cos(angle)).addScaledVector(sail.bundleCross, Math.sin(angle) * .74);
        surface.copy(bundleCenter).addScaledVector(radial, i < sail.bundleCapStart ? bundleRingRadius(r, s, angle) : 0);
        p.setXYZ(i, surface.x, surface.y, surface.z);
      }
      p.needsUpdate = true;
      sail.bundle.geometry.boundingBox = null;
      sail.bundle.geometry.computeVertexNormals();
      const ties = sail.ties.geometry.attributes.position;
      for (let i = 0; i < ties.count; i++) {
        const j = i * 3, s = sail.tieParams[j], angle = sail.tieParams[j + 1], section = sail.tieParams[j + 2];
        const r = bundleFrame(sail, q, s, bundleCenter);
        radial.copy(sail.bundleSide).multiplyScalar(Math.cos(angle)).addScaledVector(sail.bundleCross, Math.sin(angle) * .74);
        surface.copy(bundleCenter).addScaledVector(radial, bundleRingRadius(r, s, angle) * 1.02 + .008 * Math.cos(section)).addScaledVector(sail.bundleAxis, .008 * Math.sin(section));
        ties.setXYZ(i, surface.x, surface.y, surface.z);
      }
      ties.needsUpdate = true; sail.ties.geometry.boundingBox = null; sail.ties.geometry.computeVertexNormals();
    }
    sail.group.updateMatrix(); sail.canvasRoot.updateMatrix(); sail.rigGroup.updateMatrix();
  }
  function updateLines(sail) {
    sail.group.updateMatrix(); sail.rigGroup.updateMatrix();
    for (const line of running) if (line.sail === sail) {
      endpoint.copy(line.corner);
      if (line.kind !== 'brace') {
        line.params ||= canvasParameters(sail, endpoint.x, endpoint.y, endpoint.z);
        const [u, v, dx, dy, dz] = line.params;
        surfacePoint(sail, u, v, (sail.group.scale.y - .06) / .94, sailTime, windStrength, endpoint);
        endpoint.x += dx; endpoint.y += dy; endpoint.z += dz;
      }
      endpoint.applyMatrix4(sail.rigGroup.matrix);
      if (line.kind === 'reef-tail') {
        middle.copy(endpoint); middle.x -= .01; middle.y -= line.tailLength; middle.z += .017;
        writeSegment(line.offset, endpoint, middle, line.radius);
      } else if (line.segments === 2) {
        middle.copy(endpoint).lerp(line.end, .48); middle.y -= .2;
        writeSegment(line.offset, endpoint, middle); writeSegment(line.offset + 8, middle, line.end);
      } else writeSegment(line.offset, endpoint, line.end);
    }
    movingGeometry.attributes.position.needsUpdate = true; movingGeometry.attributes.normal.needsUpdate = true; movingGeometry.attributes.uv.needsUpdate = true;
  }
  function setSailFurl(index, factor) {
    const sail = sails[index]; if (!sail) return;
    if (!Number.isFinite(factor)) throw new TypeError('Sail furl must be finite');
    const f = THREE.MathUtils.clamp(factor, .06, 1);
    if (f === sail.appliedFactor) return;
    sail.appliedFactor = f;
    // Keep the public scale as state, while authored geometry gathers the cloth.
    sail.group.scale.set(1, f, 1); sail.canvasRoot.scale.set(1, 1 / f, 1);
    updateCanvas(sail, sailTime, windStrength, true); updateLines(sail);
  }
  function animateSails(elapsed, strength = 1) {
    if (!Number.isFinite(elapsed) || !Number.isFinite(strength)) throw new TypeError('Sail animation inputs must be finite');
    sailTime = elapsed; windStrength = THREE.MathUtils.clamp(strength, 0, 2);
    for (const sail of sails) {
      if (sail.group.scale.y === .06) continue;
      const normals = elapsed - (sail.normalTime ?? -1) > .16;
      updateCanvas(sail, elapsed, windStrength, normals); updateLines(sail);
      if (normals) sail.normalTime = elapsed;
    }
  }
  function setYardAngle(index, angle) {
    const sail = sails[index]; if (!sail || sail.kind !== 'square') return false;
    if (!Number.isFinite(angle)) throw new TypeError('Yard angle must be finite');
    sail.rigGroup.rotation.y = THREE.MathUtils.clamp(angle, -.65, .65);
    sail.rigGroup.updateMatrix(); updateLines(sail);
    return true;
  }
  sails.forEach((_, index) => setSailFurl(index, index === 0 || index === 3 ? .06 : 1));
  batch(staticRigging);
  staticRigging.userData.componentCounts = counts;
  staticRigging.userData.riggingPaths = paths;
  animated.userData.sailCount = 11;
  return { sails, flags, telescope, animated, staticRigging, setSailFurl, setYardAngle, animateSails };
}
