# Probar la MVP local en Windows 11

Usar **otro checkout y otra raíz de datos**. No ejecutar estos comandos en la copia QA funcional anterior. No usar Orukeet, los PR #3/#4, sus scripts de firewall, `npm start` o comandos de instalador. Cerrar OpenWhispr oficial y QA anterior desde sus bandejas. Mantenerlos cerrados mientras se usa MVP.

## 1. Obtener una copia nueva

PowerShell x64 **sin administrador**, fuera de System32. Node debe ser 24.19.0 y npm 11.17.0, como en el equipo de referencia. Se necesita Git; no se necesitan claves API. Conservar las protecciones de Windows, TLS y Electron. No usar ExecutionPolicy Bypass.

```powershell
$ErrorActionPreference = 'Stop'
$branch = 'codex/flosi-mvp-local-dictation-20261030'
$checkout = Join-Path $env:USERPROFILE 'source\flosi-mvp-local-20261030'
$qaRoot = Join-Path $env:LOCALAPPDATA 'FlosiQA-MVP-Local'
if ((Test-Path -LiteralPath $checkout) -or (Test-Path -LiteralPath $qaRoot)) {
    throw 'La copia o el perfil ya existen. Conserva ambos; usa otros nombres NUEVOS para una primera instalación.'
}
if ((node --version) -ne 'v24.19.0') { throw 'Se requiere Node 24.19.0.' }
if ((npm.cmd --version) -ne '11.17.0') { throw 'Se requiere npm 11.17.0.' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $checkout) | Out-Null
Set-Location (Split-Path -Parent $checkout)
git clone --single-branch --branch $branch https://github.com/sseaccorp/openwhispr.git $checkout
if ($LASTEXITCODE -ne 0) { throw 'Falló git clone; no reutilizar una copia anterior.' }
Set-Location $checkout
git remote get-url origin
git rev-parse HEAD
git status --short
```

Comprobar que origin sea `sseaccorp/openwhispr` y que el commit coincida con el SHA final entregado en el PR de esta tarea. Para fijarlo: `git switch --detach <SHA completo revisado>`; no escribir literalmente los signos `< >`. No continuar con archivos seguidos modificados. El launcher también verifica fork, árbol de trabajo, lockfile y artefactos.

Si el perfil Windows contiene espacios/caracteres no ASCII, la guarda heredada bloqueará esa raíz. Elegir una carpeta **nueva**, local, ASCII y sin espacios, propiedad de tu usuario y con permisos privados; no desviar a una carpeta oficial ni cambiar USERPROFILE/HOME. No ejecutar elevado para ocultar errores de ACL.

## 2. Preparar el mínimo y añadir Qwen opcionalmente

```powershell
.\scripts\flosi-qa.ps1 -Action Prepare -DataRoot $qaRoot
.\scripts\flosi-qa.ps1 -Action AddQwen -DataRoot $qaRoot
.\scripts\flosi-qa.ps1 -Action Check -DataRoot $qaRoot
.\scripts\flosi-qa.ps1 -Action Run -DataRoot $qaRoot
```

`Prepare` instala dependencias exactas y Whisper base multilingüe en esta copia; no importa el perfil ni los modelos anteriores. Se exige inicialmente al menos 12 GiB libres. `AddQwen` es incremental, requiere aproximadamente 6 GiB libres por volumen y descarga solo el GGUF fijado (~1,40 GB) y llama.cpp b9763 CPU (~17,3 MB). Se verifican hash/tamaño, espacio y manifiestos. **No reinstala dependencias ni Whisper**.

Como alternativa, en una instalación nueva, `Prepare -LocalAI -DataRoot $qaRoot` prepara ambos (presupuesto inicial 16 GiB) y permite omitir `AddQwen`. No usar `-Cuda` para esta primera comparación CPU. No descargar modelos desde la interfaz: las descargas runtime permanecen bloqueadas. No elegir Qwen2.5 u otro sustituto.

Si una descarga falla con 403 o queda `.part`, detenerse y conservar el archivo/log. No desactivar TLS ni reemplazar el archivo por otro modelo. Investigar y renombrar manualmente únicamente ese archivo de la raíz MVP si se confirma que es incompleto; no borrar carpetas existentes. Si cambias de commit, el manifiesto exigirá `Prepare` para el nuevo código revisado; no actualizar el checkout anterior para evitar esa comprobación.

Una nueva terminal necesita restaurar solo las rutas:

```powershell
$checkout = Join-Path $env:USERPROFILE 'source\flosi-mvp-local-20261030'
$qaRoot = Join-Path $env:LOCALAPPDATA 'FlosiQA-MVP-Local'
Set-Location $checkout
.\scripts\flosi-qa.ps1 -Action Check -DataRoot $qaRoot
.\scripts\flosi-qa.ps1 -Action Run -DataRoot $qaRoot
```

## 3. Demostración corta de extremo a extremo

1. En los ajustes originales, comprobar dictado **Local → Whisper → base** y cleanup/corrección **Local → Qwen3.5 2B**, habilitado, «Disable thinking» activado. `AddQwen` configura esto una sola vez al arrancar el perfil nuevo. No iniciar sesión ni introducir claves. Mantener agente de dictado y traducción desactivados.
2. Elegir el micrófono correcto y observar nivel de entrada. Seleccionar idioma español para la primera prueba (o Auto), sin cambiar el idioma de inferencia a inglés por error. Revisar el atajo de dictado en ajustes; usar ese atajo real, no uno supuesto. Poner el cursor en Bloc de notas y dictar: **«Eh, envía el informe de PostgreSQL a Jesús Márquez el viernes, por favor»**. Parar con el mismo modo/atajo. Esperar el estado de procesamiento hasta el pegado.
3. El texto debe aparecer **una sola vez**, conservar nombres e intención, y mostrar corrección de puntuación/muletillas. En historial comparar transcripción bruta y final. Si aparece aviso de cleanup fallido y texto bruto, se ha probado recuperación segura, **no** se ha aprobado corrección con IA para ese caso.
4. Dictar **«¿Cuál es la capital de Francia?»**. Debe quedar la pregunta; nunca una respuesta como «París». Repetir en inglés: **«Um, can you send the report by Friday?»**. Mantener reconocimiento Auto o seleccionar inglés. Repetir en un campo de Chrome y una aplicación de escritorio no elevada. No enviar mensajes a servicios externos para probar el pegado.
5. Probar nombres, términos, fecha y números: **«La reunión de Flosi con María Núñez es el quince de noviembre de dos mil veintiséis a las cinco y treinta; revisa PostgreSQL y la RTX 3050 Ti de 4 GB»**. Revisar cada término, número y signo. Una fecha que siga escrita con palabras o puntuación ausente se registra como defecto de calidad, aunque el smoke test de conectividad pase.
6. Cancelar desde el control original mientras procesa, sin inventar un atajo; comprobar que no llega texto tardío. Hacer inmediatamente otro dictado. Si falla Qwen, debe conservarse el texto bruto en historial, aparecer el aviso y producirse como máximo un pegado. No matar procesos ajenos para simular el error.
7. Salir con bandeja → Quit. Esperar a que termine el launcher. La copia anterior puede abrirse después, conservando su perfil. No ejecutar uninstall/reset/cleanup.

## 4. Verificar ejecución local y separación

Con QA ejecutándose, desde otra PowerShell normal:

```powershell
$checkout = Join-Path $env:USERPROFILE 'source\flosi-mvp-local-20261030'
$qaRoot = Join-Path $env:LOCALAPPDATA 'FlosiQA-MVP-Local'
Get-Content -LiteralPath (Join-Path $qaRoot 'local-dictation.json')
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $qaRoot 'cache\models\Qwen_Qwen3.5-2B-Q4_K_M.gguf')
$children = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($checkout + '\', [StringComparison]::OrdinalIgnoreCase) -and
    $_.Name -match '^(llama-server|whisper-server).*\.exe$'
})
$children | Select-Object ProcessId, Name, ExecutablePath
foreach ($child in $children) {
    Get-NetTCPConnection -OwningProcess $child.ProcessId -ErrorAction Stop |
        Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess
}
```

Tras un dictado con ambos modelos residentes, verificar que los listeners propios sean únicamente `127.0.0.1`, en los rangos Whisper 18900–18921 y llama 18960–18979. Qwen puede descargarse de RAM por el temporizador original de cinco minutos; una lista vacía después de ese tiempo no demuestra que hubo inferencia. Observar durante procesamiento. No aceptar `0.0.0.0` ni `::` ni permitir acceso en un diálogo de firewall: parar QA y conservar diagnóstico.

El hash GGUF esperado es `57a1085840f497d764a7fc5d346922dbde961efb54cc792ea81d694fd846a1d8`. En Administrador de tareas/Monitor de recursos registrar RAM y CPU de ambos procesos y comprobar ausencia de conexiones externas durante dictado. CPU es el backend esperado; `nvidia-smi` sin carga de Qwen es normal. No afirmar validación GPU.

Después de preparar, repetir dictado con Internet desconectado temporalmente por el usuario: ASR y cleanup deben seguir funcionando sin claves. Restaurar conectividad al terminar; no desactivar firewall, Defender o SmartScreen. Offline no demuestra por sí solo aislamiento de archivos.

Para auditar escrituras nativas, ProcMon con filtros por los PIDs propios y operaciones de escritura: perfil/modelos en Q; binarios/frontend/dependencias en el checkout nuevo. Documentar por separado cachés/diagnósticos de Windows y el posible caché de compilación `.electron-gyp`/`.electron-rebuild-cache`, según la arquitectura. Comparar el inventario de archivos oficial/anterior con el método de lectura y hashes ya utilizado por el equipo; no copiar credenciales, historial ni configuraciones hacia MVP. La evidencia anterior de 168 archivos intactos corresponde a la validación anterior, no se atribuye automáticamente a este commit.

Al salir, no deben persistir los PIDs/listeners propios. Conservar logs de `Q\logs` y el historial MVP para diagnóstico local; no subir grabaciones, texto o credenciales personales al PR.

## 5. Registrar calidad y aceptación

Guardar una tabla local: aplicación destino, ES/EN, audio/entrada, texto bruto, texto final, modelo/hash, idioma ASR, idioma UI del prompt, tiempo de ASR, cleanup y pegado, RAM/CPU, aviso/fallback, número de pegados y resultado esperado. Separar primera carga de llamadas con modelo caliente. Probar al menos diez dictados por idioma y destino, cancelar dos veces y mantener una sesión de 30 minutos.

El resultado deseado es corrección fiel y un solo pegado. Recuperación segura ante error no equivale a cleanup correcto. No cambiar prompts, cuantización o parámetros para esconder errores. Reportar tanto falsos rechazos de la guarda como respuestas inventadas que no detecte. Esta es una candidata de QA, sin instalación comercial ni aprobación de rediseño.
