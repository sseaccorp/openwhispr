"""Pin the selected implementation BEFORE authoring final validation cases."""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
def sources():
    files = [ROOT/'ACCEPTANCE.md', ROOT/'assets.json', ROOT/'requirements.txt', ROOT/'launch.py',
             ROOT/'run_audio.py', ROOT/'Start-SmartQA.ps1', ROOT/'freeze.py']
    files += [p for folder in ['smartqa','web','tests','experiments'] for p in (ROOT/folder).glob('*') if p.is_file()]
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}

def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['create','verify']);p.add_argument('--file',type=Path,default=ROOT/'evidence/freeze.json');a=p.parse_args()
    if a.command=='create':
        document={'schemaVersion':1,'candidateCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT).decode().strip(),
                  'createdUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'finalCasesAuthored':False,
                  'acceptanceCriteria':'ACCEPTANCE.md','sourceHashes':sources(),
                  'notice':'Selection does not imply acceptance. Independent post-freeze results cannot be used to tune and then called blind.'}
        with a.file.open('x',encoding='utf-8',newline='\n') as f:json.dump(document,f,indent=2);f.write('\n')
        print('Candidate frozen',document['candidateCommit'])
    else:
        document=json.loads(a.file.read_text(encoding='utf-8'))
        if document['sourceHashes']!=sources():raise RuntimeError('Selected implementation changed after freeze')
        print('Freeze verified',document['candidateCommit'],len(document['sourceHashes']),'source files')

if __name__=='__main__':main()
