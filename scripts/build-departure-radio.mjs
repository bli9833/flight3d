// Requires FFmpeg with the local Flite filter; no remote TTS or runtime service.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEPARTURE_RADIO } from '../src/config/departureRadio.js';

const out = 'public/audio/departure';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'flight3d-radio-'));
const voices = { pilot: 'rms', crew: 'awb', apron: 'slt', ground: 'slt', tower: 'slt' };
const manifest = {};
fs.mkdirSync(out, {recursive: true});
try {
  for (const [stage, lines] of Object.entries(DEPARTURE_RADIO)) {
    const chunks = [];
    for (const [i, [speaker, text]] of lines.entries()) {
      const spoken = text.replaceAll('123', 'one two three').replaceAll('15R', 'one five right');
      const textFile = path.join(temp, `${stage}-${i}.txt`);
      const wav = path.join(temp, `${stage}-${i}.wav`);
      fs.writeFileSync(textFile, spoken);
      execFileSync('ffmpeg', ['-v','error','-y','-f','lavfi','-i',`flite=textfile=${textFile}:voice=${voices[speaker]}`,
        '-af','highpass=f=320,lowpass=f=3100,alimiter=limit=0.8,apad=pad_dur=0.22', '-ar','22050','-ac','1',wav]);
      chunks.push(wav);
    }
    const list = path.join(temp, 'concat.txt');
    fs.writeFileSync(list, chunks.map(file => `file '${file}'`).join('\n'));
    const output = path.join(out, `${stage}.wav`);
    execFileSync('ffmpeg', ['-v','error','-y','-f','concat','-safe','0','-i',list,'-c:a','pcm_s16le',output]);
    const duration = Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',output],{encoding:'utf8'}));
    manifest[stage] = {file: `${stage}.wav`, duration, lines: lines.map(([speaker,text])=>({speaker,voice:voices[speaker],text}))};
    console.log(stage, duration.toFixed(2)+'s');
  }
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
