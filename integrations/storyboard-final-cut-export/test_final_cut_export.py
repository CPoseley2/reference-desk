import base64, copy, hashlib, json, struct, sys, tempfile, unittest, wave, zlib
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch
import final_cut_export as f

def png(w,h):
    def chunk(k,b):return struct.pack('>I',len(b))+k+b+struct.pack('>I',zlib.crc32(k+b)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\x00'+b'\xff\x00\x00'*w)*h))+chunk(b'IEND',b'')

class ExportTests(unittest.TestCase):
 def setUp(self):
    self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.r=Path(self.tmp.name).resolve();self.eid='a'*16
    for name in ['view-data','image-libraries','feedback/arrangements']:(self.r/name).mkdir(parents=True)
    self.image=self.r/'image.png';self.image.write_bytes(png(80,40))
    self.second=self.r/'second.png';self.second.write_bytes(png(100,50))
    audio=self.r/'song.wav'
    with wave.open(str(audio),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(48000);w.writeframes(b'\0'*48000*4*2)
    self.view={'sha256':'sourcehash','audio':[str(audio)]}
    self.entry={'id':self.eid,'title':'Test version','song':'Song','path':str(self.r/'source.json'),'source_signature':{}}
    self.cat={'source_sha256':'sourcehash','slots':[{'id':'1','title':'first','start':0,'end':1},{'id':'2','title':'second','start':1,'end':2}],'assets':[{'id':'a','image':str(self.image),'crop':[0,0,.5,1]},{'id':'b','image':str(self.second),'crop':None}]}
    self.state={'revision':3,'assignments':{'1':'b','2':'a'}}
    self.write();self.data={'id':self.eid,'fps':'25','audio_index':0}
 def write(self):
    (self.r/'inventory.json').write_text(json.dumps({'entries':[self.entry]}));(self.r/'view-data'/f'{self.eid}.js').write_text('window.VIEW='+json.dumps(self.view)+';')
    (self.r/'image-libraries'/f'{self.eid}.json').write_text(json.dumps(self.cat));(self.r/'feedback/arrangements'/f'{self.eid}.json').write_text(json.dumps(self.state))
 def approved(self,p):return Path(p).resolve().is_relative_to(self.r)
 def snap(self):return f.snapshot(self.r,self.data,self.approved,Path)
 def test_current_assignment_crop_and_audio(self):
    s=self.snap();self.assertEqual(s['shots'][0]['asset_id'],'b');self.assertEqual(s['shots'][1]['crop_pixels'],[0,0,40,40]);self.assertEqual(s['frames'],50);self.assertEqual(s['audio']['channels'],2)
 def test_missing_selection_and_gap_block(self):
    self.state['assignments']['1']=None;self.write()
    with self.assertRaisesRegex(f.ExportError,'Shot 1'):self.snap()
    self.state['assignments']['1']='a';self.cat['slots'][1]['start']=1.5;self.write()
    with self.assertRaisesRegex(f.ExportError,'timing'):self.snap()
 def test_timing_revision_and_audio_identity(self):
    (self.r/'beat-edits').mkdir();(self.r/'feedback/timings').mkdir()
    cfg={'fps':25,'shot_ids':['1','2'],'initial_end_frames':[25,50],'audio_sha256':hashlib.sha256((self.r/'song.wav').read_bytes()).hexdigest()}
    (self.r/'beat-edits'/f'{self.eid}.json').write_text(json.dumps(cfg));(self.r/'feedback/timings'/f'{self.eid}.json').write_text(json.dumps({'revision':2,'end_frames':[15,50]}))
    s=self.snap();self.assertEqual(s['shots'][0]['end_frame'],15);self.assertEqual(s['timing_revision'],2)
    cfg['audio_sha256']='wrong';(self.r/'beat-edits'/f'{self.eid}.json').write_text(json.dumps(cfg))
    with self.assertRaises(f.Conflict):self.snap()
 def test_fractional_rate_preserves_tail(self):
    self.data['fps']='24000/1001';s=self.snap();self.assertGreaterEqual(s['duration'],s['audio']['duration']);self.assertLess(s['duration']-2,float(1/Fraction(self.data['fps'])))
    self.assertEqual(s['shots'][0]['end_frame'],s['shots'][1]['start_frame'])
 def test_embedded_recording(self):
    self.view['audio']=['data:audio/wav;base64,'+base64.b64encode((self.r/'song.wav').read_bytes()).decode()];self.write();s=self.snap();self.assertEqual(s['audio']['duration'],2);self.assertTrue(f.redact(s)['audio']['source'].startswith('embedded:'))
 def test_changed_source_and_unauthorized_path(self):
    self.entry['source_signature']={str(self.image):[1,1]};self.write()
    with self.assertRaises(f.Conflict):self.snap()
    self.entry['source_signature']={};self.cat['assets'][1]['image']='/etc/hosts';self.write()
    with self.assertRaisesRegex(f.ExportError,'Unregistered'):self.snap()
 @unittest.skipUnless(Path('/Applications/Final Cut Pro.app/Contents/Frameworks/Interchange.framework/Versions/A/Resources/FCPXMLv1_10.dtd').is_file(), 'Full package validation requires the installed Final Cut FCPXML 1.10 DTD')
 def test_package_xml_import_structure(self):
    s=self.snap();s.update(export_id='b'*32,created_at='test');r=f.build_package(self.r,s,self.approved,Path)
    path=Path(r['folder']);xml=f.ET.parse(path/'Storyboard.fcpxml');spine=xml.find('.//spine')
    self.assertEqual(len(spine.findall('video')),2);self.assertEqual(len(xml.findall('.//asset-clip')),1)
    self.assertEqual(xml.find('.//asset-clip').get('duration'),'2/1s')
    manifest=json.loads((path/'export-manifest.json').read_text());cropped=path/manifest['shots'][1]['packaged_path'];self.assertEqual(f.image_size(cropped.read_bytes(),'.png'),(40,40));self.assertTrue((path/'Final-Cut-Package.zip').exists())
 def test_change_after_preflight_rejected(self):
    s=self.snap();s.update(export_id='c'*32,created_at='test');self.second.write_bytes(png(50,50))
    with self.assertRaises(f.Conflict):f.build_package(self.r,s,self.approved,Path)
    self.assertFalse((self.r/'exports/final-cut'/('c'*32)).exists())
 def test_stale_fingerprint_and_idempotency(self):
    s=self.snap();data={**self.data,'fingerprint':'wrong','mutation_id':'d'*32}
    import threading
    atomic=lambda p,d:p.write_text(json.dumps(d))
    with self.assertRaises(f.Conflict):f.start_job(self.r,data,self.approved,Path,atomic,threading.RLock())
    self.assertFalse(f.job_path(self.r,'d'*32).exists())
    p=f.job_path(self.r,'d'*32);p.parent.mkdir(exist_ok=True);p.write_text(json.dumps({'fingerprint':s['fingerprint'],'status':'ready'}));data['fingerprint']=s['fingerprint']
    self.assertEqual(f.start_job(self.r,data,self.approved,Path,atomic,threading.RLock()),{'job_id':'d'*32})

if __name__=='__main__':unittest.main()
