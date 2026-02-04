// Penalty Shootout - frontend logic
// Controls: click-drag to aim+power, keyboard arrows to adjust
// Top-level settings (tweak here)
const SETTINGS = {
  rounds: 5,
  goalieReactionMeanMs: 350, // goalie reaction delay mean
  goalieReadChance: 0.25, // chance to read the shot perfectly
  goalieSkill: 0.5, // 0 = random, 1 = always guess correct side (but still reaction-limited)
  maxPower: 26, // pixels per frame-ish used for speed scaling
  ballRadius: 9
};

// Canvas and rendering
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
let cw, ch, scale;

function resizeCanvas(){
  cw = canvas.clientWidth;
  ch = canvas.clientHeight;
  canvas.width = cw * devicePixelRatio;
  canvas.height = ch * devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  scale = cw / 960; // used for responsive drawing
}
resizeCanvas();
window.addEventListener("resize", () => { resizeCanvas(); draw(); });

// Game state
let ball = { x: 480, y: 360 }; // will be set on resize
let dragging = false;
let dragStart = null;
let aimVec = { x: 0, y: -1 };
let power = 8;
let goals = 0, attempts = 0, round = 0;
let shotInProgress = false;
let messageEl = document.getElementById("message");
const scoreEl = document.getElementById("score");
const roundEl = document.getElementById("round");
const restartBtn = document.getElementById("restart");
const saveBtn = document.getElementById("saveScore");
const playerNameInput = document.getElementById("playerName");
const highscoreList = document.getElementById("highscoreList");

function resetGame(){
  goals = 0; attempts = 0; round = 0;
  updateHud();
  showMessage("Click and drag to aim and set power.");
  draw();
}
restartBtn.addEventListener("click", resetGame);

function updateHud(){
  scoreEl.textContent = `Goals: ${goals} | Attempts: ${attempts}`;
  roundEl.textContent = `Round: ${round} / ${SETTINGS.rounds}`;
}

function showMessage(txt){
  messageEl.textContent = txt;
}

// Setup initial positions based on canvas size
function layout(){
  ball.x = cw * 0.5;
  ball.y = ch * 0.75;
}
layout();
resetGame();

// Input handling
canvas.addEventListener("pointerdown", (e) => {
  if (shotInProgress) return;
  dragging = true;
  dragStart = { x: e.offsetX, y: e.offsetY };
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.offsetX - dragStart.x;
  const dy = e.offsetY - dragStart.y;
  aimVec = normalize({ x: dx, y: dy });
  power = Math.min(SETTINGS.maxPower, Math.hypot(dx, dy) / 6 + 6);
  draw();
});
canvas.addEventListener("pointerup", (e) => {
  if (!dragging) return;
  dragging = false;
  const dx = e.offsetX - dragStart.x;
  const dy = e.offsetY - dragStart.y;
  if (Math.hypot(dx, dy) < 10) {
    showMessage("Drag longer for more power.");
    return;
  }
  aimVec = normalize({ x: dx, y: dy });
  power = Math.min(SETTINGS.maxPower, Math.hypot(dx, dy) / 6 + 6);
  fireShot(aimVec, power);
});
canvas.addEventListener("pointercancel", () => { dragging = false; });

// Keyboard nudges
window.addEventListener("keydown", (e) => {
  if (shotInProgress) return;
  if (e.key === "ArrowLeft") { aimVec = rotate(aimVec, -6 * Math.PI/180); draw(); }
  if (e.key === "ArrowRight") { aimVec = rotate(aimVec, 6 * Math.PI/180); draw(); }
  if (e.key === "ArrowUp") { power = Math.min(SETTINGS.maxPower, power + 1); draw(); }
  if (e.key === "ArrowDown") { power = Math.max(3, power - 1); draw(); }
  if (e.code === "Space") { fireShot(aimVec, power); }
});

// Normalization & helpers
function normalize(v){
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}
function rotate(v, ang){
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return normalize({ x: v.x * ca - v.y * sa, y: v.x * sa + v.y * ca });
}

// Simple goalie AI: chooses -1 (left), 0 (center), 1 (right)
function goalieDecide(shotVector){
  // compute shot side: left / center / right based on x component
  const shotSide = (shotVector.x < -0.2) ? -1 : (shotVector.x > 0.2) ? 1 : 0;
  const r = Math.random();
  // chance to read perfectly
  if (r < SETTINGS.goalieReadChance) return shotSide;
  // otherwise guess based on skill bias but add randomness
  const roll = Math.random();
  if (roll < SETTINGS.goalieSkill * 0.4) return shotSide; // biased to correct
  // random choice
  const choices = [-1, 0, 1];
  return choices[Math.floor(Math.random() * choices.length)];
}

// Fire shot: animate ball, animate goalie
function fireShot(vec, powerVal){
  if (shotInProgress) return;
  shotInProgress = true;
  round++;
  attempts++;
  updateHud();
  showMessage("Shot!");

  // Create ballistic motion params
  const speed = powerVal * 1.6; // tweak
  const vel = { x: vec.x * speed, y: vec.y * speed };

  // Target line: assume goal line near top of canvas
  const goalY = ch * 0.12;
  const distToGoal = ball.y - goalY;
  const timeToGoal = Math.abs(distToGoal / Math.abs(vel.y || 0.0001)); // frames-ish

  const goalieSide = goalieDecide(vec); // -1,0,1
  const goalieReaction = Math.max(80, gaussian(SETTINGS.goalieReactionMeanMs, 120)); // ms
  // convert reaction to frames (we animate using requestAnimationFrame ~60fps)
  const reactionFrames = Math.round(goalieReaction / (1000 / 60));

  // goalie position and animation state
  let goalie = {
    x: cw * 0.5,
    y: goalY - 20,
    targetX: cw * 0.5 + goalieSide * cw * 0.18,
    frame: 0,
    dived: false
  };

  // Determine if diving in time: if reactionFrames < timeToGoalFrames
  const timeToGoalFrames = Math.max(1, timeToGoal);
  const willDiver = reactionFrames < timeToGoalFrames;

  // animation loop
  let ballPos = { x: ball.x, y: ball.y };
  let frame = 0;
  const maxFrames = Math.min(500, Math.round(timeToGoalFrames + 120));
  function anim(){
    frame++;
    // move ball
    ballPos.x += vel.x;
    ballPos.y += vel.y;

    // goalie reacts after reactionFrames
    if (!goalie.dived && frame >= reactionFrames && willDiver){
      goalie.dived = true;
    }
    // move goalie toward target if dived
    if (goalie.dived){
      goalie.x += (goalie.targetX - goalie.x) * 0.22;
      goalie.y += (goalie.targetX !== cw*0.5) ? -1.2 : 0; // small hop
    } else {
      // subtle breathing
      goalie.x += Math.sin(frame * 0.05) * 0.8;
    }

    drawScene(ballPos, goalie, { aimVec, power });

    // check if ball reached goal line or went out
    if (ballPos.y <= goalY || frame > maxFrames || ballPos.x < -50 || ballPos.x > cw + 50){
      // Evaluate goal or saved
      const shotSide = (vec.x < -0.2) ? -1 : (vec.x > 0.2) ? 1 : 0;
      // If goalie dived to correct side and reached roughly same x at impact time, it's a save.
      const goalieReachedX = Math.abs(goalie.x - (cw*0.5 + shotSide * cw * 0.18)) < cw * 0.12;
      const saved = goalie.dived && goalieReachedX;
      if (saved){
        showMessage("Saved! The keeper guessed correctly.");
      } else {
        showMessage("GOAL!");
        goals++;
      }
      shotInProgress = false;
      updateHud();
      // small timeout before continuing / allow next shot
      setTimeout(() => {
        if (round >= SETTINGS.rounds){
          showMessage(`End of rounds. Score: ${goals}/${attempts}. Save if you want!`);
        } else {
          showMessage("Ready for next shot.");
        }
      }, 700);
      return;
    }
    // continue
    requestAnimationFrame(anim);
  }
  requestAnimationFrame(anim);
}

// Drawing the pitch, ball, goalie and HUD aim
function draw(){
  drawScene(ball, {x: cw*0.5, y: ch*0.12 - 20, dived:false}, {aimVec, power});
}
function drawScene(ballPos, goalieState, aimState){
  // clear
  ctx.clearRect(0,0,cw,ch);

  // grass fade
  const g = ctx.createLinearGradient(0,0,0,ch);
  g.addColorStop(0,"#6bd37f"); g.addColorStop(1,"#2e8f4a");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,cw,ch);

  // Penalty box & goal
  const goalWidth = cw * 0.5;
  const goalX = (cw - goalWidth)/2;
  const goalY = ch * 0.12;
  ctx.fillStyle = "#dbe9ff";
  ctx.fillRect(goalX, goalY - 6, goalWidth, 6); // crossbar
  // goal posts
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(goalX - 6, goalY - 60, 6, 60);
  ctx.fillRect(goalX + goalWidth, goalY - 60, 6, 60);

  // penalty spot and arc outline
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cw*0.5, ch*0.75 - 60, 44, Math.PI*1.1, Math.PI*1.9);
  ctx.stroke();

  // draw goalkeeper (simple rectangle+head)
  ctx.save();
  ctx.translate(goalieState.x, goalieState.y);
  ctx.fillStyle = "#222";
  ctx.fillRect(-18, -8, 36, 28); // body
  ctx.beginPath();
  ctx.fillStyle = "#f2c9a0";
  ctx.arc(0, -18, 10, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // ball
  ctx.beginPath();
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1.5;
  ctx.arc(ballPos.x, ballPos.y, SETTINGS.ballRadius, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();

  // draw aim vector if not shooting
  if (!shotInProgress){
    const av = aimState.aimVec || aimVec;
    const pwr = aimState.power || power;
    const lx = ball.x + av.x * 40;
    const ly = ball.y + av.y * 40;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(lx + av.x * pwr * 3, ly + av.y * pwr * 3);
    ctx.stroke();
    // power arc
    ctx.beginPath();
    ctx.strokeStyle = "rgba(29,110,219,0.9)";
    ctx.lineWidth = 4;
    ctx.arc(ball.x, ball.y, 18, -Math.PI/2, -Math.PI/2 + Math.min(2*Math.PI, pwr/SETTINGS.maxPower * Math.PI*1.6));
    ctx.stroke();
  }
}

// util: gaussian random with mean and sigma
function gaussian(mean, sigma) {
  // Box-Muller
  let u = 0, v = 0;
  while(u === 0) u = Math.random();
  while(v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + num * sigma;
}

// Highscore fetch/save
async function loadHighscores(){
  try{
    const res = await fetch("/api/highscores");
    if (!res.ok) throw new Error("Failed to load");
    const data = await res.json();
    highscoreList.innerHTML = "";
    data.forEach(it => {
      const li = document.createElement("li");
      li.textContent = `${it.name} — ${it.score}/${it.attempts} (${new Date(it.created_at).toLocaleString()})`;
      highscoreList.appendChild(li);
    });
  }catch(err){
    console.warn("Could not load highscores", err);
  }
}
saveBtn.addEventListener("click", async () => {
  try{
    await fetch("/api/highscores", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ name: playerNameInput.value || "Anon", score: goals, attempts })
    });
    showMessage("Score saved.");
    loadHighscores();
  }catch(err){ showMessage("Failed to save."); }
});

loadHighscores();
draw();