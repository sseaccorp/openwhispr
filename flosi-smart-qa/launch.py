"""Download pinned local assets and run an isolated QA session. No API keys needed."""
import argparse
import hashlib
import json
import os
import platform
import shutil
import secrets
import socket
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
import uuid
import venv
import webbrowser
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        while chunk := f.read(1024*1024):
            h.update(chunk)
    return h.hexdigest()

def download(url, target, expected):
    if target.exists():
        if sha256(target) != expected:
            raise RuntimeError(f'Checksum mismatch: {target}. Existing file preserved.')
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name+'.download-'+str(uuid.uuid4()))
    print('Downloading', target.name, flush=True)
    try:
        with urllib.request.urlopen(url, timeout=120) as source, partial.open('xb') as out:
            while chunk := source.read(1024*1024):
                out.write(chunk)
        if sha256(partial) != expected:
            raise RuntimeError('Downloaded checksum mismatch: '+target.name)
        if target.exists():
            raise RuntimeError('Concurrent download detected: '+target.name)
        partial.rename(target)
    finally:
        partial.unlink(missing_ok=True)

def prepare(runtime, install_dependencies=True):
    if sys.version_info < (3, 11) or sys.version_info >= (3, 14):
        raise RuntimeError('Python 3.11–3.13 required; validated with 3.12.14')
    if platform.system() not in ('Windows', 'Linux') or platform.machine().lower() not in ('x86_64', 'amd64'):
        raise RuntimeError('This package supports Windows x64 and Linux x64')
    runtime.mkdir(parents=True, exist_ok=True)
    config = json.loads((ROOT/'assets.json').read_text(encoding='utf-8'))
    python = runtime/'venv'/('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(runtime/'venv')
    if install_dependencies:
        subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '-r', str(ROOT/'requirements.txt')], check=True)
    model = runtime/config['llmFile']
    download(config['llmUrl'], model, config['llmSha256'])
    windows = os.name == 'nt'
    if not windows and platform.system() != 'Linux':
        raise RuntimeError('This launcher supports Windows x64 and Linux x64')
    if platform.machine().lower() not in ('x86_64', 'amd64'):
        raise RuntimeError('This package requires an x64 CPU')
    archive = runtime/('llama.zip' if windows else 'llama.tar.gz')
    download(config['llamaWindowsUrl' if windows else 'llamaLinuxUrl'], archive,
             config['llamaWindowsSha256' if windows else 'llamaLinuxSha256'])
    binaries = runtime/'llama'
    executable = next(binaries.rglob('llama-server.exe' if windows else 'llama-server'), None) if binaries.exists() else None
    if not executable:
        binaries.mkdir(exist_ok=True)
        if windows:
            with zipfile.ZipFile(archive) as z:
                for name in z.namelist():
                    if not (binaries/name).resolve().is_relative_to(binaries.resolve()):
                        raise RuntimeError('Unsafe archive path')
                z.extractall(binaries)
        else:
            with tarfile.open(archive) as t:
                t.extractall(binaries, filter='data')
        executable = next(binaries.rglob('llama-server.exe' if windows else 'llama-server'), None)
    if not executable:
        raise RuntimeError('llama-server missing in verified archive')
    asr = runtime/config['asrDirectory']
    for filename, checksum in config['asrFiles'].items():
        download(f"https://huggingface.co/{config['asrRepository']}/resolve/{config['asrRevision']}/{filename}", asr/filename, checksum)
    asr_source = {'repository':config['asrRepository'],'revision':config['asrRevision'],'files':config['asrFiles']}
    source_file = asr/'source.json'
    if source_file.exists():
        if json.loads(source_file.read_text(encoding='utf-8')) != asr_source:
            raise RuntimeError('Existing ASR source metadata does not match verified assets; file preserved')
    else:
        with source_file.open('x',encoding='utf-8') as f:json.dump(asr_source,f,indent=2)
    return python, executable, model, asr

def port_free(port):
    with socket.socket() as sock:
        try:
            sock.bind(('127.0.0.1', port))
        except OSError as error:
            raise RuntimeError(f'Port {port} is occupied. No existing process was stopped.') from error

def wait_ready(url, process, timeout=120):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    end = time.monotonic()+timeout
    while time.monotonic() < end:
        if process.poll() is not None:
            raise RuntimeError('Child process exited. Inspect the new isolated session logs.')
        try:
            with opener.open(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(.25)
    raise RuntimeError('Local model/server startup timeout; inspect session logs')

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--runtime', type=Path, default=ROOT/'runtime')
    p.add_argument('--prepare-only', action='store_true')
    p.add_argument('--skip-pip', action='store_true', help='Reuse dependencies already installed in this isolated runtime')
    p.add_argument('--no-browser', action='store_true')
    p.add_argument('--threads', type=int, default=min(4, os.cpu_count() or 1))
    args = p.parse_args()
    python, executable, model, asr = prepare(args.runtime, not args.skip_pip)
    if args.prepare_only:
        print('Pinned assets verified. No microphone validation has been performed.'); return
    for port in (18765, 18766):
        port_free(port)
    session = args.runtime/'sessions'/str(uuid.uuid4())
    session.mkdir(parents=True, exist_ok=False)
    children = []
    logs = []
    try:
        for name in ['llm-out.log', 'llm-error.log', 'qa-out.log', 'qa-error.log']:
            logs.append((session/name).open('xb'))
        local_token = secrets.token_urlsafe(32)
        llm_env = {**os.environ, 'LLAMA_API_KEY': local_token}
        qa_env = {**os.environ, 'FLOSI_SMART_LOCAL_TOKEN': local_token}
        children.append(subprocess.Popen([str(executable), '-m', str(model), '--alias', model.stem,
            '--host', '127.0.0.1', '--port', '18765', '-c', '8192', '-t', str(args.threads), '-np', '1',
            '--jinja', '--n-gpu-layers', '0', '--cors-origins', 'http://127.0.0.1:18766', '--no-webui'],
            env=llm_env, stdout=logs[0], stderr=logs[1]))
        wait_ready('http://127.0.0.1:18765/health', children[-1])
        children.append(subprocess.Popen([str(python), '-m', 'smartqa.server', '--asr-model', str(asr),
            '--runtime', str(args.runtime)], cwd=ROOT, env=qa_env, stdout=logs[2], stderr=logs[3]))
        wait_ready('http://127.0.0.1:18766/api/status', children[-1])
        print('Flosi Smart QA: http://127.0.0.1:18766\nSession logs: '+str(session)+'\nCtrl+C stops only these two new processes.', flush=True)
        if not args.no_browser:
            webbrowser.open('http://127.0.0.1:18766')
        while all(c.poll() is None for c in children):
            time.sleep(.5)
    except KeyboardInterrupt:
        pass
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait()
        for log in logs:
            log.close()

if __name__ == '__main__':
    main()
