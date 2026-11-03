"""Evaluate the frozen selected engine through its running QA backend.
Expected answers, tags and scoring rules never enter the HTTP request.
"""
import argparse,json,sys,time,urllib.request
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from smartqa.evaluate import digest,score,summarize
p=argparse.ArgumentParser();p.add_argument('--cases',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--repeat',type=int,default=1);a=p.parse_args()
if not 1<=a.repeat<=5:p.error('repeat must be 1..5')
raw=a.cases.read_bytes();cases=json.loads(raw)
if len({c['id'] for c in cases})!=len(cases):raise RuntimeError('duplicate case id')
op=urllib.request.build_opener(urllib.request.ProxyHandler({}));base='http://127.0.0.1:18766'
with op.open(base+'/api/status',timeout=5) as response:status=json.load(response)
a.out.mkdir(parents=True,exist_ok=False)
manifest={'schemaVersion':1,'mode':'real_inference_through_QA','variant':'smart','model':status['model'],'cases':str(a.cases),
          'casesSha256':digest(raw),'syntheticInputs':all(c.get('synthetic',True) for c in cases),'repeats':a.repeat,
          'startedUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'qaStatus':status,'state':'running','plannedCases':len(cases)*a.repeat,
          'criterion':'Complete ordered output annotations plus exact technical/quote checks; human semantic review still required'}
(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
rows=[];attempts=0
with (a.out/'rows.jsonl').open('x',encoding='utf-8',newline='\n') as out:
 for repeat in range(a.repeat):
  for case in cases:
   request=urllib.request.Request(base+'/api/correct',data=json.dumps({'text':case['input'],'saveEvidence':False},ensure_ascii=False).encode(),headers={'Content-Type':'application/json','Origin':base},method='POST')
   started=time.perf_counter()
   with op.open(request,timeout=180) as response:result=json.load(response)
   if result['original']!=case['input']:raise RuntimeError('original changed')
   if result.get('provider',{}).get('requestSha256'):attempts+=1
   row={'caseId':case['id'],'category':case['category'],'language':case['language'],'repeat':repeat,'input':case['input'],'expected':case['expected'],
        'result':result,'evaluation':score(case,result),'qaRequestElapsedMs':(time.perf_counter()-started)*1000}
   rows.append(row);out.write(json.dumps(row,ensure_ascii=False)+'\n');out.flush()
   print(case['id'],repeat,result['status'],row['evaluation']['completeAnnotationMatch'],flush=True)
manifest.update(state='complete',attempts=attempts,summary=summarize(rows))
(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest['summary'],indent=2))
