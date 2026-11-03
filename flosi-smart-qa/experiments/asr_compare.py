"""Paired real-human ASR comparison; no correction model or reference prompting."""
import argparse,gc,hashlib,json,time,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from faster_whisper import WhisperModel
from smartqa.audio import word_error_rate
p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--small',type=Path,required=True);p.add_argument('--medium',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
sources=json.loads(a.manifest.read_text());rows=[];loads={}
for name,path in [('small',a.small),('medium',a.medium)]:
 start=time.perf_counter();m=WhisperModel(str(path),device='cpu',compute_type='int8',cpu_threads=3,num_workers=1,local_files_only=True);loads[name]=(time.perf_counter()-start)*1000
 for s in sources:
  file=a.manifest.parent/s['file']
  if hashlib.sha256(file.read_bytes()).hexdigest()!=s['sha256']:raise RuntimeError('audio changed')
  start=time.perf_counter();segments,info=m.transcribe(str(file),language=s['language'],beam_size=5,condition_on_previous_text=False,vad_filter=False,word_timestamps=True,temperature=0)
  segments=list(segments);text=''.join(x.text for x in segments).strip();ms=(time.perf_counter()-start)*1000
  row={'model':name,'sourceId':s['id'],'reference':s['reference'],'asr':text,'asrMs':ms,'durationSeconds':info.duration,'realTimeFactor':ms/1000/info.duration,'referenceComparison':word_error_rate(s['reference'],text),'actualSegmentTemperatures':[x.temperature for x in segments]};rows.append(row)
  with (a.out/'rows.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
  print(name,s['id'],text,round(ms),flush=True)
 del m;gc.collect()
(a.out/'manifest.json').write_text(json.dumps({'mode':'real_human_audio_asr_comparison','referencesNeverSentToASR':True,'modelLoadMs':loads,'modelPaths':{'small':str(a.small),'medium':str(a.medium)},'temperature':0,'beamSize':5,'threads':3,'wordTimestamps':True,'computeType':'int8','device':'cpu'},indent=2)+'\n')
