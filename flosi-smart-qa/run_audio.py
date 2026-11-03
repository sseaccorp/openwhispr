"""Reproducible file Audio -> ASR -> correction, with append-only output."""
import argparse
import base64
import json
import time
import urllib.request
from urllib.parse import urlparse
from pathlib import Path
from smartqa.audio import AudioPipeline
from smartqa.provider import Provider, LOCAL_MODEL

p = argparse.ArgumentParser()
p.add_argument('--manifest', type=Path, required=True)
p.add_argument('--asr-model', type=Path)
p.add_argument('--via-ui', action='store_true', help='Reuse the running isolated QA backend, including its private model authentication')
p.add_argument('--ui-url', default='http://127.0.0.1:18766')
p.add_argument('--out', type=Path, required=True)
p.add_argument('--model', default=LOCAL_MODEL)
args = p.parse_args()
if not args.via_ui and not args.asr_model:p.error('--asr-model is required unless --via-ui is used')
if args.via_ui:
    url=urlparse(args.ui_url)
    if url.scheme!='http' or url.hostname!='127.0.0.1' or url.path not in ('','/') or not url.port:
        p.error('--ui-url must be an explicit local http://127.0.0.1:PORT')
args.out.mkdir(parents=True, exist_ok=False)
manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
pipeline = None if args.via_ui else AudioPipeline(args.asr_model, Provider(model=args.model))
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
ui_status=None
if args.via_ui:
    with opener.open(args.ui_url+'/api/status',timeout=5) as response:ui_status=json.load(response)
with (args.out/'rows.jsonl').open('x', encoding='utf-8', newline='\n') as out:
    for source in manifest:
        file=args.manifest.parent/source['file']
        if args.via_ui:
            body={'audioBase64':base64.b64encode(file.read_bytes()).decode('ascii'),'language':source['language'],
                  'reference':source['reference'],'saveEvidence':False}
            request=urllib.request.Request(args.ui_url+'/api/audio',data=json.dumps(body).encode(),
                headers={'Content-Type':'application/json','Origin':args.ui_url},method='POST')
            with opener.open(request,timeout=180) as response:record=json.load(response)
        else:
            record = pipeline.process(file, language=source['language'], reference=source['reference'])
        if record['audioSha256'] != source['sha256']:
            raise ValueError('Audio changed')
        record['source'] = source
        out.write(json.dumps(record, ensure_ascii=False)+'\n'); out.flush()
        print(source['id'], record['asrReferenceComparison'], record['correction']['status'], flush=True)
(args.out/'manifest.json').write_text(json.dumps({'mode': 'real_human_audio', 'viaRunningQA':args.via_ui,
    'asrLoadMs': pipeline.load_ms if pipeline else ui_status.get('asrLoadMs'),
    'timestampUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'sources': manifest,
    'asrModel':pipeline.model_source if pipeline else ui_status.get('asrSource'),
    'asrConfig': {'beamSize': 5, 'conditionOnPreviousText': False, 'vadFilter': False, 'device': 'cpu', 'threads': 3, 'temperature':0},
    'microphoneExecuted': False}, ensure_ascii=False, indent=2), encoding='utf-8')
