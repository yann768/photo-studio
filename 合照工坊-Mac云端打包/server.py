"""Local-only character segmentation and composition workbench."""
import base64
import hashlib
import gc
import io
import json
import os
import sys
from pathlib import Path
import queue
import threading
import time
import uuid
import math
import zipfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

ROOT = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
if sys.platform == 'darwin' and getattr(sys, 'frozen', False):
    ROOT = Path(sys._MEIPASS)
DATA = (Path.home() / 'Library/Application Support/PhotoStudio') if sys.platform == 'darwin' else ROOT / 'data'
DATA.mkdir(parents=True, exist_ok=True)
PORT = 8765
MODEL = ROOT / 'models/birefnet-lite.onnx'
LOCK = threading.RLock()
TASKS = queue.Queue()
SESSION = None
SESSION_ENGINE = None
MODELS = {'birefnet': MODEL, 'anime': ROOT / 'models/isnet-anime.onnx'}
Image.MAX_IMAGE_PIXELS = 24_000_000

def atomic_json(path, obj):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding='utf-8')
    tmp.replace(path)

def folder(key):
    if len(key) != 32 or any(c not in '0123456789abcdef' for c in key):
        raise ValueError('无效素材编号')
    p = DATA / key
    if not p.is_dir():
        raise ValueError('素材不存在')
    return p

def meta(key):
    return json.loads((folder(key) / 'meta.json').read_text(encoding='utf-8'))

def update(key, **changes):
    with LOCK:
        m = meta(key)
        m.update(changes, updated=time.time())
        atomic_json(folder(key) / 'meta.json', m)
        return m

def image_bytes(value):
    data = base64.b64decode(value.split(',')[-1], validate=True)
    if len(data) > 20 * 1024 * 1024:
        raise ValueError('单张图片不能超过 20MB')
    return data

def load_model(engine='birefnet'):
    global SESSION, SESSION_ENGINE
    if engine not in MODELS:
        raise ValueError('模型名称无效')
    if SESSION is None or SESSION_ENGINE != engine:
        SESSION = None
        gc.collect()
        if not MODELS[engine].exists():
            raise ValueError('模型尚未下载，请运行 setup_model.py')
        opts = ort.SessionOptions()
        opts.enable_cpu_mem_arena = False
        opts.enable_mem_pattern = False
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        opts.intra_op_num_threads = max(1, min(6, (os.cpu_count() or 4) // 2))
        opts.inter_op_num_threads = 1
        SESSION = ort.InferenceSession(str(MODELS[engine]), sess_options=opts, providers=['CPUExecutionProvider'])
        SESSION_ENGINE = engine
    return SESSION

def segment(source, box=None, engine='birefnet'):
    rgba = source.convert('RGBA')
    region = rgba
    rect = None
    if box:
        if not isinstance(box, list) or len(box) != 4:
            raise ValueError('框选区域无效')
        x1, y1, x2, y2 = [int(v) for v in box]
        rect = (max(0, min(x1, rgba.width - 1)), max(0, min(y1, rgba.height - 1)),
                min(rgba.width, x2), min(rgba.height, y2))
        if rect[2] - rect[0] < 8 or rect[3] - rect[1] < 8:
            raise ValueError('框选范围太小')
        region = rgba.crop(rect)
    session = load_model(engine)
    if engine == 'anime':
        scale = 1024 / max(region.size)
        rw, rh = round(region.width * scale), round(region.height * scale)
        left, top = (1024 - rw) // 2, (1024 - rh) // 2
        pixels = np.zeros((1024, 1024, 3), np.float32)
        pixels[top:top+rh, left:left+rw] = np.asarray(region.convert('RGB').resize((rw, rh), Image.Resampling.BILINEAR), dtype=np.float32) / 255
    else:
        pixels = np.asarray(region.convert('RGB').resize((1024, 1024), Image.Resampling.LANCZOS), dtype=np.float32)
        pixels /= max(float(pixels.max()), 1.)
        pixels = (pixels - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
    logits = session.run(None, {session.get_inputs()[0].name: pixels.transpose(2, 0, 1)[None]})[0]
    if engine == 'anime':
        pred = np.clip(np.squeeze(logits)[top:top+rh, left:left+rw], 0, 1)
    else:
        pred = 1. / (1. + np.exp(-np.clip(np.squeeze(logits), -40, 40)))
        span = float(pred.max() - pred.min())
        pred = (pred - pred.min()) / span if span > 1e-6 else np.zeros_like(pred)
    mask_region = Image.fromarray((pred * 255).astype(np.uint8)).resize(region.size, Image.Resampling.LANCZOS)
    mask = Image.new('L', rgba.size)
    mask.paste(mask_region, rect[:2] if rect else (0, 0))
    # Never make originally transparent pixels opaque.
    mask = Image.fromarray((np.asarray(mask, dtype=np.float32) * np.asarray(rgba.getchannel('A')) / 255).astype(np.uint8))
    return mask

def save_result(key, mask):
    p = folder(key)
    source = Image.open(p / 'source.png').convert('RGBA')
    if source.size != mask.size:
        raise ValueError('蒙版尺寸与原图不一致')
    mask.save(p / 'mask.png')
    source.putalpha(mask)
    source.save(p / 'result.tmp', format='PNG')
    (p / 'result.tmp').replace(p / 'result.png')
    for name, size in [('preview.png', (720, 720)), ('thumb.png', (150, 180))]:
        preview = source.copy()
        preview.thumbnail(size, Image.Resampling.LANCZOS)
        preview.save(p / name)
    return mask.getbbox()

def validate_project(obj):
    if not isinstance(obj, dict) or obj.get('version') not in (1, 2):
        raise ValueError('工程版本无效')
    people = obj.get('people')
    if not isinstance(people, list) or len(people) > 500:
        raise ValueError('角色数量无效')
    ratio = obj.get('ratio')
    if type(ratio) not in (int, float) or not math.isfinite(ratio) or not .5 <= ratio <= 3:
        raise ValueError('画布比例无效')
    for person in people:
        if not isinstance(person, dict) or not isinstance(person.get('id'), str):
            raise ValueError('角色数据无效')
        if any(type(person.get(k)) not in (int, float) or not math.isfinite(person[k]) for k in ['x', 'y', 'h']):
            raise ValueError('角色坐标无效')
    return obj

def worker():
    while True:
        key, box = TASKS.get()
        started = time.time()
        try:
            update(key, status='processing', error='')
            source = Image.open(folder(key) / 'source.png')
            engine = meta(key).get('engine', 'birefnet')
            fallback = False
            try:
                mask = segment(source, box, engine)
            except Exception as exc:
                if engine != 'birefnet' or not any(word in str(exc).lower() for word in ['memory', 'allocation', 'bad alloc']):
                    raise
                fallback = True
            if fallback:
                # Leave the exception scope before loading another model so its
                # traceback no longer retains the failed ONNX inference session.
                mask = segment(source, box, 'anime')
                update(key, engine='anime')
            bbox = save_result(key, mask)
            update(key, status='ready', seconds=round(time.time() - started, 2), bounds=bbox,
                   review=('通用模型内存不足，已自动改用动漫模型；请检查结果' if fallback else '请检查帽子、发丝、魔杖和透明特效') if bbox else '未找到前景，请框选角色后重试')
        except Exception as exc:
            update(key, status='failed', error=str(exc)[:500])
        finally:
            TASKS.task_done()

def add_image(name, content, engine='anime'):
    if engine not in MODELS:
        raise ValueError('模型名称无效')
    source = ImageOps.exif_transpose(Image.open(io.BytesIO(content))).convert('RGBA')
    if source.width * source.height > 24_000_000:
        raise ValueError('图片像素过大，请缩小到 2400 万像素以内')
    key = uuid.uuid4().hex
    p = DATA / key
    p.mkdir()
    source.save(p / 'source.png')
    m = dict(id=key, name=Path(name).stem[:80], label=Path(name).stem[:40], status='queued',
             width=source.width, height=source.height, created=time.time(), updated=time.time(), error='', engine=engine)
    atomic_json(p / 'meta.json', m)
    # Import real transparent PNGs without re-segmenting their edges.
    if source.getchannel('A').getextrema()[0] < 250:
        bbox = save_result(key, source.getchannel('A'))
        return update(key, status='ready', bounds=bbox, seconds=0, review='已保留原图透明背景')
    TASKS.put((key, None))
    return m

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if args and 'health' not in str(args[0]):
            super().log_message(fmt, *args)

    def respond(self, value, status=200, mime='application/json; charset=utf-8', filename=None):
        body = json.dumps(value, ensure_ascii=False).encode() if value is None or isinstance(value, (dict, list)) else value
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        return self.headers.get('Host') in [f'127.0.0.1:{PORT}', f'localhost:{PORT}']

    def do_GET(self):
        try:
            if not self.valid_host():
                return self.respond({'error': '仅允许本机访问'}, 403)
            path = urlparse(self.path).path
            if path == '/api/health':
                return self.respond(dict(app='character-photo-studio', version='0.3.0', model=all(p.exists() for p in MODELS.values()), engine='双模型 · 本机 CPU', queued=TASKS.qsize(), sample=(ROOT / 'sample.png').exists(), demo=(ROOT / 'demo.json').exists()))
            if path == '/sample.png':
                return self.respond((ROOT / 'sample.png').read_bytes(), mime='image/png')
            if path == '/api/assets':
                with LOCK:
                    items = [json.loads(p.read_text(encoding='utf-8')) for p in DATA.glob('*/meta.json')]
                return self.respond(sorted(items, key=lambda a: a['created']))
            if path == '/api/project':
                with LOCK:
                    saved = DATA / 'project.json'
                    return self.respond(json.loads(saved.read_text(encoding='utf-8')) if saved.exists() else None)
            if path == '/api/demo':
                return self.respond(json.loads((ROOT / 'demo.json').read_text(encoding='utf-8')) if (ROOT / 'demo.json').exists() else {'ids': []})
            if path == '/api/export':
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as z:
                    for p in DATA.glob('*/meta.json'):
                        m = json.loads(p.read_text(encoding='utf-8'))
                        if m['status'] == 'ready' and (p.parent / 'result.png').exists():
                            name = ''.join(c for c in m['label'] if c not in '/\\:*?"<>|')[:70] or '角色'
                            z.write(p.parent / 'result.png', f'{name}_{m["id"][:6]}.png')
                return self.respond(buffer.getvalue(), mime='application/zip', filename='characters.zip')
            if path.startswith('/asset/'):
                _, _, key, kind = path.split('/')
                if kind not in ['source.png', 'mask.png', 'result.png', 'preview.png', 'thumb.png']:
                    raise ValueError('图片类型无效')
                if kind in ['preview.png', 'thumb.png'] and not (folder(key) / kind).exists():
                    with LOCK:
                        with Image.open(folder(key) / 'result.png') as result:
                            preview = result.copy()
                        preview.thumbnail((720, 720) if kind == 'preview.png' else (150, 180), Image.Resampling.LANCZOS)
                        preview.save(folder(key) / kind)
                return self.respond((folder(key) / kind).read_bytes(), mime='image/png')
            files = {'/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/layout.js': 'layout.js', '/layout-core.js': 'layout-core.js', '/layout.css': 'layout.css', '/calibration.js': 'calibration.js'}
            if path not in files:
                return self.respond({'error': '未找到'}, 404)
            mime = 'text/html; charset=utf-8' if path == '/' else 'text/css; charset=utf-8' if path.endswith('.css') else 'text/javascript; charset=utf-8'
            self.respond((ROOT / files[path]).read_bytes(), mime=mime)
        except Exception as exc:
            self.respond({'error': str(exc)}, 400)

    def do_POST(self):
        try:
            if not self.valid_host() or self.headers.get('Origin', f'http://127.0.0.1:{PORT}') not in [f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}']:
                return self.respond({'error': '仅允许本机页面操作'}, 403)
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 35 * 1024 * 1024:
                raise ValueError('请求大小无效，单张图片不能超过 20MB')
            obj = json.loads(self.rfile.read(length))
            path = urlparse(self.path).path
            if path == '/api/upload':
                return self.respond(add_image(str(obj['name']), image_bytes(obj['image']), obj.get('engine', 'anime')))
            if path == '/api/project':
                with LOCK:
                    atomic_json(DATA / 'project.json', validate_project(obj))
                return self.respond({'ok': True})
            key = obj['id']
            m = meta(key)
            if path == '/api/label':
                return self.respond(update(key, label=str(obj['label'])[:40]))
            if path == '/api/retry':
                with LOCK:
                    m = meta(key)
                    if m['status'] in ['queued', 'processing']:
                        raise ValueError('这个角色正在处理，请稍候')
                    engine = obj.get('engine', m.get('engine', 'birefnet'))
                    if engine not in MODELS:
                        raise ValueError('模型名称无效')
                    box = obj.get('box')
                    if box is not None:
                        if not isinstance(box, list) or len(box) != 4 or any(type(v) not in (int, float) or not np.isfinite(v) for v in box):
                            raise ValueError('框选坐标无效')
                        if box[2] - box[0] < 8 or box[3] - box[1] < 8:
                            raise ValueError('框选区域太小')
                    update(key, status='queued', error='', engine=engine)
                    TASKS.put((key, obj.get('box')))
                return self.respond({'ok': True})
            if path == '/api/mask':
                if m['status'] in ['queued', 'processing']:
                    raise ValueError('请等待模型处理完成')
                mask = Image.open(io.BytesIO(image_bytes(obj['image']))).convert('L')
                alpha = Image.open(folder(key) / 'source.png').getchannel('A')
                if mask.size != alpha.size:
                    raise ValueError('蒙版尺寸不一致')
                mask = Image.fromarray(np.minimum(np.asarray(mask), np.asarray(alpha)))
                bounds = save_result(key, mask)
                return self.respond(update(key, status='ready', bounds=bounds, review='已保存手动修边'))
            self.respond({'error': '未找到接口'}, 404)
        except Exception as exc:
            self.respond({'error': str(exc)}, 400)

def start_worker():
    for p in DATA.glob('*/meta.json'):
        m = json.loads(p.read_text(encoding='utf-8'))
        if m['status'] in ['queued', 'processing']:
            update(m['id'], status='queued')
            TASKS.put((m['id'], None))
    threading.Thread(target=worker, daemon=True).start()

if __name__ == '__main__':
    start_worker()
    print(f'合照工坊 http://127.0.0.1:{PORT}  关闭窗口即可停止。', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
