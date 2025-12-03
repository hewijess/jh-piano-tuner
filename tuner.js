// tuner.js
// Minimal open-source web tuner core
// You can release this under the MIT license if you publish it.

// Global state
let audioContext = null;
let analyser = null;
let dataBuffer = null;
let running = false;

const MIN_FREQUENCY = 27.5; // A0
const MAX_FREQUENCY = 4186.0; // C8
const MAX_DETUNE_CENTS = 50; // +/- 50 cents scale for needle

// UI elements
const noteNameEl = document.getElementById("note-name");
const frequencyEl = document.getElementById("frequency");
const centsEl = document.getElementById("cents");
const needleEl = document.getElementById("needle");
const statusEl = document.getElementById("status-text");
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

    // On some devices (especially mobile), AudioContext starts suspended
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    dataBuffer = new Float32Array(analyser.fftSize);
    source.connect(analyser);

    running = true;
    startButton.textContent = "Microphone Running";
    startButton.disabled = true;
    statusEl.textContent = "Listening… play a single note on your piano.";

    updateTuner();
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Could not access microphone. Check permissions and that you're using HTTPS.";
  }
}

function updateTuner() {
  if (!running || !analyser || !audioContext) return;

  analyser.getFloatTimeDomainData(dataBuffer);
  const freq = autoCorrelatePitch(dataBuffer, audioContext.sampleRate);

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
    // No stable pitch detected
    noteNameEl.textContent = "--";
    frequencyEl.textContent = "0.0";
    centsEl.textContent = "0.0";
    updateNeedle(0);
    statusEl.textContent = "Play a clear, single note and let it ring.";
  }

  requestAnimationFrame(updateTuner);
}

/**
 * Basic autocorrelation pitch detection.
 * Returns frequency in Hz, or -1 if no good match.
 */
function autoCorrelatePitch(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;

  for (let i = 0; i < SIZE; i++) {
    const val = buf[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);

  if (rms < 0.01) {
    // Signal too weak
    return -1;
  }

  const MAX_SHIFT = SIZE / 2;
  let bestOffset = -1;
  let bestCorrelation = 0;
  let previousCorrelation = 1;

  for (let offset = 1; offset < MAX_SHIFT; offset++) {
    let correlation = 0;

    for (let i = 0; i < MAX_SHIFT; i++) {
      correlation += buf[i] * buf[i + offset];
    }

    correlation = correlation / MAX_SHIFT;

    if (correlation > 0.9 && correlation > previousCorrelation) {
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    previousCorrelation = correlation;
  }

  if (bestOffset > 0) {
    const frequency = sampleRate / bestOffset;
    return frequency;
  }

  return -1;
}

/**
 * Map frequency to nearest equal-tempered note and cents offset.
 */
function getNoteInfo(freq) {
  const A4 = 440;
  // MIDI note number
  const noteNumber = 12 * (Math.log(freq / A4) / Math.log(2)) + 69;
  const nearestNote = Math.round(noteNumber);

  const targetFreq = A4 * Math.pow(2, (nearestNote - 69) / 12);
  const cents = (1200 * Math.log(freq / targetFreq)) / Math.log(2);

  const noteName = midiNoteToName(nearestNote);
  return { noteName, targetFreq, cents };
}

function midiNoteToName(midi) {
  const noteNames = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B"
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
  // Map -50..+50 cents to -25..+25 degrees
  const angle = (clamped / MAX_DETUNE_CENTS) * 25;
  needleEl.style.transform = `translateX(-50%) rotate(${angle}deg)`;
}
