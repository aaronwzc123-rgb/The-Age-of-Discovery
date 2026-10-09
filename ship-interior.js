import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hullWidth, hullHalfWidthAt } from './ship-layout.js';
import { CLIMB_PATHS } from './climb-paths.js';

// Ship-local convention follows the game: +X bow, +Z starboard, metres.
// These helpers bake timber and fittings without baking hinges or hanging lamps.
export function createModelKit(materials = {}, woodTexture = null) {
  const mat = (name, color, extra = {}) => {
    const material = materials[name] || new THREE.MeshStandardMaterial({ color, roughness: .88, ...extra });
    material.name ||= name;
    return material;
  };
  const m = {
    wood: mat('wood', '#776950', { map: woodTexture }),
    lightWood: mat('deckWood', '#9c8b6c', { map: woodTexture }),
    darkWood: mat('darkWood', '#443b31', { map: woodTexture }),
    red: mat('red', '#764b3e', { map: woodTexture }),
    iron: mat('iron', '#303334', { metalness: .62, roughness: .65 }),
    rust: mat('rust', '#624738', { metalness: .35, roughness: .85 }),
    brass: mat('brass', '#9b8050', { metalness: .68, roughness: .48 }),
    rope: mat('rope', '#998c69'),
    cloth: mat('sail', '#b9b4a4', { side: THREE.DoubleSide }),
    blanket: mat('blanket', '#646b68', { side: THREE.DoubleSide }),
    seam: mat('tar', '#292823'),
    paper: mat('parchment', '#c6b898'),
    glass: mat('glass', '#68847d', { metalness: .05, roughness: .3, transparent: true, opacity: .42, side: THREE.DoubleSide, depthWrite: false }),
    glow: mat('lampGlass', '#d9b37a', { emissive: '#ffa840', emissiveIntensity: .3, roughness: .55 }),
    flame: materials.flame || new THREE.MeshBasicMaterial({ color: '#ffd399' }),
    ceramic: mat('ceramic', '#8a7560'),
    wet: mat('wet', '#36392e', { roughness: .7 }),
  };
  if (!materials.blanket && m.cloth.map) { m.blanket.map=m.cloth.map; m.blanket.bumpMap=m.cloth.bumpMap; m.blanket.bumpScale=m.cloth.bumpScale; }
  const mesh = (parent, geometry, material, position = [0, 0, 0]) => {
    const object = new THREE.Mesh(geometry, material); object.position.set(...position);
    object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  };
  const box = (parent, size, position, material = m.wood) => {
    const geometry=new THREE.BoxGeometry(...size);
    if ([m.wood,m.lightWood,m.darkWood,m.red].includes(material)) {
      const major=size.indexOf(Math.max(...size)),p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
      for(let i=0;i<p.count;i++) {
        const coords=[p.getX(i),p.getY(i),p.getZ(i)],normals=[n.getX(i),n.getY(i),n.getZ(i)],face=normals.findIndex(v=>Math.abs(v)>.5);
        const grain=face===major?[0,1,2].find(a=>a!==face):major;
        const cross=[0,1,2].find(a=>a!==face&&a!==grain);
        uv.setXY(i,coords[cross]/2,coords[grain]/4);
      }
    }
    return mesh(parent,geometry,material,position);
  };
  const pole = (parent, a, b, radius, material = m.wood, top = radius) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const object = mesh(parent, new THREE.CylinderGeometry(top, radius, start.distanceTo(end), 8), material, start.clone().add(end).multiplyScalar(.5).toArray());
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize()); return object;
  };
  const cable = (parent, points, radius = .018, material = m.rope) => {
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),geometry=new THREE.TubeGeometry(curve,Math.max(8,Math.min(192,Math.ceil(points.length*1.5))),radius,5,false);
    if (material===m.rope||material===m.wood||material===m.darkWood) {
      const uv=geometry.attributes.uv,length=curve.getLength(),unit=material===m.rope?.22:4;
      for(let i=0;i<uv.count;i++){const along=uv.getX(i);uv.setXY(i,uv.getY(i),along*length/unit);}
    }
    return mesh(parent,geometry,material);
  };
  const ring = (parent, r, tube, position, material = m.iron, rotate = [Math.PI / 2, 0, 0]) => {
    const object = mesh(parent, new THREE.TorusGeometry(r, tube, 5, 18), material, position); object.rotation.set(...rotate); return object;
  };
  const batch = (group) => {
    const batches = new Map();
    for (const object of [...group.children]) {
      if (!object.isMesh) continue;
      object.updateMatrix();
      const g = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      g.applyMatrix4(object.matrix);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!batches.has(object.material)) batches.set(object.material, []);
      batches.get(object.material).push(g); group.remove(object); object.geometry.dispose();
    }
    for (const [material, parts] of batches) {
      const object = mesh(group, mergeGeometries(parts), material); object.name = `${group.name}-${material.name}`;
      parts.forEach(g => g.dispose());
    }
  };
  const barrel = (parent, x, floor, z, h = .85, r = .275, kind = 0) => {
    // Coopered cask: convex staves, inset lid, hoop seats and a side bung.
    const profile = [[r * .84, 0], [r * .91, h * .06], [r, h * .34], [r * 1.015, h * .52], [r, h * .68], [r * .9, h * .94], [r * .84, h]];
    mesh(parent, new THREE.LatheGeometry(profile.map(([a, b]) => new THREE.Vector2(a, b)), 18), kind === 2 ? m.darkWood : m.wood, [x, floor, z]);
    for (const t of [.075, .28, .73, .925]) {
      const radius = r * (t < .12 || t > .9 ? .91 : 1.012);
      mesh(parent, new THREE.CylinderGeometry(radius + .005, radius + .005, .043, 18, 1, true), kind === 1 ? m.darkWood : m.iron, [x, floor + h * t, z]);
    }
    for (let a = 0; a < 18; a++) {
      const angle = a / 18 * Math.PI * 2;
      cable(parent, profile.map(([rad, y]) => [x + (rad + .003) * Math.cos(angle), floor + y, z + (rad + .003) * Math.sin(angle)]), .003, m.darkWood);
    }
    mesh(parent, new THREE.CylinderGeometry(r * .8, r * .8, .035, 18), m.lightWood, [x, floor + h - .025, z]);
    for (const d of [-.14, -.047, .047, .14]) {
      const length = 2 * Math.sqrt(Math.max(.002, (r * .78) ** 2 - d ** 2));
      box(parent, [length, .003, .003], [x, floor + h - .006, z + d], m.darkWood);
    }
    const bung = mesh(parent, new THREE.CylinderGeometry(.031, .027, .016, 8), m.lightWood, [x, floor + h * .61, z + r * 1.01]); bung.rotation.x = Math.PI / 2;
    if (kind === 0) box(parent, [.03, .105, .008], [x, floor + h * .5, z + r * 1.022], m.darkWood);
    return { x, z, radius: r, height: h };
  };
  const chest = (parent, x, floor, z, length = .8, depth = .42, height = .4, fine = false) => {
    box(parent, [length, height, depth], [x, floor + height / 2, z], fine ? m.darkWood : m.wood);
    box(parent, [length + .025, .045, depth + .025], [x, floor + height, z], m.lightWood);
    for (const dx of [-length * .38, length * .38]) {
      box(parent, [.034, height + .045, depth + .035], [x + dx, floor + height / 2, z], m.iron);
      for (const y of [.07, height - .05]) mesh(parent, new THREE.SphereGeometry(.009, 5, 4), m.iron, [x + dx, floor + y, z + depth / 2 + .02]);
    }
    box(parent, [.05, .09, .035], [x, floor + height * .68, z + depth / 2 + .025], m.brass);
    ring(parent, .024, .007, [x, floor + height * .69, z + depth / 2 + .05], m.iron, [0, 0, 0]);
  };
  const coil = (parent, x, y, z, r = .2, turns = 4, radius = .015) => {
    const points = Array.from({ length: turns * 28 }, (_, i) => {
      const a = i / 28 * Math.PI * 2, rad = r - i / 28 * radius * 2;
      return [x + Math.cos(a) * rad, y + .008 * Math.sin(a * .5), z + Math.sin(a) * rad];
    }); cable(parent, points, radius);
  };
  return { m, mesh, box, pole, cable, ring, batch, barrel, chest, coil };
}

export function buildShipInterior(ship, materials = {}, woodTexture = null) {
  const { m, mesh, box, pole, cable, ring, batch, barrel, chest, coil } = createModelKit(materials, woodTexture);
  const cabin = new THREE.Group(); cabin.name = 'walkable-cabin'; ship.add(cabin); cabin.visible = false;
  const captainCabin = new THREE.Group(); captainCabin.name = 'captain-cabin'; ship.add(captainCabin);
  const brig = new THREE.Group(); brig.name = 'brig'; cabin.add(brig);
  const cargo = new THREE.Group(); cargo.name = 'cargo-hold'; cabin.add(cargo);
  const overhead = new THREE.Group(); overhead.name = 'interior-overhead'; cabin.add(overhead);
  const captainRoof = new THREE.Group(); captainRoof.name = 'captain-roof-beams'; captainCabin.add(captainRoof);
  const cellDoors = [], interiorLamps = [], collisions = [];
  const floorY = .15, cargoY = -1.85;
  box(cabin,[.15,2,3.8],[-14.05,1.15,0],m.wood);
  // Tumblehome curves inward above the waterline; the lower hold rounds towards the keel.
  const widthAt = (x, y) => Math.max(.12, hullHalfWidthAt(x, y) - .14);
  const collide = (x, z, w, d, minY = floorY, maxY = 2.1, kind = 'furniture') => collisions.push({ room: minY >= 2.3 ? 'captain' : minY < -1 ? 'hold' : 'lower', x, z, w, d, minY, maxY, kind });
  function gridSurface(parent, x0, x1, rows, cols, point, material) {
    const p = [], uv = [], ix = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const x = THREE.MathUtils.lerp(x0, x1, i / cols),pt=point(x,j/rows);p.push(...pt);
      if(material.name==='interior-lining'||[m.wood,m.lightWood,m.darkWood,m.red].includes(material))uv.push(pt[1]/2,x/4);else uv.push(x/2,j/rows);
      if (i < cols && j < rows) { const a = j * (cols + 1) + i, b = a + cols + 1; ix.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(ix); geometry.computeVertexNormals();
    return mesh(parent, geometry, material);
  }
  // Continuous, curved inner planks follow the real hull. No fake portholes below the waterline.
  const liner = m.wood.clone(); liner.name = 'interior-lining'; liner.side = THREE.DoubleSide;
  for (const side of [-1, 1]) {
    gridSurface(cabin, -14.1, 12.6, 10, 100, (x, t) => { const y = floorY + t * 2.15; return [x, y, side * widthAt(x, y)]; }, liner);
    for (let y = .25; y < 2.24; y += .275) cable(cabin, Array.from({ length: 45 }, (_, i) => { const x = -14.1 + i / 44 * 26.7; return [x, y, side * (widthAt(x, y) - .004)]; }), .0035, m.darkWood);
    gridSurface(cargo, -13.6, 12, 10, 96, (x, t) => { const y = cargoY + t * 1.9; return [x, y, side * widthAt(x, y)]; }, liner);
  }
  // Planked decks taper at the ends. Staggered seams are millimetres, not open holes.
  for (let z = -3.8; z < 3.8; z += .27) {
    let start = null;
    for (let x = -14.1; x <= 12.7; x += .2) {
      const valid = Math.abs(z) + .14 < widthAt(x, floorY) && !(x > 2 && x < 4 && Math.abs(z) < .8);
      if (valid && start === null) start = x;
      if ((!valid || x > 12.5) && start !== null) {
        const end = x - .2;
        if (end > start) box(cabin, [end - start, .075, .266], [(start + end) / 2, floorY - .0375, z], m.lightWood);
        start = null;
      }
    }
    for (let x = -12.2 + (((z + 4) * 17) % 1) * 2.8; x < 12; x += 3.1) if (Math.abs(z) + .14 < widthAt(x, floorY)) box(cabin, [.004, .002, .26], [x, floorY + .001, z], m.darkWood);
  }
  // Cargo sole is narrower than the living deck and never cuts through the rounded bilge.
  for (let z = -2.4; z <= 2.4; z += .26) {
    let start = null;
    for (let x = -13.4; x <= 12; x += .2) {
      const valid = Math.abs(z) + .14 < widthAt(x, cargoY);
      if (valid && start === null) start = x;
      if ((!valid || x > 11.8) && start !== null) { const end = x - .2; if (end > start) box(cargo, [end - start, .08, .255], [(start + end) / 2, cargoY - .04, z], m.wood); start = null; }
    }
  }
  // Frame knees show where loads meet. Most ribs are behind lining; repair bays expose selected ribs.
  for (let x = -13.5; x < 12; x += .55) {
    const half = widthAt(x, 2.1);
    for (const side of [-1, 1]) {
      const exposed = x < -9.5 || (x > 4.2 && x < 6.5) || x > 10.5;
      if (exposed) cable(cabin, [[x, .18, side * (widthAt(x, .18) - .07)], [x, 1.1, side * (widthAt(x, 1.1) - .08)], [x + .025, 2.06, side * (half - .07)]], .092, m.darkWood);
      if (Math.round((x + 13.5) / .55) % 3 === 0) {
        cable(overhead, [[x, 1.58, side * (widthAt(x, 1.58) - .1)], [x, 2.06, side * (half - .27)], [x, 2.14, side * (half - .65)]], .1, m.darkWood);
      }
      cable(cargo, [[x, -1.93, side * (widthAt(x, -1.93) - .06)], [x, -1.05, side * (widthAt(x, -1.05) - .055)], [x, -.1, side * (widthAt(x, -.1) - .055)]], .09, m.darkWood);
    }
  }
  for (let x = -13.4; x < 12; x += 1.65) {
    const half = widthAt(x, 2.12); cable(overhead, [[x, 2.06, -half], [x, 2.19, 0], [x, 2.06, half]], .105, m.darkWood);
    if (Math.abs(x - 3) > 1.25) box(cargo, [.18, .17, widthAt(x, -.08) * 2], [x, -.03, 0], m.darkWood);
  }
  box(cargo, [25.2, .22, .28], [-.65, -2.06, 0], m.darkWood);
  for (const x of [7.5, -1, -10]) {
    box(cargo, [.95, .2, .82], [x, -1.76, 0], m.darkWood); collide(x, 0, .78, .78, floorY, 2.4, 'mast'); collide(x, 0, .78, .78, cargoY, .15, 'mast');
    for (const dx of [-.34, .34]) box(cabin, [.11, .18, .55], [x + dx, .24, 0], m.wood);
  }
  // Ladder foot is outside the central circulation line; rails continue through the actual hatch.
  for (const dx of [-.29, .29]) pole(cabin, [-4 + dx, .15, -.08], [-4 + dx, 2.6, .65], .045, m.darkWood);
  for (const r of CLIMB_PATHS.find(p=>p.id==='hatch').rungs) pole(cabin,r.a,r.b,.036,m.lightWood);
  for(const dx of[-.29,.29])pole(cabin,[-4+dx,2.6,.65],[-4+dx,3.6,.65],.045,m.darkWood);
  for(const r of CLIMB_PATHS.find(p=>p.id==='hatch').handrails)pole(cabin,r.a,r.b,.035,m.lightWood);
  cable(cabin,[[-4.48,1.38,.78],[-4.48,2.18,.78],[-4.48,2.57,-.28],[-4,2.57,-.28]],.017,m.rope);
  ring(cabin,.065,.014,[-4.48,1.30,.78],m.iron,[Math.PI/2,0,0]);
  // Cargo access is a genuine opening with its own companion ladder.
  for (const dz of [-.38, .38]) pole(cargo, [3.5, cargoY, dz], [2.9, 2.6, dz], .05, m.darkWood);
  for (const r of CLIMB_PATHS.find(p=>p.id==='cargo').rungs) pole(cargo,r.a,r.b,.035,m.lightWood);
  for(const dz of[-.38,.38])pole(cargo,[2.9,2.6,dz],[2.9,3.6,dz],.05,m.darkWood);
  for(const r of CLIMB_PATHS.find(p=>p.id==='cargo').handrails)pole(cargo,r.a,r.b,.035,m.lightWood);

  // Four retrofit cells, two on each side of an unobstructed 1.1 m passage.
  const corridor = .55, centers = [-8.3, -6.3];
  for (const side of [-1, 1]) for (let cell = 0; cell < 2; cell++) {
    const x = centers[cell], zOuter = side * 2.17, doorHalf = .335;
    box(brig,[1.98,1.84,.10],[x,1.07,zOuter],m.wood);
    collide(x,zOuter,1.98,.10,.15,1.99,'cell-back-wall');
    for (const dx of [-.99, .99]) box(brig, [.095, 1.84, 1.67], [x + dx, 1.07, side * 1.38], m.wood);
    for (const dx of [-.68, .68]) box(brig, [.62, 1.84, .09], [x + dx, 1.07, side * corridor], m.lightWood);
    box(brig, [.69, .16, .12], [x, 1.99, side * corridor], m.darkWood);
    for (const dx of [-.36, .36]) box(brig, [.09, 1.77, .12], [x + dx, 1.035, side * corridor], m.darkWood);
    const door = new THREE.Group(); door.name = `cell-door-${side < 0 ? 'port' : 'starboard'}-${cell + 1}`; door.position.set(x - doorHalf, .15, side * corridor); brig.add(door);
    door.userData = { closed: true, center: { x, z: side * corridor }, swing: -side, width: .67, stopAngle: -side * 1.42 };
    for (const dx of [0, .67]) box(door, [.085, 1.72, .08], [dx, .86, 0], m.wood);
    for (const y of [.045, 1.675]) box(door, [.67, .09, .095], [.335, y, 0], m.darkWood);
    for (let i = 0; i < 6; i++) pole(door, [.10 + i * .095, .08, 0], [.10 + i * .095, 1.63, 0], .0105, m.iron);
    for (const y of [.44, 1.16]) box(door, [.61, .022, .034], [.335, y, 0], m.iron);
    for (const y of [.25, 1.36]) {
      box(door, [.20, .055, .017], [.09, y, side * .065], m.iron);
      pole(door, [0, y - .06, side * .065], [0, y + .06, side * .065], .018, m.iron);
      box(brig, [.12, .07, .028], [x - .40, .15 + y, side * (.55 - .063)], m.iron);
    }
    box(door, [.14, .045, .022], [.62, .9, side * .066], m.iron);
    box(door, [.075, .095, .047], [.60, .835, side * .09], m.iron);
    ring(door, .036, .011, [.60, .902, side * .09], m.iron, [0, 0, 0]);
    mesh(door, new THREE.SphereGeometry(.008, 5, 4), m.seam, [.60, .845, side * .117]);
    batch(door); cellDoors.push(door);
    // Every bed is actually only 0.55 m wide. A clear standing patch remains behind each door.
    box(brig, [1.7, .065, .55], [x, .48, side * 1.82], m.darkWood);
    for (const dx of [-.69, .69]) box(brig, [.09, .33, .49], [x + dx, .315, side * 1.82], m.wood);
    box(brig, [1.64, .028, .51], [x, .526, side * 1.82], m.blanket);
    const pillow = mesh(brig, new THREE.SphereGeometry(1, 10, 6), m.cloth, [x - .61, .568, side * 1.82]); pillow.scale.set(.21, .055, .22);
    for (let j = 0; j < 6; j++) cable(brig, [[x - .62 + j * .21, .542, side * 1.60], [x - .64 + j * .21, .549, side * 1.84], [x - .61 + j * .21, .539, side * 2.04]], .007, m.rope);
    box(brig, [.42, .035, .26], [x + .63, .83, side * 1.50], m.wood);
    const pitcher = mesh(brig, new THREE.LatheGeometry([new THREE.Vector2(.05, 0), new THREE.Vector2(.095, .05), new THREE.Vector2(.1, .15), new THREE.Vector2(.065, .22), new THREE.Vector2(.063, .28)], 12), m.ceramic, [x + .66, .85, side * 1.52]);
    ring(brig, .061, .015, [x + .76, .99, side * 1.52], m.ceramic, [0, Math.PI / 2, 0]);
    mesh(brig, new THREE.CylinderGeometry(.033, .027, .06, 10, 1, true), m.wood, [x + .51, .895, side * 1.49]);
    // The sanitation bucket is covered and separate from drinking vessels.
    mesh(brig, new THREE.CylinderGeometry(.14, .105, .25, 12), m.darkWood, [x - .61, .275, side * .93]);
    mesh(brig, new THREE.CylinderGeometry(.146, .146, .025, 12), m.wood, [x - .61, .41, side * .93]);
    ring(brig, .113, .009, [x - .61, .3, side * .93], m.iron);
    cable(brig, [[x - .74, .32, side * .93], [x - .61, .52, side * .93], [x - .48, .32, side * .93]], .01, m.iron);
    // Chain is anchored into a heavy frame, its slack falls naturally to the floor.
    ring(brig, .052, .013, [x + .94, .43, side * 1.12], m.iron, [0, Math.PI / 2, 0]);
    for (let j = 0; j < 9; j++) {
      const t = j / 8; ring(brig, .033, .009, [x + .89 - t * .58, .19 + .21 * (1 - t) ** 3, side * (1.12 + .25 * t)], j < 3 ? m.rust : m.iron, j % 2 ? [0, 0, Math.PI / 3] : [Math.PI / 2, 0, 0]);
    }
    for (const dx of [-.055, .055]) ring(brig, .066, .015, [x + .22 + dx, .17, side * 1.39], m.iron);
    mesh(brig, new THREE.CylinderGeometry(.115, .073, .035, 12, 1, true), m.ceramic, [x + .22, .175, side * .95]);
    // Four distinct tally groups, shallow cuts on the added partition, never fake ocean windows.
    for (let j = 0; j < 3 + cell + (side > 0 ? 2 : 0); j++) box(brig, [.004, .095, .014], [x + .933, .99 + j % 2 * .11, side * (1.04 + j * .045)], m.darkWood);
    const damp = mesh(brig, new THREE.CircleGeometry(.27, 14), m.wet, [x - .56, .153, side * .93]); damp.rotation.x = -Math.PI / 2; damp.scale.set(.8, 1, 1);
    for (const dx of [-.85, .85]) collide(x + dx, side * 1.35, .15, 1.63, floorY, 2.1, 'cell-wall');
    collide(x, side * 1.82, 1.7, .57, floorY, .6, 'cell-bed');
  }
  // Door ordering matches game CELLS: port aft/forward, starboard aft/forward.
  for (const x of [-9.36, -5.24]) for (const side of [-1, 1]) box(brig, [.1, 1.8, 1.85], [x, 1.05, side * 1.50], m.darkWood);

  // Twenty-seven cross-ship slings form ordered sleeping bays with a 1.1 m central aisle.
  const hammockXs = [-4.86, -3.87, -2.88, -1.89, -.46, .53, 1.52, 2.51, 3.50, 4.49, 5.48, 6.47, 8.05, 9.04];
  let hammockCount = 0;
  for (const side of [-1, 1]) {
    const endPoints = hammockXs.map(x => [x, 1.88, side * Math.min(3.18, widthAt(x, 1.88) - .16)]);
    cable(cabin, endPoints, .035, m.darkWood);
    for (let bay = 0; bay < hammockXs.length; bay++) {
      if (side > 0 && bay === hammockXs.length - 1) continue;
      const x = hammockXs[bay], outer = Math.min(3.14, widthAt(x, 1.80) - .16), inner = .65, span = outer - inner;
      const bedStart = inner + .25, bedEnd = outer - .25;
      gridSurface(cabin, x - .37, x + .37, 20, 10, (xx, t) => {
        const width = (xx - x) / .37, pinch = .18 + .82 * Math.sin(Math.PI * t) ** .62;
        return [x + (xx - x) * pinch, .77 + .66 * Math.abs(t * 2 - 1) ** 1.6 + .07 * width * width, side * THREE.MathUtils.lerp(bedStart, bedEnd, t)];
      }, m.cloth);
      for (const end of [0, 1]) for (const dx of [-.12, 0, .12]) cable(cabin, [[x + dx, 1.43, side * (end ? bedEnd : bedStart)], [x + dx * .3, 1.6, side * (end ? outer - .10 : inner + .1)], [x, 1.88, side * (end ? outer : inner)]], .012);
      for (const dx of [-.37, .37]) cable(cabin, Array.from({ length: 13 }, (_, j) => { const t = j / 12, pinch = .18 + .82 * Math.sin(Math.PI * t) ** .62; return [x + dx * pinch, .83 + .66 * Math.abs(t * 2 - 1) ** 1.6, side * THREE.MathUtils.lerp(bedStart, bedEnd, t)]; }), .009);
      for (const zz of [inner, outer]) { ring(cabin, .031, .009, [x, 1.89, side * zz], m.iron, [0, 0, 0]); box(overhead, [.075, .20, .065], [x, 2.0, side * zz], m.darkWood); }
      if (bay % 4 === 1) {
        const blanket = box(cabin, [.53, .025, .53], [x, .845, side * ((bedStart + bedEnd) / 2)], m.blanket); blanket.rotation.z = .025 * side;
      }
      if (bay % 3 === 0) { const bag = mesh(cabin, new THREE.SphereGeometry(.13, 10, 7), m.darkWood, [x + .30, .62, side * (outer - .3)]); bag.scale.set(.6, 1.15, .75); cable(cabin, [[x + .3, .73, side * (outer - .3)], [x + .26, 1.07, side * (outer - .23)]], .011); }
      hammockCount++;
    }
  }
  for (const [x, side] of [[-3.7,-1],[-1.85,1],[.55,-1],[2.45,1],[5.5,-1],[8.1,1]]) {
    const z = side * (widthAt(x, floorY) - .40); chest(cabin, x, floorY, z, .75, .39, .37);
    cable(cabin, [[x - .32, .25, z - .22], [x - .32, .60, z], [x - .32, .25, z + .22]], .016); collide(x, z, .80, .48, floorY, .6, 'sea-chest');
  }
  // Rolled spare hammocks are lashed to beam hooks, not added as extra occupied bunks.
  for (let i = 0; i < 3; i++) { const roll = mesh(cabin, new THREE.CylinderGeometry(.073, .073, .75, 10), m.cloth, [4.7 + i * .19, 1.93, 3.30]); roll.rotation.z = Math.PI / 2; for (const dx of [-.22, .22]) ring(cabin, .079, .012, [4.7 + i * .19 + dx, 1.93, 3.30], m.rope, [0, Math.PI / 2, 0]); }

  // Bow galley: hearth isolates the timber and the flue continues to an actual deck outlet.
  box(cabin, [2.5, .07, 1.85], [10.55, .185, -1.14], m.ceramic);
  box(cabin, [1.16, .57, .73], [10.25, .50, -1.20], m.iron);
  box(cabin, [1.26, .09, .82], [10.25, .83, -1.20], m.iron);
  box(cabin, [.42, .31, .028], [10.25, .50, -.819], m.seam);
  for (const dx of [-.24,.24]) box(cabin, [.025, .34, .04], [10.25 + dx, .50, -.80], m.iron);
  box(cabin, [.12, .035, .04], [10.4, .54, -.776], m.brass);
  for (const z of [-1.43,-.98]) pole(cabin, [9.88,.95,z], [10.64,.95,z], .025, m.iron);
  const pot = mesh(cabin, new THREE.LatheGeometry([new THREE.Vector2(.20,0),new THREE.Vector2(.28,.07),new THREE.Vector2(.32,.25),new THREE.Vector2(.31,.39),new THREE.Vector2(.335,.40)], 20), m.iron, [10.25,.94,-1.2]);
  for (const dx of [-.35,.35]) ring(cabin, .09,.025,[10.25+dx,1.16,-1.2],m.iron,[0,Math.PI/2,0]);
  mesh(cabin,new THREE.CylinderGeometry(.308,.308,.02,20),m.seam,[10.25,1.318,-1.2]);
  pole(cabin,[10.73,.84,-1.4],[10.73,3.3,-1.4],.12,m.iron); ring(cabin,.15,.022,[10.73,2.12,-1.4],m.iron);
  const exteriorFlue = new THREE.Group(); exteriorFlue.name='galley-flue-outlet'; ship.add(exteriorFlue);
  pole(exteriorFlue,[10.73,2.4,-1.4],[10.73,3.33,-1.4],.125,m.iron);
  mesh(exteriorFlue,new THREE.ConeGeometry(.19,.12,12),m.iron,[10.73,3.42,-1.4]); box(exteriorFlue,[.44,.028,.44],[10.73,2.43,-1.4],m.iron); batch(exteriorFlue);
  const counterZ = 1.30; box(cabin,[2.5,.07,.54],[10.65,.95,counterZ],m.wood); for(const x of [9.5,11.8]) box(cabin,[.10,.72,.46],[x,.54,counterZ],m.darkWood);
  for (const dz of [-.25,.25]) box(cabin,[2.5,.06,.034],[10.65,1.01,counterZ+dz],m.darkWood);
  box(cabin,[.50,.025,.32],[10.43,1.01,counterZ],m.lightWood);
  box(cabin,[.18,.013,.055],[10.6,1.035,counterZ],m.iron); box(cabin,[.16,.026,.047],[10.76,1.037,counterZ],m.darkWood);
  for (let i=0;i<4;i++) { const x=9.65+i*.32; mesh(cabin,new THREE.LatheGeometry([new THREE.Vector2(.07,0),new THREE.Vector2(.11,.09),new THREE.Vector2(.1,.23),new THREE.Vector2(.07,.28)],12),m.ceramic,[x,1.0,counterZ]); mesh(cabin,new THREE.CylinderGeometry(.072,.072,.025,10),m.darkWood,[x,1.29,counterZ]); }
  pole(cabin,[9.45,1.77,1.78],[11.84,1.77,1.78],.035,m.darkWood);
  for(const [x,r] of [[9.72,.14],[10.14,.17],[10.66,.12]]) {
    cable(cabin,[[x,1.77,1.78],[x,1.54,1.78],[x+.025,1.49,1.78]],.013,m.iron);
    const pan=mesh(cabin,new THREE.CylinderGeometry(r,r*.78,.06,14),m.iron,[x,1.26,1.79]); pan.rotation.x=Math.PI/2;
    pole(cabin,[x,1.32,1.79],[x,1.52,1.79],.017,m.iron);
  }
  for (const [x,z,kind] of [[11.82,-1.10,1],[11.74,.07,0],[9.4,1.42,1]]) { barrel(cabin,x,floorY,z,.82,.275,kind); collide(x,z,.58,.58,floorY,1.05,'galley-cask'); }
  mesh(cabin,new THREE.CylinderGeometry(.17,.14,.34,14,1,true),m.wood,[11.0,.34,.28]); ring(cabin,.172,.011,[11.0,.47,.28]);
  mesh(cabin,new THREE.LatheGeometry([new THREE.Vector2(.1,0),new THREE.Vector2(.17,.12),new THREE.Vector2(.12,.27),new THREE.Vector2(.04,.37)],14),m.ceramic,[9.6,.99,counterZ]);
  cable(cabin,[[10.4,1.39,-1.22],[10.48,1.51,-1.2]],.018,m.wood);
  // A small lashed vegetable box and distinct waste pail stay beneath the preparation bench.
  box(cabin,[.62,.25,.38],[11.25,.35,1.3],m.darkWood); for(const z of [1.1,1.5]) box(cabin,[.65,.035,.025],[11.25,.49,z],m.lightWood);
  for(let i=0;i<5;i++){const vegetable=mesh(cabin,new THREE.SphereGeometry(.085,9,6),m.wet,[11.05+i*.09,.53,1.3+.08*Math.sin(i*2)]);vegetable.scale.y=.7;}
  collide(10.25,-1.2,1.32,.9,floorY,1.7,'stove'); collide(10.65,1.3,2.6,.63,floorY,1.1,'galley-counter');

  // Repair bay has a tool rack, restrained worktop and curled shavings near the vice.
  box(cabin,[1.25,.075,.50],[5.92,.84,-3.12],m.lightWood);
  for(const x of [5.42,6.42]) box(cabin,[.09,.63,.42],[x,.48,-3.12],m.darkWood);
  box(cabin,[1.3,.09,.055],[5.92,.95,-3.39],m.wood);
  for(let i=0;i<5;i++) { const x=5.49+i*.2; pole(cabin,[x,1.06,-3.39],[x,1.43,-3.39],.018,m.darkWood); box(cabin,[.035,.13,.025],[x,1.04,-3.39],m.iron); }
  box(cabin,[.24,.15,.11],[6.28,.93,-3.2],m.darkWood); pole(cabin,[6.28,.93,-3.32],[6.28,.93,-2.93],.024,m.iron);
  pole(cabin,[5.58,.92,-3.3],[5.82,.92,-3.08],.018,m.wood); box(cabin,[.13,.07,.052],[5.55,.92,-3.33],m.iron);
  for(let i=0;i<8;i++) cable(cabin,[[5.92+i*.027,.90,-3.14],[5.99+i*.027,.90,-3.11],[5.98+i*.027,.924,-3.09],[5.96+i*.027,.942,-3.11]],.0035,m.lightWood);
  chest(cabin,4.47,floorY,-3.22,.75,.45,.38); box(cabin,[.45,.14,.27],[4.45,.61,-3.22],m.cloth); coil(cabin,4.5,.695,-3.20,.15,3);
  // Fold-away mess table is outboard and its crockery is behind a retaining lip.
  box(cabin,[1.28,.055,.54],[1.0,.72,3.23],m.wood); for(const x of [.47,1.53]) box(cabin,[.075,.53,.05],[x,.435,3.23],m.darkWood);
  for(const z of [2.97,3.49]) box(cabin,[1.32,.04,.028],[1.0,.772,z],m.darkWood);
  for(const x of [.67,1.10]) mesh(cabin,new THREE.CylinderGeometry(.11,.069,.046,12,1,true),m.ceramic,[x,.773,3.23]);
  for(const x of [.5,1.48]) { box(cabin,[.29,.038,.28],[x,.36,2.75],m.wood); for(const dx of [-.11,.11]) pole(cabin,[x+dx,.15,2.65],[x+dx,.34,2.75],.026,m.darkWood); }
  // Long guns have separate barrels, locks and butt stocks, tied into notched timber.
  for(const x of [2.25,2.45,2.65]) { pole(cabin,[x,.52,-3.46],[x,1.73,-3.42],.019,m.iron); box(cabin,[.065,.45,.058],[x,.49,-3.46],m.darkWood); box(cabin,[.085,.065,.095],[x,.69,-3.42],m.iron); ring(cabin,.053,.011,[x,1.18,-3.41],m.rope,[0,0,0]); }
  for(const y of [.48,1.14]) box(cabin,[.64,.05,.17],[2.45,y,-3.42],m.wood);

  // Cargo stocks are kept low and lashed onto bearers; no modern warehouse racks.
  const waterBarrels=[];
  for(const side of [-1,1]) for(let bay=0;bay<10;bay++) {
    const x=-4.8+bay*.72, z=side*1.83;
    box(cargo,[.66,.09,.62],[x,cargoY+.04,z],m.darkWood);
    waterBarrels.push(barrel(cargo,x,cargoY+.09,z,.85,.275,0));
    cable(cargo,[[x-.24,cargoY+.12,z-side*.31],[x-.22,cargoY+.98,z],[x+.23,cargoY+.98,z],[x+.26,cargoY+.12,z+side*.31]],.019);
    collide(x,z,.6,.64,cargoY,-.7,'water-barrel');
  }
  for(const side of [-1,1]) for(const x of [4.9,6.0,8.7]) {
    const z=side*Math.min(1.7,widthAt(x,cargoY)-.38);
    chest(cargo,x,cargoY+.08,z,.88,.62,.50); box(cargo,[.93,.08,.64],[x,cargoY+.035,z],m.darkWood);
    if(x===6.0){const sack=mesh(cargo,new THREE.SphereGeometry(.34,12,8),m.cloth,[x+.12,cargoY+.85,z]);sack.scale.set(.92,1.08,.7);pole(cargo,[x+.12,cargoY+1.12,z],[x+.12,cargoY+1.24,z],.06,m.cloth,.035);ring(cargo,.056,.011,[x+.12,cargoY+1.16,z],m.rope);}
    cable(cargo,[[x-.38,cargoY+.15,z-.31],[x-.35,cargoY+.67,z],[x+.36,cargoY+.67,z],[x+.40,cargoY+.15,z+.31]],.016);
    collide(x,z,1.0,.75,cargoY,-.5,'cargo-box');
  }
  // Folded canvas, spare pulley blocks and a dry rope coil above the damp sole.
  for(let i=0;i<3;i++) { const roll=mesh(cargo,new THREE.CylinderGeometry(.13,.13,1.25,12),m.cloth,[7.55,cargoY+.33+i*.24,-1.36]);roll.rotation.z=Math.PI/2; for(const x of [7.2,7.9]) ring(cargo,.138,.015,[x,cargoY+.33+i*.24,-1.36],m.rope,[0,Math.PI/2,0]); }
  coil(cargo,9.0,cargoY+.09,-.73,.33,5,.025);
  // Raised magazine has no burning lamp. Its entrance opens on the cargo aisle, independent of the brig.
  const magazine = new THREE.Group(); magazine.name='powder-magazine'; cargo.add(magazine);
  for(const z of [-.87,.87]) box(magazine,[2.07,1.30,.09],[-12.48,-.835,z],m.darkWood);
  box(magazine,[.08,1.30,1.78],[-13.52,-.835,0],m.wood);
  for(const z of [-.67,.67]) box(magazine,[.09,1.30,.45],[-11.44,-.835,z],m.wood);
  box(magazine,[.09,.26,.99],[-11.44,-.30,0],m.darkWood);
  box(magazine,[2.0,.07,1.64],[-12.48,-1.49,0],m.lightWood);
  for(const x of [-12.9,-12.2]) for(const z of [-.48,.48]) barrel(magazine,x,-1.45,z,.65,.22,2);
  const powderDoor=new THREE.Group();powderDoor.name='powder-door';powderDoor.position.set(-11.42,-1.45,-.40);magazine.add(powderDoor);
  box(powderDoor,[.06,1.25,.77],[0,.625,.385],m.darkWood); for(const y of [.23,1.06]) box(powderDoor,[.075,.036,.77],[.045,y,.385],m.iron);box(powderDoor,[.08,.09,.04],[.055,.64,.66],m.brass);batch(powderDoor);
  collide(-12.48,0,2.1,1.8,cargoY,-.2,'powder-magazine');
  // A cabled bilge pump terminates in the screened sump, clear of ballast and stores.
  pole(cargo,[.1,-2.13,.62],[.1,.3,.62],.10,m.darkWood);
  box(cargo,[.52,.08,.48],[.1,-2.10,.62],m.iron);
  for(let i=0;i<5;i++) box(cargo,[.39,.025,.025],[.1,-2.05,.46+i*.073],m.iron);
  const bilge=mesh(cargo,new THREE.CircleGeometry(.72,24),m.wet,[.18,-2.14,.4]);bilge.rotation.x=-Math.PI/2;bilge.scale.set(1.25,.55,1);
  for(let i=0;i<46;i++){const x=-9.6+(i%15)*1.12,z=((i*7)%9-4)*.21;const rock=mesh(cargo,new THREE.DodecahedronGeometry(.12+(i%3)*.035),m.wet,[x,-2.22,z]);rock.scale.set(1.4,.65,1);rock.rotation.y=i*.73;}

  // Captain's chamber sits on the MAIN deck under the quarterdeck, with a real 0.75 m doorway.
  const captainFloor=2.4;
  for(let z=-2.65;z<2.65;z+=.24) {
    const wA=widthAt(-8,2.4), wB=widthAt(-15.96,2.4);
    const x0=-15.96+(Math.max(0,Math.abs(z)-wB)/Math.max(.001,wA-wB))*7.96;
    if(x0<-8.03) box(captainCabin,[-8-x0,.09,.236],[(x0-8)/2,2.355,z],m.lightWood);
  }
  for(const side of [-1,1]) {
    for (const [xa,xb,ya,yb] of [[-15.75,-13.22,2.4,4.36],[-12.58,-8,2.4,4.36],[-13.22,-12.58,2.4,3.25],[-13.22,-12.58,3.96,4.36]]) gridSurface(captainCabin,xa,xb,6,Math.max(4,Math.ceil((xb-xa)*6)),(x,t)=>[x,ya+t*(yb-ya),side*widthAt(x,2.4)],liner);
    for(let y=2.6;y<4.35;y+=.24) for(const [xa,xb] of (y>3.25&&y<3.96?[[-15.75,-13.22],[-12.58,-8]]:[[-15.75,-8]])) cable(captainCabin,Array.from({length:21},(_,i)=>{const x=xa+i/20*(xb-xa);return[x,y,side*(widthAt(x,2.4)-.004)];}),.004,m.darkWood);
    for(const x of [-13.45,-12.3,-11.1,-9.85,-8.7]) cable(captainRoof,[[x,3.8,side*(hullWidth(x)*.9-.23)],[x,4.22,side*(hullWidth(x)*.9-.39)],[x,4.3,side*(hullWidth(x)*.9-.70)]],.085,m.darkWood);
  }
  for(const x of [-13.6,-12.0,-10.4,-8.8]) cable(captainRoof,[[x,4.31,-(hullWidth(x)*.90-.24)],[x,4.39,0],[x,4.31,hullWidth(x)*.90-.24]],.09,m.darkWood);
  const frontHalf=hullWidth(-8)*.90-.2;
  for(const side of [-1,1]){
    box(captainCabin,[.13,1.78,frontHalf-.435],[-8,3.29,side*(frontHalf+.435)/2],m.red);
    for(const[a,b]of [[.435,.92],[1.88,frontHalf]])if(b>a)box(captainCabin,[.13,.16,b-a],[-8,4.26,side*(a+b)/2],m.red);
  }
  box(captainCabin,[.13,.18,.85],[-8,4.30,0],m.darkWood);
  for(const z of [-.405,.405]) box(captainCabin,[.17,1.84,.12],[-7.985,3.32,z],m.darkWood);
  const cabinDoor=new THREE.Group();cabinDoor.name='cabin-door';cabinDoor.position.set(-7.99,2.4,-.375);captainCabin.add(cabinDoor);
  cabinDoor.userData={center:{x:-8,z:0},width:.75,swing:-1};
  for(let i=0;i<5;i++) box(cabinDoor,[.07,1.7,.145],[0,.85,.075+i*.15],i%2?m.wood:m.red);
  for(const y of [.20,1.46]) box(cabinDoor,[.036,.09,.73],[-.055,y,.375],m.darkWood);
  for(const y of [.25,1.45]) {pole(cabinDoor,[0,y-.065,0],[0,y+.065,0],.018,m.iron);box(cabinDoor,[.026,.065,.20],[.05,y,.09],m.iron);}
  box(cabinDoor,[.027,.18,.07],[.063,.82,.62],m.iron);ring(cabinDoor,.05,.013,[.092,.88,.62],m.iron,[0,Math.PI/2,0]);box(cabinDoor,[.028,.035,.14],[.065,.98,.65],m.iron);batch(cabinDoor);
  // The exterior builder owns all five true stern windows. The room opens to that transom;
  // its rear working bay has a rope barrier, not fake windows in a solid interior wall.
  for(const z of [-1.9,1.9]) pole(captainCabin,[-14.35,2.4,z],[-14.35,3.24,z],.043,m.darkWood);
  cable(captainCabin,[[-14.35,3.20,-1.9],[-14.35,3.12,0],[-14.35,3.20,1.9]],.027);
  for(const side of [-1,1]) cable(captainCabin,[[-14.45,3.27,side*1.8],[-15.10,3.26,side*1.5],[-15.65,3.23,side*.28]],.025,m.rope);
  for(const x of [-13.50,-11.0]) box(captainCabin,[.09,1.87,.09],[x,3.335,2.0],m.darkWood);
  // Writing desk, one anchored chair and a folded stool.
  const deskStart=captainCabin.children.length;
  box(captainCabin,[1.35,.07,.75],[-12.58,3.16,.05],m.wood);
  for(const dx of [-.53,.53]) for(const dz of [-.26,.26]) box(captainCabin,[.075,.69,.075],[-12.58+dx,2.78,.05+dz],m.darkWood);
  for(const z of [-.335,.435]) box(captainCabin,[1.4,.047,.032],[-12.58,3.216,z],m.darkWood);
  box(captainCabin,[.50,.14,.65],[-12.88,3.0,.05],m.darkWood);box(captainCabin,[.03,.037,.12],[-12.607,3.00,.05],m.brass);
  const chart=box(captainCabin,[.88,.005,.53],[-12.49,3.203,.08],m.paper);
  // Written bearings and a hand-built coastline; all restrained beneath the paper clips.
  for(let i=0;i<5;i++) cable(captainCabin,[[-12.77+i*.16,3.21,-.09],[-12.67+i*.11,3.21,.22]],.00035,m.darkWood);
  cable(captainCabin,[[-12.8,3.212,.11],[-12.65,3.212,.18],[-12.50,3.212,.13],[-12.32,3.212,.19],[-12.13,3.212,.08]],.0006,m.darkWood);
  ring(captainCabin,.051,.0004,[-12.20,3.212,-.045],m.darkWood);for(const dx of [-.41,.41]) box(captainCabin,[.038,.01,.07],[-12.49+dx,3.217,.31],m.brass);
  box(captainCabin,[.21,.026,.17],[-12.90,3.204,-.12],m.darkWood);
  mesh(captainCabin,new THREE.CylinderGeometry(.037,.044,.065,10),m.glass,[-12.90,3.26,-.12]);pole(captainCabin,[-12.90,3.28,-.12],[-12.93,3.46,-.12],.004,m.darkWood);
  const feather=mesh(captainCabin,new THREE.SphereGeometry(.058,8,5),m.cloth,[-12.94,3.43,-.12]);feather.scale.set(.13,1.3,.28);
  box(captainCabin,[.21,.005,.15],[-12.98,3.212,.20],m.paper);mesh(captainCabin,new THREE.CylinderGeometry(.025,.027,.007,8),m.red,[-12.98,3.22,.20]);
  // Quiet personal details: one repaired pipe and a restrained wine bottle.
  pole(captainCabin,[-13.01,3.22,.32],[-12.90,3.23,.34],.006,m.darkWood);mesh(captainCabin,new THREE.CylinderGeometry(.024,.019,.031,8),m.darkWood,[-13.01,3.232,.32]);
  mesh(captainCabin,new THREE.LatheGeometry([new THREE.Vector2(.036,0),new THREE.Vector2(.046,.02),new THREE.Vector2(.046,.17),new THREE.Vector2(.021,.20),new THREE.Vector2(.018,.28)],12),m.glass,[-13.08,3.2,-.24]);
  box(captainCabin,[.46,.045,.46],[-11.38,2.85,.05],m.darkWood);for(const dx of [-.17,.17]) for(const dz of [-.17,.17]) box(captainCabin,[.046,.42,.046],[-11.38+dx,2.62,.05+dz],m.wood);
  box(captainCabin,[.45,.45,.055],[-11.10,3.1,.05],m.wood);for(const z of [-.12,.22]) cable(captainCabin,[[-11.11,2.42,z],[-11.32,2.88,z],[-11.11,2.86,z]],.012);
  for(const object of captainCabin.children.slice(deskStart)){object.position.x+=1.18;object.position.z+=1.15;}
  mesh(captainCabin,new THREE.CylinderGeometry(.036,.036,.12,12),m.wet,[-11.90,3.30,.91]);
  mesh(captainCabin,new THREE.CylinderGeometry(.019,.019,.022,8),m.darkWood,[-11.90,3.48,.91]);
  collide(-11.4,1.2,1.4,.80,2.4,3.25,'captain-desk');collide(-10.2,1.2,.7,.7,2.4,3.4,'captain-chair');
  // Narrow berth hugs one side; its small curtain does not turn the room into a palace.
  box(captainCabin,[1.88,.34,.70],[-11.46,2.61,-2.02],m.darkWood);box(captainCabin,[1.8,.095,.65],[-11.46,2.828,-2.02],m.cloth);
  box(captainCabin,[1.36,.028,.62],[-11.30,2.895,-2.02],m.blanket);const pillow=mesh(captainCabin,new THREE.SphereGeometry(1,12,7),m.cloth,[-12.18,2.92,-2.02]);pillow.scale.set(.17,.066,.26);
  for(const x of [-12.42,-10.51]) box(captainCabin,[.09,.63,.73],[x,2.765,-2.02],m.wood);
  pole(captainCabin,[-12.39,3.96,-2.23],[-10.5,3.96,-2.23],.025,m.darkWood);
  gridSurface(captainCabin,-12.34,-11.9,16,10,(x,t)=>[x,3.95-t*1.04,-2.20+.035*Math.sin((x+12.34)*55)],m.blanket);
  collide(-11.46,-2.02,1.96,.78,2.4,3.0,'captain-bed');
  // Shallow bookcase with retaining bars, leather spines and unequal paper edges.
  box(captainCabin,[1.32,1.08,.055],[-10.9,3.32,2.39],m.darkWood);
  for(const y of [2.77,3.12,3.51,3.88]) {box(captainCabin,[1.34,.045,.26],[-10.9,y,2.27],m.wood);box(captainCabin,[1.31,.033,.035],[-10.9,y+.065,2.12],m.darkWood);}
  for(const y of [2.82,3.19,3.57]) for(let i=0;i<10;i++){const h=.24+(i%3)*.016,x=-11.47+i*.12;box(captainCabin,[.10,h,.19],[x,y+h/2,2.27],i%3===0?m.red:m.darkWood);for(const yy of [-.065,.065])box(captainCabin,[.082,.008,.006],[x,y+h/2+yy,2.169],m.brass);}
  chest(captainCabin,-13.1,2.4,1.42,.65,.4,.35,true);collide(-13.1,1.42,.7,.45,2.4,2.85,'treasure-chest');
  box(captainCabin,[.45,.18,.30],[-9.04,2.92,1.55],m.darkWood);box(captainCabin,[.51,.04,.34],[-9.04,2.75,1.55],m.wood);for(const dx of [-.17,.17])box(captainCabin,[.05,.30,.05],[-9.04+dx,2.58,1.55],m.darkWood);
  // Small framed likeness has no glowing fantasy insignia.
  box(captainCabin,[.38,.50,.045],[-9.9,3.68,2.54],m.darkWood);box(captainCabin,[.29,.40,.05],[-9.9,3.68,2.51],m.paper);const portrait=mesh(captainCabin,new THREE.SphereGeometry(.063,10,6),m.wood,[-9.9,3.75,2.473]);portrait.scale.z=.1;
  collide(-10.9,2.26,1.35,.35,2.4,4,'bookcase');

  // Lamps are authored hardware with real 20–30 mm flames, each independently switchable.
  function lantern(parent, id, xyz, type='hanging', live=false) {
    const object=new THREE.Group();object.name=`oil-lamp-${id}`;object.position.set(...xyz);parent.add(object);
    const localGlow=m.glow.clone();localGlow.name=`lamp-glass-${id}`;localGlow.emissiveIntensity=live?.62:0;
    const glowing=[];
    if(type==='table') {
      mesh(object,new THREE.LatheGeometry([new THREE.Vector2(.065,0),new THREE.Vector2(.078,.025),new THREE.Vector2(.064,.072),new THREE.Vector2(.024,.1)],14),m.brass,[0,0,0]);
      pole(object,[.015,.07,0],[.066,.101,0],.012,m.brass,.008);box(object,[.023,.009,.012],[.073,.108,0],m.seam);ring(object,.087,.009,[0,.01,0],m.brass);
      const f=mesh(object,new THREE.SphereGeometry(.013,8,6),m.flame,[.072,.125,0]);f.scale.set(.65,1.3,.50);f.visible=live;glowing.push(f);
    } else if(type==='candle') {
      mesh(object,new THREE.LatheGeometry([new THREE.Vector2(.087,0),new THREE.Vector2(.058,.027),new THREE.Vector2(.025,.06),new THREE.Vector2(.024,.12)],14),m.brass,[0,0,0]);
      mesh(object,new THREE.CylinderGeometry(.025,.027,.12,12),m.paper,[0,.174,0]);ring(object,.033,.009,[0,.126,0],m.paper);box(object,[.004,.012,.004],[0,.241,0],m.seam);
      const f=mesh(object,new THREE.SphereGeometry(.013,8,6),m.flame,[0,.257,0]);f.scale.set(.62,1.45,.5);f.visible=live;glowing.push(f);
    } else {
      const width=type==='spare'?.14:.20, base=width*.54, body=.23;
      for(const dx of [-base,base]) for(const dz of [-base,base]) pole(object,[dx,-.125,dz],[dx,.115,dz],.012,m.iron);
      for(const y of [-.134,.126])box(object,[width+.043,.025,width+.043],[0,y,0],m.iron);
      for(const side of [-1,1]) {
        const panel=box(object,[width,.20,.006],[0,-.005,side*(base-.006)],localGlow);glowing.push(panel);
        box(object,[width,.038,.008],[0,.076,side*(base-.004)],m.seam);
        const panel2=box(object,[.006,.20,width],[side*(base-.006),-.005,0],localGlow);glowing.push(panel2);
      }
      mesh(object,new THREE.ConeGeometry(width*.88,.11,4),m.iron,[0,.192,0]).rotation.y=Math.PI/4;
      for(const dx of [-.047,.047])box(object,[.012,.008,.044],[dx,.181,-base],m.seam);
      ring(object,.048,.008,[0,.291,0],m.iron,[0,0,0]);pole(object,[0,.234,0],[0,.251,0],.010,m.iron);
      mesh(object,new THREE.CylinderGeometry(.047,.057,.057,10),m.brass,[0,-.081,0]);box(object,[.010,.017,.006],[0,-.041,0],m.seam);
      const f=mesh(object,new THREE.SphereGeometry(.012,8,6),m.flame,[0,-.018,0]);f.scale.set(.55,1.45,.6);f.visible=live;glowing.push(f);
      box(object,[.018,.055,.016],[base+.007,.003,.051],m.iron);ring(object,.017,.006,[base+.023,-.015,.043],m.brass,[0,Math.PI/2,0]);
      if(type==='hanging')cable(parent,[[xyz[0],xyz[1]+.34,xyz[2]],[xyz[0],parent===captainCabin?4.35:parent===cargo?-.08:2.16,xyz[2]]],.011,m.iron);
      if(type==='wall') {
        const side=xyz[2]<0?-1:1,wallZ=parent===brig?side*.57:id==='hatch-lower'?xyz[2]+.18:side*widthAt(xyz[0],parent===captainCabin?2.4:xyz[1]);
        if(id==='hatch-lower')box(parent,[.075,1.86,.09],[xyz[0],1.08,wallZ],m.darkWood);
        box(parent,[.12,.34,.055],[xyz[0],xyz[1]+.08,wallZ],m.darkWood);
        pole(parent,[xyz[0],xyz[1]-.165,wallZ],[xyz[0],xyz[1]-.165,xyz[2]],.025,m.iron);
        pole(parent,[xyz[0],xyz[1]+.31,wallZ],[xyz[0],xyz[1]+.31,xyz[2]],.016,m.iron);
        cable(parent,[[xyz[0],xyz[1]+.31,xyz[2]],[xyz[0],xyz[1]+.34,xyz[2]],[xyz[0],xyz[1]+.29,xyz[2]]],.009,m.iron);
        box(parent,[.19,.035,.19],[xyz[0],xyz[1]-.165,xyz[2]],m.darkWood);
      }
    }
    object.userData={lampId:id,lit:live,type};batch(object);
    const flame=object.children.find(child=>child.isMesh&&child.material===m.flame);if(flame)flame.visible=live;
    const room=parent===captainCabin?'captain':parent===cargo?'hold':'lower';
    interiorLamps.push({id,group:object,object,type,on:live,lit:live,room,flame,glowMaterial:localGlow,position:xyz,parent:parent.name,phase:interiorLamps.length*1.73,light:null});return interiorLamps.at(-1);
  }
  chest(cabin,4.36,floorY,3.1,.75,.42,.295);
  collide(4.36,3.1,.8,.46,floorY,.5,'spare-lamp-chest');
  const lamps=[
    lantern(cabin,'hatch-lower',[-3.6,1.7,.95],'wall',true),
    lantern(captainCabin,'captain-desk',[-10.90,3.202,.97],'table',true),
    lantern(captainCabin,'captain-wall',[-11.75,3.5,2.19],'wall',false),
    lantern(captainCabin,'captain-candle',[-9.04,3.025,1.55],'candle',false),
    lantern(cabin,'crew-central',[1.03,1.75,.65],'hanging',true),
    lantern(cabin,'crew-passage',[7.16,1.75,-.68],'hanging',false),
    lantern(cabin,'crew-portable',[.55,.655,-3.66],'spare',false),
    lantern(cabin,'galley',[11.61,1.72,-1.62],'wall',false),
    lantern(cabin,'repair',[6.39,1.60,-3.3],'wall',false),
    lantern(brig,'brig-watch',[-5.15,1.66,.44],'hanging',true),
    lantern(brig,'brig-end',[-9.25,1.66,-.42],'wall',false),
    lantern(cargo,'cargo-work',[4.12,-.38,.64],'hanging',false),
    lantern(cabin,'spare-one',[4.25,.58,3.1],'spare',false),
    lantern(cabin,'spare-two',[4.47,.58,3.1],'spare',false),
  ];
  // Only three practical lights are ever installed; the director can assign them to the nearest lit lamp.
  for(const lamp of [lamps[1],lamps[4],lamps[9]]) {
    const light=new THREE.PointLight('#ffc079',1.25,3.1,2);light.name=`practical-${lamp.id}`;light.position.set(0, lamp.type==='table'?.13:0, 0);lamp.object.add(light);lamp.light=light;light.castShadow=false;
  }
  for(const group of [cabin,cargo,brig,overhead,captainCabin,captainRoof,magazine])batch(group);
  cabin.userData={floorY,cargoFloorY:cargoY,collisions,hammockCount,waterBarrels:waterBarrels.length};
  captainCabin.userData={floorY:captainFloor,doorCenter:{x:-8,z:0}};
  const rooms={lower:{floorY:.15,xMin:-11.7,xMax:12.6},hold:{floorY:-1.85,xMin:-13.4,xMax:12.6},captain:{floorY:2.4,xMin:-15.3,xMax:-8.25}};
  cellDoors.sort((a,b)=>a.userData.center.x-b.userData.center.x||a.userData.center.z-b.userData.center.z);
  return {cabin,captainCabin,captainRoof,brig,cargo,overhead,cabinDoor,cellDoors,interiorLamps,lampFixtures:interiorLamps,interiorCollisions:collisions,layout:{collisions,rooms},powderDoor,exteriorFlue,interiorWidthAt:widthAt};
}
