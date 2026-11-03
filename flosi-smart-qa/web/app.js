const $ = id => document.getElementById(id);
let latest = null, recording = null, audioUrl = null;
const setStatus = text => { $('status').textContent = text; };
async function request(path, body) {
  const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Error al procesar');
  return result;
}
function show(result) {
  latest = result;
  const correction = result.correction || result;
  if (result.asrText !== undefined) $('original').value = result.asrText;
  $('final').value = correction.text;
  const labels = {edited:'Cambios aplicados · revisa el resultado', unchanged:'Sin cambios propuestos · revisa el resultado', needs_review:'Pendiente de revisión · se conserva el original', rejected:'Plan rechazado · se conserva el original', provider_error:'Proveedor no disponible · se conserva el original', asr_empty:'ASR sin texto reconocido'};
  setStatus(labels[correction.status] || correction.status);
  $('metrics').textContent = JSON.stringify(result, null, 2);
}
async function task(fn) {
  latest=null; $('final').value=''; $('metrics').textContent='Procesando…';
  for (const id of ['record','correct','audio','copy','download','language']) $(id).disabled = true;
  try { await fn(); }
  catch (error) { setStatus('Error: '+error.message+'. Tu texto original sigue disponible.'); }
  finally { for (const id of ['record','correct','audio','language']) $(id).disabled = false; $('copy').disabled=!latest; $('download').disabled=!latest; }
}
$('correct').onclick = () => task(async () => {
  setStatus('Interpretando el texto…');
  show(await request('/api/correct',{text:$('original').value, saveEvidence:$('save').checked}));
});
async function processAudio(blob) {
  if (blob.size > 25*1024*1024) throw new Error('El audio supera 25 MiB');
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(blob); $('playback').src = audioUrl; $('playback').hidden = false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = ''; for (let i=0; i<bytes.length; i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  setStatus('Reconociendo voz y aplicando corrección…');
  show(await request('/api/audio',{audioBase64:btoa(binary), language:$('language').value, reference:$('reference').value, saveEvidence:$('save').checked}));
}
$('audio').onchange = () => { const file = $('audio').files[0]; if(file) task(() => processAudio(file)); };
function wav(chunks, rate) {
  const count = chunks.reduce((n,c)=>n+c.length,0), buffer = new ArrayBuffer(44+count*2), view = new DataView(buffer);
  const string = (at,s)=>{ for(let i=0;i<s.length;i++) view.setUint8(at+i,s.charCodeAt(i)); };
  string(0,'RIFF');view.setUint32(4,36+count*2,true);string(8,'WAVE');string(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);string(36,'data');view.setUint32(40,count*2,true);
  let at=44; for(const chunk of chunks) for(const sample of chunk) { const s=Math.max(-1,Math.min(1,sample)); view.setInt16(at,s<0?s*32768:s*32767,true);at+=2; }
  return new Blob([buffer],{type:'audio/wav'});
}
async function stopCapture() {
  const r = recording; recording = null; clearTimeout(r.timer);
  r.node.disconnect(); r.source.disconnect(); r.sink.disconnect(); r.stream.getTracks().forEach(t=>t.stop());
  await r.context.close(); $('record').textContent='Grabar dictado';
  return wav(r.chunks,r.rate);
}
$('record').onclick = async () => {
  if (recording) { const blob = await stopCapture(); return task(()=>processAudio(blob)); }
  let stream, context;
  $('record').disabled=true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    context = new AudioContext(); await context.audioWorklet.addModule('/capture.js'); await context.resume();
    const source = context.createMediaStreamSource(stream), node = new AudioWorkletNode(context,'flosi-capture'), sink=context.createGain(), chunks=[];
    sink.gain.value=0; source.connect(node);node.connect(sink);sink.connect(context.destination);
    node.port.onmessage=e=>chunks.push(e.data);
    recording={stream,context,source,node,sink,chunks,rate:context.sampleRate,timer:setTimeout(()=>$('record').click(),90000)};
    $('correct').disabled=true; $('audio').disabled=true; $('language').disabled=true; $('copy').disabled=true; $('download').disabled=true;
    $('record').textContent='Detener y corregir';setStatus('Grabando · límite de 90 segundos');
  } catch(error) {
    stream?.getTracks().forEach(t=>t.stop()); if(context) await context.close();
    setStatus('No se pudo abrir el micrófono: '+error.message);
  } finally { $('record').disabled=false; }
};
$('copy').onclick=async()=>{ try {await navigator.clipboard.writeText($('final').value);setStatus('Resultado copiado.');}catch{setStatus('Selecciona el resultado y usa Ctrl+C.');} };
$('download').onclick=()=>{ if(!latest)return setStatus('Primero procesa un dictado.');const url=URL.createObjectURL(new Blob([JSON.stringify(latest,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='flosi-smart-qa-result.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); };
fetch('/api/status').then(r=>r.json()).then(s=>{$('provider').textContent=s.provider==='local'?'Audio y corrección se procesan en este equipo. Guardar evidencia es opcional.':'ASR local. La transcripción se envía a Groq mediante tu configuración existente.';}).catch(()=>setStatus('El servidor local no responde.'));
