(() => {
  const { Engine, World, Bodies, Body, Events, Runner, Composite } = Matter;

  const LEVELS = [
    { name: "樱桃牢大", r: 16, score: 1, ring: "#e74c3c" },
    { name: "草莓牢大", r: 21, score: 3, ring: "#ff6b9d" },
    { name: "葡萄牢大", r: 27, score: 6, ring: "#9b59b6" },
    { name: "橘子牢大", r: 34, score: 10, ring: "#f39c12" },
    { name: "柿子牢大", r: 42, score: 15, ring: "#e67e22" },
    { name: "苹果牢大", r: 52, score: 21, ring: "#c0392b" },
    { name: "梨子牢大", r: 64, score: 28, ring: "#f1c40f" },
    { name: "桃子牢大", r: 78, score: 36, ring: "#ffb6c1" },
    { name: "蜜瓜牢大", r: 94, score: 45, ring: "#27ae60" },
    { name: "直升机牢大", r: 114, score: 100, ring: "#fdb927" },
  ];

  const MAX_LEVEL = LEVELS.length - 1;
  const DROP_LEVELS = 5;
  const WORLD_W = 400;
  const WORLD_H = 620;
  const WALL = 18;
  const DROP_Y = 56;
  const DEAD_Y = 118;
  const BEST_KEY = "hecheng-laoda-best";
  const MERGE_LOCK_MS = 70;

  const canvas = document.getElementById("game");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const overlayScore = document.getElementById("overlay-score");
  const startBtn = document.getElementById("start-btn");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const nextImg = document.getElementById("next-img");
  const nextRing = document.getElementById("next-ring");
  const legendEl = document.getElementById("legend");
  const toastEl = document.getElementById("toast");

  const ctx = canvas.getContext("2d");
  const textures = [];
  const images = { normal: null, max: null };
  const sounds = { man: null, max: null };

  let engine;
  let runner;
  let fruits = [];
  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let nextLevel = 0;
  let previewX = WORLD_W / 2;
  let canDrop = false;
  let playing = false;
  let gameOver = false;
  let dangerMs = 0;
  let madeMax = false;
  let pointerDown = false;

  bestEl.textContent = String(best);

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("无法加载 " + src));
      img.src = src;
    });
  }

  function makeTexture(img, ring, isMax) {
    const size = 256;
    const out = document.createElement("canvas");
    out.width = size;
    out.height = size;
    const g = out.getContext("2d");

    g.save();
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    g.closePath();
    g.clip();

    if (isMax) {
      const cropH = img.height - 36;
      const side = Math.min(img.width, cropH);
      const sx = (img.width - side) / 2;
      const sy = 0;
      g.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    } else {
      const side = Math.min(img.width, img.height) * 0.62;
      const sx = (img.width - side) / 2;
      const sy = img.height * 0.04;
      g.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    }
    g.restore();
    if (isMax) {
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
      g.lineWidth = 16;
      g.strokeStyle = "#fdb927";
      g.stroke();
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 18, 0, Math.PI * 2);
      g.lineWidth = 6;
      g.strokeStyle = "#fff3c4";
      g.stroke();
    } else {
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
      g.lineWidth = 16;
      g.strokeStyle = ring;
      g.stroke();
    }
    return out;
  }

  function randDropLevel() {
    const weights = [5, 4, 3, 2, 1];
    const total = weights.reduce((a, b) => a + b, 0);
    let n = Math.random() * total;
    for (let i = 0; i < DROP_LEVELS; i += 1) {
      n -= weights[i];
      if (n <= 0) return i;
    }
    return 0;
  }

  function syncCanvasSize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const source = event.touches ? event.touches[0] : event;
    const x = ((source.clientX - rect.left) / rect.width) * WORLD_W;
    const y = ((source.clientY - rect.top) / rect.height) * WORLD_H;
    return { x, y };
  }

  function clampPreview(level, x) {
    const r = LEVELS[level].r;
    return Math.max(WALL + r + 2, Math.min(WORLD_W - WALL - r - 2, x));
  }

  function addWalls() {
    const opts = { isStatic: true, label: "wall", friction: 0.12, restitution: 0.68 };
    World.add(engine.world, [
      Bodies.rectangle(WORLD_W / 2, WORLD_H + 40, WORLD_W, 100, opts),
      Bodies.rectangle(-40, WORLD_H / 2, 100, WORLD_H * 2, opts),
      Bodies.rectangle(WORLD_W + 40, WORLD_H / 2, 100, WORLD_H * 2, opts),
    ]);
  }

  function isLiveFruit(body) {
    return Boolean(
      body &&
        body.label === "fruit" &&
        body.plugin &&
        body.plugin.kind === "fruit" &&
        !body.plugin.consumed &&
        Number.isInteger(body.plugin.level) &&
        body.plugin.level >= 0 &&
        body.plugin.level <= MAX_LEVEL
    );
  }

  function spawnFruit(level, x, y, options = {}) {
    const safeLevel = Math.max(0, Math.min(MAX_LEVEL, level));
    const info = LEVELS[safeLevel];
    const body = Bodies.circle(x, y, info.r, {
      restitution: 0.76,
      friction: 0.04,
      frictionAir: 0.001,
      density: 0.0026,
      label: "fruit",
      slop: 0.05,
    });
    body.plugin = {
      kind: "fruit",
      level: safeLevel,
      born: performance.now(),
      consumed: false,
    };
    if (options.static) Body.setStatic(body, true);
    World.add(engine.world, body);
    fruits.push(body);
    return body;
  }

  function removeFruit(body) {
    if (!body || (body.plugin && body.plugin.removed)) return;
    if (body.plugin) {
      body.plugin.consumed = true;
      body.plugin.removed = true;
    }
    fruits = fruits.filter((item) => item !== body);
    if (engine && engine.world) Composite.remove(engine.world, body);
  }

  function addScore(value) {
    score += value;
    scoreEl.textContent = String(score);
    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      localStorage.setItem(BEST_KEY, String(best));
    }
  }

  function showToast(text) {
    toastEl.hidden = false;
    toastEl.textContent = text;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toastEl.hidden = true;
    }, 1800);
  }

  function audioCtx() {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx.current;
  }

  function unlockAudio() {
    const ctx = audioCtx();
    if (ctx.state === "suspended") ctx.resume();
  }

  async function loadSound(src) {
    const response = await fetch(src);
    if (!response.ok) throw new Error("无法加载 " + src);
    const data = await response.arrayBuffer();
    return audioCtx().decodeAudioData(data.slice(0));
  }

  function playBuffer(buffer, rate, volume) {
    if (!buffer) return;
    const ctx = audioCtx();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }

  function playMergeSound(level) {
    try {
      unlockAudio();
      if (level === MAX_LEVEL) {
        playBuffer(sounds.max, 1, 1);
        return;
      }
      const steps = Math.max(1, MAX_LEVEL - 1);
      const t = (level - 1) / (steps - 1);
      playBuffer(sounds.man, 0.72 + t * 0.7, 0.42 + t * 0.58);
    } catch (_) {
      /* ignore audio errors */
    }
  }

  function mergePair(a, b) {
    if (!isLiveFruit(a) || !isLiveFruit(b) || a === b) return;
    if (a.plugin.level !== b.plugin.level) return;
    if (a.plugin.level >= MAX_LEVEL) return;
    const now = performance.now();
    if (now - a.plugin.born < MERGE_LOCK_MS || now - b.plugin.born < MERGE_LOCK_MS) return;

    // A body may hit several same-level fruits in one physics step.
    // Mark both consumed first so they cannot spawn extra upgrades.
    a.plugin.consumed = true;
    b.plugin.consumed = true;

    const level = Math.min(MAX_LEVEL, a.plugin.level + 1);
    const x = (a.position.x + b.position.x) / 2;
    const y = (a.position.y + b.position.y) / 2;
    const vx = (a.velocity.x + b.velocity.x) / 2;
    const vy = (a.velocity.y + b.velocity.y) / 2;
    removeFruit(a);
    removeFruit(b);
    const next = spawnFruit(level, x, y);
    Body.setVelocity(next, { x: vx * 0.3, y: vy * 0.3 });
    addScore(LEVELS[level].score);
    playMergeSound(level);
    if (level === MAX_LEVEL && !madeMax) {
      madeMax = true;
      showToast("曼！合成出直升机牢大");
    }
  }

  function pointerAim(event) {
    if (!playing || gameOver) return;
    previewX = clampPreview(nextLevel, worldFromEvent(event).x);
  }

  function dropFruit() {
    if (!playing || gameOver || !canDrop) return;
    unlockAudio();
    const x = clampPreview(nextLevel, previewX);
    spawnFruit(nextLevel, x, DROP_Y);
    nextLevel = randDropLevel();
    canDrop = false;
    updateNext();
    setTimeout(() => {
      if (playing && !gameOver) canDrop = true;
    }, 160);
  }

  function updateNext() {
    const info = LEVELS[nextLevel];
    nextImg.src = nextLevel === MAX_LEVEL ? "assets/max.jpg" : "assets/normal.jpg";
    nextRing.style.boxShadow = `inset 0 0 0 5px ${info.ring}`;
    const size = 36 + nextLevel * 8;
    nextImg.parentElement.style.width = Math.max(72, size) + "px";
    nextImg.parentElement.style.height = Math.max(72, size) + "px";
    nextImg.style.objectPosition = nextLevel === MAX_LEVEL ? "center 8%" : "center 12%";
  }

  function buildLegend() {
    legendEl.innerHTML = LEVELS.map((item, index) => {
      const src = index === MAX_LEVEL ? "assets/max.jpg" : "assets/normal.jpg";
      const pos = index === MAX_LEVEL ? "center 8%" : "center 12%";
      const extra = index === MAX_LEVEL ? " class=\"max-item\"" : "";
      return `<li${extra}><img src="${src}" alt="${item.name}" style="box-shadow:0 0 0 3px ${item.ring};object-position:${pos}" /><span>${index + 1}. ${item.name}</span></li>`;
    }).join("");
  }

  function resetGame() {
    if (runner) Runner.stop(runner);
    if (engine) World.clear(engine.world, false);
    engine = Engine.create({ gravity: { x: 0, y: 3.15 } });
    runner = Runner.create();
    fruits = [];
    score = 0;
    scoreEl.textContent = "0";
    nextLevel = randDropLevel();
    previewX = WORLD_W / 2;
    canDrop = true;
    playing = true;
    gameOver = false;
    dangerMs = 0;
    madeMax = false;
    addWalls();
    Events.on(engine, "collisionStart", (event) => {
      for (const pair of event.pairs) mergePair(pair.bodyA, pair.bodyB);
    });
    Events.on(engine, "collisionActive", (event) => {
      for (const pair of event.pairs) mergePair(pair.bodyA, pair.bodyB);
    });
    Runner.run(runner, engine);
    updateNext();
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    overlay.hidden = true;
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    playing = false;
    canDrop = false;
    overlayTitle.textContent = "牢大堆太高了";
    overlayText.textContent = madeMax
      ? "已经合成过直升机牢大，再来一局冲击更高分。"
      : "还没合成出直升机牢大，调整落点再试一次。";
    overlayScore.textContent = String(score);
    startBtn.textContent = "再来一局";
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.remove("hidden");
  }

  function checkDanger(dt) {
    let risky = false;
    const now = performance.now();
    for (const body of fruits) {
      if (!isLiveFruit(body)) continue;
      if (now - body.plugin.born < 900) continue;
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (body.position.y - LEVELS[body.plugin.level].r < DEAD_Y && speed < 0.35) {
        risky = true;
        break;
      }
    }
    dangerMs = risky ? dangerMs + dt : 0;
    if (dangerMs > 1200) endGame();
  }

  function drawBackground(cssW, cssH) {
    const sx = cssW / WORLD_W;
    const sy = cssH / WORLD_H;
    ctx.save();
    ctx.scale(sx, sy);
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(WORLD_W / 2, WORLD_H * 0.72, 78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "rgba(200, 40, 40, 0.85)";
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WALL, DEAD_Y);
    ctx.lineTo(WORLD_W - WALL, DEAD_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#6b4014";
    ctx.fillRect(0, 0, WALL, WORLD_H);
    ctx.fillRect(WORLD_W - WALL, 0, WALL, WORLD_H);
    ctx.fillRect(0, WORLD_H - WALL, WORLD_W, WALL);
    ctx.restore();
    return { sx, sy };
  }

  function drawFruit(body, sx, sy) {
    if (!isLiveFruit(body)) return;
    const level = body.plugin.level;
    const info = LEVELS[level];
    const x = body.position.x * sx;
    const y = body.position.y * sy;
    const r = info.r * sx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(body.angle);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(textures[level], -r, -r, r * 2, r * 2);
    ctx.restore();
  }

  function drawPreview(sx, sy) {
    if (!playing || gameOver || !canDrop) return;
    const info = LEVELS[nextLevel];
    const x = clampPreview(nextLevel, previewX) * sx;
    const y = DROP_Y * sy;
    const r = info.r * sx;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(textures[nextLevel], x - r, y - r, r * 2, r * 2);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(x, y + r + 4);
    ctx.lineTo(x, (WORLD_H - WALL) * sy);
    ctx.stroke();
    ctx.restore();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(32, now - last);
    last = now;
    const rect = canvas.getBoundingClientRect();
    const { sx, sy } = drawBackground(rect.width, rect.height);
    if (playing && !gameOver) checkDanger(dt);
    for (const body of fruits) drawFruit(body, sx, sy);
    drawPreview(sx, sy);
    requestAnimationFrame(frame);
  }

  function bindInput() {
    const move = (event) => {
      pointerAim(event);
      if (event.cancelable) event.preventDefault();
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        pointerDown = true;
        canvas.setPointerCapture(event.pointerId);
        pointerAim(event);
      }
    );
    canvas.addEventListener("pointerup", (event) => {
      if (!pointerDown) return;
      pointerDown = false;
      pointerAim(event);
      dropFruit();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") previewX = clampPreview(nextLevel, previewX - 16);
      if (event.key === "ArrowRight") previewX = clampPreview(nextLevel, previewX + 16);
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        dropFruit();
      }
    });
    startBtn.addEventListener("click", () => {
      unlockAudio();
      resetGame();
    });
    window.addEventListener("resize", syncCanvasSize);
  }

  async function start() {
    buildLegend();
    images.normal = await loadImage("assets/normal.jpg");
    images.max = await loadImage("assets/max.jpg");
    sounds.man = await loadSound("assets/man.mp3");
    sounds.max = await loadSound("assets/what-can-i-say.mp3");
    for (let i = 0; i < LEVELS.length; i += 1) {
      textures[i] = makeTexture(
        i === MAX_LEVEL ? images.max : images.normal,
        LEVELS[i].ring,
        i === MAX_LEVEL
      );
    }
    nextImg.src = "assets/normal.jpg";
    syncCanvasSize();
    bindInput();
    requestAnimationFrame(frame);
  }

  start().catch((error) => {
    overlayTitle.textContent = "资源加载失败";
    overlayText.textContent = error.message;
    startBtn.hidden = true;
  });
})();
