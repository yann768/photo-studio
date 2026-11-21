"""Download the public rembg conversion of BiRefNet Lite, with checksum verification."""
from pathlib import Path
import urllib.request
import hashlib

root = Path(__file__).resolve().parent
target = root / 'models/birefnet-lite.onnx'
target.parent.mkdir(exist_ok=True)
checksum = '4fab47adc4ff364be1713e97b7e66334'
if not target.exists() or hashlib.md5(target.read_bytes()).hexdigest() != checksum:
    tmp = target.with_suffix('.download')
    print('正在下载 BiRefNet Lite（约 224MB），只需下载一次。', flush=True)
    urllib.request.urlretrieve('https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx', tmp)
    if hashlib.md5(tmp.read_bytes()).hexdigest() != checksum:
        raise RuntimeError('模型校验失败，请重新下载')
    tmp.replace(target)
print('模型校验通过，可离线使用。')
anime = root / 'models/isnet-anime.onnx'
anime_md5 = '6f184e756bb3bd901c8849220a83e38e'
if not anime.exists() or hashlib.md5(anime.read_bytes()).hexdigest() != anime_md5:
    tmp = anime.with_suffix('.download')
    print('正在下载 IS-Net Anime（约 176MB）。', flush=True)
    urllib.request.urlretrieve('https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx', tmp)
    if hashlib.md5(tmp.read_bytes()).hexdigest() != anime_md5:
        raise RuntimeError('动漫模型校验失败，请重新下载')
    tmp.replace(anime)
print('两个模型均已就绪。')
