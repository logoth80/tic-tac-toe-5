/* What an mp3 actually is: sample rate, channels, frame count, length. No decoder, no dependency -
   the frame headers say all of that, and the length matters for the game because a sound that is
   longer than the gap between moves is a sound that stacks into a noise.

   Run directly for a report:  node tests/mp3-info.mjs sounds/*.mp3
   Imported by tests/file-check.mjs, which checks the files the page points at are really mp3s and
   short enough that the pencil does not blur into itself.
*/
import fs from 'node:fs';

const BITRATE = {
  // index 1..14, by [mpeg1 l3, mpeg2/2.5 l3]
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATE = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }; // mpeg version id
const CHANNELS = ['stereo', 'joint', 'dual', 'mono'];

function skipId3(buf, at) {
  if (buf.length - at < 10 || buf.toString('latin1', at, at + 3) !== 'ID3') return at;
  const size = ((buf[at + 6] & 0x7f) << 21) | ((buf[at + 7] & 0x7f) << 14) | ((buf[at + 8] & 0x7f) << 7) | (buf[at + 9] & 0x7f);
  return at + 10 + size;
}

export function readMp3(path) {
  const buf = fs.readFileSync(path);
  let at = skipId3(buf, 0);
  const end = buf.length;
  // an ID3v1 tag sits at the very end and is 128 bytes of metadata, not sound
  const stop = (buf.toString('latin1', Math.max(0, end - 3), end) === 'TAG') ? end - 128 : end;
  let first = null, frames = 0, samplesPerFrame = 0, bytesOfAudio = 0;
  while (at + 4 <= stop) {
    if (buf[at] === 0xff && (buf[at + 1] & 0xe0) === 0xe0 && (buf[at + 1] & 0x06) !== 0x00) {
      const verId = (buf[at + 1] >> 3) & 3;                 // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
      const layerId = (buf[at + 1] >> 1) & 3;               // 1 = Layer III
      const brIdx = (buf[at + 2] >> 4) & 0x0f;
      const srIdx = (buf[at + 2] >> 2) & 0x03;
      const pad = (buf[at + 2] >> 1) & 1;
      if (layerId === 1 && brIdx > 0 && brIdx < 15 && srIdx < 3) {
        const mpeg1 = verId === 3;
        const bitrate = (mpeg1 ? BITRATE.v1 : BITRATE.v2)[brIdx] * 1000;
        const rate = RATE[verId][srIdx];
        samplesPerFrame = mpeg1 ? 1152 : 576;
        const len = Math.floor((samplesPerFrame / 8) * bitrate / rate) + pad;
        if (len < 4) break;
        if (!first) {
          first = {
            mpeg: mpeg1 ? 1 : (verId === 2 ? 2 : 2.5), layer: 'III',
            bitrateKbps: bitrate / 1000, sampleRate: rate,
            channels: CHANNELS[((buf[at + 3] >> 6) & 3)],
          };
          // Xing/Info, when present, carries the exact frame count and length
          const hint = mpeg1 ? ((buf[at + 3] & 0xc0) === 0xc0 ? 32 : 36) : ((buf[at + 3] & 0xc0) === 0xc0 ? 17 : 32);
          const tag = buf.toString('latin1', at + hint, at + hint + 4);
          if (tag === 'Xing' || tag === 'Info') first.framesInHeader = buf.readUInt32BE(at + hint + 8);
        }
        frames++; bytesOfAudio += len;
        at += len;
        continue;
      }
    }
    at++;
  }
  if (!first || !frames) return null;
  const declared = first.framesInHeader && first.framesInHeader <= frames + 2 ? first.framesInHeader : frames;
  return {
    file: path, bytes: buf.length, ...first,
    frames: declared, seconds: +(declared * samplesPerFrame / first.sampleRate).toFixed(3),
    countedFrames: frames,
  };
}

if (process.argv[1] && process.argv[1].endsWith('mp3-info.mjs')) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node tests/mp3-info.mjs <file.mp3 ...>'); process.exit(2); }
  let bad = 0;
  for (const f of files) {
    const m = readMp3(f);
    if (!m) { console.log('NOT AN MP3: ' + f); bad++; continue; }
    console.log([
      m.file, m.bytes + ' bytes', m.seconds + ' s', m.sampleRate + ' Hz', m.channels,
      m.mpeg + '/layer ' + m.layer, m.bitrateKbps + ' kbps',
      m.frames + ' frames', (m.framesInHeader ? '(Xing says ' + m.framesInHeader + ')' : ''),
    ].join('  '));
  }
  process.exit(bad ? 1 : 0);
}
