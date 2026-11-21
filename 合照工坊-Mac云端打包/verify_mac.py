from pathlib import Path
import json,subprocess,urllib.request,time,os
from PIL import Image,ImageDraw
app=Path('dist/PhotoStudio.app/Contents/MacOS/PhotoStudio').resolve()
assert app.is_file()
out=Path('verification');out.mkdir(exist_ok=True)
image=Image.new('RGB',(128,192),'#ddeedd');draw=ImageDraw.Draw(image);draw.ellipse((40,15,88,63),fill='tan');draw.rectangle((30,60,98,180),fill='navy');image.save(out/'input.png')
for engine in ['anime','birefnet']:
 report=out/(engine+'.json')
 subprocess.run([str(app),'--self-test',engine,'--report',str(report.resolve()),'--test-image',str((out/'input.png').resolve()),'--output',str((out/(engine+'.png')).resolve())],check=True,timeout=180)
 state=json.loads(report.read_text());assert state['ok'] and state['frozen'],state
# Test the real desktop entry, local server and static resources.
proc=subprocess.Popen([str(app)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 for attempt in range(60):
  try:
   with urllib.request.urlopen('http://127.0.0.1:8765/api/health',timeout=1) as r: health=json.load(r)
   break
  except Exception:
   if proc.poll() is not None: raise RuntimeError('Desktop app exited before startup')
   time.sleep(1)
 else: raise RuntimeError('Desktop startup timed out')
 assert health['app']=='character-photo-studio'
 for path in ['/', '/layout.js','/calibration.js','/api/assets']:
  with urllib.request.urlopen('http://127.0.0.1:8765'+path,timeout=5) as r: assert r.status==200
 (out/'startup.json').write_text(json.dumps({'ok':True,'health':health}))
finally:
 proc.terminate()
 try: proc.wait(timeout=10)
 except subprocess.TimeoutExpired: proc.kill();proc.wait()
