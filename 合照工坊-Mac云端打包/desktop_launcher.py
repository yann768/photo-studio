"""Desktop launcher for Windows and macOS."""
import argparse
import json
import logging
import os
from pathlib import Path
import sys
import subprocess
import threading
import time
import urllib.request
import webbrowser

def self_test(args):
    import server
    from PIL import Image
    result = {'ok': False, 'frozen': bool(getattr(sys, 'frozen', False)), 'engine': args.self_test}
    try:
        for name in ['index.html', 'style.css', 'layout.css', 'app.js', 'layout.js', 'layout-core.js', 'calibration.js']:
            if not (server.ROOT / name).is_file():
                raise RuntimeError('缺少程序文件：' + name)
        if args.test_image:
            with Image.open(args.test_image) as original:
                source = original.convert('RGBA')
        else:
            source = Image.new('RGBA', (96, 128), (220, 220, 220, 255))
            from PIL import ImageDraw
            draw = ImageDraw.Draw(source)
            draw.ellipse((30, 12, 66, 48), fill='#aa3344')
            draw.rectangle((24, 45, 72, 115), fill='#334477')
        started = time.time()
        mask = server.segment(source, engine=args.self_test)
        if mask.size != source.size:
            raise RuntimeError('蒙版尺寸错误')
        source.putalpha(mask)
        if args.output:
            source.save(args.output)
        result.update(ok=True, seconds=round(time.time()-started, 2), size=source.size, providers=server.SESSION.get_providers())
    except Exception as exc:
        result['error'] = str(exc)
    Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if result['ok'] else 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', choices=['anime', 'birefnet'])
    parser.add_argument('--report')
    parser.add_argument('--test-image')
    parser.add_argument('--output')
    args = parser.parse_args()
    if args.self_test:
        if not args.report:
            parser.error('--report is required for --self-test')
        return self_test(args)

    import tkinter as tk
    from tkinter import messagebox, ttk
    root = tk.Tk()
    root.title('合照工坊 · 本地版')
    root.geometry('500x430')
    root.minsize(500, 430)
    try:
        import server
    except Exception as exc:
        messagebox.showerror('无法启动', str(exc));root.destroy();return 1
    log = open(server.DATA / 'desktop.log', 'a', encoding='utf-8', buffering=1)
    previous_stdout, previous_stderr = sys.stdout, sys.stderr
    sys.stdout = log
    sys.stderr = log
    logging.basicConfig(stream=log, level=logging.INFO)
    # If our app is already running, reuse it rather than creating competing queues.
    for port in range(8765, 8775):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=.25) as r:
                state = json.loads(r.read())
            if state.get('app') == 'character-photo-studio':
                webbrowser.open(f'http://127.0.0.1:{port}')
                root.destroy();return 0
        except Exception:
            pass
    httpd = None
    for port in range(8765, 8775):
        try:
            server.PORT = port
            httpd = server.ThreadingHTTPServer(('127.0.0.1', port), server.Handler)
            break
        except OSError:
            continue
    if httpd is None:
        messagebox.showerror('无法启动', '本机端口 8765～8774 均不可用。请关闭其他合照工坊窗口后重试。');root.destroy();return 1
    server.start_worker()
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.PORT}'
    frame = ttk.Frame(root, padding=26);frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='合照工坊', font=('Microsoft YaHei UI', 23)).pack(anchor='w')
    ttk.Label(frame, text='本地 AI 抠图 · 多人合照排版', font=('Microsoft YaHei UI', 11)).pack(anchor='w', pady=(5, 18))
    ttk.Label(frame, text='服务已启动，图片仅在这台电脑处理。').pack(anchor='w')
    ttk.Label(frame, text=url).pack(anchor='w', pady=(5, 12))
    ttk.Button(frame, text='打开合照工坊', command=lambda:webbrowser.open(url)).pack(fill='x', pady=4)
    def open_data():
        if sys.platform == 'darwin':
            subprocess.Popen(['open', str(server.DATA)])
        else:
            os.startfile(server.DATA)
    ttk.Button(frame, text='打开素材与草稿文件夹', command=open_data).pack(fill='x', pady=4)
    def close():
        with server.LOCK:
            pending = server.TASKS.unfinished_tasks
        if pending and not messagebox.askyesno('还有图片正在处理', '退出会中断当前抠图，未完成任务下次启动后会重新处理。仍要退出吗？'):
            return
        try:
            httpd.shutdown();httpd.server_close()
        finally:
            root.destroy()
    ttk.Button(frame, text='退出工具', command=close).pack(fill='x', pady=(12, 4))
    ttk.Label(frame, text='关闭本窗口会停止本地服务；关闭浏览器不会退出工具。', foreground='#667466').pack(anchor='w', pady=(8, 0))
    root.protocol('WM_DELETE_WINDOW', close)
    webbrowser.open(url)
    root.mainloop()
    sys.stdout, sys.stderr = previous_stdout, previous_stderr
    log.close()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
