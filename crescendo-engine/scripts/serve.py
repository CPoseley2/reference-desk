#!/usr/bin/env python3
"""Serve one review folder on loopback with byte ranges for audio seeking."""
import argparse, functools, re
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.byte_range=None
        path=Path(self.translate_path(self.path))
        if not path.resolve().is_relative_to(Path(self.directory).resolve()):
            self.send_error(403);return None
        if self.headers.get('Range') and path.is_file():
            size=path.stat().st_size;m=re.fullmatch(r'bytes=(\d+)-(\d*)',self.headers['Range'])
            if not m:self.send_error(416);return None
            start=int(m[1]);end=min(int(m[2]) if m[2] else size-1,size-1)
            if start>=size or end<start:self.send_error(416);return None
            f=path.open('rb');f.seek(start);self.byte_range=(start,end)
            self.send_response(206);self.send_header('Content-Type',self.guess_type(str(path)));self.send_header('Accept-Ranges','bytes')
            self.send_header('Content-Range',f'bytes {start}-{end}/{size}');self.send_header('Content-Length',str(end-start+1));self.end_headers();return f
        return super().send_head()
    def copyfile(self,source,out):
        try:
            if self.byte_range:
                left=self.byte_range[1]-self.byte_range[0]+1
                while left:
                    data=source.read(min(65536,left))
                    if not data:break
                    out.write(data);left-=len(data)
            else:super().copyfile(source,out)
        except (BrokenPipeError,ConnectionResetError):pass

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory');p.add_argument('--port',type=int,default=8946);a=p.parse_args()
    root=Path(a.directory).resolve()
    if not (root/'index.html').is_file():p.error('Select a generated dashboard directory')
    print(f'Open http://127.0.0.1:{a.port}/ — serving {root}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',a.port),functools.partial(Handler,directory=str(root))).serve_forever()
