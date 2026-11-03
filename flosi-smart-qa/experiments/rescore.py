"""New audit artifacts only. Never rewrites original responses or historical scores."""
import argparse,csv,json,sys,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from smartqa.evaluate import score,summarize,percentile,digest
from smartqa.engine import _technical,_subsequence,word_sequence,apply_plan,InvalidPlan

p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--replay-plans',action='store_true');p.add_argument('runs',type=Path,nargs='+');a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
root=Path(__file__).resolve().parents[1];summary=[]
with (a.out/'rows.jsonl').open('x',encoding='utf-8',newline='\n') as rowsout:
 for directory in a.runs:
  manifest=json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
  corpus=Path(manifest['cases']);corpus=corpus if corpus.is_absolute() else root/corpus
  data=corpus.read_bytes()
  if digest(data)!=manifest['casesSha256']:raise RuntimeError('Corpus changed: '+str(corpus))
  cases={c['id']:c for c in json.loads(data)};rows=[];character_flags=0
  for line in (directory/'rows.jsonl').read_text(encoding='utf-8').splitlines():
   original=json.loads(line);row=json.loads(line);case=cases[row['caseId']]
   if row['input']!=case['input']:raise RuntimeError('Input mismatch')
   if a.replay_plans:
    if manifest['variant']!='smart':raise RuntimeError('Only explicit plans can be replayed')
    response=row['result']['provider']
    if response['status']=='ok':
     try:result=apply_plan(case['input'],json.loads(response['content']))
     except (ValueError,InvalidPlan) as error:result={'original':case['input'],'text':case['input'],'status':'rejected','reason':str(error)}
    else:result={'original':case['input'],'text':case['input'],'status':'provider_error','reason':response['error']}
    row['result']=result
    row['sourceResponseId']=response.get('responseId');row['mode']='real_response_replay_no_new_inference'
   else:row['mode']='rescore_original_output_no_new_inference'
   row['evaluation']=score(case,row['result'])
   changed=not _subsequence(_technical(row['result']['text']),_technical(case['input']))
   character_flags+=changed
   row['extractedTechnicalCharacterFlag']=changed
   row['sourceRun']=str(directory);row['originalRowSha256']=digest(line)
   rows.append(row);rowsout.write(json.dumps(row,ensure_ascii=False)+'\n')
  stats=summarize(rows) if not a.replay_plans else {'cases':len(rows),'annotationMatches':sum(r['evaluation']['completeAnnotationMatch'] for r in rows),'reviewRequested':sum(r['evaluation']['reviewRequested'] for r in rows)}
  changed_cases=[r for r in rows if not any(word_sequence(r['input'])==word_sequence(e) for e in r['expected'])]
  stats.update(run=str(directory),model=manifest['model'],variant=manifest['variant'],inputChangesRequired=len(changed_cases),
               requiredChangesMatched=sum(r['evaluation']['completeAnnotationMatch'] for r in changed_cases),
               extractedTechnicalCharacterFlags=character_flags,mode='replay' if a.replay_plans else 'original_outputs_rescored')
  summary.append(stats)
(a.out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
with (a.out/'summary.csv').open('x',encoding='utf-8',newline='') as f:
 fields=['run','model','variant','cases','annotationMatches','inputChangesRequired','requiredChangesMatched','reviewRequested','extractedTechnicalCharacterFlags','mode']
 w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(summary)
print(json.dumps(summary,indent=2))
