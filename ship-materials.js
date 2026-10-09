import * as THREE from 'three';

// Shared surfaces for the 32 m Black Tide. Grain runs along V: U = across-grain
// metres / 2, V = along-grain metres / 4. Keep plank geometry tightly joined.
function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canvasTexture(name, width, height, paint, color = true, repeat = true) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paint(ctx, width, height, random(731 + name.length * 113));
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.userData = { procedural: true, width, height, seed: 731 };
  return texture;
}

function mottling(ctx, width, height, rng, rgb, amount = 11) {
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    const grain = (rng() - .5) * amount;
    image.data[i] = rgb[0] + grain;
    image.data[i + 1] = rgb[1] + grain;
    image.data[i + 2] = rgb[2] + grain;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function woodPaint(ctx, w, h, rng, bump = false) {
  mottling(ctx, w, h, rng, bump ? [151, 151, 151] : [143, 139, 129], bump ? 15 : 14);
  const plank = w / 8;
  for (let p = 0; p < 8; p++) {
    const variation = .045 + rng() * .09;
    ctx.fillStyle = bump ? `rgba(255,255,255,${variation * .4})` : `rgba(${p % 3 === 0 ? '72,67,59' : '189,188,172'},${variation})`;
    ctx.fillRect(p * plank, 0, plank, h);
    if (!bump) {
      const wash = ctx.createLinearGradient(p * plank, 0, (p + 1) * plank, 0);
      wash.addColorStop(0, 'rgba(46,43,37,.065)'); wash.addColorStop(.3, 'rgba(214,211,196,.055)'); wash.addColorStop(1, 'rgba(83,78,65,.025)');
      ctx.fillStyle = wash; ctx.fillRect(p * plank, 0, plank, h);
    }
    ctx.strokeStyle = bump ? '#363636' : 'rgba(44,40,32,.43)';
    ctx.lineWidth = .85;
    ctx.beginPath(); ctx.moveTo(p * plank + .5, 0); ctx.lineTo(p * plank + .5, h); ctx.stroke();
    const joint = ((p * 173 + 281) % h);
    ctx.beginPath(); ctx.moveTo(p * plank + 1, joint); ctx.lineTo((p + 1) * plank - 1, joint); ctx.stroke();
    for (let g = 0; g < 57; g++) {
      const x = p * plank + rng() * plank;
      const phase = rng() * Math.PI * 2, bend = .6 + rng() * 2;
      ctx.strokeStyle = bump ? `rgba(35,35,35,${.1 + rng() * .15})` : `rgba(54,48,39,${.085 + rng() * .17})`;
      ctx.lineWidth = .35 + rng() * .7;
      ctx.beginPath();
      for (let y = 0; y <= h; y += 16) {
        const gx = x + Math.sin(y / h * Math.PI * 2 + phase) * bend + Math.sin(y / h * Math.PI * 6 + phase) * .4;
        if (!y) ctx.moveTo(gx, y); else ctx.lineTo(gx, y);
      }
      ctx.stroke();
    }
    // Restrained knots, worn treenails and hairline splits rather than bright rivets.
    if (p % 3 === 1) {
      const x = p * plank + plank * .43, y = 155 + p * 79;
      for (let ring = 0; ring < 5; ring++) {
        ctx.strokeStyle = bump ? '#777' : `rgba(62,48,35,${.22 - ring * .025})`;
        ctx.lineWidth = .6;
        ctx.beginPath(); ctx.ellipse(x, y, 1.3 + ring * 1.3, 5 + ring * 6, -.025, 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (const x of [p * plank + 7, (p + 1) * plank - 7]) {
      ctx.fillStyle = bump ? '#818181' : 'rgba(83,72,51,.22)';
      ctx.beginPath(); ctx.arc(x, joint + 5, 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  for (let i = 0; i < 230; i++) {
    const x = rng() * w, y = rng() * h;
    ctx.strokeStyle = bump ? 'rgba(65,65,65,.15)' : 'rgba(207,205,186,.16)';
    ctx.lineWidth = .4 + rng();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng() * 2 - 1, y + 4 + rng() * 36); ctx.stroke();
  }
  if (!bump) for (let i = 0; i < 42; i++) {
    const x = rng() * w, y = rng() * h, rw = 5 + rng() * 17, rh = 25 + rng() * 100;
    const stain = ctx.createRadialGradient(x, y, 0, x, y, rh);
    stain.addColorStop(0, i % 3 ? 'rgba(54,49,41,.09)' : 'rgba(202,202,185,.075)');
    stain.addColorStop(1, 'rgba(0,0,0,0)'); ctx.save(); ctx.translate(x, y); ctx.scale(rw / rh, 1); ctx.translate(-x, -y);
    ctx.fillStyle = stain; ctx.fillRect(x - rh, y - rh, rh * 2, rh * 2); ctx.restore();
  }
}

function clothPaint(ctx, w, h, rng, bump = false) {
  mottling(ctx, w, h, rng, bump ? [151, 151, 151] : [207, 202, 183], bump ? 10 : 11);
  // Canvas threads stay shallow. Construction seams and reinforcement are darker.
  for (let x = 0; x < w; x += 3) {
    ctx.fillStyle = bump ? 'rgba(230,230,230,.22)' : 'rgba(255,249,223,.1)';
    ctx.fillRect(x, 0, .75, h);
  }
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = bump ? 'rgba(62,62,62,.15)' : 'rgba(107,96,71,.085)';
    ctx.fillRect(0, y, w, .75);
  }
  for (let x = 0; x <= w; x += w / 24) {
    ctx.fillStyle = bump ? '#898989' : 'rgba(135,124,95,.2)';
    ctx.fillRect(x, 0, 2.3, h);
    ctx.fillStyle = bump ? '#c4c4c4' : 'rgba(250,241,209,.32)';
    ctx.fillRect(x + 2.4, 0, .8, h);
    ctx.strokeStyle = bump ? '#b7b7b7' : 'rgba(89,79,58,.22)';
    ctx.lineWidth = .6; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(x + 5, 0); ctx.lineTo(x + 5, h); ctx.stroke();
    ctx.setLineDash([]);
  }
  for (let i = 0; i < 38; i++) {
    const x = rng() * w, y = rng() * h, r = 12 + rng() * 64;
    const wash = ctx.createRadialGradient(x, y, 0, x, y, r);
    wash.addColorStop(0, bump ? 'rgba(92,92,92,.05)' : (i % 3 ? 'rgba(117,95,57,.14)' : 'rgba(75,73,66,.13)'));
    wash.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = wash;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Repair patches belong to a few authored sail meshes. Baking them into this
  // shared tile repeated identical repairs on every sail and corner reinforcement.
  for (const y of [.37, .65]) {
    ctx.fillStyle = bump ? 'rgba(70,70,70,.12)' : 'rgba(132,122,94,.07)';
    ctx.fillRect(0, h * y, w, 7);
  }
  if (!bump) {
    for (let i = 0; i < 16; i++) {
      const x = rng() * w, y = h * (.55 + rng() * .24), width = 9 + rng() * 21;
      const salt = ctx.createLinearGradient(0, y, 0, h);
      salt.addColorStop(0, 'rgba(91,82,60,0)'); salt.addColorStop(.55, 'rgba(122,110,80,.1)'); salt.addColorStop(1, 'rgba(191,177,136,.2)');
      ctx.fillStyle = salt; ctx.fillRect(x, y, width, h - y);
    }
    for (const x of [0, w]) {
      const soil = ctx.createRadialGradient(x, h, 0, x, h, h * .28);
      soil.addColorStop(0, 'rgba(94,82,58,.18)'); soil.addColorStop(.4, 'rgba(151,137,101,.065)'); soil.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = soil; ctx.fillRect(x - h * .28, h * .72, h * .56, h * .28);
    }
  }
}

function flagInsignia(ctx) {
  ctx.fillStyle = '#e2dcc8'; ctx.strokeStyle = '#e2dcc8'; ctx.lineWidth = 13; ctx.lineCap = 'round';
  for (const direction of [-1, 1]) {
    const ax = 51, bx = 204, ay = direction < 0 ? 182 : 229, by = direction < 0 ? 229 : 182;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.beginPath(); ctx.arc(x - 4, y - 4, 8, 0, Math.PI * 2); ctx.arc(x + 4, y + 4, 8, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.beginPath(); ctx.moveTo(63, 103); ctx.bezierCurveTo(55, 21, 177, 5, 196, 83); ctx.bezierCurveTo(198, 116, 187, 138, 169, 147); ctx.lineTo(164, 172); ctx.lineTo(104, 174); ctx.lineTo(94, 148); ctx.bezierCurveTo(70, 139, 60, 121, 63, 103); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (const [x, y, angle] of [[96, 107, -.18], [157, 105, .12]]) { ctx.beginPath(); ctx.ellipse(x, y, 17, 20, angle, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(129, 124); ctx.lineTo(118, 141); ctx.lineTo(139, 139); ctx.closePath(); ctx.fill();
  for (const x of [116, 130, 145]) ctx.fillRect(x, 152, 3, 24);
  // The old painted mark has a few chips without destroying its silhouette.
  for (const [x, y] of [[85, 67], [173, 137], [154, 51], [112, 38], [74, 205]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 3, y + 1); ctx.lineTo(x + 2, y + 7); ctx.closePath(); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over';
}

function ropePaint(ctx, w, h, rng, bump = false) {
  mottling(ctx, w, h, rng, bump ? [125, 125, 125] : [195, 173, 133], 21);
  for (let y = -w; y < h + w; y += 22) {
    ctx.lineWidth = 7;
    ctx.strokeStyle = bump ? '#474747' : 'rgba(61,47,27,.28)';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + w * .7); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = bump ? '#bebebe' : 'rgba(250,229,180,.25)';
    ctx.beginPath(); ctx.moveTo(0, y + 5); ctx.lineTo(w, y + 5 + w * .7); ctx.stroke();
  }
  for (let i = 0; i < 2900; i++) {
    const x = rng() * w, y = rng() * h;
    ctx.strokeStyle = bump ? 'rgba(245,245,245,.14)' : 'rgba(252,227,171,.15)';
    ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1 + rng() * 3, y + 3 + rng() * 6); ctx.stroke();
  }
}

export function createShipMaterials(textures = {}) {
  const woodMap = canvasTexture('ship-oak-weathered-color', 512, 1024, (c, w, h, r) => woodPaint(c, w, h, r)) || textures.wood || null;
  const woodBump = canvasTexture('ship-oak-fine-grain-height', 512, 1024, (c, w, h, r) => woodPaint(c, w, h, r, true), false);
  const sailMap = canvasTexture('ship-canvas-seams-salt-patches-color', 1024, 1024, (c, w, h, r) => clothPaint(c, w, h, r)) || textures.cloth || null;
  const sailBump = canvasTexture('ship-canvas-weave-height', 1024, 1024, (c, w, h, r) => clothPaint(c, w, h, r, true), false);
  const ropeMap = canvasTexture('ship-hemp-twisted-fibres-color', 256, 512, (c, w, h, r) => ropePaint(c, w, h, r));
  const ropeBump = canvasTexture('ship-hemp-twisted-fibres-height', 256, 512, (c, w, h, r) => ropePaint(c, w, h, r, true), false);
  const flagInsigniaMap = textures.flagSkull || canvasTexture('ship-worn-white-jolly-roger-alpha', 256, 256, flagInsignia, true, false) || textures.skull || null;
  const metalBump = canvasTexture('ship-forged-metal-pitting-height', 256, 256, (c, w, h, r) => {
    mottling(c, w, h, r, [180, 180, 180], 19);
    for (let i = 0; i < 1100; i++) {
      c.fillStyle = `rgba(26,26,26,${.05 + r() * .2})`;
      c.beginPath(); c.arc(r() * w, r() * h, .4 + r() * 1.8, 0, Math.PI * 2); c.fill();
    }
  }, false);
  const underwaterMap = canvasTexture('ship-old-white-antifouling-color', 512, 512, (c, w, h, r) => {
    mottling(c, w, h, r, [174, 175, 155], 15);
    for (let i = 0; i < 175; i++) {
      c.fillStyle = i % 4 ? 'rgba(115,113,83,.15)' : 'rgba(180,158,118,.45)';
      c.beginPath(); c.ellipse(r() * w, r() * h, 2 + r() * 18, 1 + r() * 8, r(), 0, Math.PI * 2); c.fill();
    }
  });
  const algaeMap = canvasTexture('ship-waterline-brown-green-fouling-color', 512, 256, (c, w, h, r) => {
    const gradient = c.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(57,62,29,0)'); gradient.addColorStop(.22, 'rgba(66,66,35,.68)');
    gradient.addColorStop(.55, 'rgba(49,58,31,.89)'); gradient.addColorStop(.9, 'rgba(92,86,48,.38)');
    gradient.addColorStop(1, 'rgba(76,77,41,0)'); c.fillStyle = gradient; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      c.fillStyle = i % 3 ? 'rgba(118,112,63,.17)' : 'rgba(35,42,25,.23)';
      const x = r() * w, y = r() * h, rx = 1 + r() * 7, ry = 1 + r() * 5;
      for (const dx of [-w, 0, w]) { c.beginPath(); c.ellipse(x + dx, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }
    }
  });

  const mat = (name, color, options = {}) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .88, ...options });
    material.name = `ship-${name}`; material.userData.role = name;
    return material;
  };
  const oak = { map: woodMap, bumpMap: woodBump, bumpScale: .0048 };
  const fibre = { map: ropeMap, bumpMap: ropeBump, bumpScale: .0014 };
  const fabric = { map: sailMap, bumpMap: sailBump, bumpScale: .0012, roughness: .97, side: THREE.DoubleSide };
  const materials = {
    wood: mat('oak-structural', '#aaa18e', oak),
    mastWood: mat('oak-mast-and-yards', '#bdb4a1', { ...oak, bumpScale: .0036, roughness: .89 }),
    weathered: mat('oak-sunbleached', '#b7b6aa', oak),
    darkWood: mat('oak-tarred-wales', '#493f32', { ...oak, roughness: .83 }),
    deckWood: mat('oak-scrubbed-deck', '#c5bfad', { ...oak, bumpScale: .0038, roughness: .93 }),
    iron: mat('iron-forged', '#343735', { metalness: .72, roughness: .85, bumpMap: metalBump, bumpScale: .0014, roughnessMap: metalBump }),
    rust: mat('iron-local-rust', '#735038', { metalness: .16, roughness: .93, bumpMap: metalBump, bumpScale: .0026 }),
    brass: mat('brass-aged', '#ac8950', { metalness: .78, roughness: .42, bumpMap: metalBump, bumpScale: .00035 }),
    rope: mat('hemp-running-rigging', '#d3be98', fibre),
    tarRope: mat('hemp-tarred-standing-rigging', '#746654', { ...fibre, roughness: .94, bumpScale: .0011 }),
    red: mat('oak-worn-ochre-paint', '#8c4e3e', { ...oak, roughness: .9, bumpScale: .003 }),
    underwater: mat('old-white-antifouling', '#d6d7c5', { map: underwaterMap, bumpMap: woodBump, bumpScale: .004, roughness: .94 }),
    algae: mat('waterline-fouling', '#aca882', { map: algaeMap, transparent: true, depthWrite: false, roughness: 1, alphaTest: .06, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    sail: mat('dirty-ivory-canvas', '#ece7d2', fabric),
    repairedSail: mat('dirty-ivory-canvas-authored-repairs', '#ece7d2', { ...fabric, vertexColors: true }),
    patch: mat('replacement-canvas', '#bdb69f', fabric),
    glass: mat('small-sea-green-glass', '#9bafa0', { roughness: .24, metalness: .06, transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide }),
    lampGlass: mat('smoke-tinted-lantern-glass', '#c7b382', { emissive: '#d39043', emissiveIntensity: .18, roughness: .32, transparent: true, opacity: .42, depthWrite: false, side: THREE.DoubleSide }),
    flame: mat('oil-wick-flame', '#ffdb85', { emissive: '#ffad39', emissiveIntensity: 3.5, roughness: 1, toneMapped: false }),
    tar: mat('caulking-pitch', '#29271f', { roughness: .9 }),
    bone: mat('weathered-bone', '#c3bda7', { roughness: .94 }),
    flag: mat('worn-black-flag', '#302f2a', { ...fabric, map: sailBump }),
    skull: mat('sail-skull-decal', '#ddd7be', { map: textures.skull || null, side: THREE.DoubleSide, transparent: true, alphaTest: .3, depthWrite: false, roughness: 1 }),
    flagSkull: mat('flag-skull-decal', '#e1dac4', { map: flagInsigniaMap, side: THREE.DoubleSide, transparent: true, alphaTest: .3, depthWrite: false, roughness: 1 }),
    parchment: mat('hand-drawn-nautical-chart', '#f2e6c9', { map: buildMapTexture(), roughness: .95, side: THREE.DoubleSide }),
  };
  Object.defineProperties(materials, {
    deck: { value: materials.deckWood }, paintRed: { value: materials.red },
    cloth: { value: materials.sail }, seam: { value: materials.tar },
  });
  const maps = new Set();
  for (const material of Object.values(materials)) {
    for (const key of ['map', 'bumpMap', 'roughnessMap']) if (material[key]) maps.add(material[key]);
  }
  Object.defineProperty(materials, 'resources', { value: {
    materialCount: Object.keys(materials).length,
    textureCount: maps.size,
    textureNames: [...maps].map(t => t.name || 'external-texture'),
    estimatedMiB: [...maps].reduce((sum, t) => sum + (t.image?.width || 0) * (t.image?.height || 0) * 4 * 4 / 3, 0) / 1048576,
    textures: [...maps],
    uv: { wood: 'U=across-grain metres/2, V=along-grain metres/4', sail: '0..1 across whole sail; 24 canvas strips on a 14 m course', rope: 'U around circumference, V along rope length in metres/.22' },
  } });
  return materials;
}

export function buildMapTexture() {
  return canvasTexture('ship-hand-drawn-nautical-chart', 1024, 768, (ctx, w, h, rng) => {
    mottling(ctx, w, h, rng, [212, 194, 153], 16);
    const aging = ctx.createRadialGradient(w * .5, h * .5, h * .2, w * .5, h * .5, w * .6);
    aging.addColorStop(0, 'rgba(95,62,24,0)'); aging.addColorStop(1, 'rgba(91,64,25,.24)');
    ctx.fillStyle = aging; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(76,65,43,.18)'; ctx.lineWidth = 1;
    for (let x = 48; x < w; x += 96) { ctx.beginPath(); ctx.moveTo(x, 25); ctx.lineTo(x, h - 25); ctx.stroke(); }
    for (let y = 42; y < h; y += 86) { ctx.beginPath(); ctx.moveTo(25, y); ctx.lineTo(w - 25, y); ctx.stroke(); }
    function coast(cx, cy, rx, ry, seed) {
      const points = [];
      for (let i = 0; i <= 72; i++) {
        const a = i / 72 * Math.PI * 2;
        const r = 1 + .14 * Math.sin(a * 3 + seed) + .08 * Math.sin(a * 7 + seed * 2) + .035 * Math.sin(a * 13);
        points.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
      }
      ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.fillStyle = 'rgba(105,111,76,.13)'; ctx.fill(); ctx.strokeStyle = '#66593b'; ctx.lineWidth = 2; ctx.stroke();
      for (let i = 0; i < points.length - 1; i += 2) {
        const [x, y] = points[i]; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx + (x - cx) * .94, cy + (y - cy) * .94); ctx.stroke();
      }
    }
    coast(335, 420, 94, 150, 3); coast(673, 253, 129, 95, 1); coast(719, 599, 36, 58, 2);
    const cx = 855, cy = 480;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, length = i % 4 ? 45 : 78;
      ctx.strokeStyle = 'rgba(78,65,42,.37)'; ctx.lineWidth = .75;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a) * length * 4, cy - Math.cos(a) * length * 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a - .06) * length, cy - Math.cos(a - .06) * length); ctx.lineTo(cx + Math.sin(a) * length * .63, cy - Math.cos(a) * length * .63); ctx.closePath();
      ctx.fillStyle = i % 2 ? '#9b855a' : '#5c513b'; ctx.fill();
    }
    ctx.strokeStyle = '#6a5b3e'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 51, 0, Math.PI * 2); ctx.stroke();
    ctx.font = 'italic 25px Georgia'; ctx.fillStyle = '#75603d';
    ctx.fillText('Mare Incognitum', 83, 134); ctx.font = 'italic 15px Georgia';
    ctx.fillText('Port du Corbeau', 186, 612); ctx.fillText('Îles des Brumes', 584, 126);
    ctx.font = '13px Georgia';
    for (let i = 0; i < 40; i++) ctx.fillText(String(5 + Math.floor(rng() * 19)), 70 + rng() * 870, 178 + rng() * 480);
    ctx.strokeStyle = 'rgba(115,66,40,.62)'; ctx.setLineDash([5, 8]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(325, 586); ctx.bezierCurveTo(513, 628, 548, 440, 601, 343); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(85,68,39,.6)'; ctx.strokeRect(23, 23, w - 46, h - 46); ctx.strokeRect(27, 27, w - 54, h - 54);
  }, true, false);
}
