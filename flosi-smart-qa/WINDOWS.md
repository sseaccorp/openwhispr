# Windows PowerShell — una instalación nueva, sin tocar Flosi QA

**Validación física pendiente.** Se han probado código, inferencias y archivos de
voz humana en Linux. No se ha ejecutado este launcher en Windows ni se ha probado
el micrófono físico del usuario. Una captura de pantalla de Chromium no cambia
ese estado. Esta es una herramienta de evaluación, no una versión de producción.

Requisitos: Windows x64, Python 3.12 x64, Edge o Chrome actualizado, espacio libre
de al menos 6 GB en la carpeta nueva y acceso HTTPS a PyPI, GitHub y Hugging Face
durante la preparación. Se recomiendan 16 GB de RAM. No requiere Node, Git, una
clave API ni modificar la configuración de Flosi QA. Las dependencias de Windows
todavía deben verificarse en ese sistema. El ZIP incluye el código, WAV
humanos licenciados y evidencia; los modelos se descargan con hashes fijos.

1. Descarga el ZIP **Flosi-Smart-QA-P0.zip** desde el enlace de distribución del PR de la entrega. Conserva tu
   instalación anterior y sus carpetas de experimentos.
2. Abre PowerShell. Comprueba Python:

```powershell
py -3.12 --version
```

Si falta, instala Python 3.12 x64 y vuelve a abrir PowerShell:

```powershell
winget install --exact --id Python.Python.3.12 --scope user --source winget
```

Si `winget` no existe, el instalador oficial está en
https://www.python.org/downloads/windows/ — elige Python 3.12 x64 e instala el
launcher `py`. Después vuelve a comprobar el comando anterior. No continúes si
no devuelve una versión 3.12.

3. Ejecuta este bloque. Abre un selector para elegir el ZIP descargado, crea una
   carpeta única bajo Documentos y lanza la herramienta. No utiliza el checkout
   anterior ni presupone el nombre o ubicación de Descargas.

```powershell
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$zipPicker = New-Object System.Windows.Forms.OpenFileDialog
$zipPicker.Filter = 'Flosi Smart QA ZIP (*.zip)|*.zip'
$zipPicker.Title = 'Selecciona Flosi-Smart-QA-P0.zip'
if ($zipPicker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    throw 'No se seleccionó el ZIP.'
}
$documentsPath = [Environment]::GetFolderPath('MyDocuments')
if (-not $documentsPath) { throw 'Windows no devolvió la carpeta Documentos.' }
$newFolder = Join-Path $documentsPath ('FlosiSmartQA-P0-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $newFolder | Out-Null
Expand-Archive -LiteralPath $zipPicker.FileName -DestinationPath $newFolder
$smartFolder = Join-Path $newFolder 'flosi-smart-qa'
if (-not (Test-Path -LiteralPath (Join-Path $smartFolder 'Start-SmartQA.ps1'))) {
    throw 'El ZIP seleccionado no tiene la estructura esperada.'
}
Set-Location -LiteralPath $smartFolder
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-SmartQA.ps1
```

La excepción de política se limita a ese proceso de PowerShell. La primera
preparación instala dependencias únicamente en `runtime\venv`, descarga unos
4 GB de modelos y verifica SHA-256. El launcher rechaza puertos ocupados y
archivos con hashes incorrectos. No termina procesos ajenos. Abre
`http://127.0.0.1:18766`. Si el navegador no se abre, introduce esa URL después
del mensaje `Flosi Smart QA` en la consola. La consola debe permanecer abierta.

4. En la interfaz, selecciona Español o English. Puedes empezar con texto y
   después usar **Grabar dictado**. Acepta el permiso de micrófono del navegador,
   habla, pulsa **Detener y corregir** y compara las dos columnas. La grabación
   se detiene a los 90 segundos. Puedes escucharla en el reproductor.
5. Comprueba una autocorrección, una instrucción adicional, una negación con
   condición y una cita literal. Usa palabras tuyas, incluyendo un caso que el
   motor anterior haya fallado. Introduce qué dijiste en Referencia si deseas
   medir WER. Una referencia a lo dicho incluye las autocorrecciones habladas;
   la salida corregida deseada debe revisarse aparte.
6. Para reproducir el audio público de AMI, elige **Abrir audio WAV** y selecciona
   `data\human\ami-ES2012a-D-785.35-791.77.wav` dentro de esta carpeta. Esta prueba
   usa voz humana real, pero abrir un archivo no valida el micrófono físico.
7. **Guardar audio y evidencia** es opcional y está desactivado por defecto.
   Guarda una carpeta nueva por prueba bajo `runtime\runs\<UUID>`, con WAV,
   referencia, ASR original, texto final, cambios, tiempos y uso de tokens.
   **Descargar resultado JSON** funciona aunque no actives esa persistencia.
8. Si un resultado dice rechazado, pendiente de revisión o error, el texto
   original se conserva. No lo cuentes como una autocorrección lograda. Ningún
   resultado se pega automáticamente en otra aplicación.
9. Para detener, vuelve a la consola y pulsa Ctrl+C. Solo se cierran los dos
   procesos que ha creado el launcher. Puedes volver a abrir la versión anterior
   de Flosi QA con su acceso habitual; esta herramienta nunca accede a sus datos.

Para sesiones posteriores, desde esta misma carpeta:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-SmartQA.ps1 -SkipPip
```

Para ejecutar solo las pruebas de código:

```powershell
.\runtime\venv\Scripts\python.exe -m unittest discover -s tests -v
```

Para repetir el pipeline completo de los ocho WAV, con la aplicación arrancada,
abre OTRA consola PowerShell en esta carpeta y ejecuta:

```powershell
$audioRun = Join-Path 'runs' ('audio-win-' + [guid]::NewGuid().ToString('N'))
.\runtime\venv\Scripts\python.exe .\run_audio.py --manifest .\data\human\manifest.json --via-ui --out $audioRun
```

No dictes mientras se ejecuta ese lote: comparten el mismo proceso del modelo.
El script crea una carpeta nueva, nunca sobrescribe otra ejecución y no envía
las referencias al ASR ni al corrector.

Si aparece un error de DLL al iniciar llama.cpp o CTranslate2, comprueba la
dependencia oficial Microsoft Visual C++ Runtime x64. Su instalación, si falta,
se hace explícitamente en Windows; no se declara validada desde cloud:

```powershell
winget install --exact --id 'Microsoft.VCRedist.2015+.x64' --source winget
```

Los errores quedan en una carpeta nueva `runtime\sessions\<UUID>`. No pegues
credenciales en la interfaz ni en un informe. El launcher local no las necesita.
Cuando falle un puerto ocupado, cierra únicamente tu sesión Smart QA anterior
o utiliza su propia consola; el script no mata procesos para liberar puertos.

Groq es una opción de investigación adicional, no el flujo predeterminado. Solo
se puede usar con una credencial ya configurada y una cuenta con cuota gratuita
confirmada. No se hicieron peticiones a Groq en cloud y no se autoriza activar
facturación. El adaptador registra errores y cuota de peticiones; no prueba por
sí mismo si una cuenta externa tiene facturación habilitada.

Para comprobar que el código extraído coincide con la congelación evaluada:

```powershell
.\runtime\venv\Scripts\python.exe .\freeze.py verify --file .\evidence\freeze-release.json
```

Para repetir la última batería textual, con la aplicación arrancada y sin dictar
al mismo tiempo, desde OTRA consola situada en esta carpeta:

```powershell
$textRun = Join-Path 'runs' ('text-win-' + [guid]::NewGuid().ToString('N'))
.\runtime\venv\Scripts\python.exe .\experiments\evaluate_via_ui.py --cases .\data\release-validation.json --out $textRun
```

Para los cuatro audios del último candidato (dos controles nuevos y dos
regresiones conocidas), usa el mismo flujo del lote de audio cambiando
`--manifest` por `.\data\human-release\manifest.json` y una carpeta `--out` nueva.
Los resultados cloud de esos lotes incluyen fallos; no se espera ni se promete
aprobación completa en Windows. El micrófono se valida con el flujo de grabación
y datos propios nuevos, no por repetir estos archivos.
