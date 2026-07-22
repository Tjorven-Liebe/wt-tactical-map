// State variables
let socketConnected = false;
let wtConnected = false;
let lastPingTime = 0;
let pingMs = 0;
let currentSpeed = 0;
const unitSpeedTracker = new Map();

// Map render configuration
let zoom = 1.0;
let mapMin = [-32500, -32500];
let mapMax = [32500, 32500];
let mapImgLoaded = false;
let mapImgIsPlaceholder = false;
const mapImg = new Image();

// Player state
let playerX = 0.5;
let playerY = 0.5;
let playerHeading = 0;
let playerPitch = 0;
let playerRoll = 0;
let autoCenter = true;
const playerTrail = [];
const maxTrailLength = 150;

// 3D Canvas Contexts
const canvas3d = document.getElementById('canvas-gyro3d');
const ctx3d = canvas3d ? canvas3d.getContext('2d') : null;

// Game objects
let mapObjects = [];
let missionName = 'NO MATCH DETECTED';

// Combat Log / Event feed state
let lastEvtId = -1;
let lastDmgId = -1;
let playerNickname = '';
let playerAircraftType = '';
let symbolTheme = 'standard';
let structTheme = 'cyber';
let activeThreatKey = null;
let activeThreatLevel = null;
let isPlayerAlive = false;
let isPlayerTank = false;
let lastConnectedTime = 0;

// Speech Synthesis / Text-to-Speech (TTS) voice alert state
let spokenFuelMid = false;
let spokenFuelEmpty = false;
let spokenEngineOverheat = false;
let spokenEngineFailure = false;
let spokenGpwsPullup = false;
let spokenGpwsLowalt = false;
let lastGpwsBeepTime = 0;
let groundLevel = 0;
const spokenThreatKeys = new Set();
const knownCloseThreats = new Set();
let cockpitVoice = null;
let activeSpeechAudio = null;
let isSpeaking = false;

function selectCockpitVoice() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  
  // Try loading selected voice from cookie/dropdown value first
  const selVal = document.getElementById('sel-cockpit-voice')?.value || getCookie('selected_cockpit_voice') || 'google_neural_en';
  if (selVal && !selVal.startsWith('google_neural')) {
    const matched = voices.find(v => v.name === selVal);
    if (matched) {
      cockpitVoice = matched;
      return;
    }
  }

  // 1. Prefer Microsoft Zira (Clear female English voice standard on Windows)
  let selected = voices.find(v => v.name.includes('Zira') && v.lang.startsWith('en'));
  if (selected) { cockpitVoice = selected; return; }
  
  // 2. Try any Google US English Female voice
  selected = voices.find(v => v.name.toLowerCase().includes('google') && v.name.toLowerCase().includes('female') && v.lang.startsWith('en'));
  if (selected) { cockpitVoice = selected; return; }

  // 3. Try any female English voice
  selected = voices.find(v => v.name.toLowerCase().includes('female') && v.lang.startsWith('en'));
  if (selected) { cockpitVoice = selected; return; }

  // 4. Try any English voice
  selected = voices.find(v => v.lang.startsWith('en'));
  if (selected) { cockpitVoice = selected; return; }

  // 5. Fallback to first voice (might be German)
  cockpitVoice = voices[0] || null;
}

function populateVoiceList() {
  const dropdown = document.getElementById('sel-cockpit-voice');
  if (!dropdown) return;
  
  dropdown.innerHTML = '';

  // Add high-quality Google Neural options at the top
  const savedVoice = getCookie('selected_cockpit_voice') || 'google_neural_en';
  
  const optNeuralEn = document.createElement('option');
  optNeuralEn.value = 'google_neural_en';
  optNeuralEn.textContent = 'GOOGLE NEURAL CLOUD (ENGLISH - HIGH QUALITY)';
  if (savedVoice === 'google_neural_en') optNeuralEn.selected = true;
  dropdown.appendChild(optNeuralEn);

  const optNeuralDe = document.createElement('option');
  optNeuralDe.value = 'google_neural_de';
  optNeuralDe.textContent = 'GOOGLE NEURAL CLOUD (GERMAN - HIGH QUALITY)';
  if (savedVoice === 'google_neural_de') optNeuralDe.selected = true;
  dropdown.appendChild(optNeuralDe);

  if (window.speechSynthesis) {
    const voices = window.speechSynthesis.getVoices();
    voices.forEach(voice => {
      const opt = document.createElement('option');
      opt.value = voice.name;
      opt.textContent = `${voice.name} (${voice.lang}) [OFFLINE]`;
      if (voice.name === savedVoice) {
        opt.selected = true;
      }
      dropdown.appendChild(opt);
    });
  }
}

if (window.speechSynthesis) {
  selectCockpitVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    selectCockpitVoice();
    populateVoiceList();
  };

  // Wire up change listener
  document.addEventListener('DOMContentLoaded', () => {
    const dropdown = document.getElementById('sel-cockpit-voice');
    if (dropdown) {
      populateVoiceList();
      dropdown.addEventListener('change', (e) => {
        const selectedName = e.target.value;
        setCookie('selected_cockpit_voice', selectedName, 365);
        selectCockpitVoice();
        // Allow the test warnings to interrupt anything
        isSpeaking = false;
        speakCockpitWarning('test');
      });
    }
  });
}

function speakText(text) {
  if (isSpeaking || (window.speechSynthesis && window.speechSynthesis.speaking)) {
    // Already speaking, do not interrupt!
    return;
  }

  const selectedVoiceName = document.getElementById('sel-cockpit-voice')?.value || getCookie('selected_cockpit_voice') || 'google_neural_en';

  if (selectedVoiceName.startsWith('google_neural')) {
    const lang = selectedVoiceName.endsWith('_de') ? 'de' : 'en';
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text)}`;
    
    try {
      isSpeaking = true;
      activeSpeechAudio = new Audio(url);
      
      activeSpeechAudio.addEventListener('ended', () => {
        isSpeaking = false;
      });
      activeSpeechAudio.addEventListener('error', () => {
        isSpeaking = false;
      });

      activeSpeechAudio.play().catch(err => {
        console.warn('Google Neural TTS play failed, falling back to local SpeechSynthesis:', err);
        isSpeaking = false;
        playSpeechSynthesisFallback(text);
      });
      return;
    } catch (e) {
      console.warn('Google Neural TTS failed to initialize, falling back to local SpeechSynthesis:', e);
      isSpeaking = false;
      playSpeechSynthesisFallback(text);
      return;
    }
  }

  playSpeechSynthesisFallback(text);
}

function playSpeechSynthesisFallback(text) {
  if (!window.speechSynthesis) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    if (cockpitVoice) {
      utterance.voice = cockpitVoice;
    }
    utterance.rate = 1.15; // Slightly faster military cockpit warning style
    utterance.pitch = 1.05; // Slightly higher pitch to cut through noise
    
    utterance.onstart = () => {
      isSpeaking = true;
    };
    utterance.onend = () => {
      isSpeaking = false;
    };
    utterance.onerror = () => {
      isSpeaking = false;
    };

    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.error('Speech synthesis fallback error:', e);
    isSpeaking = false;
  }
}

function speakCockpitWarning(type) {
  if (!window.speechSynthesis) return;
  if (!wtConnected || mapImgIsPlaceholder) {
    return;
  }

  // Central category check
  let category = 'merge';
  if (type.startsWith('fuel_')) category = 'fuel';
  else if (type === 'threat_lock') category = 'lock';
  else if (type === 'engine_overheat') category = 'overheat';
  else if (type === 'engine_failure') category = 'failure';
  else if (type.startsWith('gpws_')) category = 'gpws';

  if (!isAlertTtsEnabled(category)) {
    return;
  }

  const selectedVoiceName = document.getElementById('sel-cockpit-voice')?.value || getCookie('selected_cockpit_voice') || 'google_neural_en';
  
  let isGerman = false;
  if (selectedVoiceName === 'google_neural_de') {
    isGerman = true;
  } else if (selectedVoiceName === 'google_neural_en') {
    isGerman = false;
  } else {
    // Offline local voice fallback checks
    if (!cockpitVoice) {
      selectCockpitVoice();
    }
    isGerman = cockpitVoice && (
      cockpitVoice.lang.startsWith('de') || 
      cockpitVoice.name.toLowerCase().includes('deutsch') || 
      cockpitVoice.name.toLowerCase().includes('hedda') || 
      cockpitVoice.name.toLowerCase().includes('stefan')
    );
  }
  
  let text = '';
  if (type === 'fuel_mid') {
    text = isGerman ? 'Treibstoff, fünfzig Prozent.' : 'Fuel, fifty percent.';
  } else if (type === 'fuel_low') {
    text = isGerman ? 'Treibstoff niedrig. Treibstoff niedrig.' : 'Fuel low. Fuel low.';
  } else if (type === 'threat_rear') {
    text = isGerman ? 'Achtung, Gefahr von hinten.' : 'Warning, check six.';
  } else if (type === 'threat_front') {
    text = isGerman ? 'Achtung, Feindkontakt.' : 'Warning, threat contact.';
  } else if (type === 'test') {
    text = isGerman ? 'Sprechverbindung hergestellt.' : 'Cockpit voice active.';
  } else if (type === 'threat_lock') {
    text = isGerman ? 'Achtung, Aufschaltung.' : 'Warning, threat lock.';
  } else if (type === 'engine_overheat') {
    text = isGerman ? 'Achtung, Triebwerk überhitzt. Triebwerk überhitzt.' : 'Warning, engine overheat. Engine overheat.';
  } else if (type === 'engine_failure') {
    text = isGerman ? 'Achtung, Triebwerksausfall. Triebwerksausfall.' : 'Warning, engine failure. Engine failure.';
  } else if (type === 'gpws_pullup') {
    text = isGerman ? 'Hochziehen. Hochziehen.' : 'Pull up. Pull up.';
  } else if (type === 'gpws_lowalt') {
    text = isGerman ? 'Achtung, niedrige Flughöhe.' : 'Warning, low altitude.';
  }

  if (text) {
    speakText(text);
  }
}

function checkFuelVoiceAlerts(mFuel, mFuelMax) {
  if (mFuel === -1 || mFuelMax <= 0) return;
  const isEnabled = document.getElementById('chk-voice-fuel-alerts')?.checked ?? true;
  if (!isEnabled) return;

  const fuelPct = (mFuel / mFuelMax) * 100;
  
  // Reset if refilled or full
  if (fuelPct > 90) {
    spokenFuelMid = false;
    spokenFuelEmpty = false;
  }

  if (fuelPct < 50 && fuelPct >= 20) {
    if (!spokenFuelMid) {
      speakCockpitWarning('fuel_mid');
      spokenFuelMid = true;
    }
  } else if (fuelPct < 20) {
    if (!spokenFuelEmpty) {
      speakCockpitWarning('fuel_low');
      spokenFuelEmpty = true;
    }
  }
}

// Canvas Context
const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');

// Mouse position for coordinate readout
let mouseX = 0;
let mouseY = 0;

// Setup image loading
mapImg.onload = () => {
  mapImgLoaded = true;
  mapImgIsPlaceholder = isPlaceholderImage(mapImg);
  if (mapImgIsPlaceholder) {
    spokenFuelMid = false;
    spokenFuelEmpty = false;
    spokenEngineOverheat = false;
    spokenEngineFailure = false;
    spokenGpwsPullup = false;
    spokenGpwsLowalt = false;
    spokenThreatKeys.clear();
    isSpeaking = false;
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (activeSpeechAudio) {
      activeSpeechAudio.pause();
      activeSpeechAudio = null;
    }
  }
};
mapImg.onerror = () => {
  mapImgLoaded = false;
  mapImgIsPlaceholder = false;
};

// Check if image is the gray question-mark placeholder returned by Gaijin when in menu/hangar
function isPlaceholderImage(img) {
  try {
    // Create a small offscreen canvas to inspect color distribution
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 16;
    tempCanvas.height = 16;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return false;
    tempCtx.drawImage(img, 0, 0, 16, 16);

    const imgData = tempCtx.getImageData(0, 0, 16, 16).data;

    let monochromeCount = 0;
    const totalPixels = 16 * 16;

    for (let i = 0; i < imgData.length; i += 4) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];

      // If R, G, and B values are nearly identical, the pixel is greyscale
      if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8 && Math.abs(r - b) < 8) {
        monochromeCount++;
      }
    }

    const ratio = monochromeCount / totalPixels;
    // The Gaijin menu placeholder is 100% greyscale, real maps have forest/water/field colors
    return ratio > 0.98;
  } catch (err) {
    console.error('Error checking map image pixels:', err);
    return false;
  }
}

// Draw a beautiful circular tactical radar scanning standby grid on the canvas
function drawRadarStandbyScreen() {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const maxRadius = Math.min(canvas.width, canvas.height) / 2 * 0.9;

  const themeMain = getComputedStyle(document.body).getPropertyValue('--color-text-main').trim() || '#00ffc4';
  const themeBorder = getComputedStyle(document.body).getPropertyValue('--color-border').trim() || 'rgba(0, 240, 255, 0.2)';
  const themeDim = getComputedStyle(document.body).getPropertyValue('--color-text-dim').trim() || '#7f9bb3';

  // 1. Draw outer compass ring bezel
  ctx.strokeStyle = themeBorder;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, maxRadius, 0, 2 * Math.PI);
  ctx.stroke();

  // Compass ticks and degree labels
  ctx.fillStyle = themeMain;
  ctx.font = '8px Share Tech Mono';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let angle = 0; angle < 360; angle += 10) {
    const rad = (angle * Math.PI) / 180;
    const isMajor = angle % 30 === 0;
    const tickLen = isMajor ? 8 : 4;

    const startX = cx + Math.sin(rad) * maxRadius;
    const startY = cy - Math.cos(rad) * maxRadius;
    const endX = cx + Math.sin(rad) * (maxRadius - tickLen);
    const endY = cy - Math.cos(rad) * (maxRadius - tickLen);

    ctx.strokeStyle = themeBorder;
    ctx.lineWidth = isMajor ? 1.5 : 0.8;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    if (isMajor) {
      let label = String(angle).padStart(3, '0');
      if (angle === 0) label = 'N';
      else if (angle === 90) label = 'E';
      else if (angle === 180) label = 'S';
      else if (angle === 270) label = 'W';

      const labelX = cx + Math.sin(rad) * (maxRadius - 16);
      const labelY = cy - Math.cos(rad) * (maxRadius - 16);
      ctx.fillText(label, labelX, labelY);
    }
  }

  // 2. Draw Concentric Range Rings (25%, 50%, 75%)
  const percentages = [0.25, 0.5, 0.75];
  percentages.forEach(p => {
    const r = maxRadius * p;
    ctx.strokeStyle = themeBorder;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    // Range ring label
    ctx.fillStyle = themeDim;
    ctx.font = '7px Share Tech Mono';
    ctx.fillText(`${Math.round(p * 80)} KM`, cx + 4, cy - r - 6);
  });

  // 3. Draw horizontal/vertical crosshairs
  ctx.strokeStyle = themeBorder;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - maxRadius, cy);
  ctx.lineTo(cx + maxRadius, cy);
  ctx.moveTo(cx, cy - maxRadius);
  ctx.lineTo(cx, cy + maxRadius);
  ctx.stroke();

  // 4. Draw rotating radar sweep line / target acquisition brackets based on structural theme
  if (structTheme === 'tactical') {
    if (window.radarSweepAngle === undefined) {
      window.radarSweepAngle = 0;
    }
    window.radarSweepAngle = (window.radarSweepAngle + 0.006) % (2 * Math.PI);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(window.radarSweepAngle);

    // Draw 4 solid tactical acquisition brackets framing the boundary
    ctx.strokeStyle = themeMain;
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(maxRadius - 15, -12);
      ctx.lineTo(maxRadius - 4, -12);
      ctx.lineTo(maxRadius - 4, 12);
      ctx.lineTo(maxRadius - 15, 12);
      ctx.stroke();
    }
    ctx.restore();
  } else if (structTheme === 'retro') {
    if (window.radarSweepAngle === undefined) {
      window.radarSweepAngle = 0;
    }
    // Blocky movement intervals (80s cathode sweep)
    const tick = Math.floor(Date.now() / 120);
    if (tick !== window.lastRadarTick) {
      window.radarSweepAngle = (window.radarSweepAngle + 0.12) % (2 * Math.PI);
      window.lastRadarTick = tick;
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(window.radarSweepAngle);

    // Thick blocky sweep line
    ctx.strokeStyle = themeMain;
    ctx.lineWidth = 5.0;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -maxRadius);
    ctx.stroke();

    // Sparse blocky tail
    ctx.fillStyle = themeMain;
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < 12; i++) {
      const tailAngle = -0.02 * i;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, maxRadius, -Math.PI / 2 + tailAngle, -Math.PI / 2 + tailAngle + 0.025);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else if (structTheme === 'steampunk') {
    if (window.radarSweepAngle === undefined) {
      window.radarSweepAngle = 0;
    }
    window.radarSweepAngle = (window.radarSweepAngle + 0.004) % (2 * Math.PI);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(window.radarSweepAngle);

    // Draw compass gears and rivets
    ctx.strokeStyle = themeMain;
    ctx.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      ctx.rotate(Math.PI / 12);
      ctx.beginPath();
      ctx.moveTo(maxRadius - 8, 0);
      ctx.lineTo(maxRadius - 3, -3);
      ctx.lineTo(maxRadius - 3, 3);
      ctx.closePath();
      ctx.stroke();
    }

    // Draw Victorian star
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-5, -maxRadius * 0.45);
      ctx.lineTo(0, -maxRadius * 0.82);
      ctx.lineTo(5, -maxRadius * 0.45);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  } else if (structTheme === 'xeno') {
    if (window.radarSweepAngle === undefined) {
      window.radarSweepAngle = 0;
    }
    window.radarSweepAngle = (window.radarSweepAngle + 0.015) % 1.0;

    // Organic waves radiating outwards
    ctx.save();
    ctx.strokeStyle = themeMain;
    for (let i = 0; i < 3; i++) {
      const progress = (window.radarSweepAngle + i * 0.33) % 1.0;
      const radius = maxRadius * progress;
      const opacity = 1.0 - progress;
      ctx.lineWidth = 3.5 * opacity;
      ctx.globalAlpha = opacity * 0.4;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  } else if (structTheme === 'warthunder') {
    if (window.radarSweepAngle === undefined) {
      window.radarSweepAngle = 0;
    }
    // Very slow, smooth rotation of tracking brackets
    window.radarSweepAngle = (window.radarSweepAngle + 0.003) % (2 * Math.PI);

    ctx.save();
    ctx.translate(cx, cy);

    // Draw static tactical target crosshairs
    ctx.strokeStyle = themeBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-20, 0); ctx.lineTo(20, 0);
    ctx.moveTo(0, -20); ctx.lineTo(0, 20);
    ctx.stroke();

    // Rotating tracking brackets
    ctx.rotate(window.radarSweepAngle);
    ctx.strokeStyle = themeMain;
    ctx.lineWidth = 2.0;
    
    const size = maxRadius * 0.48;
    ctx.beginPath();
    // Top-left bracket
    ctx.moveTo(-size, -size + 12);
    ctx.lineTo(-size, -size);
    ctx.lineTo(-size + 12, -size);
    // Top-right bracket
    ctx.moveTo(size, -size + 12);
    ctx.lineTo(size, -size);
    ctx.lineTo(size - 12, -size);
    // Bottom-left bracket
    ctx.moveTo(-size, size - 12);
    ctx.lineTo(-size, size);
    ctx.lineTo(-size + 12, size);
    // Bottom-right bracket
    ctx.moveTo(size, size - 12);
    ctx.lineTo(size, size);
    ctx.lineTo(size - 12, size);
    ctx.stroke();

    ctx.restore();
  } else {
    // Default cyber sci-fi sweep
    if (window.radarSweepAngle === undefined) {
      window.radarSweepAngle = 0;
    }
    window.radarSweepAngle = (window.radarSweepAngle + 0.008) % (2 * Math.PI);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(window.radarSweepAngle);

    // Sweep leading line
    ctx.strokeStyle = themeMain;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -maxRadius);
    ctx.stroke();

    // Fading sonar tail
    ctx.fillStyle = themeMain;
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 40; i++) {
      const tailAngle = -0.005 * i;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, maxRadius, -Math.PI / 2 + tailAngle, -Math.PI / 2 + tailAngle + 0.006);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 5. Draw Standby warnings in the center
  ctx.fillStyle = themeMain;
  if (structTheme === 'retro') {
    ctx.font = 'bold 13px Courier New';
  } else if (structTheme === 'tactical') {
    ctx.font = 'bold 12px "Segoe UI", sans-serif';
  } else if (structTheme === 'steampunk') {
    ctx.font = 'bold 13px Georgia';
  } else if (structTheme === 'xeno') {
    ctx.font = '12px "Century Gothic", sans-serif';
  } else if (structTheme === 'warthunder') {
    ctx.font = 'bold 12px "Roboto", "Helvetica Neue", sans-serif';
  } else {
    ctx.font = '12px Orbitron';
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const isJoiningMatch = !wtConnected && (Date.now() - lastConnectedTime < 45000) && lastConnectedTime > 0;
  const flash = Math.floor(Date.now() / 600) % 2 === 0;
  if (flash) {
    ctx.fillText(isJoiningMatch ? 'JOINING MATCH' : 'STANDBY', cx, cy - 15);
  }

  ctx.fillStyle = themeDim;
  ctx.font = '8px Share Tech Mono';
  if (isJoiningMatch) {
    ctx.fillText('ESTABLISHING SATELLITE CONNECTION...', cx, cy + 10);
    ctx.fillText('LOADING COMBAT THEATRE DATA...', cx, cy + 25);
  } else {
    ctx.fillText('SEARCHING FOR SATELLITE LINK...', cx, cy + 10);
    ctx.fillText('CONNECTING TO WAR THUNDER CLIENT...', cx, cy + 25);
  }
}

// Initial image fetch
mapImg.src = '/map.img?colors=1';

// Periodically reload map image (e.g. every 15s) in case map changes
setInterval(() => {
  if (wtConnected) {
    mapImg.src = '/map.img?colors=1&t=' + Date.now();
  }
}, 15000);

// Set up UI listeners
document.getElementById('btn-zoom-in').addEventListener('click', () => {
  zoom = Math.min(zoom * 1.15, 50.0);
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
  zoom = Math.max(zoom / 1.15, 1.0);
});

document.getElementById('btn-zoom-reset').addEventListener('click', () => {
  zoom = 1.0;
});

// Smooth Ctrl + Mouse scroll zooming on the map canvas
canvas.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault(); // prevent default browser zoom/scroll
    const zoomFactor = 1.05; // 5% zoom steps
    if (e.deltaY < 0) {
      zoom = Math.min(zoom * zoomFactor, 50.0);
    } else {
      zoom = Math.max(zoom / zoomFactor, 1.0);
    }
  }
}, { passive: false });

// Map Coordinate conversion helper functions
function worldToScreen(wx, wy) {
  const squareSize = Math.min(canvas.width, canvas.height);
  if (zoom === 1.0) {
    const offsetX = (canvas.width - squareSize) / 2;
    const offsetY = (canvas.height - squareSize) / 2;
    return {
      x: offsetX + wx * squareSize,
      y: offsetY + wy * squareSize
    };
  } else {
    // Zoomed in: center viewport on player if autoCenter is active, else center on map middle
    const centerX = autoCenter ? playerX : 0.5;
    const centerY = autoCenter ? playerY : 0.5;
    const screenX = (wx - centerX) * zoom * squareSize + canvas.width / 2;
    const screenY = (wy - centerY) * zoom * squareSize + canvas.height / 2;
    return { x: screenX, y: screenY };
  }
}

function screenToWorld(sx, sy) {
  const squareSize = Math.min(canvas.width, canvas.height);
  if (zoom === 1.0) {
    const offsetX = (canvas.width - squareSize) / 2;
    const offsetY = (canvas.height - squareSize) / 2;
    return {
      x: (sx - offsetX) / squareSize,
      y: (sy - offsetY) / squareSize
    };
  } else {
    // Zoomed: inverted equation centered on player or map middle
    const centerX = autoCenter ? playerX : 0.5;
    const centerY = autoCenter ? playerY : 0.5;
    const wx = (sx - canvas.width / 2) / (zoom * squareSize) + centerX;
    const wy = (sy - canvas.height / 2) / (zoom * squareSize) + centerY;
    return { x: wx, y: wy };
  }
}

// Check if an object is the player plane
function isPlayerObject(obj) {
  if (!obj) return false;
  const icon = (obj.icon || '').toLowerCase();
  const type = (obj.type || '').toLowerCase();
  const name = (obj.name || '').toUpperCase();
  const nick = (playerNickname || '').toUpperCase();
  return icon === 'player' || type === 'player' || icon === 'player_plane' || type === 'player_plane' || name === 'YOU' || (nick && name === nick);
}

// Resize canvas to fill wrapper completely (widescreen support on zoom)
function resizeCanvas() {
  const wrapper = canvas.closest('.map-wrapper');
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    // Clear inline styles to let CSS 100% rules handle sizing properly
    canvas.style.width = '';
    canvas.style.height = '';
  }
}

// Draw Loop
function drawMap() {
  resizeCanvas();

  function drawTextWithOutline(text, x, y, font, fillColor = '#fff', strokeColor = '#000', strokeWidth = 2.5, align = 'left', baseline = 'middle') {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  const themeBgColor = getComputedStyle(document.body).getPropertyValue('--color-bg').trim() || '#02060c';

  // Clear canvas
  ctx.fillStyle = themeBgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw standby radar if map is not loaded or is the placeholder image
  if (!mapImgLoaded || mapImgIsPlaceholder) {
    drawRadarStandbyScreen();
    return;
  }

  // 1. Draw Map Image
  const tl = worldToScreen(0, 0);
  const br = worldToScreen(1, 1);
  ctx.drawImage(mapImg, tl.x, tl.y, br.x - tl.x, br.y - tl.y);

  // 2. Draw Tactical Grid (if active)
  if (document.getElementById('chk-grid').checked) {
    drawGrid();
  }

  // 3. Draw Trails (if active)
  if (document.getElementById('chk-trails').checked && playerTrail.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 255, 196, 0.4)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 5]);

    const startPt = worldToScreen(playerTrail[0].x, playerTrail[0].y);
    ctx.moveTo(startPt.x, startPt.y);

    for (let i = 1; i < playerTrail.length; i++) {
      const pt = worldToScreen(playerTrail[i].x, playerTrail[i].y);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash
  }

  // 4. Draw Objects & Player (if UNIT MARKERS is enabled)
  if (document.getElementById('chk-markers').checked) {
    mapObjects.forEach(obj => {
      // Skip player - will draw last
      if (isPlayerObject(obj)) return;

      const icon = (obj.icon || '').toLowerCase();
      const type = (obj.type || '').toLowerCase();

      const isCaptureZone = icon === 'capture_zone' || type === 'capture_zone';
      const isBombingBase = icon === 'bombing_base' || type === 'bombing_base' || icon === 'bombing_point' || type === 'bombing_point' || icon === 'defending_point' || type === 'defending_point';
      const isAirfield = icon === 'airfield' || type === 'airfield' || icon === 'runway';
      const isBaseOrZone = isCaptureZone || isBombingBase || isAirfield;

      const isAA = icon === 'airdefence' || icon === 'spaa' || icon === 'sam' || type === 'airdefence' || type === 'aaa' || type === 'flak';
      const isWaypoint = icon === 'waypoint';
      const isTank = icon.includes('tank') || type.includes('tank');
      const isShip = icon === 'destroyer' || icon === 'frigate' || icon === 'cruiser' || icon === 'battleship' || icon === 'carrier' || icon === 'boat' || icon.includes('ship') || type.includes('ship') || icon.includes('boat') || type.includes('boat');
      const isStructure = icon === 'structure' || icon === 'pillbox' || icon === 'bunker' || type === 'structure';
      const isGroundModel = type === 'ground_model';
      const isSpawn = icon.includes('spawn') || type.includes('spawn') || icon.includes('respawn') || type.includes('respawn');

      const isAircraft = !isAA && !isWaypoint && !isTank && !isShip && !isStructure && !isGroundModel && !isSpawn && !isBaseOrZone;

      const showAir = document.getElementById('btn-toggle-type-air')?.classList.contains('active') !== false;
      const showGround = document.getElementById('btn-toggle-type-ground')?.classList.contains('active') !== false;
      const showNaval = document.getElementById('btn-toggle-type-naval')?.classList.contains('active') !== false;
      const showBases = document.getElementById('btn-toggle-type-bases')?.classList.contains('active') !== false;

      if (isAircraft && !showAir) return;
      if ((isAA || isTank || isStructure || (isGroundModel && !isShip) || isSpawn) && !showGround) return;
      if (isShip && !showNaval) return;
      if (isBaseOrZone && !showBases) return;

      // Determine type/color
      let color = '#7f9bb3'; // default gray
      let isEnemy = false;
      let isFriendly = false;
      let isSquadron = false;

      if (obj['color[]']) {
        const rgb = obj['color[]'];
        // KORREKTUR: rgb[0] auf 57 geändert, passend zum Log/Hex-Wert
        isSquadron = rgb[0] === 57 && rgb[1] === 217 && rgb[2] === 33;

        if (!isSquadron) {
          isEnemy = rgb[0] > rgb[2];
          isFriendly = rgb[2] > rgb[0];
        }

      } else if (typeof obj.color === 'string') {
        if (obj.color.startsWith('#')) {
          const r = parseInt(obj.color.slice(1, 3), 16) || 0;
          const b = parseInt(obj.color.slice(5, 7), 16) || 0;
          isEnemy = r > b;
          isFriendly = b > r;
        } else {
          const lowerColor = obj.color.toLowerCase();
          isEnemy = lowerColor === 'red' || lowerColor === 'enemy';
          isFriendly = lowerColor === 'blue' || lowerColor === 'friendly';
        }
      } else if (obj.faction) {
        isEnemy = obj.faction === 'enemy';
        isFriendly = obj.faction === 'friendly';
      }

      // Zuweisung der finalen Farbe basierend auf der Priorität
      if (isSquadron) {
        color = '#39d921'; // Das helle Grün ([57, 217, 33] als Hex)
      } else if (isEnemy) {
        color = '#df2525ff'; // Rot für Gegner
      } else if (isFriendly) {
        color = '#0044ffff'; // Blau für Verbündete
      }

      // Special Drawing for Airfields using sx, sy, ex, ey
      if (obj.icon === 'airfield' || obj.type === 'airfield') {
        const start = worldToScreen(obj.sx, obj.sy);
        const end = worldToScreen(obj.ex, obj.ey);

        // Check if visible
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);
        if (maxX < -50 || minX > canvas.width + 50 || maxY < -50 || minY > canvas.height + 50) {
          return;
        }

        // Calculate length and heading for label rotation
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const heading = Math.atan2(dy, dx);

        ctx.save();

        // Dark asphalt runway background
        ctx.strokeStyle = color;
        ctx.lineWidth = 10;
        ctx.lineCap = 'square';
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        // Boundary colored line (inner glow border)
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.shadowBlur = 0; // reset

        // Runway centerline ticks
        ctx.beginPath();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Name tag
        if (document.getElementById('chk-names').checked) {
          // Find midpoint
          const midX = (start.x + end.x) / 2;
          const midY = (start.y + end.y) / 2;

          ctx.save();
          ctx.translate(midX, midY);
          ctx.rotate(heading);
          drawTextWithOutline('RUNWAY', 0, -8, 'bold 9px Share Tech Mono', '#fff', '#000', 2.5, 'center', 'bottom');
          ctx.restore();
        }

        ctx.restore();
        return;
      }

      // Fallback for regular coordinates
      const norm = normalizeCoords(obj.x, obj.y);
      const screen = worldToScreen(norm.x, norm.y);

      // Draw only if it's roughly on screen
      if (screen.x < -50 || screen.x > canvas.width + 50 || screen.y < -50 || screen.y > canvas.height + 50) {
        return;
      }

      ctx.save();
      ctx.translate(screen.x, screen.y);

      // Check if this object is the active threat target, and highlight it on the map
      const objKey = obj.name || `${obj.icon}_${obj.x}_${obj.y}`;
      const isThreatTarget = (activeThreatKey && objKey === activeThreatKey);

      if (isThreatTarget) {
        ctx.save();
        const threatColor = activeThreatLevel === 'critical' ? '#ff0055' : '#ffaa00';

        // 1. Pulsing dashed background target ring
        ctx.beginPath();
        ctx.arc(0, 0, 16 + 4 * Math.sin(Date.now() / 120), 0, 2 * Math.PI);
        ctx.strokeStyle = threatColor;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // 2. Lock-on bracket corners [ ]
        ctx.strokeStyle = threatColor;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        // Top-left
        ctx.moveTo(-13, -8); ctx.lineTo(-13, -13); ctx.lineTo(-8, -13);
        // Top-right
        ctx.moveTo(8, -13); ctx.lineTo(13, -13); ctx.lineTo(13, -8);
        // Bottom-left
        ctx.moveTo(-13, 8); ctx.lineTo(-13, 13); ctx.lineTo(-8, 13);
        // Bottom-right
        ctx.moveTo(8, 13); ctx.lineTo(13, 13); ctx.lineTo(13, 8);
        ctx.stroke();

        // 3. Text label indicator above the brackets
        const tagText = activeThreatLevel === 'critical' ? '▲ COLLISION THREAT' : '▲ INTERCEPT THREAT';
        drawTextWithOutline(tagText, 0, -18, 'bold 8px Orbitron', threatColor, '#000', 2.5, 'center', 'bottom');

        ctx.restore();
      }

      // Get direction/heading
      let heading = 0;
      if (obj.dx !== undefined && obj.dy !== undefined) {
        heading = Math.atan2(obj.dx, -obj.dy);
      } else if (Array.isArray(obj.dir)) {
        heading = Math.atan2(obj.dir[0], -obj.dir[1]);
      } else if (typeof obj.dir === 'number') {
        heading = (obj.dir * Math.PI) / 180;
      }

      ctx.rotate(heading);

      if (obj.icon === 'bombing_point' || obj.type === 'bombing_point') {
        const pulse = 1.0 + 0.12 * Math.sin(Date.now() / 250);

        if (symbolTheme === 'modern') {
          ctx.beginPath();
          ctx.moveTo(0, -9 * pulse);
          ctx.lineTo(9 * pulse, 0);
          ctx.lineTo(0, 9 * pulse);
          ctx.lineTo(-9 * pulse, 0);
          ctx.closePath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, 2, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        } else if (symbolTheme === 'arcade') {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-9 * pulse, -9 * pulse, 18 * pulse, 18 * pulse);
          ctx.strokeRect(-4, -4, 8, 8);
          ctx.fillRect(-1.5, -1.5, 3, 3);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, 11 * pulse, 0, 2 * Math.PI);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(0, 0, 6, 0, 2 * Math.PI);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(0, 0, 2, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();

          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.moveTo(0, -15 * pulse); ctx.lineTo(0, -9 * pulse);
          ctx.moveTo(0, 9 * pulse); ctx.lineTo(0, 15 * pulse);
          ctx.moveTo(-15 * pulse, 0); ctx.lineTo(-9 * pulse, 0);
          ctx.moveTo(9 * pulse, 0); ctx.lineTo(15 * pulse, 0);
          ctx.stroke();
        }

        if (document.getElementById('chk-names').checked) {
          ctx.rotate(-heading);
          drawTextWithOutline(obj.name || 'TARGET BASE', 16, 3, 'bold 9px Share Tech Mono', '#fff', '#000', 2.5, 'left', 'middle');
        }
      }
      else if (obj.icon === 'defending_point' || obj.type === 'defending_point') {
        const pulse = 1.0;

        if (symbolTheme === 'modern') {
          ctx.beginPath();
          ctx.moveTo(0, -9);
          ctx.lineTo(9, 0);
          ctx.lineTo(0, 9);
          ctx.lineTo(-9, 0);
          ctx.closePath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, 2, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        } else if (symbolTheme === 'arcade') {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-9, -9, 18, 18);
          ctx.strokeRect(-4, -4, 8, 8);
          ctx.fillRect(-1.5, -1.5, 3, 3);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, 11 * pulse, 0, 2 * Math.PI);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(0, 0, 6, 0, 2 * Math.PI);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(0, 0, 2, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();

          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.moveTo(0, -15 * pulse); ctx.lineTo(0, -9 * pulse);
          ctx.moveTo(0, 9 * pulse); ctx.lineTo(0, 15 * pulse);
          ctx.moveTo(-15 * pulse, 0); ctx.lineTo(-9 * pulse, 0);
          ctx.moveTo(9 * pulse, 0); ctx.lineTo(15 * pulse, 0);
          ctx.stroke();
        }

        if (document.getElementById('chk-names').checked) {
          ctx.rotate(-heading);
          drawTextWithOutline(obj.name || 'BASE', 16, 3, 'bold 9px Share Tech Mono', '#fff', '#000', 2.5, 'left', 'middle');
        }
      }
      else if (obj.icon === 'capture_zone' || obj.type === 'capture_zone' || obj.icon === 'point') {
        const pulse = 1.0 + 0.1 * Math.sin(Date.now() / 200 + 1);

        if (symbolTheme === 'modern') {
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const angle = i * Math.PI / 4;
            const x = 12 * Math.cos(angle);
            const y = 12 * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.globalAlpha = 0.15;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 1.0;
        } else if (symbolTheme === 'arcade') {
          ctx.save();
          ctx.rotate(Date.now() / 800);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(-11, -11, 22, 22);
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = color;
          ctx.fillRect(-11, -11, 22, 22);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, 13, 0, 2 * Math.PI);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.globalAlpha = 0.15;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 1.0;

          ctx.beginPath();
          ctx.arc(0, 0, 19 * pulse, 0, 2 * Math.PI);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.3 * (2.0 - pulse);
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        }

        ctx.rotate(-heading);
        drawTextWithOutline(obj.name || '?', 0, 1, 'bold 11px Orbitron', '#fff', '#000', 2.5, 'center', 'middle');

        if (document.getElementById('chk-names').checked) {
          drawTextWithOutline('ZONE', 18, 3, 'bold 9px Share Tech Mono', color, '#000', 2.5, 'left', 'middle');
        }
      }
      else {
        const icon = (obj.icon || '').toLowerCase();
        const type = (obj.type || '').toLowerCase();

        const isWaypoint = icon == 'waypoint';
        const isAA = icon === 'airdefence' || icon === 'spaa' || icon === 'sam' || type === 'airdefence' || type === 'aaa' || type === 'flak';
        const isTank = icon.includes('tank') || type.includes('tank');
        const isShip = icon === 'destroyer' || icon === 'frigate' || icon === 'cruiser' || icon === 'battleship' || icon === 'carrier' || icon === 'boat' || icon.includes('ship') || type.includes('ship');
        const isStructure = icon === 'structure' || icon === 'pillbox' || icon === 'bunker' || type === 'structure';
        const isAircraft = icon === 'aircraft' || type === 'aircraft' || icon === 'helicopter' || type === 'helicopter';

        if (!isWaypoint && !isTank && !isAA && !isShip && !isStructure && !isAircraft) {
          console.log(icon);
        }

        if (isAA) {
          if (symbolTheme === 'modern') {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-5, -5, 10, 10);
            ctx.beginPath();
            ctx.moveTo(-5, -5); ctx.lineTo(5, 5);
            ctx.moveTo(5, -5); ctx.lineTo(-5, 5);
            ctx.stroke();
          } else if (symbolTheme === 'arcade') {
            ctx.fillStyle = color;
            ctx.fillRect(-5, -2, 10, 6);
            ctx.fillRect(-2, -5, 4, 3);
          } else if (symbolTheme === 'default_wt') {
            ctx.fillStyle = color;
            ctx.fillRect(-5, -2, 10, 4);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.strokeRect(-5, -2, 10, 4);
            ctx.beginPath();
            ctx.moveTo(0, -2);
            ctx.lineTo(3, -6);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.moveTo(-5, 4); ctx.lineTo(5, 4);
            ctx.moveTo(0, 4); ctx.lineTo(0, 0);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, 3, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(4, -7);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.8;
            ctx.stroke();
          }

          if (document.getElementById('chk-names').checked && obj.name) {
            ctx.rotate(-heading);
            drawTextWithOutline(obj.name, 8, 3, 'bold 9px Share Tech Mono', '#fff', '#000', 2.5, 'left', 'middle');
          }
        }
        else if (isWaypoint) {
          ctx.fillStyle = color;
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.beginPath();
          ctx.arc(0, 0, 4, 0, 2 * Math.PI);
          ctx.fill();

          drawTextWithOutline("WAYPOINT", 8, 3, 'bold 9px Share Tech Mono', '#fff', '#000', 2.5, 'left', 'middle');
        }
        else if (isTank) {
          if (symbolTheme === 'modern') {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-5, -5, 10, 10);
            ctx.beginPath();
            ctx.arc(0, 0, 1.5, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          } else if (symbolTheme === 'arcade') {
            ctx.fillStyle = color;
            ctx.fillRect(-5, -5, 10, 6);
            ctx.fillRect(-3, 1, 6, 3);
          } else if (symbolTheme === 'default_wt') {
            ctx.fillStyle = color;
            ctx.fillRect(-5, -2, 10, 4);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.strokeRect(-5, -2, 10, 4);
          } else {
            ctx.fillStyle = color;
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 0.8;
            ctx.fillRect(-4, -4, 8, 8);
            ctx.strokeRect(-4, -4, 8, 8);
            ctx.fillRect(-6, -5, 2, 10);
            ctx.fillRect(4, -5, 2, 10);
            ctx.beginPath();
            ctx.arc(0, 0, 2.5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(0, -7);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }

          if (document.getElementById('chk-names').checked && obj.name) {
            ctx.rotate(-heading);
            drawTextWithOutline(obj.name, 8, 3, 'bold 9px Share Tech Mono', '#fff', '#000', 2.5, 'left', 'middle');
          }
        }
        else if (isShip) {
          if (symbolTheme === 'modern') {
            ctx.beginPath();
            ctx.moveTo(0, -7);
            ctx.lineTo(4, 5);
            ctx.lineTo(-4, 5);
            ctx.closePath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          } else if (symbolTheme === 'arcade') {
            ctx.fillStyle = color;
            ctx.fillRect(-4, -5, 8, 3);
            ctx.fillRect(-2, -2, 4, 6);
          } else if (symbolTheme === 'default_wt') {
            ctx.fillStyle = color;
            ctx.fillRect(-7, -1.5, 14, 3);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.strokeRect(-7, -1.5, 14, 3);
          } else {
            ctx.beginPath();
            ctx.moveTo(0, -9);
            ctx.lineTo(3.5, -3);
            ctx.lineTo(2, 6);
            ctx.lineTo(-2, 6);
            ctx.lineTo(-3.5, -3);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }

          if (document.getElementById('chk-names').checked && obj.name) {
            ctx.rotate(-heading);
            drawTextWithOutline(obj.name, 8, 3, 'bold 9px Share Tech Mono', '#fff', '#000', 2.5, 'left', 'middle');
          }
        }
        else if (isStructure) {
          if (symbolTheme === 'modern') {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-6, -6, 12, 12);
            ctx.strokeRect(-2, -2, 4, 4);
          } else if (symbolTheme === 'arcade') {
            ctx.fillStyle = color;
            ctx.fillRect(-6, -2, 12, 6);
            ctx.fillRect(-4, -5, 8, 3);
          } else if (symbolTheme === 'default_wt') {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(-6, 3);
            ctx.lineTo(6, 3);
            ctx.lineTo(6, -1);
            ctx.lineTo(4, -1); ctx.lineTo(4, -4); ctx.lineTo(2, -4); ctx.lineTo(2, -1);
            ctx.lineTo(1, -1); ctx.lineTo(1, -4); ctx.lineTo(-1, -4); ctx.lineTo(-1, -1);
            ctx.lineTo(-2, -1); ctx.lineTo(-2, -4); ctx.lineTo(-4, -4); ctx.lineTo(-4, -1);
            ctx.lineTo(-6, -1);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(0, 2, 6, Math.PI, 0);
            ctx.lineTo(6, 4);
            ctx.lineTo(-6, 4);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#000';
            ctx.fillRect(-3, 0, 6, 1.5);
          }

          if (document.getElementById('chk-names').checked && obj.name) {
            ctx.rotate(-heading);
            drawTextWithOutline(obj.name, 8, 3, 'bold 9px Share Tech Mono', '#fff', '#000', 2.5, 'left', 'middle');
          }
        }
        else if (type === 'ground_model') {
          if (symbolTheme === 'modern') {
            ctx.beginPath();
            ctx.rect(-4.5, -4.5, 9, 9);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
          } else if (symbolTheme === 'arcade') {
            ctx.fillStyle = color;
            ctx.fillRect(-4, -4, 8, 2);
            ctx.fillRect(-4, 2, 8, 2);
            ctx.fillRect(-1.5, -2, 3, 4);
          } else {
            ctx.beginPath();
            ctx.moveTo(0, -5);
            ctx.lineTo(5, 0);
            ctx.lineTo(0, 5);
            ctx.lineTo(-5, 0);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 4;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }

          if (document.getElementById('chk-names').checked && obj.name) {
            ctx.rotate(-heading);
            drawTextWithOutline(obj.name, 8, 3, 'bold 9px Share Tech Mono', '#fff', '#000', 2.5, 'left', 'middle');
          }
        }
        else if (icon === 'missile' || type === 'missile' || icon === 'rocket' || type === 'rocket' || icon === 'torpedo' || type === 'torpedo') {
          const isTorpedo = icon === 'torpedo' || type === 'torpedo';
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 4;

          if (isTorpedo) {
            // Draw a torpedo: cylindrical body with dual rear propellers
            ctx.beginPath();
            ctx.ellipse(0, 0, 2, 6, 0, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
            // Propellers
            ctx.beginPath();
            ctx.moveTo(-3, 5); ctx.lineTo(3, 5);
            ctx.moveTo(-3, 6); ctx.lineTo(3, 6);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();
          } else {
            // Draw a missile/rocket
            if (symbolTheme === 'modern') {
              // Sleek tactical chevron/arrow pointing forward
              ctx.beginPath();
              ctx.moveTo(0, -6);
              ctx.lineTo(2, -2);
              ctx.lineTo(1.5, 4);
              ctx.lineTo(-1.5, 4);
              ctx.lineTo(-2, -2);
              ctx.closePath();
              ctx.fillStyle = color;
              ctx.fill();
            } else if (symbolTheme === 'arcade') {
              // 8-bit rocket with a flashing tail flame!
              ctx.fillStyle = color;
              ctx.fillRect(-1, -5, 2, 7);
              ctx.fillRect(-2, 2, 4, 1);
              // tail flame
              const flash = Math.floor(Date.now() / 100) % 2 === 0;
              if (flash) {
                ctx.fillStyle = '#ffaa00';
                ctx.fillRect(-0.5, 3, 1, 2);
              }
            } else if (symbolTheme === 'default_wt') {
              // Simple thin arrow/chevron representing WT projectile
              ctx.beginPath();
              ctx.moveTo(0, -5);
              ctx.lineTo(2.5, 3);
              ctx.lineTo(0, 1.5);
              ctx.lineTo(-2.5, 3);
              ctx.closePath();
              ctx.fillStyle = color;
              ctx.fill();
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 0.8;
              ctx.stroke();
            } else {
              // Standard detailed vector missile
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.moveTo(0, -7); // pointed nose
              ctx.lineTo(1.5, -4);
              ctx.lineTo(1.5, 3); // body
              ctx.lineTo(3.5, 5); // right tail fin
              ctx.lineTo(1.5, 5);
              ctx.lineTo(0, 4.2); // base
              ctx.lineTo(-1.5, 5);
              ctx.lineTo(-3.5, 5); // left tail fin
              ctx.lineTo(-1.5, 3);
              ctx.lineTo(-1.5, -4);
              ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1;
              ctx.stroke();

              // Draw a short orange rocket flame at the exhaust
              ctx.fillStyle = '#ff3c00';
              ctx.beginPath();
              ctx.moveTo(-1, 5);
              ctx.lineTo(0, 8);
              ctx.lineTo(1, 5);
              ctx.closePath();
              ctx.fill();
            }
          }

          ctx.shadowBlur = 0; // reset

          // Draw name tag if names are enabled
          if (document.getElementById('chk-names').checked) {
            ctx.rotate(-heading);
            const labelText = isTorpedo ? 'TORPEDO' : (icon === 'rocket' || type === 'rocket' ? 'ROCKET' : 'MISSILE');
            drawTextWithOutline(labelText, 8, 3, 'bold 8px Share Tech Mono', color, '#000', 2, 'left', 'middle');
          }
        }
        else {
          const isBomber = icon.includes('bomber') || type.includes('bomber');
          const isHelicopter = icon.includes('heli') || type.includes('heli');
          const isPlayer = isPlayerObject(obj);

          const showFighters = document.getElementById('chk-show-fighters') ? document.getElementById('chk-show-fighters').checked : true;
          if (!isPlayer && !isBomber && !isHelicopter && !showFighters) {
            return;
          }

          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 4;

          if (isPlayer) {
            if (symbolTheme === 'modern') {
              ctx.beginPath();
              ctx.arc(0, 0, 5.5, 0, 2 * Math.PI);
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(0, 0, 1.5, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();

              const startY = -5.5;
              const vectorLen = Math.max(2, 8 + (playerPitch * 0.5));
              ctx.beginPath();
              ctx.moveTo(0, startY);
              ctx.lineTo(0, startY - vectorLen);
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.8;
              ctx.stroke();
            } else if (symbolTheme === 'arcade') {
              ctx.fillStyle = color;
              ctx.fillRect(-1.5, -7, 3, 4);
              ctx.fillRect(-6.5, -3, 13, 3);
              ctx.fillRect(-8.5, 0, 2, 4);
              ctx.fillRect(6.5, 0, 2, 4);
              ctx.fillStyle = '#ffb703';
              ctx.fillRect(-2.5, 3, 1.5, 3);
              ctx.fillRect(1, 3, 1.5, 3);
            } else if (symbolTheme === 'default_wt') {
              ctx.beginPath();
              ctx.moveTo(0, -7);
              ctx.lineTo(5, 5);
              ctx.lineTo(0, 2);
              ctx.lineTo(-5, 5);
              ctx.closePath();
              ctx.fillStyle = color;
              ctx.fill();
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1.2;
              ctx.stroke();

              const startY = -7;
              const vectorLen = Math.max(2, 8 + (playerPitch * 0.5));
              ctx.beginPath();
              ctx.moveTo(0, startY);
              ctx.lineTo(0, startY - vectorLen);
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.8;
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.moveTo(0, -6);
              ctx.lineTo(5, 5);
              ctx.lineTo(0, 3);
              ctx.lineTo(-5, 5);
              ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1.8;
              ctx.stroke();

              const startY = -6;
              const vectorLen = Math.max(2, 8 + (playerPitch * 0.5));
              ctx.beginPath();
              ctx.moveTo(0, startY);
              ctx.lineTo(0, startY - vectorLen);
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.8;
              ctx.stroke();
            }
          }
          else if (isHelicopter) {
            if (symbolTheme === 'modern') {
              ctx.beginPath();
              ctx.arc(0, 0, 5, 0, 2 * Math.PI);
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.5;
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(-5, -5); ctx.lineTo(5, 5);
              ctx.moveTo(5, -5); ctx.lineTo(-5, 5);
              ctx.stroke();
            } else if (symbolTheme === 'arcade') {
              ctx.fillStyle = color;
              ctx.fillRect(-2, -5, 4, 10);
              const flash = Math.floor(Date.now() / 150) % 2 === 0;
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.beginPath();
              if (flash) {
                ctx.moveTo(-7, -7); ctx.lineTo(7, 7);
                ctx.moveTo(7, -7); ctx.lineTo(-7, 7);
              } else {
                ctx.moveTo(-9, 0); ctx.lineTo(9, 0);
                ctx.moveTo(0, -9); ctx.lineTo(0, 9);
              }
              ctx.stroke();
            } else if (symbolTheme === 'default_wt') {
              ctx.beginPath();
              ctx.arc(0, 0, 4.5, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1.2;
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(-6, 0); ctx.lineTo(6, 0);
              ctx.moveTo(0, -6); ctx.lineTo(0, 6);
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.ellipse(0, 0, 2.2, 5.5, 0, 0, 2 * Math.PI);
              ctx.fill();
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1.5;
              ctx.stroke();
              ctx.shadowBlur = 0;
              ctx.beginPath();
              ctx.moveTo(-8, 0); ctx.lineTo(8, 0);
              ctx.moveTo(0, -8); ctx.lineTo(0, 8);
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
          else {
            if (symbolTheme === 'modern') {
              ctx.beginPath();
              ctx.moveTo(0, -7);
              ctx.lineTo(5, 5);
              ctx.lineTo(0, 2);
              ctx.lineTo(-5, 5);
              ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1.2;
              ctx.stroke();
            } else if (symbolTheme === 'arcade') {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.moveTo(0, -6);
              ctx.lineTo(6, 4);
              ctx.lineTo(2, 2);
              ctx.lineTo(-2, 2);
              ctx.lineTo(-6, 4);
              ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1;
              ctx.stroke();
            } else if (symbolTheme === 'default_wt') {
              ctx.beginPath();
              ctx.moveTo(0, -6);
              ctx.lineTo(4.5, 4);
              ctx.lineTo(0, 1.5);
              ctx.lineTo(-4.5, 4);
              ctx.closePath();
              ctx.fillStyle = color;
              ctx.fill();
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1;
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.moveTo(0, -8);
              ctx.bezierCurveTo(1.5, -8, 2, -4, 2, -3);
              ctx.lineTo(9.5, -2);
              ctx.lineTo(9.5, 0);
              ctx.lineTo(2, 1);
              ctx.lineTo(1.2, 5);
              ctx.lineTo(3.8, 5.8);
              ctx.lineTo(3.8, 7);
              ctx.lineTo(0, 6.2);
              ctx.lineTo(-3.8, 7);
              ctx.lineTo(-3.8, 5.8);
              ctx.lineTo(-1.2, 5);
              ctx.lineTo(-2, 1);
              ctx.lineTo(-9.5, 0);
              ctx.lineTo(-9.5, -2);
              ctx.lineTo(-2, -3);
              ctx.bezierCurveTo(-2, -4, -1.5, -8, 0, -8);
              ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1.8;
              ctx.stroke();
            }
          }

          ctx.shadowBlur = 0; // reset

          // Draw name tag if active, appending aircraft class and calculated speed
          if (document.getElementById('chk-names').checked) {
            ctx.rotate(-heading); // keep text upright
            const showSpeeds = document.getElementById('chk-show-speeds')?.checked !== false;
            
            if (isPlayer) {
              const typeStr = playerAircraftType ? ` [${playerAircraftType}]` : '';
              const speedStr = currentSpeed > 0 ? `${currentSpeed} KM/H` : '';
              
              // Line 1: Identifier + Type
              drawTextWithOutline(`YOU${typeStr}`, 0, 13, 'bold 8px Orbitron', '#fff', '#000', 2.5, 'center', 'top');
              // Line 2: Speed (slightly larger)
              if (showSpeeds && speedStr) {
                drawTextWithOutline(speedStr, 0, 23, 'bold 10px Orbitron', '#00ffc4', '#000', 2.5, 'center', 'top');
              }
            } else {
              let typeStr = 'AIRCRAFT';
              if (isBomber) typeStr = 'BOMBER';
              else if (isHelicopter) typeStr = 'HELI';
              else if (icon === 'fighter' || type === 'fighter') typeStr = 'FIGHTER';
              else if (obj.icon) typeStr = obj.icon.toUpperCase();

              const nameLabel = obj.name ? `${obj.name} [${typeStr}]` : `[${typeStr}]`;
              const speedVal = obj.calculatedSpeed || 0;
              const speedStr = speedVal > 0 ? `${speedVal} KM/H` : '';

              // Line 1: Nickname + Type
              drawTextWithOutline(nameLabel, 0, 13, 'bold 8px Share Tech Mono', '#fff', '#000', 2.5, 'center', 'top');
              // Line 2: Speed (slightly larger)
              if (showSpeeds && speedStr) {
                drawTextWithOutline(speedStr, 0, 23, 'bold 10px Share Tech Mono', color, '#000', 2.5, 'center', 'top');
              }
            }
          }
        }
      }

      ctx.restore();
    });

    // 5. Draw Player Plane (Always at top, neon green)
    if (isPlayerAlive && playerX !== undefined && playerY !== undefined) {
      const playerScreen = worldToScreen(playerX, playerY);
      ctx.save();
      ctx.translate(playerScreen.x, playerScreen.y);
      ctx.rotate(playerHeading);

      // Draw glow shadow
      const themeMainColor = getComputedStyle(document.body).getPropertyValue('--color-text-main').trim() || '#00ffc4';
      ctx.shadowColor = themeMainColor;
      ctx.shadowBlur = 12;

      if (isPlayerTank) {
        if (symbolTheme === 'modern') {
          ctx.strokeStyle = themeMainColor;
          ctx.lineWidth = 2;
          ctx.strokeRect(-6, -6, 12, 12);
          ctx.beginPath();
          ctx.arc(0, 0, 1.5, 0, 2 * Math.PI);
          ctx.fillStyle = themeMainColor;
          ctx.fill();
        } else if (symbolTheme === 'arcade') {
          ctx.fillStyle = themeMainColor;
          ctx.fillRect(-6, -6, 12, 8);
          ctx.fillRect(-4, 2, 8, 4);
          ctx.fillRect(-1.5, -9, 3, 3);
        } else if (symbolTheme === 'default_wt') {
          ctx.fillStyle = themeMainColor;
          ctx.fillRect(-7, -3, 14, 6);
        } else {
          ctx.fillStyle = themeMainColor;
          ctx.fillRect(-8, -8, 3, 16);
          ctx.fillRect(5, -8, 3, 16);
          ctx.fillRect(-5, -6, 10, 12);
          ctx.beginPath();
          ctx.arc(0, 0, 4, 0, 2 * Math.PI);
          ctx.fill();
        }

        ctx.shadowBlur = 0; // reset glow shadow

        // Outlines and details
        if (symbolTheme === 'modern') {
          ctx.beginPath();
          ctx.moveTo(-3, 2);
          ctx.lineTo(0, -2);
          ctx.lineTo(3, 2);
          ctx.strokeStyle = themeMainColor;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (symbolTheme === 'default_wt') {
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.8;
          ctx.strokeRect(-7, -3, 14, 6);
          ctx.beginPath();
          ctx.moveTo(0, -3);
          ctx.lineTo(0, -9);
          ctx.stroke();
        } else if (symbolTheme === 'standard' || symbolTheme === 'default') {
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-8, -8, 3, 16);
          ctx.strokeRect(5, -8, 3, 16);
          ctx.strokeRect(-5, -6, 10, 12);
          ctx.beginPath();
          ctx.arc(0, 0, 4, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, -11);
          ctx.stroke();
        }
      } else {
        // Draw airplane chevron
        ctx.beginPath();
        ctx.moveTo(0, -11); // nose
        ctx.lineTo(8, 8);   // right wing
        ctx.lineTo(3, 5);   // right inner
        ctx.lineTo(0, 9);   // tail
        ctx.lineTo(-3, 5);  // left inner
        ctx.lineTo(-8, 8);  // left wing
        ctx.closePath();
        ctx.fillStyle = themeMainColor;
        ctx.fill();

        ctx.shadowBlur = 0; // reset glow shadow

        ctx.beginPath();
        ctx.lineWidth = 0.7;
        ctx.moveTo(0, -11); // nose
        ctx.lineTo(8, 8);   // right wing
        ctx.lineTo(3, 5);   // right inner
        ctx.lineTo(0, 9);   // tail
        ctx.lineTo(-3, 5);  // left inner
        ctx.lineTo(-8, 8);  // left wing
        ctx.closePath();
        ctx.strokeStyle = '#000';
        ctx.stroke();
      }

      // Name tag
      if (document.getElementById('chk-names').checked) {
        ctx.rotate(-playerHeading); // keep text straight
        const showSpeeds = document.getElementById('chk-show-speeds')?.checked !== false;
        const typeStr = playerAircraftType ? ` [${playerAircraftType}]` : '';
        const speedStr = currentSpeed > 0 ? `${currentSpeed} KM/H` : '';
        
        // Line 1: YOU [F8U-2]
        drawTextWithOutline(`YOU${typeStr}`, 0, 13, 'bold 8px Orbitron', '#fff', '#000', 2.5, 'center', 'top');
        // Line 2: Speed (slightly larger)
        if (showSpeeds && speedStr) {
          drawTextWithOutline(speedStr, 0, 23, 'bold 10px Orbitron', '#00ffc4', '#000', 2.5, 'center', 'top');
        }
      }

      ctx.restore();
    }
  }
}

function drawGrid() {
  const themeBorderColor = getComputedStyle(document.body).getPropertyValue('--color-border').trim() || 'rgba(0, 240, 255, 0.2)';
  ctx.strokeStyle = themeBorderColor;
  ctx.lineWidth = 1;

  // Draw 10 horizontal and vertical lines
  for (let i = 0; i <= 10; i++) {
    const ratio = i / 10;

    // Vertical line
    const vtTop = worldToScreen(ratio, 0);
    const vtBottom = worldToScreen(ratio, 1);
    ctx.beginPath();
    ctx.moveTo(vtTop.x, vtTop.y);
    ctx.lineTo(vtBottom.x, vtBottom.y);
    ctx.stroke();

    // Horizontal line
    const hzLeft = worldToScreen(0, ratio);
    const hzRight = worldToScreen(1, ratio);
    ctx.beginPath();
    ctx.moveTo(hzLeft.x, hzLeft.y);
    ctx.lineTo(hzRight.x, hzRight.y);
    ctx.stroke();

    // Draw Grid Coordinates Labels on boundaries (1-10 horizontally, A-J vertically)
    if (i < 10) {
      const colLabel = i + 1; // numbers 1-10
      const labelX = worldToScreen(ratio + 0.05, 0.02);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '14px Share Tech Mono';
      ctx.textAlign = 'center';
      ctx.fillText(colLabel, labelX.x, labelX.y);

      const rowLabel = String.fromCharCode(65 + i); // letters A-J
      const labelY = worldToScreen(0.01, ratio + 0.05);
      ctx.textAlign = 'left';
      ctx.fillText(rowLabel, labelY.x, labelY.y + 3);
    }
  }
}

// Convert absolute game coords to normalized map 0..1 coordinates
function normalizeCoords(x, y) {
  // If coordinates are already normalized between 0 and 1
  if (Math.abs(x) <= 1.05 && Math.abs(y) <= 1.05) {
    return { x, y };
  }

  // Scale with mapMin and mapMax boundaries
  const rangeX = mapMax[0] - mapMin[0];
  const rangeY = mapMax[1] - mapMin[1];

  if (rangeX === 0 || rangeY === 0) {
    return { x: 0.5, y: 0.5 };
  }

  const normX = (x - mapMin[0]) / rangeX;
  const normY = (y - mapMin[1]) / rangeY;

  return { x: normX, y: normY };
}

let audioCtx = null;
let lastBeepTime = 0;

// Auto-initialize AudioContext immediately on startup if running inside Electron,
// since we bypass gesture restrictions there via command-line flags.
if (/electron/i.test(navigator.userAgent)) {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.error('Failed to auto-init Electron AudioContext:', e);
  }
}

// Initialize and resume AudioContext on first user interaction for browser compatibility
const initAudioContext = () => {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch (e) {
    console.error('Failed to initialize AudioContext on gesture:', e);
  }
};
window.addEventListener('click', initAudioContext, { once: true });
window.addEventListener('keydown', initAudioContext, { once: true });
window.addEventListener('touchstart', initAudioContext, { once: true });

function triggerRwrBeep(type, isRear = false) {
  if (!wtConnected || mapImgIsPlaceholder) {
    return;
  }

  // Abort silently if the AudioContext has not been created or is still suspended.
  if (!audioCtx || audioCtx.state === 'suspended') {
    return;
  }

  const now = Date.now();
  if (type !== 'lock' && type !== 'gpws_whoop' && type !== 'gpws_beep') {
    // Rear attacks (tail merges) have faster, more urgent pulse intervals
    const interval = type === 'critical' 
      ? (isRear ? 200 : 300) 
      : (isRear ? 800 : 1200);

    if (now - lastBeepTime < interval) {
      return;
    }
    lastBeepTime = now;
  }

  // Central category check for sound alerts
  let category = 'merge';
  if (type === 'lock') category = 'lock';
  else if (type === 'gpws_whoop' || type === 'gpws_beep') category = 'gpws';

  if (!isAlertSoundEnabled(category)) {
    return;
  }

  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'gpws_whoop') {
      // Classic GPWS "whoop whoop" alarm tone: low pitch to high pitch sweep
      const nowMs = Date.now();
      if (nowMs - lastGpwsBeepTime < 800) return;
      lastGpwsBeepTime = nowMs;

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(480, audioCtx.currentTime + 0.35);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
      return;
    }

    if (type === 'gpws_beep') {
      // Rapid triple-beep warning for low altitude
      const nowMs = Date.now();
      if (nowMs - lastGpwsBeepTime < 1000) return;
      lastGpwsBeepTime = nowMs;

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
      return;
    }

    if (type === 'lock') {
      // High-intensity rapidly oscillating siren (screamer lock warning beep)
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(1600, audioCtx.currentTime + 0.08);
      osc.frequency.linearRampToValueAtTime(1200, audioCtx.currentTime + 0.16);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
      return;
    }

    if (isRear) {
      if (type === 'critical') {
        // Rear Critical: Tragic low-pitched descending scream (scary klaxon warning)
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(520, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.18);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime); // louder
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.18);
      } else {
        // Rear Caution: Tragic low-pitched descending triangle rumble
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(380, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(260, audioCtx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.14, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
      }
    } else {
      if (type === 'critical') {
        // Frontal Critical: High pitch rapid alert (sawtooth RWR lock warning beep)
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      } else {
        // Frontal Caution: Standard radar sweep beep (sine 440 Hz beep)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
      }
    }
  } catch (e) {
    console.error('Web Audio API play error:', e);
  }
}

// Query WT Telemetry Data
async function updateTelemetry() {
  const startTime = Date.now();

  try {
    // 1. Get Connection Status
    const statusRes = await fetch('/api/status');
    const statusData = await statusRes.json();

    if (statusData.status === 'connected') {
      lastConnectedTime = Date.now();
      if (!wtConnected) {
        wtConnected = true;
        mapImg.src = '/map.img?colors=1&t=' + Date.now();
        getMissionName();

        // Update sidebar footer status to ONLINE
        const footerUserStatus = document.querySelector('.sidebar-footer .user-status');
        if (footerUserStatus) {
          footerUserStatus.textContent = 'ONLINE';
          footerUserStatus.style.color = ''; // reset to CSS variable color
        }
      }
      document.getElementById('status-indicator').className = 'status-dot online';
      document.getElementById('status-text').textContent = 'CONNECTED';
      document.getElementById('offline-overlay').style.opacity = '0';
      document.getElementById('offline-overlay').style.pointerEvents = 'none';
    } else {
      setDisconnectedState();
      return;
    }

    // Calculate network latency
    pingMs = Date.now() - startTime;
    document.getElementById('conn-ping').textContent = `${pingMs} ms`;

    // 2. Fetch Map Info (bounds) - do this dynamically
    const mapInfoRes = await fetch('/map_info.json');
    if (mapInfoRes.ok) {
      const mapInfo = await mapInfoRes.json();
      if (mapInfo && mapInfo.map_min && mapInfo.map_max) {
        mapMin = mapInfo.map_min;
        mapMax = mapInfo.map_max;
      }
    }

    // 3. Fetch Objects
    const mapObjRes = await fetch('/map_obj.json');
    if (mapObjRes.ok) {
      mapObjects = await mapObjRes.json();

      // Track and calculate actual speed of each unit based on real position changes over time
      const now = Date.now();
      mapObjects.forEach((obj, idx) => {
        const key = obj.name || `${obj.faction || 'neutral'}_${obj.icon || 'unknown'}_${idx}`;
        const prev = unitSpeedTracker.get(key);

        let calculatedSpeed = prev ? prev.speed : 0;

        if (prev) {
          const hasMoved = obj.x !== prev.x || obj.y !== prev.y;
          if (hasMoved) {
            const dt = (now - prev.time) / 1000; // time since last actual movement in seconds
            if (dt > 0.1) {
              const dx = obj.x - prev.x;
              const dy = obj.y - prev.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              const rangeX = mapMax[0] - mapMin[0] || 65000;
              const distanceMeters = distance * rangeX;
              const speedMps = distanceMeters / dt;
              const newSpeed = Math.round(speedMps * 3.6);

              if (newSpeed < 3000) {
                if (prev.speed > 0) {
                  calculatedSpeed = Math.round(prev.speed * 0.7 + newSpeed * 0.3);
                } else {
                  calculatedSpeed = newSpeed;
                }
              }

              // Only update tracker on actual movement
              unitSpeedTracker.set(key, {
                x: obj.x,
                y: obj.y,
                time: now,
                speed: calculatedSpeed
              });
            }
          }
        } else {
          // Initialize tracker entry
          unitSpeedTracker.set(key, {
            x: obj.x,
            y: obj.y,
            time: now,
            speed: 0
          });
        }

        obj.calculatedSpeed = calculatedSpeed || 0;
      });

      // Clear stale tracker entries
      const activeKeys = new Set(mapObjects.map((obj, idx) => obj.name || `${obj.faction || 'neutral'}_${obj.icon || 'unknown'}_${idx}`));
      for (const key of unitSpeedTracker.keys()) {
        if (!activeKeys.has(key)) {
          unitSpeedTracker.delete(key);
        }
      }

      // Extract player object coordinates and direction
      const playerObj = mapObjects.find(isPlayerObject);
      if (playerObj) {
        if (playerObj.name && playerObj.name !== 'YOU') {
          playerNickname = playerObj.name;
          // Update sidebar footer user name
          const footerUserName = document.querySelector('.sidebar-footer .user-name');
          if (footerUserName) {
            footerUserName.textContent = playerNickname.toUpperCase();
          }
        }
        const norm = normalizeCoords(playerObj.x, playerObj.y);
        playerX = norm.x;
        playerY = norm.y;

        // Compute direction angle (North is 0, East is positive)
        if (playerObj.dx !== undefined && playerObj.dy !== undefined) {
          playerHeading = Math.atan2(playerObj.dx, -playerObj.dy);
        } else if (Array.isArray(playerObj.dir)) {
          playerHeading = Math.atan2(playerObj.dir[0], -playerObj.dir[1]);
        } else if (typeof playerObj.dir === 'number') {
          playerHeading = (playerObj.dir * Math.PI) / 180;
        }

        // Append to trail
        const lastTrailPt = playerTrail[playerTrail.length - 1];
        if (!lastTrailPt || Math.abs(lastTrailPt.x - playerX) > 0.0005 || Math.abs(lastTrailPt.y - playerY) > 0.0005) {
          playerTrail.push({ x: playerX, y: playerY });
          if (playerTrail.length > maxTrailLength) {
            playerTrail.shift();
          }
        }
      }
    } else {
      mapObjects = [];
    }

    // 4. Fetch State (primary telemetry)
    const stateRes = await fetch('/state');
    let stateValid = false;
    if (stateRes.ok) {
      const state = await stateRes.json();
      stateValid = state.valid !== false;

      // Update values
      const ias = state['IAS, km/h'] !== undefined ? Math.round(state['IAS, km/h']) : (state['V, km/h'] !== undefined ? Math.round(state['V, km/h']) : 0);
      currentSpeed = ias;

      const alt = state['H, m'] !== undefined ? Math.round(state['H, m']) : 0;
      const climb = state['Vy, m/s'] !== undefined ? state['Vy, m/s'].toFixed(1) : '0.0';

      // Try resolving engine throttle
      let throttle = 0;
      if (state['throttle 1, %'] !== undefined) throttle = state['throttle 1, %'];
      else if (state['throttle, %'] !== undefined) throttle = state['throttle, %'];

      // Engine values
      const rpm = state['RPM 1'] || state['RPM'] || 0;
      const oilTemp = state['oil temp 1, C'] || state['oil temp, C'] || 0;
      const waterTemp = state['water temp, C'] || state['water temp 1, C'] || 0;
      const mFuel = state['Mfuel, kg'] !== undefined ? state['Mfuel, kg'] : -1;
      const mFuelMax = state['Mfuel0, kg'] !== undefined ? state['Mfuel0, kg'] : -1;

      const tas = state['TAS, km/h'] !== undefined ? Math.round(state['TAS, km/h']) : ias;
      const gload = state['G, g'] !== undefined ? state['G, g'].toFixed(1) : '1.0';
      const aoa = state['AoA, deg'] !== undefined ? state['AoA, deg'].toFixed(1) : '0.0';
      const mach = state['M'] !== undefined ? state['M'].toFixed(2) : (state['Mach'] !== undefined ? state['Mach'].toFixed(2) : '0.00');

      document.getElementById('val-spd').textContent = ias;
      document.getElementById('val-tas').textContent = tas;
      document.getElementById('val-alt').textContent = alt;
      document.getElementById('val-climb').textContent = climb;
      document.getElementById('val-thr').textContent = throttle;
      document.getElementById('val-gload').textContent = gload;
      document.getElementById('val-aoa').textContent = aoa;
      document.getElementById('val-mach').textContent = mach;

      // Engine gauges width updates
      document.getElementById('val-rpm').textContent = Math.round(rpm);
      document.getElementById('bar-rpm').style.width = `${Math.min((rpm / 3500) * 100, 100)}%`;

      document.getElementById('val-oil').textContent = `${Math.round(oilTemp)} °C`;
      document.getElementById('bar-oil').style.width = `${Math.min((oilTemp / 150) * 100, 100)}%`;

      document.getElementById('val-water').textContent = `${Math.round(waterTemp)} °C`;
      document.getElementById('bar-water').style.width = `${Math.min((waterTemp / 120) * 100, 100)}%`;

      // Oil Temperature Warning Alerts
      const oilRow = document.getElementById('row-oil');
      if (oilRow) {
        if (oilTemp >= 125) {
          oilRow.className = 'engine-row danger-flash';
        } else if (oilTemp >= 110) {
          oilRow.className = 'engine-row caution-flash';
        } else {
          oilRow.className = 'engine-row';
        }
      }

      // Water/H2O Temperature Warning Alerts
      const waterRow = document.getElementById('row-water');
      if (waterRow) {
        if (waterTemp >= 115) {
          waterRow.className = 'engine-row danger-flash';
        } else if (waterTemp >= 100) {
          waterRow.className = 'engine-row caution-flash';
        } else {
          waterRow.className = 'engine-row';
        }
      }

      // Check for Engine Overheat and Engine Failure voice warnings
      if (oilTemp >= 125 || waterTemp >= 115) {
        if (!spokenEngineOverheat) {
          spokenEngineOverheat = true;
          speakCockpitWarning('engine_overheat');
        }
      } else if (oilTemp < 110 && waterTemp < 100) {
        spokenEngineOverheat = false;
      }

      if (ias > 150 && throttle > 20 && rpm < 200) {
        if (!spokenEngineFailure) {
          spokenEngineFailure = true;
          speakCockpitWarning('engine_failure');
        }
      } else if (rpm > 1000 || ias < 50) {
        spokenEngineFailure = false;
      }

      // Fuel progress bar and value update
      if (mFuel !== -1 && mFuelMax > 0) {
        checkFuelVoiceAlerts(mFuel, mFuelMax);
        const fuelPct = Math.round((mFuel / mFuelMax) * 100);
        document.getElementById('val-fuel').textContent = `${Math.round(mFuel)} kg (${fuelPct}%)`;
        const fuelBar = document.getElementById('bar-fuel');
        if (fuelBar) {
          fuelBar.style.width = `${Math.min(fuelPct, 100)}%`;
          if (fuelPct < 20) {
            fuelBar.style.background = 'linear-gradient(90deg, #ff0055, #ff3366)';
            fuelBar.style.boxShadow = '0 0 5px rgba(255, 51, 102, 0.5)';
          } else if (fuelPct < 50) {
            fuelBar.style.background = 'linear-gradient(90deg, #ffaa00, #ffb703)';
            fuelBar.style.boxShadow = '0 0 5px rgba(255, 183, 3, 0.5)';
          } else {
            fuelBar.style.background = '';
            fuelBar.style.boxShadow = '';
          }
        }

        // Low Fuel Warning Alert Row Glows
        const fuelRow = document.getElementById('row-fuel');
        if (fuelRow) {
          if (fuelPct < 20) {
            fuelRow.className = 'engine-row danger-flash';
          } else if (fuelPct < 50) {
            fuelRow.className = 'engine-row caution-flash';
          } else {
            fuelRow.className = 'engine-row';
          }
        }

        // Mechanical fuel quantity gauge update (lbs x 1000)
        // 1 kg = 2.20462 lbs
        const mFuelLbs = mFuel * 2.20462;
        const mFuelLbsThousands = mFuelLbs / 1000;

        document.getElementById('val-fuel-digital-lbs').textContent = `${Math.round(mFuelLbs)} LBS`;
        document.getElementById('val-fuel-digital-kg').textContent = `${Math.round(mFuel)} KG (${fuelPct}%)`;

        // Sweep is 300 degrees clockwise, starting at 210 degrees for 0 lbs.
        const clampedLbsVal = Math.max(0, Math.min(mFuelLbsThousands, 6));
        const needleAngle = 210 + (clampedLbsVal * 50);

        const needleGroup = document.getElementById('fuel-needle-group');
        if (needleGroup) {
          needleGroup.style.transform = `rotate(${needleAngle}deg)`;
        }
        const miniNeedleGroup = document.getElementById('mini-fuel-needle-group');
        if (miniNeedleGroup) {
          miniNeedleGroup.style.transform = `rotate(${needleAngle}deg)`;
        }
      }

      // Mechanical parts state
      const gearVal = state['gear, %'] !== undefined ? state['gear, %'] : 0;
      const flapsVal = state['flaps, %'] !== undefined ? state['flaps, %'] : 0;
      const airbrakeVal = state['airbrake, %'] !== undefined ? state['airbrake, %'] : 0;

      updateMechIndicator('mech-gear', 'val-gear', gearVal, 'DOWN', 'RETRACTED');
      updateMechIndicator('mech-flaps', 'val-flaps', flapsVal, 'DEPLOYED', 'UP');
      updateMechIndicator('mech-airbrake', 'val-airbrake', airbrakeVal, 'ENGAGED', 'RETRACTED');

      const climbVal = state['Vy, m/s'] !== undefined ? state['Vy, m/s'] : 0;

      // Auto-calibrate airfield ground level if on the runway
      if (ias < 15 && gearVal > 80 && Math.abs(climbVal) < 1 && throttle < 15) {
        groundLevel = alt;
      }

      // Check for GPWS (Ground Proximity Warning System) if gears are retracted (< 80)
      if (gearVal <= 80) {
        // Calculate dynamic pull up warning height based on vertical sink rate (e.g. at -50 m/s sink rate, warn at 550m above ground level)
        const triggerAlt = 150 + Math.abs(climbVal) * 8;
        const relativeAlt = alt - groundLevel;

        // 1. GPWS Pull Up Warning (altitude below trigger height above ground and vertical speed descending faster than -5 m/s)
        if (relativeAlt < triggerAlt && climbVal < -5) {
          if (!spokenGpwsPullup) {
            spokenGpwsPullup = true;
            triggerRwrBeep('gpws_whoop');
            speakCockpitWarning('gpws_pullup');
          }
        } else if (climbVal >= -2 || relativeAlt > (triggerAlt + 50)) {
          spokenGpwsPullup = false;
        }

        // 2. Low Altitude Warning (height below 60m above ground level, even if flying level)
        if (relativeAlt < 60) {
          if (!spokenGpwsLowalt) {
            spokenGpwsLowalt = true;
            triggerRwrBeep('gpws_beep');
            speakCockpitWarning('gpws_lowalt');
          }
        } else if (relativeAlt > 80) {
          spokenGpwsLowalt = false;
        }
      } else {
        // Reset warning state when landing gears are deployed (actively landing)
        spokenGpwsPullup = false;
        spokenGpwsLowalt = false;
      }

      // Update Radar Telemetry Widget
      const radarActive = state['radar_active'] === true || state['radar_active'] === 1 || state['radar_active'] === 'true';
      const radarValActive = document.getElementById('radar-val-active');
      const radarValMode = document.getElementById('radar-val-mode');
      const radarValRange = document.getElementById('radar-val-range');
      const radarSweepBar = document.getElementById('radar-sweep-bar');

      if (radarValActive) {
        if (radarActive) {
          radarValActive.textContent = 'ACTIVE';
          radarValActive.style.color = 'var(--color-text-main)'; // bright theme color
        } else {
          radarValActive.textContent = 'STANDBY';
          radarValActive.style.color = 'var(--color-text-dim)';
        }
      }

      if (radarValMode) {
        radarValMode.textContent = state['radar_mode'] !== undefined ? String(state['radar_mode']).toUpperCase() : (radarActive ? 'SEARCH' : 'OFF');
      }

      if (radarValRange) {
        let rangeVal = '--';
        if (state['radar_range'] !== undefined) {
          const rawRange = state['radar_range'];
          if (typeof rawRange === 'number') {
            rangeVal = `${(rawRange / 1000).toFixed(0)} km`;
          } else {
            rangeVal = String(rawRange).toLowerCase().includes('km') ? rawRange : `${rawRange} m`;
          }
        } else if (state['radar_scale'] !== undefined) {
          rangeVal = state['radar_scale'];
        }
        radarValRange.textContent = rangeVal;
      }

      if (radarSweepBar) {
        if (radarActive) {
          const sweepPct = 50 + 50 * Math.sin(Date.now() / 300);
          radarSweepBar.style.width = `${sweepPct}%`;
        } else {
          radarSweepBar.style.width = '0%';
        }
      }
    }

    // 5. Fetch Indicators (pitch, roll, compass)
    const indRes = await fetch('/indicators');
    if (indRes.ok) {
      const indicators = await indRes.json();

      if (indicators.valid) {
        if (indicators.type) {
          playerAircraftType = indicators.type.toUpperCase();
        }
        let pitch = indicators.aviahorizon_pitch !== undefined ? indicators.aviahorizon_pitch : (indicators.pitch !== undefined ? indicators.pitch : 0);
        pitch = -pitch; // Invert pitch: positive = climb, negative = dive to match cockpit instrument
        playerPitch = pitch; // Store in global state for drawing aircraft heading vector
        const bank = indicators.aviahorizon_roll !== undefined ? indicators.aviahorizon_roll : (indicators.bank !== undefined ? indicators.bank : 0);
        playerRoll = bank; // Store globally for 3D Attitude Display
        const compass = indicators.compass !== undefined ? Math.round(indicators.compass) : 0;

        if (currentSpeed === 0 && indicators.speed !== undefined) {
          currentSpeed = Math.round(indicators.speed * 3.6);
          document.getElementById('val-spd').textContent = currentSpeed;
        }

        // Update readouts
        document.getElementById('val-pitch').textContent = `${pitch.toFixed(1)}°`;
        document.getElementById('val-roll').textContent = `${bank.toFixed(1)}°`;

        const hdgStr = String(compass).padStart(3, '0');
        document.getElementById('val-hdg').textContent = `${hdgStr}°`;

        // Update Artificial Horizon SVG/CSS elements
        const horizon = document.getElementById('gyro-horizon');
        // Roll spins the horizon block, Pitch slides it up/down (approx 2px per degree)
        if (horizon) {
          horizon.style.transform = `rotate(${bank}deg) translateY(${pitch * 2.0}px)`;
        }

        // Update mini artificial horizon
        const miniHorizon = document.getElementById('mini-gyro-horizon');
        const miniHdg = document.getElementById('mini-val-hdg');
        if (miniHorizon) {
          miniHorizon.style.transform = `rotate(${bank}deg) translateY(${pitch * 2.0}px)`;
        }
        if (miniHdg) {
          miniHdg.textContent = `${hdgStr}°`;
        }

        // Fallback for fuel if state didn't provide it
        const valFuelElem = document.getElementById('val-fuel');
        if (valFuelElem && valFuelElem.textContent.includes('0 kg (0%)') && indicators.fuel !== undefined) {
          const fuelQty = Math.round(indicators.fuel);
          valFuelElem.textContent = `${fuelQty} kg`;
          const fuelBar = document.getElementById('bar-fuel');
          if (fuelBar) {
            fuelBar.style.width = '100%';
          }

          const mFuelLbs = indicators.fuel * 2.20462;
          const mFuelLbsThousands = mFuelLbs / 1000;
          document.getElementById('val-fuel-digital-lbs').textContent = `${Math.round(mFuelLbs)} LBS`;
          document.getElementById('val-fuel-digital-kg').textContent = `${fuelQty} KG`;
          const clampedLbsVal = Math.max(0, Math.min(mFuelLbsThousands, 6));
          const needleAngle = 210 + (clampedLbsVal * 50);
          const needleGroup = document.getElementById('fuel-needle-group');
          if (needleGroup) {
            needleGroup.style.transform = `rotate(${needleAngle}deg)`;
          }
          const miniNeedleGroup = document.getElementById('mini-fuel-needle-group');
          if (miniNeedleGroup) {
            miniNeedleGroup.style.transform = `rotate(${needleAngle}deg)`;
          }
        }
      }
    }

    // Determine if the player is alive and if they are in a tank
    const hasPlayerObjWithName = mapObjects.some(obj => {
      const name = (obj.name || '').toUpperCase();
      const nick = (playerNickname || '').toUpperCase();
      return name === 'YOU' || (nick && name === nick);
    });

    isPlayerAlive = stateValid || hasPlayerObjWithName;

    const playerObj = mapObjects.find(isPlayerObject);
    if (playerObj) {
      isPlayerTank = (playerObj.icon && playerObj.icon.includes('tank')) || 
                     (playerObj.type && playerObj.type.includes('tank')) || 
                     (isPlayerAlive && !stateValid);
    } else {
      isPlayerTank = false;
    }

    if (!isPlayerAlive) {
      playerTrail.length = 0; // Clear trails on death
    }

    // 6. Calculate Threat Alerts (Intercept / Collision Warning System)
    let closestThreat = null;
    let closestDist = Infinity;

    const threatStyle = document.getElementById('sel-threat-style')?.value || 'both';
    const audioEnabled = isAlertSoundEnabled('merge') || isAlertSoundEnabled('lock');
    const shouldTrackThreats = (threatStyle !== 'none' || audioEnabled || isAlertTtsEnabled('merge') || isAlertTtsEnabled('lock'));

    if (wtConnected && isPlayerAlive && !mapImgIsPlaceholder && playerX !== undefined && playerY !== undefined && shouldTrackThreats) {
      const rangeX = mapMax[0] - mapMin[0] || 65000;

      mapObjects.forEach(obj => {
        if (isPlayerObject(obj)) return;


        // Is it an aircraft?
        const icon = (obj.icon || '').toLowerCase();
        const type = (obj.type || '').toLowerCase();
        const isAA = icon === 'airdefence' || icon === 'spaa' || icon === 'sam' || type === 'airdefence' || type === 'aaa' || type === 'flak';
        const isWaypoint = icon == 'waypoint';
        const isTank = icon.includes('tank') || type.includes('tank');
        const isShip = icon === 'destroyer' || icon === 'frigate' || icon === 'cruiser' || icon === 'battleship' || icon === 'carrier' || icon === 'boat' || icon.includes('ship') || type.includes('ship');
        const isStructure = icon === 'structure' || icon === 'pillbox' || icon === 'bunker' || type === 'structure';
        const isGround = type === 'ground_model';
        const isSpawn = icon.includes('spawn') || type.includes('spawn') || icon.includes('respawn') || type.includes('respawn');

        const isAircraft = !isAA && !isWaypoint && !isTank && !isShip && !isStructure && !isGround && !isSpawn;

        if (!isAircraft) return;

        // Is it an enemy? (faction is 'enemy'/'red', or team color has Red as dominant channel, excluding squadmates)
        let isEnemy = false;
        if (obj.faction) {
          isEnemy = obj.faction === 'enemy' || obj.faction === 'red';
        } else if (obj['color[]']) {
          const rgb = obj['color[]'];
          const isSquad = rgb[0] === 57 && rgb[1] === 217 && rgb[2] === 33;
          isEnemy = !isSquad && rgb[0] > rgb[2] && rgb[0] > rgb[1];
        } else if (typeof obj.color === 'string') {
          if (obj.color.startsWith('#')) {
            const r = parseInt(obj.color.slice(1, 3), 16) || 0;
            const g = parseInt(obj.color.slice(3, 5), 16) || 0;
            const b = parseInt(obj.color.slice(5, 7), 16) || 0;
            const isSquad = r === 57 && g === 217 && b === 33;
            isEnemy = !isSquad && r > b && r > g;
          } else {
            const lowerColor = obj.color.toLowerCase();
            isEnemy = lowerColor === 'red' || lowerColor === 'enemy';
          }
        }

        if (!isEnemy) return;

        // Normalize object coordinates first
        const objNorm = normalizeCoords(obj.x, obj.y);

        // Distance in meters
        const dx = playerX - objNorm.x;
        const dy = playerY - objNorm.y;
        const dist = Math.sqrt(dx * dx + dy * dy) * rangeX;

        // Only consider threats within 15000 meters (15 km) for high-speed merges
        if (dist > 15000) return;

        // Direction vector from enemy to player
        const dx_ep = playerX - objNorm.x;
        const dy_ep = playerY - objNorm.y;
        const len_ep = Math.sqrt(dx_ep * dx_ep + dy_ep * dy_ep);
        if (len_ep === 0) return;
        const dirx = dx_ep / len_ep;
        const diry = dy_ep / len_ep;

        // Resolve heading vector in screen/map coordinate space (where X is East, Y is South)
        let vx_enemy = 0;
        let vy_enemy = 0;
        if (obj.dx !== undefined && obj.dy !== undefined) {
          vx_enemy = obj.dx;
          vy_enemy = obj.dy; // Keep dy aligned in screen Y space (no negation needed for dot product)
        } else if (Array.isArray(obj.dir)) {
          vx_enemy = obj.dir[0];
          vy_enemy = obj.dir[1];
        } else if (typeof obj.dir === 'number') {
          const rad = (obj.dir * Math.PI) / 180;
          vx_enemy = Math.sin(rad);
          vy_enemy = Math.cos(rad);
        }

        // Normalize enemy heading vector to make the dot product exactly cos(angle)
        const len_enemy = Math.sqrt(vx_enemy * vx_enemy + vy_enemy * vy_enemy);
        if (len_enemy > 0) {
          vx_enemy /= len_enemy;
          vy_enemy /= len_enemy;
        }

        // Compute dot product (both vectors now in the same screen space where Y increases downwards)
        const dot = vx_enemy * dirx + vy_enemy * diry;

        // If pointing within ~45 degrees (dot > 0.70)
        if (dot > 0.70) {
          if (dist < closestDist) {
            // Compute if the threat is in the rear hemisphere of the player
            const dx_pe = objNorm.x - playerX;
            const dy_pe = objNorm.y - playerY;
            const len_pe = Math.sqrt(dx_pe * dx_pe + dy_pe * dy_pe);
            const dirx_pe = len_pe > 0 ? dx_pe / len_pe : 0;
            const diry_pe = len_pe > 0 ? dy_pe / len_pe : 0;
            const vx_p = Math.sin(playerHeading);
            const vy_p = -Math.cos(playerHeading);
            const playerDotEnemy = vx_p * dirx_pe + vy_p * diry_pe;
            const isRear = playerDotEnemy < 0;

            closestDist = dist;
            closestThreat = {
              obj: obj,
              dist: dist,
              dot: dot,
              isRear: isRear
            };
          }

          // Check for Sudden Close Threat (locked within 6 km)
          if (dist < 6000) {
            const threatKey = obj.name || `${obj.icon}_${obj.x}_${obj.y}`;
            if (!knownCloseThreats.has(threatKey)) {
              knownCloseThreats.add(threatKey);
              triggerRwrBeep('lock');
              speakCockpitWarning('threat_lock');
            }
          }
        }
      });
    }

    // Prune knownCloseThreats with hysteresis (exits at >8km or not aiming)
    const activeCloseThreatKeys = new Set();
    if (wtConnected && isPlayerAlive && !mapImgIsPlaceholder && playerX !== undefined && playerY !== undefined && shouldTrackThreats) {
      mapObjects.forEach(obj => {
        if (obj.icon === 'aircraft' && obj.army === 'enemy') {
          const objNorm = normalizeCoords(obj.x, obj.y);
          const rangeX = mapMax[0] - mapMin[0] || 65000;
          const dx = playerX - objNorm.x;
          const dy = playerY - objNorm.y;
          const dist = Math.sqrt(dx * dx + dy * dy) * rangeX;
          
          const dx_ep = playerX - objNorm.x;
          const dy_ep = playerY - objNorm.y;
          const len_ep = Math.sqrt(dx_ep * dx_ep + dy_ep * dy_ep);
          if (len_ep > 0) {
            const dirx = dx_ep / len_ep;
            const diry = dy_ep / len_ep;
            let vx_enemy = 0;
            let vy_enemy = 0;
            if (obj.dx !== undefined && obj.dy !== undefined) {
              vx_enemy = obj.dx;
              vy_enemy = obj.dy;
            } else if (Array.isArray(obj.dir)) {
              vx_enemy = obj.dir[0];
              vy_enemy = obj.dir[1];
            } else if (typeof obj.dir === 'number') {
              const rad = (obj.dir * Math.PI) / 180;
              vx_enemy = Math.sin(rad);
              vy_enemy = Math.cos(rad);
            }
            const len_enemy = Math.sqrt(vx_enemy * vx_enemy + vy_enemy * vy_enemy);
            if (len_enemy > 0) {
              vx_enemy /= len_enemy;
              vy_enemy /= len_enemy;
            }
            const dot = vx_enemy * dirx + vy_enemy * diry;
            
            if (dist < 8000 && dot > 0.57) {
              const threatKey = obj.name || `${obj.icon}_${obj.x}_${obj.y}`;
              activeCloseThreatKeys.add(threatKey);
            }
          }
        }
      });
    }

    for (const key of knownCloseThreats) {
      if (!activeCloseThreatKeys.has(key)) {
        knownCloseThreats.delete(key);
      }
    }

    // Update Threat Warning Visuals and Sound
    const banner = document.getElementById('threat-warning-banner');
    const canvasContainer = document.querySelector('.canvas-container');

    if (closestThreat) {
      const distanceText = (closestThreat.dist / 1000).toFixed(1) + ' KM';
      const nameText = closestThreat.obj.name ? closestThreat.obj.name.toUpperCase() : 'UNKNOWN AIRCRAFT';
      const isCritical = closestThreat.dist < 4000; // Critical alert below 4 km instead of 2.5 km

      // Set global threat variables for drawMap() highlighting
      activeThreatKey = closestThreat.obj.name || `${closestThreat.obj.icon}_${closestThreat.obj.x}_${closestThreat.obj.y}`;
      activeThreatLevel = isCritical ? 'critical' : 'caution';

      // Speech Synthesis Voice Threat Alert
      const voiceThreatsEnabled = isAlertTtsEnabled('merge');
      if (voiceThreatsEnabled && !spokenThreatKeys.has(activeThreatKey)) {
        if (closestThreat.isRear) {
          speakCockpitWarning('threat_rear');
        } else {
          speakCockpitWarning('threat_front');
        }
        spokenThreatKeys.add(activeThreatKey);
      }

      // Garbage collect spokenThreatKeys to only keep active map objects
      const activeMapKeys = new Set(mapObjects.map(o => o.name || `${o.icon}_${o.x}_${o.y}`));
      for (const key of spokenThreatKeys) {
        if (!activeMapKeys.has(key)) {
          spokenThreatKeys.delete(key);
        }
      }

      // 1. Audio alert
      triggerRwrBeep(isCritical ? 'critical' : 'caution', closestThreat.isRear);

      // 2. Banner alert
      if (banner) {
        if (threatStyle === 'both' || threatStyle === 'banner') {
          if (isCritical) {
            banner.className = 'threat-banner level-critical';
            banner.querySelector('.warning-text').textContent = `COLLISION ALERT: ENEMY ${nameText} [${distanceText}]`;
          } else {
            banner.className = 'threat-banner level-caution';
            banner.querySelector('.warning-text').textContent = `TACTICAL WARNING: ENEMY INTERCEPT COURSE [${distanceText}]`;
          }
        } else {
          banner.className = 'threat-banner hidden';
        }
      }

      // 3. Border glow alert
      if (canvasContainer) {
        if (threatStyle === 'both' || threatStyle === 'border') {
          if (isCritical) {
            canvasContainer.className = 'canvas-container threat-border-critical';
          } else {
            canvasContainer.className = 'canvas-container threat-border-caution';
          }
        } else {
          canvasContainer.className = 'canvas-container';
        }
      }
    } else {
      // Clear global threat variables
      activeThreatKey = null;
      activeThreatLevel = null;

      // Clear alerts
      if (banner) {
        banner.className = 'threat-banner hidden';
      }
      if (canvasContainer) {
        canvasContainer.className = 'canvas-container';
      }
    }

  } catch (error) {
    console.error('Error fetching telemetry:', error);
    setDisconnectedState();
  }
}

function updateMechIndicator(elementId, valueId, percent, activeText, inactiveText) {
  const el = document.getElementById(elementId);
  const valEl = document.getElementById(valueId);
  if (percent > 5) {
    el.classList.add('active');
    valEl.textContent = percent === 100 ? activeText : `${percent}%`;
  } else {
    el.classList.remove('active');
    valEl.textContent = inactiveText;
  }
}

function setDisconnectedState() {
  wtConnected = false;

  // Immediately stop all speech and RWR alarms
  spokenFuelMid = false;
  spokenFuelEmpty = false;
  spokenEngineOverheat = false;
  spokenEngineFailure = false;
  spokenGpwsPullup = false;
  spokenGpwsLowalt = false;
  spokenThreatKeys.clear();
  isSpeaking = false;
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (activeSpeechAudio) {
    activeSpeechAudio.pause();
    activeSpeechAudio = null;
  }

  document.getElementById('status-indicator').className = 'status-dot offline';
  document.getElementById('status-text').textContent = 'OFFLINE';
  document.getElementById('conn-ping').textContent = '-- ms';

  // Update sidebar footer status to OFFLINE
  const footerUserStatus = document.querySelector('.sidebar-footer .user-status');
  if (footerUserStatus) {
    footerUserStatus.textContent = 'OFFLINE';
    footerUserStatus.style.color = '#ff3366'; // red danger color
  }

  // Show overlay with dynamic message based on joining match state
  const overlay = document.getElementById('offline-overlay');
  if (overlay) {
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'all';

    const isJoiningMatch = !wtConnected && (Date.now() - lastConnectedTime < 45000) && lastConnectedTime > 0;
    const titleEl = overlay.querySelector('.overlay-title');
    const descEl = overlay.querySelector('.overlay-desc');
    const iconEl = overlay.querySelector('.glitch-icon');

    if (isJoiningMatch) {
      if (titleEl) titleEl.textContent = 'JOINING MATCH...';
      if (descEl) descEl.textContent = 'Establishing tactical satellite link. Loading combat theatre data...';
      if (iconEl) {
        iconEl.textContent = '📡';
        iconEl.style.color = 'var(--color-text-main)';
      }
    } else {
      if (titleEl) titleEl.textContent = 'NO GAME CLIENT DETECTED';
      if (descEl) descEl.textContent = 'Launch War Thunder and enter a battle or test flight to stream telemetry.';
      if (iconEl) {
        iconEl.textContent = '⚠';
        iconEl.style.color = '';
      }
    }
  }

  // Reset values
  document.getElementById('val-spd').textContent = '0';
  document.getElementById('val-alt').textContent = '0';
  document.getElementById('val-thr').textContent = '0';
  document.getElementById('val-climb').textContent = '0.0';
  document.getElementById('val-pitch').textContent = '0.0°';
  document.getElementById('val-roll').textContent = '0.0°';
  document.getElementById('val-hdg').textContent = '000°';
  document.getElementById('val-rpm').textContent = '0';
  document.getElementById('bar-rpm').style.width = '0%';
  document.getElementById('val-oil').textContent = '0 °C';
  document.getElementById('bar-oil').style.width = '0%';
  document.getElementById('val-water').textContent = '0 °C';
  document.getElementById('bar-water').style.width = '0%';
  document.getElementById('val-gear').textContent = 'RETRACTED';
  document.getElementById('val-flaps').textContent = 'UP';
  document.getElementById('val-airbrake').textContent = 'RETRACTED';
  document.getElementById('mech-gear').classList.remove('active');
  document.getElementById('mech-flaps').classList.remove('active');
  document.getElementById('mech-airbrake').classList.remove('active');

  // Reset Radar Widget
  const radarValActive = document.getElementById('radar-val-active');
  const radarValMode = document.getElementById('radar-val-mode');
  const radarValRange = document.getElementById('radar-val-range');
  const radarSweepBar = document.getElementById('radar-sweep-bar');
  if (radarValActive) {
    radarValActive.textContent = 'STANDBY';
    radarValActive.style.color = 'var(--color-text-dim)';
  }
  if (radarValMode) radarValMode.textContent = 'OFF';
  if (radarValRange) radarValRange.textContent = '-- km';
  if (radarSweepBar) radarSweepBar.style.width = '0%';

  // Center horizon
  const horizon = document.getElementById('gyro-horizon');
  horizon.style.transform = `rotate(0deg) translateY(0px)`;

  playerTrail.length = 0; // Clear trails

  isPlayerAlive = false;
  isPlayerTank = false;

  // Clear active threat warning indicators
  activeThreatKey = null;
  activeThreatLevel = null;
  const banner = document.getElementById('threat-warning-banner');
  if (banner) {
    banner.className = 'threat-banner hidden';
  }
  const canvasContainer = document.querySelector('.canvas-container');
  if (canvasContainer) {
    canvasContainer.className = 'canvas-container';
  }
}

// Fetch current mission name from WT
async function getMissionName() {
  if (!wtConnected) return;
  try {
    const res = await fetch('/map_info.json');
    if (res.ok) {
      const data = await res.json();
      // Look for map or mission field
      if (data && data.map) {
        const newMissionName = data.map.toUpperCase().replace(/_/g, ' ');
        if (missionName !== newMissionName) {
          missionName = newMissionName;
          document.getElementById('mission-name').textContent = missionName;
          // Reload map image and clear flight path trail for new map
          mapImg.src = '/map.img?colors=1&t=' + Date.now();
          playerTrail.length = 0;
        }
      }
    }
  } catch (e) {
    missionName = 'NO MATCH DETECTED';
  }
  document.getElementById('mission-name').textContent = missionName;
}

// Fetch live HUD combat log messages and events from localhost:8111/hudmsg
async function updateCombatEvents() {
  if (!wtConnected) return;
  try {
    const res = await fetch(`/hudmsg?lastEvt=${lastEvtId}&lastDmg=${lastDmgId}`);
    if (res.ok) {
      const data = await res.json();

      let hasNew = false;

      // Process Damage/Combat logs
      if (Array.isArray(data.damage)) {
        data.damage.forEach(item => {
          if (item.id > lastDmgId) {
            lastDmgId = item.id;
            addCombatLog(item);
            hasNew = true;
          }
        });

        // Initialize lastDmgId on load to latest to prevent flooding history
        if (lastDmgId === -1 && data.damage.length > 0) {
          lastDmgId = Math.max(...data.damage.map(d => d.id));
          // Pre-populate last 3 events as history
          const hist = data.damage.slice(-3);
          hist.forEach(addCombatLog);
        }
      }

      // Process System Events
      if (Array.isArray(data.events)) {
        data.events.forEach(item => {
          if (item.id > lastEvtId) {
            lastEvtId = item.id;
            addCombatLog(item);
            hasNew = true;
          }
        });

        if (lastEvtId === -1 && data.events.length > 0) {
          lastEvtId = Math.max(...data.events.map(e => e.id));
        }
      }
    }
  } catch (e) {
    console.error('Error fetching combat logs:', e);
  }
}

// Append formatted events to sidebar log UI element
function addCombatLog(item) {
  const logContainer = document.getElementById('combat-log');
  if (!logContainer) return;

  // Remove placeholder on first entry
  const placeholder = logContainer.querySelector('.log-placeholder');
  if (placeholder) placeholder.remove();

  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${timeStr}]`;
  entry.appendChild(timeSpan);

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';

  let rawMsg = item.msg || '';
  rawMsg = rawMsg.replace(/<[^>]*>/g, ''); // Clean HTML
  msgSpan.textContent = rawMsg;
  entry.appendChild(msgSpan);

  // Classify message categories for aesthetic color highlights
  const msgLower = rawMsg.toLowerCase();

  if (msgLower.includes('überhitzt') || msgLower.includes('overheat') || msgLower.includes('overheated')) {
    entry.classList.add('overheat');
  } else if (playerNickname && msgLower.includes(playerNickname.toLowerCase())) {
    entry.classList.add('player-event');
  } else if (msgLower.includes('zerstört') || msgLower.includes('abgeschossen') || msgLower.includes('destroyed') || msgLower.includes('shot down')) {
    if (item.enemy) {
      entry.classList.add('kill-enemy');
    } else {
      entry.classList.add('kill-friendly');
    }
  }

  logContainer.appendChild(entry);

  // Max log list size
  while (logContainer.children.length > 40) {
    logContainer.removeChild(logContainer.firstChild);
  }

  // Scroll to bottom
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Initialize loop
async function init() {
  // Restore draggable layout settings
  restoreLayoutConfig();
  // Restore panel visibility layout config
  restorePanelVisibility();

  // Initialize Global Hotkeys
  initGlobalHotkeys();

  // Wire up Target Type Filters (Air, Ground, Naval, Bases)
  const filterTypes = ['air', 'ground', 'naval', 'bases'];
  filterTypes.forEach(type => {
    const btn = document.getElementById(`btn-toggle-type-${type}`);
    if (btn) {
      // Restore initial state from cookies
      const savedState = getCookie(`filter_type_${type}`);
      if (savedState === '0') {
        btn.classList.remove('active');
      } else {
        btn.classList.add('active');
      }

      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        setCookie(`filter_type_${type}`, btn.classList.contains('active') ? '1' : '0');
        drawMap();
      });
    }
  });

  // Helper function to match browser KeyboardEvent against Electron accelerator string
  function isHotkeyMatch(event, shortcutString) {
    if (!shortcutString || typeof shortcutString !== 'string') return false;
    const parts = shortcutString.split('+').map(s => s.trim());
    if (parts.length === 0) return false;

    const reqCtrl = parts.some(p => ['CommandOrControl', 'CmdOrCtrl', 'Control', 'Ctrl'].includes(p));
    const reqAlt = parts.some(p => ['Alt', 'Option'].includes(p));
    const reqShift = parts.some(p => p === 'Shift');
    const reqMeta = parts.some(p => ['Super', 'Meta'].includes(p));

    const hasCtrl = reqCtrl ? (event.ctrlKey || event.metaKey) : (!event.ctrlKey && !event.metaKey);
    const hasAlt = reqAlt ? event.altKey : !event.altKey;
    const hasShift = reqShift ? event.shiftKey : !event.shiftKey;

    if (!hasCtrl || !hasAlt || !hasShift) return false;

    const keyParts = parts.filter(p => !['CommandOrControl', 'CmdOrCtrl', 'Control', 'Ctrl', 'Alt', 'Option', 'Shift', 'Super', 'Meta'].includes(p));
    if (keyParts.length === 0) return false;
    const targetKey = keyParts[0].toUpperCase();

    let eventKey = event.key ? event.key.toUpperCase() : '';
    let eventCode = event.code || '';

    if (eventCode.startsWith('Key')) eventCode = eventCode.replace('Key', '');
    else if (eventCode.startsWith('Digit')) eventCode = eventCode.replace('Digit', '');
    else if (eventCode === 'ArrowUp') eventCode = 'UP';
    else if (eventCode === 'ArrowDown') eventCode = 'DOWN';
    else if (eventCode === 'ArrowLeft') eventCode = 'LEFT';
    else if (eventCode === 'ArrowRight') eventCode = 'RIGHT';
    else if (eventCode === 'Equal' || eventCode === 'NumpadAdd') eventCode = 'PLUS';
    else if (eventCode === 'Minus' || eventCode === 'NumpadSubtract') eventCode = 'MINUS';
    else if (eventCode === 'Space') eventCode = 'SPACE';

    if (targetKey === 'UP' && (eventKey === 'ARROWUP' || eventCode === 'UP')) return true;
    if (targetKey === 'DOWN' && (eventKey === 'ARROWDOWN' || eventCode === 'DOWN')) return true;
    if (targetKey === 'LEFT' && (eventKey === 'ARROWLEFT' || eventCode === 'LEFT')) return true;
    if (targetKey === 'RIGHT' && (eventKey === 'ARROWRIGHT' || eventCode === 'RIGHT')) return true;
    if (targetKey === 'PLUS' && (eventKey === '+' || eventCode === 'PLUS')) return true;
    if (targetKey === 'MINUS' && (eventKey === '-' || eventCode === 'MINUS')) return true;
    if (targetKey === 'SPACE' && (eventKey === ' ' || eventCode === 'SPACE')) return true;

    return eventKey === targetKey || eventCode.toUpperCase() === targetKey;
  }

  // Dynamic window keydown listener for customizable map hotkeys
  window.addEventListener('keydown', (e) => {
    // Only intercept when not typing in text/hotkey recorder fields
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      return;
    }

    const zoomInShortcut = getCookie('shortcut_zoom_in') || 'CommandOrControl+Up';
    const zoomOutShortcut = getCookie('shortcut_zoom_out') || 'CommandOrControl+Down';
    const toggleAirShortcut = getCookie('shortcut_toggle_air') || 'Alt+1';
    const toggleGroundShortcut = getCookie('shortcut_toggle_ground') || 'Alt+2';
    const toggleNavalShortcut = getCookie('shortcut_toggle_naval') || 'Alt+3';
    const toggleBasesShortcut = getCookie('shortcut_toggle_bases') || 'Alt+4';
    const toggleFullscreenShortcut = getCookie('shortcut_toggle_fullscreen') || 'F11';

    if (isHotkeyMatch(e, zoomInShortcut)) {
      e.preventDefault();
      zoom = Math.min(50.0, zoom * 1.15);
      drawMap();
    } else if (isHotkeyMatch(e, zoomOutShortcut)) {
      e.preventDefault();
      zoom = Math.max(1.0, zoom / 1.15);
      drawMap();
    } else if (isHotkeyMatch(e, toggleAirShortcut)) {
      e.preventDefault();
      document.getElementById('btn-toggle-type-air')?.click();
    } else if (isHotkeyMatch(e, toggleGroundShortcut)) {
      e.preventDefault();
      document.getElementById('btn-toggle-type-ground')?.click();
    } else if (isHotkeyMatch(e, toggleNavalShortcut)) {
      e.preventDefault();
      document.getElementById('btn-toggle-type-naval')?.click();
    } else if (isHotkeyMatch(e, toggleBasesShortcut)) {
      e.preventDefault();
      document.getElementById('btn-toggle-type-bases')?.click();
    } else if (isHotkeyMatch(e, toggleFullscreenShortcut)) {
      e.preventDefault();
      if (window.electronAPI && window.electronAPI.isElectron) {
        window.electronAPI.toggleFullscreen();
      } else {
        toggleFullscreen();
      }
    }
  });

  // Telemetry loop - 10Hz polling
  setInterval(updateTelemetry, 100);

  // Mission loop - slower 5s polling
  setInterval(getMissionName, 5000);

  // Combat log loop - 1Hz polling (safe for Gaijin localhost rate limits)
  setInterval(updateCombatEvents, 1000);

  // Canvas render loop - syncs with browser refresh rate (approx 60Hz)
  function renderLoop() {
    drawMap();

    // Draw 3D Attitude Indicator if the panel is visible and expanded
    const gyro3dPanel = document.getElementById('panel-gyro3d');
    if (gyro3dPanel && !gyro3dPanel.classList.contains('hidden') && !gyro3dPanel.classList.contains('collapsed')) {
      draw3DAttitude(playerPitch, playerRoll);
    }

    // Draw Navigation Compass if the panel is visible and expanded
    const compassPanel = document.getElementById('panel-compass');
    if (compassPanel && !compassPanel.classList.contains('hidden') && !compassPanel.classList.contains('collapsed')) {
      drawCompassHUD();
    }

    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);
}

// Toggle All checkbox controls (Master switch)
const btnToggleAll = document.getElementById('btn-toggle-all');
const checkboxes = ['chk-grid', 'chk-trails', 'chk-names', 'chk-markers'];

function syncToggleAllButton() {
  if (!btnToggleAll) return;
  const anyChecked = checkboxes.some(id => {
    const chk = document.getElementById(id);
    return chk && chk.checked;
  });
  btnToggleAll.textContent = anyChecked ? 'HIDE ALL' : 'SHOW ALL';
}

if (btnToggleAll) {
  btnToggleAll.addEventListener('click', () => {
    const anyChecked = checkboxes.some(id => {
      const chk = document.getElementById(id);
      return chk && chk.checked;
    });

    checkboxes.forEach(id => {
      const chk = document.getElementById(id);
      if (chk) {
        chk.checked = !anyChecked;
        // Dispatch change event to trigger re-renders or checks if needed
        chk.dispatchEvent(new Event('change'));
      }
    });

    btnToggleAll.textContent = anyChecked ? 'SHOW ALL' : 'HIDE ALL';
  });
}

// Bind change listeners to each checkbox to keep master button synced and save cookie state
checkboxes.forEach(id => {
  const chk = document.getElementById(id);
  if (chk) {
    // Restore initial state from cookie on startup
    const savedVal = getCookie(`map_option_${id}`);
    if (savedVal !== '') {
      chk.checked = savedVal === '1';
    }

    chk.addEventListener('change', () => {
      setCookie(`map_option_${id}`, chk.checked ? '1' : '0');
      syncToggleAllButton();
    });
  }
});
syncToggleAllButton();

// Cookie helper methods for persistent HUD configurations
function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

function getCookie(name) {
  return document.cookie.split('; ').reduce((r, v) => {
    const parts = v.split('=');
    return parts[0] === name ? decodeURIComponent(parts[1]) : r;
  }, '');
}

function toggleHudPanel(panelId) {
  const panel = document.getElementById(`panel-${panelId}`);
  const btn = document.getElementById(`btn-toggle-${panelId}`);
  if (!panel || !btn) return;

  const isCollapsed = panel.classList.toggle('collapsed');
  btn.textContent = isCollapsed ? '[+]' : '[-]';

  // Save state in cookies
  setCookie(`collapsed_${panelId}`, isCollapsed ? '1' : '0');
}

// Wire up sub-panel toggles and restore state from cookies
const panelIds = ['stats', 'gyro', 'gyro3d', 'fuel', 'mech', 'engine', 'combat', 'compass', 'radar'];
panelIds.forEach(id => {
  const btn = document.getElementById(`btn-toggle-${id}`);
  if (btn) {
    btn.addEventListener('click', () => toggleHudPanel(id));
  }

  // Restore initial state from cookies
  const cookieVal = getCookie(`collapsed_${id}`);
  if (cookieVal === '1') {
    const panel = document.getElementById(`panel-${id}`);
    const toggleBtn = document.getElementById(`btn-toggle-${id}`);
    if (panel) panel.classList.add('collapsed');
    if (toggleBtn) toggleBtn.textContent = '[+]';
  }
});

// HTML5 Fullscreen API toggle logic for Tactical Map
const mapPanel = document.querySelector('.map-panel');
const btnFullscreen = document.getElementById('btn-fullscreen');

function toggleFullscreen() {
  const isElectron = window.electronAPI && window.electronAPI.isElectron;
  if (isElectron) {
    window.electronAPI.toggleFullscreen();
    return;
  }
  const targetPanel = document.querySelector('.map-panel');
  if (!targetPanel) return;
  if (!document.fullscreenElement) {
    targetPanel.requestFullscreen().catch(err => {
      console.error(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}

if (btnFullscreen && mapPanel) {
  btnFullscreen.addEventListener('click', toggleFullscreen);

  // Watch for HTML5 fullscreen change event to update class names and button text (Web Fallback)
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === mapPanel) {
      btnFullscreen.textContent = 'EXIT FS';
      mapPanel.classList.add('fullscreen-mode');
    } else {
      btnFullscreen.textContent = 'FULLSCREEN';
      mapPanel.classList.remove('fullscreen-mode');
    }
    // Resize map canvas instantly to fill the new screen bounds
    resizeCanvas();
  });
}

// Auto-Center toggle button listener
const btnAutoCenter = document.getElementById('btn-autocenter');
if (btnAutoCenter) {
  // Restore initial autoCenter state from cookie
  const savedAutoCenter = getCookie('autocenter');
  if (savedAutoCenter !== '') {
    autoCenter = savedAutoCenter === '1';
    if (autoCenter) {
      btnAutoCenter.classList.add('active');
      btnAutoCenter.textContent = 'CENTER: ON';
    } else {
      btnAutoCenter.classList.remove('active');
      btnAutoCenter.textContent = 'CENTER: OFF';
    }
  }

  btnAutoCenter.addEventListener('click', () => {
    autoCenter = !autoCenter;
    if (autoCenter) {
      btnAutoCenter.classList.add('active');
      btnAutoCenter.textContent = 'CENTER: ON';
    } else {
      btnAutoCenter.classList.remove('active');
      btnAutoCenter.textContent = 'CENTER: OFF';
    }
    setCookie('autocenter', autoCenter ? '1' : '0');
  });
}

// Settings Modal Interactivity
const settingsModal = document.getElementById('settings-modal');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const themeOptions = document.querySelectorAll('.theme-option');

// Open HUD window button event listener
const btnOpenHud = document.getElementById('btn-open-hud');
if (window.electronAPI && window.electronAPI.isElectron) {
  if (btnOpenHud) {
    btnOpenHud.style.display = 'inline-flex';
    btnOpenHud.style.alignItems = 'center';
    btnOpenHud.style.justifyContent = 'center';
    btnOpenHud.addEventListener('click', () => {
      window.electronAPI.openSecondaryWindow();
    });
  }
}

let activeTheme = getCookie('theme') || 'cyan';
symbolTheme = getCookie('symbol_theme') || 'standard';
structTheme = getCookie('struct_theme') || 'cyber';

// Apply theme class to body
function applyTheme(theme) {
  // Remove existing themes
  document.body.classList.remove('theme-cyan', 'theme-green', 'theme-amber', 'theme-red', 'theme-stealth', 'theme-blue', 'theme-purple', 'theme-forest', 'theme-warthunder');
  // Add selected theme
  document.body.classList.add(`theme-${theme}`);
}

function applyStructTheme(struct) {
  document.body.classList.remove('struct-cyber', 'struct-tactical', 'struct-retro', 'struct-steampunk', 'struct-xeno', 'struct-warthunder');
  document.body.classList.add(`struct-${struct}`);
}

// Initial theme application
applyTheme(activeTheme);
applyStructTheme(structTheme);

if (btnSettings && settingsModal) {
  btnSettings.addEventListener('click', () => {
    // Sync active option in the modal to match activeTheme
    themeOptions.forEach(opt => {
      if (opt.getAttribute('data-theme') === activeTheme) {
        opt.classList.add('active');
      } else {
        opt.classList.remove('active');
      }
    });

    // Sync active symbol option in the modal to match symbolTheme
    const symbolOptions = document.querySelectorAll('.symbol-option');
    symbolOptions.forEach(opt => {
      if (opt.getAttribute('data-symbol') === symbolTheme) {
        opt.classList.add('active');
      } else {
        opt.classList.remove('active');
      }
    });

    // Sync active structural option in the modal to match structTheme
    const structOptions = document.querySelectorAll('.struct-option');
    structOptions.forEach(opt => {
      if (opt.getAttribute('data-struct') === structTheme) {
        opt.classList.add('active');
        opt.style.borderColor = 'var(--color-border)';
      } else {
        opt.classList.remove('active');
        opt.style.borderColor = 'rgba(255,255,255,0.1)';
      }
    });

    // Sync panel checkboxes with current visibility status
    panelCheckboxIds.forEach(id => {
      const panel = document.getElementById(`panel-${id}`);
      const chk = document.getElementById(`chk-panel-${id}`);
      if (panel && chk) {
        chk.checked = !panel.classList.contains('hidden');
      }
    });

    // Sync sub-element checkboxes with current visibility status
    subCheckboxIds.forEach(id => {
      const element = getSubElement(id);
      const chk = document.getElementById(`chk-sub-${id}`);
      if (element && chk) {
        chk.checked = !element.classList.contains('hidden');
      }
    });

    settingsModal.classList.add('open');
  });
}

if (btnCloseSettings && settingsModal) {
  btnCloseSettings.addEventListener('click', () => {
    settingsModal.classList.remove('open');
  });
}

// Close settings if clicked outside modal body
window.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.remove('open');
  }
});

// Select a theme inside the modal grid
themeOptions.forEach(opt => {
  opt.addEventListener('click', () => {
    themeOptions.forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
  });
});

// Select a symbol theme inside the modal grid
const symbolOptions = document.querySelectorAll('.symbol-option');
symbolOptions.forEach(opt => {
  opt.addEventListener('click', () => {
    symbolOptions.forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
  });
});

// Select a structural theme inside the modal grid
const structOptions = document.querySelectorAll('.struct-option');
structOptions.forEach(opt => {
  opt.addEventListener('click', () => {
    structOptions.forEach(o => {
      o.classList.remove('active');
      o.style.borderColor = 'rgba(255,255,255,0.1)';
    });
    opt.classList.add('active');
    opt.style.borderColor = 'var(--color-border)';
  });
});

// Apply changes button click
if (btnSaveSettings && settingsModal) {
  btnSaveSettings.addEventListener('click', () => {
    const selectedOpt = document.querySelector('.theme-option.active');
    if (selectedOpt) {
      activeTheme = selectedOpt.getAttribute('data-theme');
      applyTheme(activeTheme);
      setCookie('theme', activeTheme);
    }

    const selectedSymbolOpt = document.querySelector('.symbol-option.active');
    if (selectedSymbolOpt) {
      symbolTheme = selectedSymbolOpt.getAttribute('data-symbol');
      setCookie('symbol_theme', symbolTheme);
    }

    const selectedStructOpt = document.querySelector('.struct-option.active');
    if (selectedStructOpt) {
      structTheme = selectedStructOpt.getAttribute('data-struct');
      applyStructTheme(structTheme);
      setCookie('struct_theme', structTheme);
    }

    // Save panel visibility configuration
    savePanelVisibility();

    // Save global hotkeys
    const zoomInVal = document.getElementById('ipt-hotkey-zoom-in')?.value || '';
    const zoomOutVal = document.getElementById('ipt-hotkey-zoom-out')?.value || '';
    const toggleAirVal = document.getElementById('ipt-hotkey-toggle-air')?.value || '';
    const toggleGroundVal = document.getElementById('ipt-hotkey-toggle-ground')?.value || '';
    const toggleNavalVal = document.getElementById('ipt-hotkey-toggle-naval')?.value || '';
    const toggleBasesVal = document.getElementById('ipt-hotkey-toggle-bases')?.value || '';
    const toggleFullscreenVal = document.getElementById('ipt-hotkey-toggle-fullscreen')?.value || '';

    setCookie('shortcut_zoom_in', zoomInVal, 365);
    setCookie('shortcut_zoom_out', zoomOutVal, 365);
    setCookie('shortcut_toggle_air', toggleAirVal, 365);
    setCookie('shortcut_toggle_ground', toggleGroundVal, 365);
    setCookie('shortcut_toggle_naval', toggleNavalVal, 365);
    setCookie('shortcut_toggle_bases', toggleBasesVal, 365);
    setCookie('shortcut_toggle_fullscreen', toggleFullscreenVal, 365);

    // Save joystick configurations
    const joyItems = [
      { id: 'ipt-joy-zoom-in' },
      { id: 'ipt-joy-zoom-out' },
      { id: 'ipt-joy-toggle-air' },
      { id: 'ipt-joy-toggle-ground' },
      { id: 'ipt-joy-toggle-naval' },
      { id: 'ipt-joy-toggle-bases' },
      { id: 'ipt-joy-toggle-fullscreen' }
    ];

    joyItems.forEach(item => {
      const el = document.getElementById(item.id);
      if (el) {
        const val = el.value;
        const joyName = el.getAttribute('data-joy-name') || '';
        const joyBtn = el.getAttribute('data-joy-button') || '';

        setCookie(item.id.replace('ipt-', 'shortcut_'), val, 365);
        setCookie(item.id.replace('ipt-', 'joy_name_'), joyName, 365);
        setCookie(item.id.replace('ipt-', 'joy_btn_'), joyBtn, 365);
      }
    });

    const isElectron = window.electronAPI && window.electronAPI.isElectron;
    if (isElectron) {
      window.electronAPI.registerZoomShortcut({
        shortcutZoomIn: zoomInVal,
        shortcutZoomOut: zoomOutVal,
        shortcutToggleAir: toggleAirVal,
        shortcutToggleGround: toggleGroundVal,
        shortcutToggleNaval: toggleNavalVal,
        shortcutToggleBases: toggleBasesVal,
        shortcutToggleFullscreen: toggleFullscreenVal
      });
    }

    settingsModal.classList.remove('open');
  });
}

// Drag and Drop Grid Layout Logic
const draggables = document.querySelectorAll('[draggable="true"]');
const dragZones = document.querySelectorAll('.drag-drop-zone');

let draggedElement = null;
const dragPlaceholder = document.createElement('div');
dragPlaceholder.className = 'drag-placeholder';

draggables.forEach(draggable => {
  draggable.addEventListener('dragstart', (e) => {
    draggedElement = draggable;
    draggable.classList.add('dragging');
    document.querySelector('.hud-main')?.classList.add('dragging-active');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggable.id);
  });

  draggable.addEventListener('dragend', () => {
    draggedElement = null;
    draggable.classList.remove('dragging');
    document.querySelector('.hud-main')?.classList.remove('dragging-active');
    if (dragPlaceholder.parentNode) {
      dragPlaceholder.parentNode.removeChild(dragPlaceholder);
    }
    saveLayoutConfig();
  });
});

dragZones.forEach(zone => {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(zone, e.clientY);
    if (afterElement == null) {
      zone.appendChild(dragPlaceholder);
    } else {
      zone.insertBefore(dragPlaceholder, afterElement);
    }
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (draggedElement) {
      const afterElement = getDragAfterElement(zone, e.clientY);
      if (afterElement == null) {
        zone.appendChild(draggedElement);
      } else {
        zone.insertBefore(draggedElement, afterElement);
      }
    }
  });
});

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('[draggable="true"]:not(.dragging), .map-panel:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateSidebarsVisibility() {
  // Right Sidebar
  const sidebarPanelRight = document.getElementById('right-sidebar-panel');
  const sidebarRight = document.getElementById('drop-zone-right-sidebar');
  if (sidebarPanelRight && sidebarRight) {
    const hasWidgetsRight = sidebarRight.querySelectorAll('.hud-sub-panel').length > 0;
    if (!hasWidgetsRight) {
      sidebarPanelRight.classList.add('empty');
    } else {
      sidebarPanelRight.classList.remove('empty');
    }
  }

  // Left Sidebar
  const sidebarPanelLeft = document.querySelector('.hud-panel.left-panel');
  const sidebarLeft = document.getElementById('drop-zone-left');
  if (sidebarPanelLeft && sidebarLeft) {
    const hasWidgetsLeft = sidebarLeft.querySelectorAll('.hud-sub-panel').length > 0;
    if (!hasWidgetsLeft) {
      sidebarPanelLeft.classList.add('empty');
    } else {
      sidebarPanelLeft.classList.remove('empty');
    }
  }
}

function saveLayoutConfig() {
  const leftZone = document.getElementById('drop-zone-left');
  const rightZone = document.getElementById('drop-zone-right');
  const sidebarRightZone = document.getElementById('drop-zone-right-sidebar');
  if (!leftZone || !rightZone || !sidebarRightZone) return;

  const layout = {
    left: Array.from(leftZone.children)
      .map(child => child.id)
      .filter(id => id),
    right: Array.from(rightZone.children)
      .map(child => child.id)
      .filter(id => id),
    rightSidebar: Array.from(sidebarRightZone.children)
      .map(child => child.id)
      .filter(id => id)
  };
  setCookie('layout_config', JSON.stringify(layout));
  updateSidebarsVisibility();
}

function restoreLayoutConfig() {
  const configStr = getCookie('layout_config');
  const leftZone = document.getElementById('drop-zone-left');
  const rightZone = document.getElementById('drop-zone-right');
  const sidebarRightZone = document.getElementById('drop-zone-right-sidebar');

  // Collect all draggable sub-panels in a map
  const elementsMap = {};
  const ids = ['panel-stats', 'panel-gyro', 'panel-gyro3d', 'panel-fuel', 'panel-mech', 'panel-engine', 'panel-combat', 'panel-compass', 'panel-radar'];
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
          if (el) {
            leftZone.appendChild(el);
            delete elementsMap[id];
          }
        });
      }

      if (layout.right && rightZone) {
        layout.right.forEach(id => {
          const el = elementsMap[id];
          if (el) {
            rightZone.appendChild(el);
            delete elementsMap[id];
          }
        });
      }

      if (layout.rightSidebar && sidebarRightZone) {
        layout.rightSidebar.forEach(id => {
          const el = elementsMap[id];
          if (el) {
            sidebarRightZone.appendChild(el);
            delete elementsMap[id];
          }
        });
      }

    } catch (err) {
      console.error('Failed to restore layout config:', err);
    }
  }

  // Safe fallback for unplaced elements
  Object.keys(elementsMap).forEach(id => {
    const el = elementsMap[id];
    if (id === 'panel-combat' || id === 'panel-map') {
      if (rightZone) rightZone.appendChild(el);
    } else {
      if (leftZone) leftZone.appendChild(el);
    }
  });

  updateSidebarsVisibility();
}

// 3D Plane Vertices (Simplified Fighter Jet silhouette)
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

// Draw real-time 3D flight attitude wireframe indicator
function draw3DAttitude(pitchDeg, rollDeg) {
  if (!canvas3d || !ctx3d) return;

  // Clear canvas
  ctx3d.clearRect(0, 0, canvas3d.width, canvas3d.height);

  const cx = canvas3d.width / 2;
  const cy = canvas3d.height / 2;
  const r = 110; // Sphere radius inside bezel

  // Convert to radians (negate pitch to match standard nose rotation coordinate direction)
  const pitchRad = (-pitchDeg * Math.PI) / 180;
  const rollRad = (rollDeg * Math.PI) / 180;

  const themeMain = getComputedStyle(document.body).getPropertyValue('--color-text-main').trim() || '#00ffc4';
  const themeBorder = getComputedStyle(document.body).getPropertyValue('--color-border').trim() || 'rgba(0, 240, 255, 0.2)';
  const themeDim = getComputedStyle(document.body).getPropertyValue('--color-text-dim').trim() || '#7f9bb3';

  // Dynamic sky/ground colors based on active theme
  let skyColorStart = '#1a3c61';
  let skyColorEnd = '#3569a1';
  let groundColorStart = '#543821';
  let groundColorEnd = '#331d0d';
  
  const activeTheme = getCookie('theme') || 'cyan';
  if (activeTheme === 'green' || activeTheme === 'cyan') {
    skyColorStart = '#02181b';
    skyColorEnd = '#064249';
    groundColorStart = '#1d1102';
    groundColorEnd = '#090500';
  } else if (activeTheme === 'warthunder' || activeTheme === 'forest') {
    skyColorStart = '#2b3c32';
    skyColorEnd = '#4d6455';
    groundColorStart = '#3c2c1e';
    groundColorEnd = '#241a12';
  } else if (activeTheme === 'red') {
    skyColorStart = '#2b060f';
    skyColorEnd = '#5c1022';
    groundColorStart = '#201014';
    groundColorEnd = '#0b0406';
  } else if (activeTheme === 'purple') {
    skyColorStart = '#25083a';
    skyColorEnd = '#48196e';
    groundColorStart = '#1d0c24';
    groundColorEnd = '#0b030f';
  }

  // 1. Draw Sphere (clipped to r)
  ctx3d.save();
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx3d.clip();

  // Sphere transformations
  ctx3d.save();
  ctx3d.translate(cx, cy);
  ctx3d.rotate(-rollRad); // Horizon rolls in the opposite direction of the plane
  const pitchOffset = pitchDeg * 2.8; // scale factor for pitch translation
  ctx3d.translate(0, pitchOffset);

  // Draw Sky half
  const skyG = ctx3d.createLinearGradient(0, -300, 0, 0);
  skyG.addColorStop(0, skyColorStart);
  skyG.addColorStop(1, skyColorEnd);
  ctx3d.fillStyle = skyG;
  ctx3d.fillRect(-300, -300, 600, 300);

  // Draw Ground half
  const groundG = ctx3d.createLinearGradient(0, 0, 0, 300);
  groundG.addColorStop(0, groundColorStart);
  groundG.addColorStop(1, groundColorEnd);
  ctx3d.fillStyle = groundG;
  ctx3d.fillRect(-300, 0, 600, 300);

  // Draw main horizon bar
  ctx3d.strokeStyle = '#ffffff';
  ctx3d.lineWidth = 2.5;
  ctx3d.beginPath();
  ctx3d.moveTo(-300, 0);
  ctx3d.lineTo(300, 0);
  ctx3d.stroke();

  // Draw parallel grid lines & degree values
  ctx3d.fillStyle = 'rgba(255,255,255,0.7)';
  ctx3d.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx3d.font = 'bold 9px "Roboto", "Segoe UI", sans-serif';
  ctx3d.textAlign = 'center';
  ctx3d.textBaseline = 'middle';

  for (let y = -80; y <= 80; y += 10) {
    if (y === 0) continue;
    const yPos = -y * 2.8;
    ctx3d.lineWidth = 1.2;
    ctx3d.beginPath();
    
    // Draw solid/dashed ticks based on positive/negative pitch
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

    // Labels
    ctx3d.fillText(Math.abs(y), -w - 12, yPos);
    ctx3d.fillText(Math.abs(y), w + 12, yPos);
  }
  ctx3d.restore();

  // Draw internal bevel shadow overlay for 3D look
  const radShad = ctx3d.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
  radShad.addColorStop(0, 'rgba(0,0,0,0)');
  radShad.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx3d.fillStyle = radShad;
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx3d.fill();

  // Glass glare effect overlay
  const glare = ctx3d.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  glare.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
  glare.addColorStop(0.35, 'rgba(255, 255, 255, 0.05)');
  glare.addColorStop(0.36, 'rgba(255, 255, 255, 0.0)');
  glare.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  ctx3d.fillStyle = glare;
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx3d.fill();

  ctx3d.restore(); // ends clipping

  // 2. Draw outer metal bezel frame
  ctx3d.lineWidth = 14;
  ctx3d.strokeStyle = '#22272e'; // Casing steel grey
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, r + 7, 0, 2 * Math.PI);
  ctx3d.stroke();

  // Bezel highlight rings
  ctx3d.lineWidth = 1.2;
  ctx3d.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx3d.stroke();
  ctx3d.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, r + 14, 0, 2 * Math.PI);
  ctx3d.stroke();

  // Screws on the bezel
  const screwAngles = [Math.PI/4, 3*Math.PI/4, 5*Math.PI/4, 7*Math.PI/4];
  screwAngles.forEach(ang => {
    const sx = cx + Math.cos(ang) * (r + 7);
    const sy = cy + Math.sin(ang) * (r + 7);
    
    // Screw circle
    ctx3d.fillStyle = '#444c56';
    ctx3d.beginPath();
    ctx3d.arc(sx, sy, 3.8, 0, 2 * Math.PI);
    ctx3d.fill();
    
    // Screw notch
    ctx3d.strokeStyle = '#1c2128';
    ctx3d.lineWidth = 1.2;
    ctx3d.beginPath();
    ctx3d.moveTo(sx - 2.2, sy - 0.8);
    ctx3d.lineTo(sx + 2.2, sy + 0.8);
    ctx3d.stroke();
  });

  // 3. Draw Bank Scale Angle ticks on Bezel
  const bankAngles = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
  ctx3d.strokeStyle = themeBorder;
  ctx3d.fillStyle = themeMain;
  ctx3d.font = '8px "Courier New", monospace';
  ctx3d.textAlign = 'center';
  ctx3d.textBaseline = 'bottom';
  
  bankAngles.forEach(a => {
    const rad = (a * Math.PI) / 180 - Math.PI / 2;
    const x1 = cx + Math.cos(rad) * r;
    const y1 = cy + Math.sin(rad) * r;
    const x2 = cx + Math.cos(rad) * (r - 7);
    const y2 = cy + Math.sin(rad) * (r - 7);
    
    ctx3d.lineWidth = a === 0 ? 2 : 1;
    ctx3d.beginPath();
    ctx3d.moveTo(x1, y1);
    ctx3d.lineTo(x2, y2);
    ctx3d.stroke();
    
    // Degree texts
    if (Math.abs(a) === 30 || Math.abs(a) === 60 || a === 0) {
      const tx = cx + Math.cos(rad) * (r - 14);
      const ty = cy + Math.sin(rad) * (r - 14);
      ctx3d.save();
      ctx3d.translate(tx, ty);
      ctx3d.rotate(rad + Math.PI/2);
      ctx3d.fillText(Math.abs(a), 0, 0);
      ctx3d.restore();
    }
  });

  // Rotating bank pointer index
  ctx3d.save();
  ctx3d.translate(cx, cy);
  ctx3d.rotate(-rollRad);
  ctx3d.fillStyle = '#ffaa00';
  ctx3d.beginPath();
  ctx3d.moveTo(0, -r + 1);
  ctx3d.lineTo(-5, -r + 9);
  ctx3d.lineTo(5, -r + 9);
  ctx3d.closePath();
  ctx3d.fill();
  ctx3d.restore();

  // 4. Draw projected 3D aircraft wireframe overlay
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
    const z2 = z1;

    // Projection
    const px = cx + (x2 * distance) / (distance + z2) * scale;
    const py = cy - (y2 * distance) / (distance + z2) * scale;
    return { x: px, y: py };
  });

  ctx3d.strokeStyle = '#ffffff';
  ctx3d.shadowColor = '#ffffff';
  ctx3d.shadowBlur = 3;
  ctx3d.lineWidth = 1.8;

  planeEdges.forEach(edge => {
    const p1 = projectedPoints[edge[0]];
    const p2 = projectedPoints[edge[1]];
    ctx3d.beginPath();
    ctx3d.moveTo(p1.x, p1.y);
    ctx3d.lineTo(p2.x, p2.y);
    ctx3d.stroke();
  });

  ctx3d.shadowBlur = 0; // reset

  // 5. Draw stationary instrument aircraft reference pointer bar (yellow)
  ctx3d.strokeStyle = '#ffb703';
  ctx3d.lineWidth = 3.5;
  ctx3d.beginPath();
  // Left wing reference
  ctx3d.moveTo(cx - 50, cy);
  ctx3d.lineTo(cx - 20, cy);
  ctx3d.lineTo(cx - 20, cy + 6);
  // Right wing reference
  ctx3d.moveTo(cx + 50, cy);
  ctx3d.lineTo(cx + 20, cy);
  ctx3d.lineTo(cx + 20, cy + 6);
  ctx3d.stroke();

  // Fuselage central dot
  ctx3d.fillStyle = '#ffb703';
  ctx3d.beginPath();
  ctx3d.arc(cx, cy, 4.5, 0, 2 * Math.PI);
  ctx3d.fill();
}

// Panel Visibility Configurations
const panelCheckboxIds = ['stats', 'gyro', 'gyro3d', 'fuel', 'mech', 'engine', 'combat', 'compass', 'radar'];
const subCheckboxIds = ['spd', 'tas', 'alt', 'climb', 'thr', 'gload', 'aoa', 'mach', 'gear', 'flaps', 'airbrake', 'rpm', 'oil', 'water', 'fuel'];
const compassCheckboxIds = ['threats', 'enemies', 'friendlies', 'zones', 'bases', 'airfields'];

const alertTypes = ['fuel', 'merge', 'lock', 'overheat', 'failure', 'gpws'];

function isAlertSoundEnabled(type) {
  const chk = document.getElementById(`chk-alert-sound-${type}`);
  return chk ? chk.checked : true;
}

function isAlertTtsEnabled(type) {
  const chk = document.getElementById(`chk-alert-tts-${type}`);
  return chk ? chk.checked : true;
}

function getSubElement(id) {
  return document.getElementById(`card-${id}`) || document.getElementById(`mech-${id}`) || document.getElementById(`row-${id}`);
}

function savePanelVisibility() {
  const visibility = {};

  // 1. Save Main Panels
  panelCheckboxIds.forEach(id => {
    const chk = document.getElementById(`chk-panel-${id}`);
    if (chk) {
      visibility[id] = chk.checked ? 1 : 0;
      const panel = document.getElementById(`panel-${id}`);
      if (panel) {
        if (chk.checked) {
          panel.classList.remove('hidden');
        } else {
          panel.classList.add('hidden');
        }
      }
    }
  });
  setCookie('visible_panels', JSON.stringify(visibility));

  // 2. Save Sub-Elements
  const subVisibility = {};
  subCheckboxIds.forEach(id => {
    const chk = document.getElementById(`chk-sub-${id}`);
    if (chk) {
      subVisibility[id] = chk.checked ? 1 : 0;
      const element = getSubElement(id);
      if (element) {
        if (chk.checked) {
          element.classList.remove('hidden');
        } else {
          element.classList.add('hidden');
        }
      }
    }
  });
  setCookie('visible_sub_elements', JSON.stringify(subVisibility));

  // 3. Save Show Speeds Setting
  const chkShowSpeeds = document.getElementById('chk-show-speeds');
  if (chkShowSpeeds) {
    setCookie('show_aircraft_speeds', chkShowSpeeds.checked ? '1' : '0');
  }

  const chkShowFighters = document.getElementById('chk-show-fighters');
  if (chkShowFighters) {
    setCookie('show_fighters_on_map', chkShowFighters.checked ? '1' : '0');
  }

  // Save Threat Alerts Setting
  const selThreatStyle = document.getElementById('sel-threat-style');
  if (selThreatStyle) {
    setCookie('threat_alert_style', selThreatStyle.value);
  }
  // Save warning alerts settings (Sound & TTS)
  alertTypes.forEach(type => {
    const chkSound = document.getElementById(`chk-alert-sound-${type}`);
    if (chkSound) {
      setCookie(`alert_sound_${type}`, chkSound.checked ? '1' : '0');
    }
    const chkTts = document.getElementById(`chk-alert-tts-${type}`);
    if (chkTts) {
      setCookie(`alert_tts_${type}`, chkTts.checked ? '1' : '0');
    }
  });

  // 4. Save Compass Elements Setting
  const compassVisibility = {};
  compassCheckboxIds.forEach(id => {
    const chk = document.getElementById(`chk-compass-${id}`);
    if (chk) {
      compassVisibility[id] = chk.checked ? 1 : 0;
    }
  });
  setCookie('visible_compass_elements', JSON.stringify(compassVisibility));

  // Trigger window resize update to keep square canvas layout intact
  setTimeout(resizeCanvas, 100);
}

function restorePanelVisibility() {
  // 1. Restore Main Panels
  const cookieStr = getCookie('visible_panels');
  let visibility = {};
  if (cookieStr) {
    try {
      visibility = JSON.parse(cookieStr);
    } catch (e) {
      console.error('Failed to parse visible_panels cookie:', e);
    }
  }

  panelCheckboxIds.forEach(id => {
    const isVisible = visibility[id] !== undefined ? visibility[id] === 1 : true;
    const chk = document.getElementById(`chk-panel-${id}`);
    if (chk) chk.checked = isVisible;
    const panel = document.getElementById(`panel-${id}`);
    if (panel) {
      if (isVisible) {
        panel.classList.remove('hidden');
      } else {
        panel.classList.add('hidden');
      }
    }
  });

  // 2. Restore Sub-Elements
  const subCookieStr = getCookie('visible_sub_elements');
  let subVisibility = {};
  if (subCookieStr) {
    try {
      subVisibility = JSON.parse(subCookieStr);
    } catch (e) {
      console.error('Failed to parse visible_sub_elements cookie:', e);
    }
  }

  subCheckboxIds.forEach(id => {
    const isVisible = subVisibility[id] !== undefined ? subVisibility[id] === 1 : true;
    const chk = document.getElementById(`chk-sub-${id}`);
    if (chk) chk.checked = isVisible;
    const element = getSubElement(id);
    if (element) {
      if (isVisible) {
        element.classList.remove('hidden');
      } else {
        element.classList.add('hidden');
      }
    }
  });

  // 3. Restore Show Speeds Setting
  const savedShowSpeeds = getCookie('show_aircraft_speeds');
  const chkShowSpeeds = document.getElementById('chk-show-speeds');
  if (chkShowSpeeds) {
    chkShowSpeeds.checked = savedShowSpeeds !== '0'; // default true
  }

  const savedShowFighters = getCookie('show_fighters_on_map');
  const chkShowFighters = document.getElementById('chk-show-fighters');
  if (chkShowFighters) {
    chkShowFighters.checked = savedShowFighters !== '0'; // default true
  }

  // Restore Threat Alerts Setting
  const savedThreatStyle = getCookie('threat_alert_style');
  const selThreatStyle = document.getElementById('sel-threat-style');
  if (selThreatStyle) {
    selThreatStyle.value = savedThreatStyle || 'both'; // default 'both'
  }
  // Restore warning alerts settings (Sound & TTS)
  alertTypes.forEach(type => {
    const chkSound = document.getElementById(`chk-alert-sound-${type}`);
    if (chkSound) {
      const val = getCookie(`alert_sound_${type}`);
      chkSound.checked = val !== '0'; // default true
    }
    const chkTts = document.getElementById(`chk-alert-tts-${type}`);
    if (chkTts) {
      const val = getCookie(`alert_tts_${type}`);
      chkTts.checked = val !== '0'; // default true
    }
  });

  // 4. Restore Compass Elements Setting
  const compassCookieStr = getCookie('visible_compass_elements');
  let compassVisibility = {};
  if (compassCookieStr) {
    try {
      compassVisibility = JSON.parse(compassCookieStr);
    } catch (e) {
      console.error('Failed to parse visible_compass_elements cookie:', e);
    }
  }

  compassCheckboxIds.forEach(id => {
    const isVisible = compassVisibility[id] !== undefined ? compassVisibility[id] === 1 : true;
    const chk = document.getElementById(`chk-compass-${id}`);
    if (chk) chk.checked = isVisible;
  });
}

function initGlobalHotkeys() {
  const isElectron = window.electronAPI && window.electronAPI.isElectron;
  const hotkeySection = document.getElementById('section-global-hotkeys');
  const fallbackSection = document.getElementById('section-web-hotkeys-fallback');

  if (isElectron) {
    if (hotkeySection) hotkeySection.style.display = 'block';
    if (fallbackSection) fallbackSection.style.display = 'none';
  } else {
    if (hotkeySection) hotkeySection.style.display = 'none';
    if (fallbackSection) fallbackSection.style.display = 'block';
  }

  const iptZoomIn = document.getElementById('ipt-hotkey-zoom-in');
  const iptZoomOut = document.getElementById('ipt-hotkey-zoom-out');
  const iptToggleAir = document.getElementById('ipt-hotkey-toggle-air');
  const iptToggleGround = document.getElementById('ipt-hotkey-toggle-ground');
  const iptToggleNaval = document.getElementById('ipt-hotkey-toggle-naval');
  const iptToggleBases = document.getElementById('ipt-hotkey-toggle-bases');
  const iptToggleFullscreen = document.getElementById('ipt-hotkey-toggle-fullscreen');

  const iptJoyZoomIn = document.getElementById('ipt-joy-zoom-in');
  const iptJoyZoomOut = document.getElementById('ipt-joy-zoom-out');
  const iptJoyToggleAir = document.getElementById('ipt-joy-toggle-air');
  const iptJoyToggleGround = document.getElementById('ipt-joy-toggle-ground');
  const iptJoyToggleNaval = document.getElementById('ipt-joy-toggle-naval');
  const iptJoyToggleBases = document.getElementById('ipt-joy-toggle-bases');
  const iptJoyToggleFullscreen = document.getElementById('ipt-joy-toggle-fullscreen');

  // Load existing shortcuts or set defaults
  const zoomInShortcut = getCookie('shortcut_zoom_in') || 'CommandOrControl+Up';
  const zoomOutShortcut = getCookie('shortcut_zoom_out') || 'CommandOrControl+Down';
  const toggleAirShortcut = getCookie('shortcut_toggle_air') || 'Alt+1';
  const toggleGroundShortcut = getCookie('shortcut_toggle_ground') || 'Alt+2';
  const toggleNavalShortcut = getCookie('shortcut_toggle_naval') || 'Alt+3';
  const toggleBasesShortcut = getCookie('shortcut_toggle_bases') || 'Alt+4';
  const toggleFullscreenShortcut = getCookie('shortcut_toggle_fullscreen') || 'F11';

  if (iptZoomIn) iptZoomIn.value = zoomInShortcut;
  if (iptZoomOut) iptZoomOut.value = zoomOutShortcut;
  if (iptToggleAir) iptToggleAir.value = toggleAirShortcut;
  if (iptToggleGround) iptToggleGround.value = toggleGroundShortcut;
  if (iptToggleNaval) iptToggleNaval.value = toggleNavalShortcut;
  if (iptToggleBases) iptToggleBases.value = toggleBasesShortcut;
  if (iptToggleFullscreen) iptToggleFullscreen.value = toggleFullscreenShortcut;

  // Helper to format joystick product names
  function formatJoystickName(name) {
    if (!name) return 'Joystick';
    let clean = name.trim();
    if (clean.toLowerCase().includes('warthog throttle')) return 'Warthog Throttle';
    if (clean.toLowerCase().includes('warthog stick') || clean.toLowerCase().includes('warthog joystick')) return 'Warthog Stick';
    if (clean.toLowerCase().includes('warthog')) return 'Warthog';
    if (clean.toLowerCase().includes('t.16000m')) return 'T.16000M';
    if (clean.toLowerCase().includes('thrustmaster')) return 'Thrustmaster';
    return clean.split(/[()]/)[0].trim().substring(0, 12);
  }

  // Load joystick bindings from cookies
  const joyInputs = [
    { id: 'ipt-joy-zoom-in', action: 'zoom_in' },
    { id: 'ipt-joy-zoom-out', action: 'zoom_out' },
    { id: 'ipt-joy-toggle-air', action: 'toggle_air' },
    { id: 'ipt-joy-toggle-ground', action: 'toggle_ground' },
    { id: 'ipt-joy-toggle-naval', action: 'toggle_naval' },
    { id: 'ipt-joy-toggle-bases', action: 'toggle_bases' },
    { id: 'ipt-joy-toggle-fullscreen', action: 'toggle_fullscreen' }
  ];

  joyInputs.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) {
      const val = getCookie(item.id.replace('ipt-', 'shortcut_')) || '';
      const joyName = getCookie(item.id.replace('ipt-', 'joy_name_')) || '';
      const joyBtn = getCookie(item.id.replace('ipt-', 'joy_btn_')) || '';
      
      el.value = val;
      if (joyName) el.setAttribute('data-joy-name', joyName);
      if (joyBtn) el.setAttribute('data-joy-button', joyBtn);
    }
  });

  // Track focused joystick input for recording
  let activeJoyInput = null;
  joyInputs.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) {
      el.addEventListener('focus', () => {
        activeJoyInput = el;
        el.value = 'Press Joystick Button...';
        el.style.borderColor = 'var(--color-text-main)';
      });
      el.addEventListener('blur', () => {
        activeJoyInput = null;
        el.style.borderColor = 'var(--color-border)';
        if (el.value === 'Press Joystick Button...') {
          el.value = getCookie(item.id.replace('ipt-', 'shortcut_')) || '';
        }
      });
    }
  });

  // Only proceed with Electron API if running in Electron
  if (isElectron) {
    window.electronAPI.registerZoomShortcut({
      shortcutZoomIn: zoomInShortcut,
      shortcutZoomOut: zoomOutShortcut,
      shortcutToggleAir: toggleAirShortcut,
      shortcutToggleGround: toggleGroundShortcut,
      shortcutToggleNaval: toggleNavalShortcut,
      shortcutToggleBases: toggleBasesShortcut,
      shortcutToggleFullscreen: toggleFullscreenShortcut
    });
  }

  // Add keydown listener to record shortcuts
  function setupHotkeyRecorder(input, cookieName) {
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore naked modifier keys
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      let key = '';
      let code = e.code || '';

      if (code.startsWith('Key')) {
        key = code.replace('Key', '');
      } else if (code.startsWith('Digit')) {
        key = code.replace('Digit', '');
      } else if (code === 'ArrowUp') {
        key = 'Up';
      } else if (code === 'ArrowDown') {
        key = 'Down';
      } else if (code === 'ArrowLeft') {
        key = 'Left';
      } else if (code === 'ArrowRight') {
        key = 'Right';
      } else if (code === 'Space') {
        key = 'Space';
      } else if (code === 'Equal' || code === 'NumpadAdd') {
        key = 'Plus';
      } else if (code === 'Minus' || code === 'NumpadSubtract') {
        key = 'Minus';
      } else if (code === 'Enter') {
        key = 'Enter';
      } else if (code === 'Escape') {
        key = 'Escape';
      } else if (code === 'Tab') {
        key = 'Tab';
      } else if (code === 'Backspace') {
        key = 'Backspace';
      } else if (code === 'Delete') {
        key = 'Delete';
      } else if (code === 'Insert') {
        key = 'Insert';
      } else if (code === 'Home') {
        key = 'Home';
      } else if (code === 'End') {
        key = 'End';
      } else if (code === 'PageUp') {
        key = 'PageUp';
      } else if (code === 'PageDown') {
        key = 'PageDown';
      } else {
        key = e.key;
        if (key.length === 1) {
          key = key.toUpperCase();
        }
      }

      const shortcutStr = parts.join('+');
      input.value = shortcutStr ? `${shortcutStr}+${key}` : key;
    });
  }

  setupHotkeyRecorder(iptZoomIn, 'shortcut_zoom_in');
  setupHotkeyRecorder(iptZoomOut, 'shortcut_zoom_out');
  setupHotkeyRecorder(iptToggleAir, 'shortcut_toggle_air');
  setupHotkeyRecorder(iptToggleGround, 'shortcut_toggle_ground');
  setupHotkeyRecorder(iptToggleNaval, 'shortcut_toggle_naval');
  setupHotkeyRecorder(iptToggleBases, 'shortcut_toggle_bases');
  setupHotkeyRecorder(iptToggleFullscreen, 'shortcut_toggle_fullscreen');

  if (isElectron) {
    // Register IPC zoom triggers
    window.electronAPI.onTriggerZoomIn(() => {
      zoom = Math.min(50.0, zoom * 1.15);
      drawMap();
      console.log('Global Zoom In triggered via shortcut. Zoom level:', zoom.toFixed(2));
    });

    window.electronAPI.onTriggerZoomOut(() => {
      zoom = Math.max(1.0, zoom / 1.15);
      drawMap();
      console.log('Global Zoom Out triggered via shortcut. Zoom level:', zoom.toFixed(2));
    });

    // Register IPC target filters triggers
    window.electronAPI.onTriggerToggleAir(() => {
      document.getElementById('btn-toggle-type-air')?.click();
      console.log('Global Toggle Air targets triggered via shortcut.');
    });

    window.electronAPI.onTriggerToggleGround(() => {
      document.getElementById('btn-toggle-type-ground')?.click();
      console.log('Global Toggle Ground targets triggered via shortcut.');
    });

    window.electronAPI.onTriggerToggleNaval(() => {
      document.getElementById('btn-toggle-type-naval')?.click();
      console.log('Global Toggle Naval targets triggered via shortcut.');
    });

    window.electronAPI.onTriggerToggleBases(() => {
      document.getElementById('btn-toggle-type-bases')?.click();
      console.log('Global Toggle Bases targets triggered via shortcut.');
    });

    window.electronAPI.onTriggerToggleFullscreen(() => {
      toggleFullscreen();
      console.log('Global Toggle Fullscreen triggered via shortcut.');
    });

    window.electronAPI.onElectronFullscreenChanged((isFS) => {
      console.log('Electron fullscreen changed event received:', isFS);
      const btnFs = document.getElementById('btn-fullscreen');
      const panel = document.querySelector('.map-panel');
      if (btnFs) {
        btnFs.textContent = isFS ? 'EXIT FS' : 'FULLSCREEN';
      }
      if (panel) {
        if (isFS) {
          panel.classList.add('fullscreen-mode');
        } else {
          panel.classList.remove('fullscreen-mode');
        }
      }
      resizeCanvas();
    });

    // Unified Joystick Event Handler & HTML5 Gamepad API Polling
    let joyZoomInInterval = null;
    let joyZoomOutInterval = null;

    function isJoystickMatch(evtName, boundName) {
      if (!evtName || !boundName) return false;
      if (evtName === boundName) return true;
      const fEvt = formatJoystickName(evtName).toLowerCase();
      const fBound = formatJoystickName(boundName).toLowerCase();
      if (fEvt === fBound) return true;
      if (evtName.toLowerCase().includes(fBound) || boundName.toLowerCase().includes(fEvt)) return true;
      return false;
    }

    function handleJoyEvent(evt) {
      const { event: type, name, button } = evt;

      if (activeJoyInput) {
        if (type === 'pressed') {
          const formatted = formatJoystickName(name);
          activeJoyInput.value = `${formatted} B${button}`;
          activeJoyInput.setAttribute('data-joy-name', name);
          activeJoyInput.setAttribute('data-joy-button', button);
          activeJoyInput.blur();
        }
        return;
      }

      // Trigger actions when modal is closed
      if (settingsModal && !settingsModal.classList.contains('open')) {
        // Zoom In
        const boundInName = iptJoyZoomIn ? iptJoyZoomIn.getAttribute('data-joy-name') : null;
        const boundInBtn = iptJoyZoomIn ? iptJoyZoomIn.getAttribute('data-joy-button') : null;
        if (isJoystickMatch(name, boundInName) && String(button) === String(boundInBtn)) {
          if (type === 'pressed') {
            if (!joyZoomInInterval) {
              zoom = Math.min(50.0, zoom * 1.15);
              drawMap();
              joyZoomInInterval = setInterval(() => {
                zoom = Math.min(50.0, zoom * 1.05);
                drawMap();
              }, 80);
            }
          } else if (type === 'released') {
            if (joyZoomInInterval) {
              clearInterval(joyZoomInInterval);
              joyZoomInInterval = null;
            }
          }
        }

        // Zoom Out
        const boundOutName = iptJoyZoomOut ? iptJoyZoomOut.getAttribute('data-joy-name') : null;
        const boundOutBtn = iptJoyZoomOut ? iptJoyZoomOut.getAttribute('data-joy-button') : null;
        if (isJoystickMatch(name, boundOutName) && String(button) === String(boundOutBtn)) {
          if (type === 'pressed') {
            if (!joyZoomOutInterval) {
              zoom = Math.max(1.0, zoom / 1.15);
              drawMap();
              joyZoomOutInterval = setInterval(() => {
                zoom = Math.max(1.0, zoom / 1.05);
                drawMap();
              }, 80);
            }
          } else if (type === 'released') {
            if (joyZoomOutInterval) {
              clearInterval(joyZoomOutInterval);
              joyZoomOutInterval = null;
            }
          }
        }

        // Toggles (Only on pressed)
        if (type === 'pressed') {
          // Toggle Air
          const boundAirName = iptJoyToggleAir ? iptJoyToggleAir.getAttribute('data-joy-name') : null;
          const boundAirBtn = iptJoyToggleAir ? iptJoyToggleAir.getAttribute('data-joy-button') : null;
          if (isJoystickMatch(name, boundAirName) && String(button) === String(boundAirBtn)) {
            document.getElementById('btn-toggle-type-air')?.click();
          }

          // Toggle Ground
          const boundGroundName = iptJoyToggleGround ? iptJoyToggleGround.getAttribute('data-joy-name') : null;
          const boundGroundBtn = iptJoyToggleGround ? iptJoyToggleGround.getAttribute('data-joy-button') : null;
          if (isJoystickMatch(name, boundGroundName) && String(button) === String(boundGroundBtn)) {
            document.getElementById('btn-toggle-type-ground')?.click();
          }

          // Toggle Naval
          const boundNavalName = iptJoyToggleNaval ? iptJoyToggleNaval.getAttribute('data-joy-name') : null;
          const boundNavalBtn = iptJoyToggleNaval ? iptJoyToggleNaval.getAttribute('data-joy-button') : null;
          if (isJoystickMatch(name, boundNavalName) && String(button) === String(boundNavalBtn)) {
            document.getElementById('btn-toggle-type-naval')?.click();
          }

          // Toggle Bases
          const boundBasesName = iptJoyToggleBases ? iptJoyToggleBases.getAttribute('data-joy-name') : null;
          const boundBasesBtn = iptJoyToggleBases ? iptJoyToggleBases.getAttribute('data-joy-button') : null;
          if (isJoystickMatch(name, boundBasesName) && String(button) === String(boundBasesBtn)) {
            document.getElementById('btn-toggle-type-bases')?.click();
          }

          // Toggle Fullscreen
          const boundFsName = iptJoyToggleFullscreen ? iptJoyToggleFullscreen.getAttribute('data-joy-name') : null;
          const boundFsBtn = iptJoyToggleFullscreen ? iptJoyToggleFullscreen.getAttribute('data-joy-button') : null;
          if (isJoystickMatch(name, boundFsName) && String(button) === String(boundFsBtn)) {
            if (window.electronAPI && window.electronAPI.isElectron) {
              window.electronAPI.toggleFullscreen();
            } else {
              toggleFullscreen();
            }
          }
        }
      }
    }

    // HTML5 Gamepad API polling (works natively on Linux, Windows & macOS)
    const previousGamepadState = {};
    function pollGamepads() {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : null;
      if (!gamepads) return;

      for (let g = 0; g < gamepads.length; g++) {
        const gp = gamepads[g];
        if (!gp) continue;

        const gpName = gp.id || `Joystick ${gp.index + 1}`;
        for (let b = 0; b < gp.buttons.length; b++) {
          const btn = gp.buttons[b];
          const isPressed = btn ? (btn.pressed || btn.value > 0.5) : false;
          const stateKey = `${gp.index}_${b}`;
          const wasPressed = previousGamepadState[stateKey] || false;

          if (isPressed && !wasPressed) {
            previousGamepadState[stateKey] = true;
            handleJoyEvent({ event: 'pressed', name: gpName, button: b + 1 });
          } else if (!isPressed && wasPressed) {
            previousGamepadState[stateKey] = false;
            handleJoyEvent({ event: 'released', name: gpName, button: b + 1 });
          }
        }
      }
    }
    setInterval(pollGamepads, 20);

    if (isElectron && window.electronAPI && window.electronAPI.onJoyEvent) {
      window.electronAPI.onJoyEvent((evt) => {
        handleJoyEvent(evt);
      });
    }
  }
}

// Settings Modal Tabs Switching Interactivity
const tabButtons = document.querySelectorAll('.settings-tab-btn');
const tabContents = document.querySelectorAll('.settings-tab-content');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class from all buttons
    tabButtons.forEach(b => b.classList.remove('active'));
    // Add active class to clicked button
    btn.classList.add('active');

    // Hide all tab contents and show the selected one
    const targetTabId = btn.getAttribute('data-tab');
    tabContents.forEach(content => {
      if (content.id === targetTabId) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  });
});

function drawCompassHUD() {
  const canvas = document.getElementById('compass-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }
  
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  
  const themeMainColor = getComputedStyle(document.body).getPropertyValue('--color-text-main').trim() || '#00ffc4';
  
  if (!isPlayerAlive || playerX === undefined || playerY === undefined) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '10px Share Tech Mono';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COMPASS STANDBY', width / 2, height / 2);
    ctx.restore();
    return;
  }
  
  // Retrieve settings
  const showThreats = document.getElementById('chk-compass-threats') ? document.getElementById('chk-compass-threats').checked : true;
  const showEnemies = document.getElementById('chk-compass-enemies') ? document.getElementById('chk-compass-enemies').checked : true;
  const showFriendlies = document.getElementById('chk-compass-friendlies') ? document.getElementById('chk-compass-friendlies').checked : true;
  const showZones = document.getElementById('chk-compass-zones') ? document.getElementById('chk-compass-zones').checked : true;
  const showBases = document.getElementById('chk-compass-bases') ? document.getElementById('chk-compass-bases').checked : true;
  const showAirfields = document.getElementById('chk-compass-airfields') ? document.getElementById('chk-compass-airfields').checked : true;

  const FOV = 90 * Math.PI / 180;
  const halfFov = FOV / 2;
  
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  
  const stepDeg = 5;
  const stepRad = stepDeg * Math.PI / 180;
  
  const startAngle = Math.floor((playerHeading - halfFov) / stepRad) * stepRad;
  const endAngle = Math.ceil((playerHeading + halfFov) / stepRad) * stepRad;
  
  for (let angle = startAngle; angle <= endAngle; angle += stepRad) {
    let relAngle = angle - playerHeading;
    while (relAngle < -Math.PI) relAngle += 2 * Math.PI;
    while (relAngle > Math.PI) relAngle -= 2 * Math.PI;
    
    if (Math.abs(relAngle) > halfFov) continue;
    
    const x = width / 2 + (relAngle / FOV) * width;
    let deg = Math.round((angle * 180 / Math.PI)) % 360;
    if (deg < 0) deg += 360;
    
    const isMajor = deg % 30 === 0;
    const isCardinal = deg % 90 === 0;
    const isFive = deg % 10 !== 0;
    
    ctx.beginPath();
    ctx.moveTo(x, height);
    if (isCardinal) {
      ctx.lineTo(x, height - 12);
    } else if (isMajor) {
      ctx.lineTo(x, height - 8);
    } else if (!isFive) {
      ctx.lineTo(x, height - 5);
    } else {
      ctx.lineTo(x, height - 3);
    }
    ctx.stroke();
    
    if (isMajor || isCardinal) {
      let label = '';
      if (deg === 0 || deg === 360) label = 'N';
      else if (deg === 90) label = 'E';
      else if (deg === 180) label = 'S';
      else if (deg === 270) label = 'W';
      else label = String(deg / 10);
      
      ctx.fillStyle = isCardinal ? themeMainColor : 'rgba(255, 255, 255, 0.7)';
      ctx.font = isCardinal ? 'bold 10px Orbitron' : '9px Share Tech Mono';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, x, height - 14);
    }
  }
  
  mapObjects.forEach(obj => {
    if (isPlayerObject(obj)) return;
    
    const norm = normalizeCoords(obj.x, obj.y);
    const dx = norm.x - playerX;
    const dy = norm.y - playerY;
    const targetAngle = Math.atan2(dx, -dy);
    
    let relAngle = targetAngle - playerHeading;
    while (relAngle < -Math.PI) relAngle += 2 * Math.PI;
    while (relAngle > Math.PI) relAngle -= 2 * Math.PI;
    
    if (Math.abs(relAngle) > halfFov) return;
    
    const x = width / 2 + (relAngle / FOV) * width;
    
    let color = 'rgba(255, 255, 255, 0.5)';
    let isEnemyObj = false;
    let isFriendlyObj = false;
    
    if (obj.color && obj.color.startsWith('#')) {
      const r = parseInt(obj.color.substring(1, 3), 16);
      const g = parseInt(obj.color.substring(3, 5), 16);
      const b = parseInt(obj.color.substring(5, 7), 16);
      
      const isSquad = (r === 57 && g === 217 && b === 33);
      if (!isSquad && r > b && r > g) {
        isEnemyObj = true;
        color = '#ff3366';
      } else if (b > r && b > g) {
        isFriendlyObj = true;
        color = '#00f0ff';
      }
    }
    
    const icon = (obj.icon || '').toLowerCase();
    const type = (obj.type || '').toLowerCase();
    const name = (obj.name || '').toUpperCase();
    
    const isCaptureZone = icon === 'capture_zone' || type === 'capture_zone';
    const isBombingBase = icon === 'bombing_base' || type === 'bombing_base';
    const isAirfield = icon === 'airfield' || type === 'airfield' || icon === 'runway';
    
    const isThreat = (activeThreatKey && (obj.name === activeThreatKey || `${obj.faction || 'neutral'}_${obj.icon || 'unknown'}_` === activeThreatKey.substring(0, activeThreatKey.lastIndexOf('_') + 1)));

    // Aircraft check to filter out ground units/clutter
    const isAA = icon === 'airdefence' || icon === 'spaa' || icon === 'sam' || type === 'airdefence' || type === 'aaa' || type === 'flak';
    const isWaypoint = icon === 'waypoint';
    const isTank = icon.includes('tank') || type.includes('tank');
    const isShip = icon === 'destroyer' || icon === 'frigate' || icon === 'cruiser' || icon === 'battleship' || icon === 'carrier' || icon === 'boat' || icon.includes('ship') || type.includes('ship');
    const isStructure = icon === 'structure' || icon === 'pillbox' || icon === 'bunker' || type === 'structure';
    const isGround = type === 'ground_model';
    const isSpawn = icon.includes('spawn') || type.includes('spawn') || icon.includes('respawn') || type.includes('respawn');

    const isAircraft = !isAA && !isWaypoint && !isTank && !isShip && !isStructure && !isGround && !isSpawn && !isCaptureZone && !isBombingBase && !isAirfield;
    const isSpecialTarget = isCaptureZone || isBombingBase || isAirfield;

    if (!isAircraft && !isSpecialTarget) return;
    
    // Visibility filters
    if (isThreat) {
      if (!showThreats) return;
    } else if (isCaptureZone) {
      if (!showZones) return;
    } else if (isBombingBase) {
      if (!showBases) return;
    } else if (isAirfield) {
      if (!showAirfields) return;
    } else if (isEnemyObj) {
      if (!showEnemies) return;
    } else if (isFriendlyObj) {
      if (!showFriendlies) return;
    } else {
      if (!showFriendlies) return;
    }

    ctx.save();
    ctx.shadowBlur = isThreat ? 8 : 0;
    ctx.shadowColor = color;
    
    if (isThreat) {
      const scale = 1 + 0.2 * Math.sin(Date.now() / 100);
      ctx.fillStyle = '#ff3366';
      ctx.beginPath();
      ctx.moveTo(x, 15);
      ctx.lineTo(x - 5 * scale, 5);
      ctx.lineTo(x + 5 * scale, 5);
      ctx.closePath();
      ctx.fill();
      
      ctx.font = 'bold 8px Orbitron';
      ctx.fillStyle = '#ff3366';
      ctx.textAlign = 'center';
      ctx.fillText('▲ LOCK', x, 4);
    } else if (isCaptureZone) {
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x - 4, 14);
      ctx.lineTo(x, 18);
      ctx.lineTo(x + 4, 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      
      const letter = name.replace('ZONE', '').trim().substring(0, 1);
      if (letter) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 7px Orbitron';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letter, x, 14);
      }
    } else if (isBombingBase) {
      ctx.strokeStyle = color;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, 14, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    } else if (isAirfield) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 5, 14);
      ctx.lineTo(x + 5, 14);
      ctx.stroke();
    } else {
      const isBomber = icon.includes('bomber') || type.includes('bomber');
      const isHeli = icon.includes('helicopter') || icon.includes('heli') || type.includes('helicopter') || type.includes('heli');
      
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.2;
      ctx.translate(x, 14);
      
      if (isHeli) {
        // Helicopter symbol
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-5, -3);
        ctx.lineTo(5, -3);
        ctx.stroke();
        
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, 2.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 5);
        ctx.lineTo(-2, 5);
        ctx.stroke();
      } else if (isBomber) {
        // Bomber symbol
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(-1.5, -4);
        ctx.lineTo(-6, -1);
        ctx.lineTo(-1.5, 1);
        ctx.lineTo(-1.5, 4);
        ctx.lineTo(-3.5, 5);
        ctx.lineTo(0, 3.5);
        ctx.lineTo(3.5, 5);
        ctx.lineTo(1.5, 4);
        ctx.lineTo(1.5, 1);
        ctx.lineTo(6, -1);
        ctx.lineTo(1.5, -4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Fighter / default aircraft chevron
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(-4, 3);
        ctx.lineTo(-1.5, 1.5);
        ctx.lineTo(0, 4);
        ctx.lineTo(1.5, 1.5);
        ctx.lineTo(4, 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  });
  
  // Draw vertical needle line from top to bottom
  ctx.save();
  ctx.strokeStyle = themeMainColor;
  ctx.shadowColor = themeMainColor;
  ctx.shadowBlur = 6;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.stroke();
  ctx.restore();

  // Center look marker arrow pointing DOWN (flat edge at top y=0, tip at y=6)
  ctx.fillStyle = themeMainColor;
  ctx.shadowColor = themeMainColor;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 5, 0);
  ctx.lineTo(width / 2 + 5, 0);
  ctx.lineTo(width / 2, 6);
  ctx.closePath();
  ctx.fill();
  
  let headingDeg = Math.round((playerHeading * 180 / Math.PI)) % 360;
  if (headingDeg < 0) headingDeg += 360;
  const hdgStr = String(headingDeg).padStart(3, '0');
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px Orbitron';
  ctx.textAlign = 'center';
  ctx.shadowBlur = 0;
  ctx.fillText(hdgStr + '°', width / 2, 16);
  
  ctx.restore();
}

// Run initialization at the bottom after all functions are defined
init();
