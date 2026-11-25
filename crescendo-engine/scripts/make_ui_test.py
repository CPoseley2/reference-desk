#!/usr/bin/env python3
"""Create an isolated browser DOM-event test page inside a generated review folder."""
import argparse,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('review_folder');p.add_argument('--name',default='ui-regression');a=p.parse_args()
 if Path(a.name).name!=a.name or a.name in ('','.', '..'):p.error('Use a single new subdirectory name')
 review=Path(a.review_folder).resolve();source=review/'index.html';out=review/a.name
 if not source.is_file():p.error('Review folder must contain index.html')
 if out.exists():p.error('Choose a new test directory; existing output is preserved')
 html=source.read_text().replace('src="audio-preview.wav"','src="../audio-preview.wav"')
 harness=(ROOT/'tests/dashboard-dom-harness.js').read_text()
 html=html.replace('</html>','<script>'+harness+'</script></html>')
 out.mkdir();(out/'index.html').write_text(html)
 print('Isolated test page:',out/'index.html')
 print('Tested dashboard SHA-256:',hashlib.sha256(source.read_bytes()).hexdigest())
 print('Serve the review folder using serve.py; open /'+a.name+'/index.html. Read #qa-report and test the Input delivery probe separately.')
