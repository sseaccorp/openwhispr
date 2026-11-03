"""Real Chromium file/text flow. No physical microphone success is claimed."""
import argparse,json,sys,struct
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1];parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=root/'evidence/browser-final');out=parser.parse_args().out;out.mkdir(parents=True,exist_ok=False)
records=[];errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 context=browser.new_context(viewport={'width':1280,'height':1000},permissions=[])
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:18766');expect(page.locator('#provider')).to_contain_text('Audio y corrección',timeout=15000)
 assert page.title()=='Flosi Smart QA'
 tests=[('illustrative_contract','Voy a enviarle el contrato hoy, espera, no, mejor mañana después de revisarlo', 'Voy a enviarle el contrato mañana después de revisarlo.'),
        ('literal_and_negation','La nota dice literalmente "no, espera, mejor vuelve" y no autoriza a nadie a entrar.', 'La nota dice literalmente "no, espera, mejor vuelve" y no autoriza a nadie a entrar.')]
 for name,text,expected in tests:
  page.locator('#original').fill(text)
  with page.expect_response('**/api/correct',timeout=180000) as pending:page.locator('#correct').click()
  response=pending.value;record=response.json();assert response.status==200
  expect(page.locator('#correct')).to_be_enabled(timeout=180000)
  assert page.locator('#final').input_value()==expected,(name,record)
  assert record['text']==expected
  records.append({'test':name,'mode':'real_text_inference_through_browser','result':record})
 source=next(s for s in json.loads((root/'data/human/manifest.json').read_text()) if s['id'].startswith('ami-ES2012'))
 page.locator('#language').select_option('en');page.locator('summary').click();page.locator('#reference').fill(source['reference']);page.locator('summary').click()
 with page.expect_response('**/api/audio',timeout=180000) as pending:page.locator('#audio').set_input_files(str(root/'data/human'/source['file']))
 response=pending.value;record=response.json();assert response.status==200
 expect(page.locator('#correct')).to_be_enabled(timeout=180000)
 assert record['audioSha256']==source['sha256']
 assert 'if we try to sell' in record['asrText']
 assert record['correction']['text']=='Especially if we try to sell 4 million of them.',record['correction']
 assert page.locator('#original').input_value()==record['asrText']
 assert page.locator('#final').input_value()==record['correction']['text']
 records.append({'test':'licensed_human_wav_upload','mode':'real_human_file_browser_asr_correction','result':record})
 page.screenshot(path=str(out/'real-human-audio.png'),full_page=True)
 # No microphone hardware in the cloud. Test actual unavailable-device behavior.
 page.locator('#record').click()
 expect(page.locator('#status')).to_contain_text('No se pudo abrir el micrófono',timeout=15000)
 assert not page.locator('#record').is_disabled()
 records.append({'test':'microphone_unavailable','status':page.locator('#status').inner_text(),'physicalMicrophoneValidated':False})
 page.set_viewport_size({'width':390,'height':844})
 page.screenshot(path=str(out/'mobile.png'),full_page=True)
 assert struct.unpack('>I',(out/'mobile.png').read_bytes()[16:20])[0]==390
 assert not errors,errors
 browser.close()
(out/'results.json').write_text(json.dumps({'browser':'Chromium headless 141 / Playwright 1.56.0','javascriptErrors':errors,'physicalWindowsExecuted':False,'modelAuthentication':'direct model endpoint separately verified 401; backend authorized inferences succeeded','tests':records},ensure_ascii=False,indent=2)+'\n')
print('Browser text cases, real licensed WAV pipeline, unavailable-microphone handling and responsive layout passed. Physical Windows microphone remains unexecuted.',flush=True)
