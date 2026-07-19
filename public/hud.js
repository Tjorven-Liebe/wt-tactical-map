// Telemetry variables
let currentSpeed = 0;
let playerPitch = 0;
let playerRoll = 0;

// Audio state
let audioCtx = null;
let lastGpwsBeepTime = 0;
let spokenGpwsPullup = false;
let spokenGpwsLowalt = false;
let spokenEngineOverheat = false;
let spokenEngineFailure = false;
let spokenFuelMid = false;
let spokenFuelEmpty = false;
let isSpeaking = false;
let groundLevel = 0;

// Speech synthesis voice
let cockpitVoice = null;

// Draggable config
let draggedElement = null;

// 3D Plane Vertices (Fighter Jet silhouette)
const planeVertices = [
  { x: 0, y: 0, z: -35 },   // 0: Nose
  { x: 0, y: 0, z: 35 },    // 1: Tail
  { x: 0, y: 10, z: 30 },   // 2: Tailfin tip
  { x: -32, y: -2, z: 10 },  // 3: Left wing tip
  { x: -7, y: -1, z: -10 },  // 4: Left wing root front
  { x: -7, y: -1, z: 18 },   // 5: Left wing root back
  { x: 32, y: -2, z: 10 },   // 6: Right wing tip
  { x: 7, y: -1, z: -10 },   // 7: Right wing root front
  { x: 7, y: -1, z: 18 },    // 8: Right wing root back
  { x: -12, y: 0, z: 30 },   // 9: Left stabilizer tip
  { x: 12, y: 0, z: 30 },    // 10: Right stabilizer tip
  { x: 0, y: 4, z: -12 },    // 11: Cockpit top
  { x: 0, y: 0, z: -20 },    // 12: Cockpit front root
  { x: 0, y: 0, z: -3 }      // 13: Cockpit back root
];

const planeEdges = [
  [0, 12], [12, 11], [11, 13], [13, 1], // Centerline fuselage & cockpit bubble top
  [0, 4], [4, 3], [3, 5], [5, 1],       // Left wing outline
  [0, 7], [7, 6], [6, 8], [8, 1],       // Right wing outline
  [1, 2], [2, 13],                      // Tailfin
  [1, 9], [9, 5],                       // Left stabilizer
  [1, 10], [10, 8]                      // Right stabilizer
];

// Initialize canvases
const canvas3d = document.getElementById('canvas-gyro3d');
const ctx3d = canvas3d ? canvas3d.getContext('2d') : null;

// Cookies Helpers
function getCookie(name) {
  return document.cookie.split('; ').reduce((r, v) => {
    const parts = v.split('=');
    return parts[0] === name ? decodeURIComponent(parts[1]) : r;
  }, '');
}

function setCookie(name, value, days = 30) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

// Check alert settings from cookies (shared with main window)
function isAlertSoundEnabled(type) {
  return getCookie(`alert_sound_${type}`) !== '0'; // default true
}

function isAlertTtsEnabled(type) {
  return getCookie(`alert_tts_${type}`) !== '0'; // default true
}

// Apply theme on load
function applyTheme() {
  const theme = getCookie('theme') || 'cyan';
  const struct = getCookie('struct_theme') || 'cyber';
  
  document.body.className = '';
  document.body.classList.add(`theme-${theme}`);
  document.body.classList.add(`struct-${struct}`);
}

// Audio initialization
const initAudioContext = () => {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch (e) {
    console.error('Failed to initialize AudioContext:', e);
  }
};
window.addEventListener('click', initAudioContext, { once: true });
window.addEventListener('keydown', initAudioContext, { once: true });

// Play GPWS sound alerts
function triggerGpwsBeep(type) {
  if (!audioCtx || audioCtx.state === 'suspended') return;
  if (!isAlertSoundEnabled('gpws')) return;

  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'gpws_whoop') {
      const now = Date.now();
      if (now - lastGpwsBeepTime < 800) return;
      lastGpwsBeepTime = now;

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(480, audioCtx.currentTime + 0.35);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    }

    if (type === 'gpws_beep') {
      const now = Date.now();
      if (now - lastGpwsBeepTime < 1000) return;
      lastGpwsBeepTime = now;

      for (let i = 0; i < 3; i++) {
        const timeOffset = i * 0.15;
        const oscBeep = audioCtx.createOscillator();
        const gainBeep = audioCtx.createGain();
        oscBeep.connect(gainBeep);
        gainBeep.connect(audioCtx.destination);

        oscBeep.type = 'sine';
        oscBeep.frequency.setValueAtTime(700, audioCtx.currentTime + timeOffset);
        gainBeep.gain.setValueAtTime(0.12, audioCtx.currentTime + timeOffset);
        gainBeep.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + timeOffset + 0.08);

        oscBeep.start(audioCtx.currentTime + timeOffset);
        oscBeep.stop(audioCtx.currentTime + timeOffset + 0.08);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

// Speak GPWS / Telemetry Warnings via Speech Synthesis
function speakWarning(type) {
  if (!isAlertTtsEnabled(type === 'gpws_pullup' || type === 'gpws_lowalt' ? 'gpws' : type.replace('engine_', '').replace('fuel_', ''))) {
    return;
  }
  if (isSpeaking || !window.speechSynthesis) return;

  let phrase = '';
  const isGerman = getCookie('selected_cockpit_voice')?.includes('_de') || false;

  if (type === 'gpws_pullup') phrase = isGerman ? 'Hochziehen. Hochziehen.' : 'Pull up. Pull up.';
  else if (type === 'gpws_lowalt') phrase = isGerman ? 'Achtung, niedrige Flughöhe.' : 'Warning, low altitude.';
  else if (type === 'engine_overheat') phrase = isGerman ? 'Achtung, Triebwerk überhitzt. Triebwerk überhitzt.' : 'Warning, engine overheat. Engine overheat.';
  else if (type === 'engine_failure') phrase = isGerman ? 'Achtung, Triebwerksausfall. Triebwerksausfall.' : 'Warning, engine failure. Engine failure.';
  else if (type === 'fuel_mid') phrase = isGerman ? 'Warnung, halber Kraftstoff.' : 'Warning, fuel level fifty percent.';
  else if (type === 'fuel_low') phrase = isGerman ? 'Achtung, niedriger Kraftstoffstand.' : 'Warning, low fuel.';

  if (!phrase) return;

  const utter = new SpeechSynthesisUtterance(phrase);
  utter.rate = 1.1;
  utter.volume = 1.0;
  
  if (cockpitVoice) utter.voice = cockpitVoice;
  else {
    const voices = window.speechSynthesis.getVoices();
    const matched = voices.find(v => v.lang.startsWith(isGerman ? 'de' : 'en'));
    if (matched) utter.voice = matched;
  }

  utter.onstart = () => { isSpeaking = true; };
  utter.onend = () => { isSpeaking = false; };
  utter.onerror = () => { isSpeaking = false; };

  window.speechSynthesis.speak(utter);
}

// Select suitable voice profile on startup
function selectVoice() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  const savedVoice = getCookie('selected_cockpit_voice') || 'google_neural_en';
  
  const matched = voices.find(v => v.name === savedVoice);
  if (matched) {
    cockpitVoice = matched;
    return;
  }
  // Fallbacks
  const fallback = voices.find(v => v.lang.startsWith('en'));
  if (fallback) cockpitVoice = fallback;
}
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = selectVoice;
}

// Update Mechanical indicator elements
function updateMechIndicator(elementId, valueId, percent, activeText, inactiveText) {
  const el = document.getElementById(elementId);
  const valEl = document.getElementById(valueId);
  if (!el || !valEl) return;

  if (percent > 5) {
    el.classList.add('active');
    valEl.textContent = percent === 100 ? activeText : `${percent}%`;
  } else {
    el.classList.remove('active');
    valEl.textContent = inactiveText;
  }
}

// Draw 3D wireframe aircraft indicator
function draw3DAttitude(pitchDeg, rollDeg) {
  if (!canvas3d || !ctx3d) return;

  ctx3d.clearRect(0, 0, canvas3d.width, canvas3d.height);

  const cx = canvas3d.width / 2;
  const cy = canvas3d.height / 2;
  const r = 100; // Radius inside bezel

  const pitchRad = (-pitchDeg * Math.PI) / 180;
  const rollRad = (rollDeg * Math.PI) / 180;

  const themeMain = getComputedStyle(document.body).getPropertyValue('--color-text-main').trim() || '#00ffc4';
  const themeBorder = getComputedStyle(document.body).getPropertyValue('--color-border').trim() || 'rgba(0, 240, 255, 0.2)';

  let skyColorStart = '#02181b', skyColorEnd = '#064249';
  let groundColorStart = '#1d1102', groundColorEnd = '#090500';

  const activeTheme = getCookie('theme') || 'cyan';
  if (activeTheme === 'red') {
    skyColorStart = '#2b060f'; skyColorEnd = '#5c1022';
    groundColorStart = '#201014'; groundColorEnd = '#0b0406';
  } else if (activeTheme === 'purple') {
    skyColorStart = '#25083a'; skyColorEnd = '#48196e';
    groundColorStart = '#1d0c24'; groundColorEnd = '#0b030f';
  }

  // Draw sphere background (clipped)
  ctx3d.save();
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx3d.clip();

  ctx3d.save();
  ctx3d.translate(cx, cy);
  ctx3d.rotate(-rollRad);
  const pitchOffset = pitchDeg * 2.8;
  ctx3d.translate(0, pitchOffset);

  // Sky
  const skyG = ctx3d.createLinearGradient(0, -300, 0, 0);
  skyG.addColorStop(0, skyColorStart);
  skyG.addColorStop(1, skyColorEnd);
  ctx3d.fillStyle = skyG;
  ctx3d.fillRect(-300, -300, 600, 300);

  // Ground
  const groundG = ctx3d.createLinearGradient(0, 0, 0, 300);
  groundG.addColorStop(0, groundColorStart);
  groundG.addColorStop(1, groundColorEnd);
  ctx3d.fillStyle = groundG;
  ctx3d.fillRect(-300, 0, 600, 300);

  // Horizon bar
  ctx3d.strokeStyle = '#ffffff';
  ctx3d.lineWidth = 2.5;
  ctx3d.beginPath();
  ctx3d.moveTo(-300, 0);
  ctx3d.lineTo(300, 0);
  ctx3d.stroke();

  // Pitch scale ticks
  ctx3d.fillStyle = 'rgba(255,255,255,0.7)';
  ctx3d.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx3d.font = 'bold 9px "Rajdhani", sans-serif';
  ctx3d.textAlign = 'center';
  ctx3d.textBaseline = 'middle';

  for (let y = -80; y <= 80; y += 10) {
    if (y === 0) continue;
    const yPos = -y * 2.8;
    ctx3d.lineWidth = 1.2;
    ctx3d.beginPath();
    const w = y > 0 ? 32 : 24;
    if (y > 0) {
      ctx3d.moveTo(-w, yPos);
      ctx3d.lineTo(w, yPos);
    } else {
      ctx3d.setLineDash([4, 3]);
      ctx3d.moveTo(-w, yPos);
      ctx3d.lineTo(w, yPos);
      ctx3d.setLineDash([]);
    }
    ctx3d.stroke();
    ctx3d.fillText(Math.abs(y), -w - 12, yPos);
    ctx3d.fillText(Math.abs(y), w + 12, yPos);
  }
  ctx3d.restore();

  // Sphere bezel shadow
  const radShad = ctx3d.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
  radShad.addColorStop(0, 'rgba(0,0,0,0)');
  radShad.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx3d.fillStyle = radShad;
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx3d.fill();

  ctx3d.restore(); // ends clipping

  // Bezel frame ring
  ctx3d.lineWidth = 10;
  ctx3d.strokeStyle = '#22272e';
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, r + 5, 0, 2 * Math.PI);
  ctx3d.stroke();

  // Draw 3D wireframe jet
  const distance = 80;
  const scale = 1.35;
  const projectedPoints = planeVertices.map(v => {
    // Rotation X (Pitch)
    const cosP = Math.cos(pitchRad);
    const sinP = Math.sin(pitchRad);
    const y1 = v.y * cosP - v.z * sinP;
    const z1 = v.y * sinP + v.z * cosP;
    const x1 = v.x;

    // Rotation Z (Roll)
    const cosR = Math.cos(rollRad);
    const sinR = Math.sin(rollRad);
    const x2 = x1 * cosR - y1 * sinR;
    const y2 = x1 * sinR + y1 * cosR;

    // Projection
    const px = cx + (x2 * distance) / (distance + z1) * scale;
    const py = cy - (y2 * distance) / (distance + z1) * scale;
    return { x: px, y: py };
  });

  ctx3d.strokeStyle = '#ffffff';
  ctx3d.lineWidth = 1.8;
  planeEdges.forEach(edge => {
    const p1 = projectedPoints[edge[0]];
    const p2 = projectedPoints[edge[1]];
    ctx3d.beginPath();
    ctx3d.moveTo(p1.x, p1.y);
    ctx3d.lineTo(p2.x, p2.y);
    ctx3d.stroke();
  });

  // Static reference pointer
  ctx3d.strokeStyle = '#ffb703';
  ctx3d.lineWidth = 3.5;
  ctx3d.beginPath();
  ctx3d.moveTo(cx - 45, cy); ctx3d.lineTo(cx - 18, cy); ctx3d.lineTo(cx - 18, cy + 5);
  ctx3d.moveTo(cx + 45, cy); ctx3d.lineTo(cx + 18, cy); ctx3d.lineTo(cx + 18, cy + 5);
  ctx3d.stroke();

  ctx3d.fillStyle = '#ffb703';
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, 4, 0, 2 * Math.PI);
  ctx3d.fill();
}

// Telemetry Fetch Loop
async function updateHUDData() {
  try {
    const res = await fetch('/state');
    if (!res.ok) {
      setDisconnectedHUD();
      return;
    }

    const state = await res.json();
    if (state.valid === false) {
      setDisconnectedHUD();
      return;
    }

    // Connected state UI update
    document.getElementById('status-dot').className = 'status-dot online';
    document.getElementById('status-text').textContent = 'ONLINE';

    // Primary parameters
    const ias = state['IAS, km/h'] !== undefined ? Math.round(state['IAS, km/h']) : (state['V, km/h'] !== undefined ? Math.round(state['V, km/h']) : 0);
    const tas = state['TAS, km/h'] !== undefined ? Math.round(state['TAS, km/h']) : ias;
    const alt = state['H, m'] !== undefined ? Math.round(state['H, m']) : 0;
    const climbVal = state['Vy, m/s'] !== undefined ? state['Vy, m/s'] : 0;
    const throttle = state['throttle, %'] !== undefined ? Math.round(state['throttle, %']) : 0;
    const gload = state['Ny'] !== undefined ? state['Ny'] : 1.0;
    const aoa = state['AoA, deg'] !== undefined ? state['AoA, deg'] : 0.0;
    const mach = state['M'] !== undefined ? state['M'] : 0.00;

    currentSpeed = ias;

    // Set digital readouts
    document.getElementById('val-spd').textContent = ias;
    document.getElementById('val-tas').textContent = tas;
    document.getElementById('val-alt').textContent = alt;
    document.getElementById('val-climb').textContent = climbVal.toFixed(1);
    document.getElementById('val-thr').textContent = throttle;
    document.getElementById('val-gload').textContent = gload.toFixed(1);
    document.getElementById('val-aoa').textContent = aoa.toFixed(1);
    document.getElementById('val-mach').textContent = mach.toFixed(2);

    // Fuel telemetry
    const mFuel = state['M fuel, kg'] !== undefined ? state['M fuel, kg'] : -1;
    const mFuelMax = state['M fuel max, kg'] !== undefined ? state['M fuel max, kg'] : 0;
    if (mFuel !== -1 && mFuelMax > 0) {
      const fuelPct = Math.round((mFuel / mFuelMax) * 100);
      document.getElementById('val-fuel').textContent = `${Math.round(mFuel)} kg (${fuelPct}%)`;
      const fuelBar = document.getElementById('bar-fuel');
      if (fuelBar) {
        fuelBar.style.width = `${Math.min(fuelPct, 100)}%`;
        if (fuelPct < 20) {
          fuelBar.style.background = 'linear-gradient(90deg, #ff0055, #ff3366)';
        } else if (fuelPct < 50) {
          fuelBar.style.background = 'linear-gradient(90deg, #ffaa00, #ffb703)';
        } else {
          fuelBar.style.background = '';
        }
      }

      // Fuel dial gauge update
      const mFuelLbs = mFuel * 2.20462;
      const mFuelLbsThousands = mFuelLbs / 1000;
      document.getElementById('val-fuel-digital-lbs').textContent = `${Math.round(mFuelLbs)} LBS`;
      document.getElementById('val-fuel-digital-kg').textContent = `${Math.round(mFuel)} KG (${fuelPct}%)`;

      const clampedLbsVal = Math.max(0, Math.min(mFuelLbsThousands, 6));
      const needleAngle = 210 + (clampedLbsVal * 50);
      const needleGroup = document.getElementById('fuel-needle-group');
      if (needleGroup) {
        needleGroup.style.transform = `rotate(${needleAngle}deg)`;
      }

      // Fuel voice warning checks
      if (fuelPct > 90) {
        spokenFuelMid = false;
        spokenFuelEmpty = false;
      }
      if (fuelPct < 50 && fuelPct >= 20) {
        if (!spokenFuelMid) {
          speakWarning('fuel_mid');
          spokenFuelMid = true;
        }
      } else if (fuelPct < 20) {
        if (!spokenFuelEmpty) {
          speakWarning('fuel_low');
          spokenFuelEmpty = true;
        }
      }
    }

    // Engine Temperatures
    const oilTemp = state['t_oil_min'] !== undefined ? state['t_oil_min'] : 0;
    const waterTemp = state['t_water_min'] !== undefined ? state['t_water_min'] : 0;
    const rpm = state['RPM min'] !== undefined ? state['RPM min'] : 0;

    document.getElementById('val-rpm').textContent = Math.round(rpm);
    document.getElementById('bar-rpm').style.width = `${Math.min((rpm / 3500) * 100, 100)}%`;

    document.getElementById('val-oil').textContent = `${Math.round(oilTemp)} °C`;
    document.getElementById('bar-oil').style.width = `${Math.min((oilTemp / 150) * 100, 100)}%`;

    document.getElementById('val-water').textContent = `${Math.round(waterTemp)} °C`;
    document.getElementById('bar-water').style.width = `${Math.min((waterTemp / 120) * 100, 100)}%`;

    // Oil Temp Warnings
    const oilRow = document.getElementById('row-oil');
    if (oilRow) {
      if (oilTemp >= 125) oilRow.className = 'engine-row danger-flash';
      else if (oilTemp >= 110) oilRow.className = 'engine-row caution-flash';
      else oilRow.className = 'engine-row';
    }

    // Water/H2O Temp Warnings
    const waterRow = document.getElementById('row-water');
    if (waterRow) {
      if (waterTemp >= 115) waterRow.className = 'engine-row danger-flash';
      else if (waterTemp >= 100) waterRow.className = 'engine-row caution-flash';
      else waterRow.className = 'engine-row';
    }

    // Overheat warning trigger
    if (oilTemp >= 125 || waterTemp >= 115) {
      if (!spokenEngineOverheat) {
        spokenEngineOverheat = true;
        speakWarning('engine_overheat');
      }
    } else if (oilTemp < 110 && waterTemp < 100) {
      spokenEngineOverheat = false;
    }

    // Engine failure warning trigger
    if (ias > 150 && throttle > 20 && rpm < 200) {
      if (!spokenEngineFailure) {
        spokenEngineFailure = true;
        speakWarning('engine_failure');
      }
    } else if (rpm > 1000 || ias < 50) {
      spokenEngineFailure = false;
    }

    // Mechanical components
    const gearVal = state['gear, %'] !== undefined ? state['gear, %'] : 0;
    const flapsVal = state['flaps, %'] !== undefined ? state['flaps, %'] : 0;
    const airbrakeVal = state['airbrake, %'] !== undefined ? state['airbrake, %'] : 0;

    updateMechIndicator('mech-gear', 'val-gear', gearVal, 'DOWN', 'RETRACTED');
    updateMechIndicator('mech-flaps', 'val-flaps', flapsVal, 'DEPLOYED', 'UP');
    updateMechIndicator('mech-airbrake', 'val-airbrake', airbrakeVal, 'ENGAGED', 'RETRACTED');

    // GPWS (Ground Proximity Warning System) checks
    if (gearVal <= 80) {
      if (ias < 15 && Math.abs(climbVal) < 1 && throttle < 15) {
        groundLevel = alt;
      }
      const triggerAlt = 150 + Math.abs(climbVal) * 8;
      const relativeAlt = alt - groundLevel;

      if (relativeAlt < triggerAlt && climbVal < -5) {
        if (!spokenGpwsPullup) {
          spokenGpwsPullup = true;
          triggerGpwsBeep('gpws_whoop');
          speakWarning('gpws_pullup');
        }
      } else if (climbVal >= -2 || relativeAlt > (triggerAlt + 50)) {
        spokenGpwsPullup = false;
      }

      if (relativeAlt < 60) {
        if (!spokenGpwsLowalt) {
          spokenGpwsLowalt = true;
          triggerGpwsBeep('gpws_beep');
          speakWarning('gpws_lowalt');
        }
      } else if (relativeAlt > 80) {
        spokenGpwsLowalt = false;
      }
    } else {
      spokenGpwsPullup = false;
      spokenGpwsLowalt = false;
    }

    // Radar values
    const radarActive = state['radar_active'] === true || state['radar_active'] === 1 || state['radar_active'] === 'true';
    const radarValActive = document.getElementById('radar-val-active');
    const radarValMode = document.getElementById('radar-val-mode');
    const radarValRange = document.getElementById('radar-val-range');
    const radarSweepBar = document.getElementById('radar-sweep-bar');

    if (radarValActive) {
      if (radarActive) {
        radarValActive.textContent = 'ACTIVE';
        radarValActive.style.color = 'var(--color-text-main)';
      } else {
        radarValActive.textContent = 'STANDBY';
        radarValActive.style.color = 'var(--color-text-dim)';
      }
    }

    if (radarActive) {
      if (radarValMode && state['radar_mode'] !== undefined) {
        radarValMode.textContent = String(state['radar_mode']).toUpperCase();
      }
      if (radarValRange) {
        let rangeVal = '-- km';
        if (state['radar_range_km'] !== undefined) {
          rangeVal = `${state['radar_range_km']} km`;
        } else if (state['radar_scale'] !== undefined) {
          rangeVal = state['radar_scale'];
        }
        radarValRange.textContent = rangeVal;
      }
      if (radarSweepBar) {
        const sweepPct = 50 + 50 * Math.sin(Date.now() / 300);
        radarSweepBar.style.width = `${sweepPct}%`;
      }
    } else {
      if (radarSweepBar) radarSweepBar.style.width = '0%';
    }

    // Fetch indicators (pitch, roll, compass)
    const indRes = await fetch('/indicators');
    if (indRes.ok) {
      const indicators = await indRes.json();
      if (indicators.valid) {
        let pitch = indicators.aviahorizon_pitch !== undefined ? indicators.aviahorizon_pitch : (indicators.pitch !== undefined ? indicators.pitch : 0);
        pitch = -pitch;
        playerPitch = pitch;
        const bank = indicators.aviahorizon_roll !== undefined ? indicators.aviahorizon_roll : (indicators.bank !== undefined ? indicators.bank : 0);
        playerRoll = bank;
        const compass = indicators.compass !== undefined ? Math.round(indicators.compass) : 0;

        if (indicators.type) {
          document.getElementById('hud-title-aircraft').textContent = `COCKPIT FLIGHT INSTRUMENTS [${indicators.type.toUpperCase()}]`;
        }

        // Update readouts
        document.getElementById('val-pitch').textContent = `${pitch.toFixed(1)}°`;
        document.getElementById('val-roll').textContent = `${bank.toFixed(1)}°`;
        const hdgStr = String(compass).padStart(3, '0');
        document.getElementById('val-hdg').textContent = `${hdgStr}°`;

        // Update Gyro SVG
        const horizon = document.getElementById('gyro-horizon');
        if (horizon) {
          horizon.style.transform = `rotate(${bank}deg) translateY(${pitch * 2.0}px)`;
        }

        // Draw 3D Wireframe
        draw3DAttitude(pitch, bank);
      }
    }

  } catch (err) {
    setDisconnectedHUD();
  }
}

// Disconnected fallback values
function setDisconnectedHUD() {
  document.getElementById('status-dot').className = 'status-dot offline';
  document.getElementById('status-text').textContent = 'OFFLINE';
  document.getElementById('hud-title-aircraft').textContent = 'COCKPIT FLIGHT INSTRUMENTS [STANDBY]';

  spokenFuelMid = false;
  spokenFuelEmpty = false;
  spokenEngineOverheat = false;
  spokenEngineFailure = false;
  spokenGpwsPullup = false;
  spokenGpwsLowalt = false;
  isSpeaking = false;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

// Collapsible sub-panels toggles
function toggleHudPanel(panelId) {
  const panel = document.getElementById(`panel-${panelId}`);
  const btn = document.getElementById(`btn-toggle-${panelId}`);
  if (!panel || !btn) return;

  const isCollapsed = panel.classList.toggle('collapsed');
  btn.textContent = isCollapsed ? '[+]' : '[-]';
  setCookie(`hud_collapsed_${panelId}`, isCollapsed ? '1' : '0');
}

// Draggable Sub-panels Layout Management
function saveHUDLayout() {
  const leftZone = document.getElementById('hud-zone-left');
  const centerZone = document.getElementById('hud-zone-center');
  const rightZone = document.getElementById('hud-zone-right');

  const layout = {
    left: leftZone ? [...leftZone.querySelectorAll('.hud-sub-panel')].map(el => el.id) : [],
    center: centerZone ? [...centerZone.querySelectorAll('.hud-sub-panel')].map(el => el.id) : [],
    right: rightZone ? [...rightZone.querySelectorAll('.hud-sub-panel')].map(el => el.id) : []
  };

  setCookie('hud_layout_config', JSON.stringify(layout));
}

function restoreHUDLayout() {
  const leftZone = document.getElementById('hud-zone-left');
  const centerZone = document.getElementById('hud-zone-center');
  const rightZone = document.getElementById('hud-zone-right');
  const configStr = getCookie('hud_layout_config');

  const elementsMap = {};
  const ids = ['panel-stats', 'panel-gyro', 'panel-gyro3d', 'panel-engine', 'panel-radar', 'panel-fuel', 'panel-mech'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) elementsMap[id] = el;
  });

  if (configStr) {
    try {
      const layout = JSON.parse(configStr);
      if (layout.left && leftZone) {
        layout.left.forEach(id => {
          const el = elementsMap[id];
          if (el) { leftZone.appendChild(el); delete elementsMap[id]; }
        });
      }
      if (layout.center && centerZone) {
        layout.center.forEach(id => {
          const el = elementsMap[id];
          if (el) { centerZone.appendChild(el); delete elementsMap[id]; }
        });
      }
      if (layout.right && rightZone) {
        layout.right.forEach(id => {
          const el = elementsMap[id];
          if (el) { rightZone.appendChild(el); delete elementsMap[id]; }
        });
      }
    } catch (err) {
      console.error('Failed to restore HUD layout config:', err);
    }
  }

  // Safe fallback
  Object.keys(elementsMap).forEach(id => {
    const el = elementsMap[id];
    if (id === 'panel-gyro' || id === 'panel-gyro3d') {
      if (centerZone) centerZone.appendChild(el);
    } else if (id === 'panel-stats') {
      if (leftZone) leftZone.appendChild(el);
    } else {
      if (rightZone) rightZone.appendChild(el);
    }
  });
}

// Drag & Drop event listener registration
function registerDraggables() {
  const draggables = document.querySelectorAll('.hud-sub-panel');
  const dropZones = document.querySelectorAll('.hud-column');

  draggables.forEach(draggable => {
    draggable.addEventListener('dragstart', (e) => {
      draggedElement = draggable;
      draggable.classList.add('dragging');
      e.dataTransfer.setData('text/plain', draggable.id);
    });

    draggable.addEventListener('dragend', () => {
      draggable.classList.remove('dragging');
      saveHUDLayout();
    });
  });

  dropZones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragging-over');
      const afterElement = getDragAfterElement(zone, e.clientY);
      if (draggedElement) {
        if (afterElement == null) {
          zone.appendChild(draggedElement);
        } else {
          zone.insertBefore(draggedElement, afterElement);
        }
      }
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragging-over');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragging-over');
      saveHUDLayout();
    });
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.hud-sub-panel:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: -Infinity }).element;
}

// Initialise HUD scripts on DOM loaded
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  restoreHUDLayout();
  registerDraggables();

  // Setup sub-panel toggles
  const panelIds = ['stats', 'gyro', 'gyro3d', 'fuel', 'mech', 'engine', 'radar'];
  panelIds.forEach(id => {
    const btn = document.getElementById(`btn-toggle-${id}`);
    if (btn) {
      btn.addEventListener('click', () => toggleHudPanel(id));
    }
    const val = getCookie(`hud_collapsed_${id}`);
    if (val === '1') {
      const panel = document.getElementById(`panel-${id}`);
      if (panel) panel.classList.add('collapsed');
      if (btn) btn.textContent = '[+]';
    }
  });

  // Periodic updates
  setInterval(updateHUDData, 100);
});
