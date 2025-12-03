// tuner.js
// JH Piano Tuner - ScriptProcessor-based version for better mobile compatibility

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
const needleEl = document.getElementById("needle");
const statusEl = document.getElementById("status-text");
const levelEl = document.getElementById("level");
const startButton = document.getElementById("start-button");

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

    // ScriptProcessorNode: deprecated but still widely supported (incl. iOS Safari)
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

  // Only attempt pitch detection if there's some signal
  if (rms > 0.002) {
    freq = yinPitch(inputData, audioContext.sampleRate);
  }

  if (
    freq > 0 &&
    Number.isFinite(freq) &&
    freq >= MIN_FREQUENCY &&
    freq <= MAX_FREQUENCY
  ) {
    const { noteName, targetFreq, cents } = getNoteInfo(freq);

    noteNameEl.textContent = noteName;
    frequencyEl.textContent = freq.toFixed(1);
    centsEl.textContent = cents.toFixed(1);

    updateNeedle(cents);
    statusEl.textContent = "Try to bring the needle to 0 cents.";
  } else {
    noteNameEl.textContent = "--";
    frequencyEl.textContent = "0.0";
    centsEl.textContent = "0.0";
    updateNeedle(0);

    if (rms < 0.002) {
      statusEl.textContent = "Input is very quiet. Move device closer or play louder.";
    } else {
      statusEl.textContent = "Listening… play a clear, single note and let it ring.";
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
  const A4 = 440;
  const noteNumber = 12 * (Math.log(freq / A4) / Math.log(2)) + 69;
  const nearestNote = Math.round(noteNumber);

  const targetFreq = A4 * Math.pow(2, (nearestNote - 69) / 12);
  const cents = (1200 * Math.log(freq / targetFreq)) / Math.log(2);

  const noteName = midiNoteToName(nearestNote);
  return { noteName, targetFreq, cents };
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
 * Move the needle based on cents (clamped to +/- MAX_DETUNE_CENTS).
 */
function updateNeedle(cents) {
  const clamped = Math.max(-MAX_DETUNE_CENTS, Math.min(MAX_DETUNE_CENTS, cents));
  const angle = (clamped / MAX_DETUNE_CENTS) * 25;
  needleEl.style.transform = `translateX(-50%) rotate(${angle}deg)`;
}
