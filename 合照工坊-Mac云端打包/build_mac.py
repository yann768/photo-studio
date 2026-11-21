from pathlib import Path
import subprocess,sys,platform
assert sys.platform == 'darwin', 'Build on macOS only'
assets=['index.html','app.js','style.css','layout.js','layout-core.js','layout.css','calibration.js','MODEL_LICENSE.txt','ANIME_MODEL_LICENSE.txt']
cmd=[sys.executable,'-m','PyInstaller','--noconfirm','--windowed','--name','PhotoStudio','--osx-bundle-identifier','local.photostudio.app','--collect-all','onnxruntime','--add-data','models:models']
for name in assets: cmd += ['--add-data',name+':.']
cmd += ['desktop_launcher.py']
subprocess.run(cmd,check=True)
print('Built',platform.machine(),Path('dist/PhotoStudio.app').resolve())
