// tuner.js
// JH Piano Tuner - PWA + sensitivity + ScriptProcessor + YIN pitch detection

// -----------------------------
// PWA / Service Worker + Update button
// -----------------------------
const updateButton = document.getElementById("update-button");
let waitingWorker = null;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then(reg => {
        // If there's already a waiting worker when we load (new version ready)
        if (reg.waiting) {
          showUpdateButton(reg.waiting);
        }

        // Listen for future updates
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New version installed and in waiting state: show update button
              showUpdateButton(newWorker);
            }
          });
        });
      })
      .catch(err => {
        console.error("Service worker registration failed:", err);
      });

    // Reload the page when the new service worker becomes active
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  });
}

function showUpdateButton(worker) {
  waitingWorker = worker;
  if (!updateButton) return;

  updateButton.hidden = false;
  updateButton.onclick = () => {
    if (!waitingWorker) return;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };
}

// -----------------------------
// Sensitivity slider wiring
// -----------------------------
const sensitivitySlider = document.getElementById("sensitivity-slider");
const sensitivityLabel = document.getElementById("sensitivity-label");

// 1–100 from the slider (higher = more sensitive)
let sensitivityValue = 70;

function getRmsThreshold() {
  // Map slider 1–100 to threshold between:
  //  - 0.0005  (high sensitivity: detects quieter signals)
  //  - 0.01    (low sensitivity: ignores quiet noise)
  const minThresh = 0.0005;
  const maxThresh = 0.01;

  const t = sensitivityValue / 100; // 0..1
  // Higher sensitivityValue => closer to minThresh
  const threshold = maxThresh - t * (maxThresh - minThresh);
  return threshold;
}

if (sensitivitySlider) {
  // Initialize from slider's initial value
  sensitivityValue = Number(sensitivitySlider.value) || 70;
  updateSensitivityLabel();

  sensitivitySlider.addEventListener("input", () => {
    sensitivityValue = Number(sensitivitySlider.value) || 70;
    updateSensitivityLabel();
  });
}

function updateSensitivityLabel() {
  if (!sensitivityLabel) return;

  if (sensitivityValue >= 80) {
    sensitivityLabel.textContent = "High";
  } else if (sensitivityValue <= 30) {
    sensitivityLabel.textContent = "Low";
  } else {
    sensitivityLabel.textContent = "Medium";
  }
}

// -----------------------------
// Tuner core: audio + pitch detection
// -----------------------------
let audioContext = null;
let scriptNode = null;
let running = false;

const MIN_FREQUENCY = 27.5;  // A0
const MAX_FREQUENCY = 4186;  // C8
const MAX_DETUNE_CENTS = 50; // +/- 50 cents for the needle

// UI elements
const noteNameEl = document.getElementById("note-name");
const frequencyEl = document.getElementById("frequency");
const centsEl = document.getElementById("cents");
const tuningBgEl = document.getElementById("tuning-bg");
const statusEl = document.getElementById("status-text");
const levelEl = document.getElementById("level");
const pianoKeyEl = document.getElementById("piano-key");
const startButton = document.getElementById("start-button");

// Piano range (standard 88-key piano: A0 to C8)
const MIN_MIDI_PIANO = 21;  // A0
const MAX_MIDI_PIANO = 108; // C8

startButton.addEventListener("click", startTuner);

async function startTuner() {
  if (running) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = "This browser doesn't support microphone access.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);

    // ScriptProcessorNode: deprecated but widely supported (including iOS Safari)
    const bufferSize = 2048;
    scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);

    // Silent gain so we don't hear ourselves
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    // Connect: mic -> scriptNode -> silentGain -> destination
    source.connect(scriptNode);
    scriptNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    scriptNode.onaudioprocess = handleAudioProcess;

    running = true;
    startButton.textContent = "Microphone Running";
    startButton.disabled = true;
    statusEl.textContent = "Listening… play a single note on your piano.";
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Could not access microphone. Check permissions and that you're using HTTPS.";
  }
}

function handleAudioProcess(event) {
  if (!audioContext) return;

  const inputBuffer = event.inputBuffer;
  const inputData = inputBuffer.getChannelData(0); // mono

  // Compute RMS level
  const rms = computeRMS(inputData);
  if (levelEl) {
    levelEl.textContent = rms.toFixed(3);
  }

  let freq = -1;
  const rmsThreshold = getRmsThreshold();

  // Only attempt pitch detection if there's some signal above threshold
  if (rms > rmsThreshold) {
    freq = yinPitch(inputData, audioContext.sampleRate);
  }

if (
  freq > 0 &&
  Number.isFinite(freq) &&
  freq >= MIN_FREQUENCY &&
  freq <= MAX_FREQUENCY
) {
  const { noteName, targetFreq, cents, keyNumber } = getNoteInfo(freq);

  // Only accept notes that are on a standard 88-key piano
  if (keyNumber !== null) {
    noteNameEl.textContent = noteName;
    frequencyEl.textContent = freq.toFixed(1);
    centsEl.textContent = cents.toFixed(1);

    if (pianoKeyEl) {
      pianoKeyEl.textContent = keyNumber.toString();
    }

    updateNeedle(cents);
    statusEl.textContent = "Piano note detected. Try to bring the needle to 0 cents.";
  } else {
    // Detected frequency is outside piano note range (or a bad harmonic)
    noteNameEl.textContent = "--";
    frequencyEl.textContent = "0.0";
    centsEl.textContent = "0.0";
    if (pianoKeyEl) {
      pianoKeyEl.textContent = "--";
    }
    updateNeedle(0);
    statusEl.textContent = "Sound detected, but not within the 88-key piano range.";
  }
} else {
  noteNameEl.textContent = "--";
  frequencyEl.textContent = "0.0";
  centsEl.textContent = "0.0";
  if (pianoKeyEl) {
    pianoKeyEl.textContent = "--";
  }
  updateNeedle(0);

  if (rms < rmsThreshold) {
    statusEl.textContent =
      "Input is below sensitivity. Move device closer, play louder, or increase sensitivity.";
  } else {
    statusEl.textContent =
      "Listening… play a clear, single piano note and let it ring.";
  }
}

  // Zero the output so we don't feed anything to speakers
  const outputBuffer = event.outputBuffer;
  for (let ch = 0; ch < outputBuffer.numberOfChannels; ch++) {
    const outputData = outputBuffer.getChannelData(ch);
    outputData.fill(0);
  }
}

function computeRMS(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

/**
 * YIN pitch detection algorithm (simplified).
 * Returns frequency in Hz, or -1 if not found.
 */
function yinPitch(buffer, sampleRate) {
  const threshold = 0.15;
  const tauMax = Math.floor(buffer.length / 2);

  const yinBuffer = new Float32Array(tauMax);
  let runningSum = 0;

  // Step 1: Difference function
  for (let tau = 1; tau < tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < tauMax; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    yinBuffer[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference
  yinBuffer[0] = 1;
  for (let tau = 1; tau < tauMax; tau++) {
    runningSum += yinBuffer[tau];
    yinBuffer[tau] *= tau / runningSum;
  }

  // Step 3: Absolute threshold
  let tauEstimate = -1;
  for (let tau = 2; tau < tauMax; tau++) {
    if (yinBuffer[tau] < threshold) {
      while (tau + 1 < tauMax && yinBuffer[tau + 1] < yinBuffer[tau]) {
        tau++;
      }
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate === -1) {
    return -1;
  }

  // Step 4: Parabolic interpolation
  const x0 = tauEstimate < 1 ? tauEstimate : tauEstimate - 1;
  const x2 = tauEstimate + 1 < tauMax ? tauEstimate + 1 : tauEstimate;

  const s0 = yinBuffer[x0];
  const s1 = yinBuffer[tauEstimate];
  const s2 = yinBuffer[x2];

  const betterTau = tauEstimate + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
  const frequency = sampleRate / betterTau;

  if (!Number.isFinite(frequency) || frequency <= 0) {
    return -1;
  }

  return frequency;
}

/**
 * Map frequency to nearest equal-tempered note and cents offset.
 */
function getNoteInfo(freq) {
  const A4 = 440; // A4 reference; later we can make this configurable
  const noteNumber = 12 * (Math.log(freq / A4) / Math.log(2)) + 69;
  const nearestNote = Math.round(noteNumber);

  const targetFreq = A4 * Math.pow(2, (nearestNote - 69) / 12);
  const cents = (1200 * Math.log(freq / targetFreq)) / Math.log(2);

  const noteName = midiNoteToName(nearestNote);

  // Map MIDI to piano key (1–88). A0 (MIDI 21) => key 1
  let keyNumber = null;
  if (nearestNote >= MIN_MIDI_PIANO && nearestNote <= MAX_MIDI_PIANO) {
    keyNumber = nearestNote - (MIN_MIDI_PIANO - 1);
  }

  return { noteName, targetFreq, cents, keyNumber };
}

function midiNoteToName(midi) {
  const noteNames = [
    "C", "C♯", "D", "D♯", "E", "F",
    "F♯", "G", "G♯", "A", "A♯", "B"
  ];
  const note = noteNames[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

/**
 * Move the sliding background based on cents (clamped to +/- MAX_DETUNE_CENTS).
 * Negative cents: slide one way, positive cents: slide the other.
 */
function updateNeedle(cents) {
  if (!tuningBgEl) return;

  const clamped = Math.max(-MAX_DETUNE_CENTS, Math.min(MAX_DETUNE_CENTS, cents));
  // Map -MAX..+MAX cents to a shift range (in percent).
  // With width 300%, translating +/- 20% gives a nice visible slide.
  const maxShiftPercent = 20;
  const shift = (clamped / MAX_DETUNE_CENTS) * maxShiftPercent;

  // Start centered at -50% (middle of 300%), then add our shift
  tuningBgEl.style.transform = `translateX(${shift - 50}%)`;
}
