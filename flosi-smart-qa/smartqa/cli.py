import argparse
import json
import platform
import sys
import time
from pathlib import Path
from .engine import correct
from .source_editor import correct_text, EDITOR_PROMPT
from .evaluate import digest, score, summarize
from .provider import Provider, LOCAL_MODEL

ROOT = Path(__file__).resolve().parents[1]

def main():
    p = argparse.ArgumentParser(description='Flosi Smart QA: local experimental dictation engine')
    p.add_argument('command', choices=['correct', 'evaluate'])
    p.add_argument('--input', help='UTF-8 transcript file (or stdin for correct)')
    p.add_argument('--cases', type=Path)
    p.add_argument('--out', type=Path, required=True, help='New output FILE for correct or DIRECTORY for evaluation')
    p.add_argument('--variant', default='smart', choices=['smart', 'source', 'v2', 'v3', 'v4'])
    p.add_argument('--repeat', type=int, default=1)
    p.add_argument('--model', default=LOCAL_MODEL)
    p.add_argument('--endpoint', default='http://127.0.0.1:18765/v1/chat/completions')
    p.add_argument('--groq-free-tier', action='store_true', help='Operator asserts existing account is on free tier; no paid activation')
    p.add_argument('--max-requests', type=int, default=200)
    p.add_argument('--thinking', action='store_true', help='Controlled local reasoning experiment')
    p.add_argument('--max-tokens', type=int, default=768)
    p.add_argument('--reasoning-budget', type=int, default=512)
    args = p.parse_args()
    provider = Provider(endpoint=args.endpoint, model=args.model, free_tier=args.groq_free_tier, max_requests=args.max_requests,
                        thinking=args.thinking, max_tokens=args.max_tokens, reasoning_budget=args.reasoning_budget)
    if args.command == 'correct':
        text = Path(args.input).read_text(encoding='utf-8') if args.input else sys.stdin.read()
        result = correct_text(text, provider) if args.variant == 'source' else correct(text, provider)
        with args.out.open('x', encoding='utf-8', newline='\n') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(json.dumps({'status': result['status'], 'text': result['text']}, ensure_ascii=False))
        return
    if not args.cases or not (1 <= args.repeat <= 5):
        p.error('--cases and repeat in 1..5 required')
    corpus_bytes = args.cases.read_bytes()
    cases = json.loads(corpus_bytes)
    args.out.mkdir(parents=True, exist_ok=False)
    prompt = None
    if args.variant not in ('smart', 'source'):
        prompt = json.loads((ROOT.parent/'flosi-intelligence-lab'/'prompts'/f'{args.variant}.json').read_text())['system']
    manifest = {'schemaVersion': 1, 'mode': 'real_inference', 'variant': args.variant, 'model': args.model,
                'casesSha256': digest(corpus_bytes), 'cases': str(args.cases), 'repeats': args.repeat,
                'startedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'platform': platform.platform(), 'python': sys.version,
                'temperature': 0, 'seed': 42, 'maxCompletionTokens': provider.max_tokens,
                'thinking': provider.thinking if provider.local else 'low', 'reasoningBudget': provider.reasoning_budget if provider.thinking else 0,
                'externalInferenceCostUsd': 0 if provider.local else None,
                'sourceHashes': {str(f.relative_to(ROOT)): digest(f.read_bytes()) for f in (ROOT/'smartqa').glob('*') if f.is_file()},
                'state': 'running'}
    manifest['systemPromptSha256'] = digest(prompt) if prompt else digest(EDITOR_PROMPT) if args.variant == 'source' else digest((ROOT/'smartqa'/'planner.txt').read_text(encoding='utf-8'))
    (args.out/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    rows = []
    with (args.out/'rows.jsonl').open('x', encoding='utf-8', newline='\n') as f:
        for repeat in range(args.repeat):
            for case in cases:
                if provider.groq and provider.last_request:
                    time.sleep(max(0, 15-(time.monotonic()-provider.last_request)))
                if prompt:
                    response = provider.complete(prompt, case['input'])
                    result = {'original': case['input'], 'text': response['content'] if response['status'] == 'ok' else case['input'],
                              'status': 'baseline' if response['status'] == 'ok' else 'provider_error', 'provider': response}
                else:
                    result = correct_text(case['input'], provider) if args.variant == 'source' else correct(case['input'], provider)
                row = {'caseId': case['id'], 'repeat': repeat, 'category': case['category'], 'language': case['language'],
                       'input': case['input'], 'expected': case['expected'], 'result': result, 'evaluation': score(case, result)}
                rows.append(row)
                f.write(json.dumps(row, ensure_ascii=False)+'\n'); f.flush()
                print(case['id'], repeat, result['status'], row['evaluation']['completeAnnotationMatch'], flush=True)
                if provider.stopped:
                    break
            if provider.stopped:
                break
    manifest.update(state='stopped' if provider.stopped else 'complete', stopReason=provider.stopped, summary=summarize(rows), attempts=provider.attempts)
    (args.out/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest['summary'], indent=2))

if __name__ == '__main__':
    main()
