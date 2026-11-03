"""Summarize immutable, actually executed runs; never updates source results."""
import collections,csv,hashlib,json,math,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from smartqa.engine import word_sequence
from smartqa.evaluate import percentile
E=ROOT/'evidence'
def readrows(name):return [json.loads(s) for s in (E/name/'rows.jsonl').read_text().splitlines()]
runs=['dev-v3','dev-v4','dev-smart-1','dev-smart-thinking','dev-smart-thinking128','dev-instruct-v4','dev-instruct-source','dev-instruct-smart','dev-selected','long-selected','long-revalidated','final-validation','final-round2','final-qualification','release-validation','repeated-recovered','release-repeats']
batches=[]
for name in runs:
 m=json.loads((E/name/'manifest.json').read_text());rs=readrows(name);s=dict(m.get('summary',{}))
 required=[r for r in rs if not any(word_sequence(r['input'])==word_sequence(x) for x in r['expected'])]
 s.update(run=name,model=m['model'],state=m['state'],requestsRecorded=len(rs),requiredChanges=len(required),requiredChangesMatched=sum(r['evaluation']['completeAnnotationMatch'] for r in required),controls=len(rs)-len(required),controlsMatched=sum(r['evaluation']['completeAnnotationMatch'] for r in rs if r not in required),acceptedAnnotationFailures=sum(not r['evaluation']['completeAnnotationMatch'] and not r['evaluation']['reviewRequested'] for r in rs),automatedMatches=sum(r['evaluation']['completeAnnotationMatch'] and not r['evaluation']['reviewRequested'] for r in rs))
 batches.append(s)
known={};errors={}
def walk(n,source):
 if isinstance(n,list):
  for v in n:walk(v,source)
 elif isinstance(n,dict):
  rid=n.get('responseId')
  if isinstance(rid,str) and rid.startswith('chatcmpl-') and isinstance(n.get('usage'),dict):
   if rid in known and known[rid]['usage']!=n['usage']:raise RuntimeError('Inconsistent token evidence')
   known[rid]={'model':n.get('model'),'usage':n['usage'],'source':source}
  if n.get('status')=='error' and n.get('requestSha256') and n.get('latencyMs'):
   errors[(n.get('requestSha256'),n['latencyMs'])]={'error':n.get('error'),'source':source}
  for v in n.values():walk(v,source)
for p in sorted(E.rglob('*')):
 if not p.is_file() or p.suffix not in ('.json','.jsonl') or p.name=='metrics.json':continue
 if p.suffix=='.jsonl':
  for line in p.read_text().splitlines():walk(json.loads(line),str(p.relative_to(ROOT)))
 else:walk(json.loads(p.read_text()),str(p.relative_to(ROOT)))
tokens={k:sum(r['usage'][k] for r in known.values()) for k in ('prompt_tokens','completion_tokens','total_tokens')}
by_model={m:{'responses':sum(r['model']==m for r in known.values()),'tokens':sum(r['usage']['total_tokens'] for r in known.values() if r['model']==m)} for m in sorted({r['model'] for r in known.values()})}
# Latest available pipeline record for each unique human recording; known discovery
# clips are explicitly regression evidence, never post-fix independent approval.
audio={}
for name in ['audio-via-launcher','human-postfreeze','audio-release']:
 for r in readrows(name):r['evidenceRun']=name;audio[r['audioSha256']]=r
assert len(audio)==12,len(audio)
ars=list(audio.values());atr=[]
for r in ars:
 p=r['correction']['provider'];s=r['source'];c=r['asrReferenceComparison']
 atr.append({'id':s['id'],'run':r['evidenceRun'],'audioSha256':r['audioSha256'],'speechType':s['speechType'],'durationSeconds':r['audioDurationSeconds'],'asrMs':r['asrMs'],'asrRTF':r['asrRealTimeFactor'],'correctionMs':p['latencyMs'],'totalMs':r['totalMs'],'correctionStatus':r['correction']['status'],'referenceWords':c['referenceWords'],'asrWordEdits':c['wordEdits'],'asrWER':c['wer'],'tokens':p['usage']['total_tokens']})
repeats=[]
for ident in sorted({r['caseId'] for r in readrows('release-repeats')}):
 rs=[r for r in readrows('release-repeats') if r['caseId']==ident]
 repeats.append({'caseId':ident,'repeats':len(rs),'uniqueOutputs':len({r['evaluation']['outputSha256'] for r in rs}),'uniquePlans':len({r['result']['provider']['content'] for r in rs}),'annotationMatches':sum(r['evaluation']['completeAnnotationMatch'] for r in rs),'statuses':dict(collections.Counter(r['result']['status'] for r in rs))})
metrics={'schemaVersion':1,'acceptance':'FAILED_P0_OPEN','selectedFreeze':'evidence/freeze-release.json','notUniversalSemanticAccuracy':True,'batches':batches,'usage':{'uniqueSavedProviderResponses':len(known),'savedResponseTokens':tokens,'byModel':by_model,'knownMissingUsage':['One actual 120-second timeout has no returned usage.','Three successful local model calls made by the first failed browser driver were not captured as raw response JSON; usage unknown.'],'savedProviderErrors':list(errors.values()),'externalInferenceRequests':0,'externalInferenceChargesUsd':0,'computeElectricityCost':'not_measured_not_zero_claim'},'audio':{'uniqueHumanFilesActuallyProcessed':len(ars),'humanSpontaneousFiles':sum(r['source']['speechType']=='human_spontaneous_meeting' for r in ars),'humanReadSpeechFiles':sum(r['source']['speechType']=='human_read_speech' for r in ars),'latestRowsAcrossDifferentRevisions':True,'asrWordEdits':sum(r['asrReferenceComparison']['wordEdits'] for r in ars),'referenceWords':sum(r['asrReferenceComparison']['referenceWords'] for r in ars),'note':'Lexical WER includes spoken-word/digit formatting differences; it does not score intended corrected meaning. Audio latency rows remain per actual run, not a pooled benchmark.','rows':atr},'repeats':repeats,'windowsPhysicalExecuted':False,'externalIndependentHumanApproval':False,'tests':{'standaloneUnit':59,'historicalOffline':51,'totalPassing':110}}
(E/'metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2)+'\n')
fields=['run','model','state','requestsRecorded','annotationMatches','requiredChanges','requiredChangesMatched','controls','controlsMatched','automatedMatches','reviewRequested','acceptedAnnotationFailures','technicalFailures','providerSuccesses','correctionP50Ms','correctionP95Ms']
with (E/'metrics.csv').open('w',newline='',encoding='utf-8') as f:w=csv.DictWriter(f,fields,extrasaction='ignore');w.writeheader();w.writerows(batches)
with (E/'audio-metrics.csv').open('w',newline='',encoding='utf-8') as f:w=csv.DictWriter(f,list(atr[0]));w.writeheader();w.writerows(atr)
print(json.dumps({'usage':metrics['usage'],'release':batches[-3:],'audioUnique':len(ars),'repeats':repeats},indent=2))
