const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
const OfflineAudioContextCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;

const PRIVACY_PROFILE = Object.freeze({
  semitoneShift: 3.5,
  targetSampleRate: 24000,
  highpassHz: 160,
  lowpassHz: 3400,
  voiceGain: 0.94,
  noiseLevel: 0.0032
});

const TARGET_PEAK = 0.92;

export function supportsVoiceAnonymization() {
  return Boolean(
    AudioContextCtor &&
      OfflineAudioContextCtor &&
      window.MediaRecorder &&
      typeof File !== 'undefined' &&
      typeof Blob !== 'undefined' &&
      typeof Blob.prototype.arrayBuffer === 'function'
  );
}

export async function anonymizeAudioFile(file) {
  if (!supportsVoiceAnonymization()) {
    throw new Error('VOICE_ANONYMIZATION_UNSUPPORTED');
  }

  const decodedBuffer = await decodeAudioBlob(file);
  const renderedBuffer = await renderAnonymousBuffer(decodedBuffer);
  const maskedName = buildMaskedFilename(file?.name);

  return audioBufferToWaveFile(renderedBuffer, maskedName);
}

async function decodeAudioBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContextCtor();

  try {
    return await decodeAudioDataCompat(audioContext, arrayBuffer);
  } finally {
    await closeAudioContext(audioContext);
  }
}

function decodeAudioDataCompat(audioContext, arrayBuffer) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (callback) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };

    const onResolve = finish(resolve);
    const onReject = finish(reject);

    try {
      const maybePromise = audioContext.decodeAudioData(arrayBuffer.slice(0), onResolve, onReject);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(onResolve, onReject);
      }
    } catch (error) {
      onReject(error);
    }
  });
}

async function closeAudioContext(audioContext) {
  if (!audioContext || typeof audioContext.close !== 'function' || audioContext.state === 'closed') {
    return;
  }

  try {
    await audioContext.close();
  } catch {
    // Ignore close errors on older mobile browsers.
  }
}

async function renderAnonymousBuffer(audioBuffer) {
  const pitchRate = Math.pow(2, PRIVACY_PROFILE.semitoneShift / 12);
  const durationSeconds = Math.max(0.05, audioBuffer.duration / pitchRate);
  const frameCount = Math.max(1, Math.ceil(durationSeconds * PRIVACY_PROFILE.targetSampleRate));
  const channelCount = Math.max(1, Math.min(Number(audioBuffer.numberOfChannels) || 1, 2));
  const offlineContext = new OfflineAudioContextCtor(
    channelCount,
    frameCount,
    PRIVACY_PROFILE.targetSampleRate
  );

  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = pitchRate;

  const highpass = offlineContext.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = PRIVACY_PROFILE.highpassHz;
  highpass.Q.value = 0.7;

  const lowpass = offlineContext.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = PRIVACY_PROFILE.lowpassHz;
  lowpass.Q.value = 0.8;

  const compressor = offlineContext.createDynamicsCompressor();
  compressor.threshold.value = -30;
  compressor.knee.value = 24;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;

  const voiceGain = offlineContext.createGain();
  voiceGain.gain.value = PRIVACY_PROFILE.voiceGain;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(compressor);
  compressor.connect(voiceGain);
  voiceGain.connect(offlineContext.destination);

  addMaskingNoise(offlineContext, frameCount);

  source.start(0);
  return offlineContext.startRendering();
}

function addMaskingNoise(offlineContext, frameCount) {
  const noiseBuffer = offlineContext.createBuffer(1, frameCount, offlineContext.sampleRate);
  const samples = noiseBuffer.getChannelData(0);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (Math.random() * 2 - 1) * 0.9;
  }

  const noiseSource = offlineContext.createBufferSource();
  noiseSource.buffer = noiseBuffer;

  const bandpass = offlineContext.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 1800;
  bandpass.Q.value = 0.85;

  const noiseGain = offlineContext.createGain();
  noiseGain.gain.value = PRIVACY_PROFILE.noiseLevel;

  noiseSource.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(offlineContext.destination);
  noiseSource.start(0);
}

function audioBufferToWaveFile(audioBuffer, filename) {
  const monoSamples = mixToMono(audioBuffer);
  const scale = peakScaleFor(monoSamples);

  if (scale !== 1) {
    for (let index = 0; index < monoSamples.length; index += 1) {
      monoSamples[index] *= scale;
    }
  }

  const wavBuffer = encodeWavePcm16(monoSamples, audioBuffer.sampleRate);
  const file = new File([wavBuffer], filename, {
    type: 'audio/wav',
    lastModified: Date.now()
  });

  try {
    Object.defineProperty(file, 'voiceMasked', {
      value: true,
      enumerable: false,
      configurable: false
    });
  } catch {
    // File objects can stay unchanged if the browser blocks custom properties.
  }

  return file;
}

function mixToMono(audioBuffer) {
  const channelCount = Math.max(1, Number(audioBuffer.numberOfChannels) || 1);
  const mono = new Float32Array(audioBuffer.length);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);

    for (let sampleIndex = 0; sampleIndex < channelData.length; sampleIndex += 1) {
      mono[sampleIndex] += channelData[sampleIndex] / channelCount;
    }
  }

  return mono;
}

function peakScaleFor(samples) {
  let peak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const abs = Math.abs(samples[index]);
    if (abs > peak) {
      peak = abs;
    }
  }

  if (!peak || peak <= TARGET_PEAK) {
    return 1;
  }

  return TARGET_PEAK / peak;
}

function encodeWavePcm16(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(value), true);
    offset += bytesPerSample;
  }

  return buffer;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function buildMaskedFilename(originalName = '') {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');

  const base = String(originalName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return `${base || `audio-${stamp}`}-anonyme.wav`;
}
