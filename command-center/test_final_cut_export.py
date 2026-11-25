import shutil
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
    if not shutil.which("ffprobe") or not shutil.which("ffmpeg"):self.skipTest("ffmpeg and ffprobe required")
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
 @unittest.skipUnless(Path("/Applications/Final Cut Pro.app/Contents/Frameworks/Interchange.framework/Versions/A/Resources/FCPXMLv1_10.dtd").exists(), "Final Cut Pro XML schema required")
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
 def test_fixed_without_recording_or_saved_timing(self):
    self.view['audio']=[];self.cat['slots'][0]['start']=None;self.cat['slots'][1]['end']=None;self.write()
    (self.r/'song.wav').unlink();self.data={'id':self.eid,'fps':'25','timing_mode':'fixed','seconds_per_clip':3.5}
    s=self.snap();self.assertIsNone(s['audio']);self.assertEqual(s['frames'],176);self.assertEqual(s['duration'],7.04)
    self.assertEqual([(v['start_frame'],v['end_frame']) for v in s['shots']],[(0,88),(88,176)])
    self.assertIsNone(f.summary(s)['audio_duration']);self.assertIsNone(f.redact(s)['audio'])
    opts=f.options(self.r,self.eid);self.assertEqual(opts['shot_count'],2);self.assertEqual(opts['timing_mode'],'fixed')
 def test_fixed_ignores_recording_bound_timing(self):
    (self.r/'beat-edits').mkdir();(self.r/'beat-edits'/f'{self.eid}.json').write_text(json.dumps({'fps':25,'shot_ids':['old-shot'],'initial_end_frames':[5],'audio_sha256':'wrong'}))
    self.data.update(timing_mode='fixed',seconds_per_clip=5);s=self.snap()
    self.assertEqual(s['duration'],10);self.assertIsNone(s['timing_revision']);self.assertIsNone(s['audio'])
 def test_fixed_duration_validation_and_fingerprint(self):
    self.data.update(timing_mode='fixed',seconds_per_clip=5);first=self.snap()
    self.data['seconds_per_clip']=6;self.assertNotEqual(first['fingerprint'],self.snap()['fingerprint'])
    for value in [None,True,'5',0,-1,.001,3601,float('nan'),float('inf')]:
      self.data['seconds_per_clip']=value
      with self.subTest(value=value),self.assertRaises(f.ExportError):self.snap()
 def test_fixed_fractional_fps_equal_clips(self):
    self.data.update(timing_mode='fixed',seconds_per_clip=5,fps='24000/1001');s=self.snap()
    self.assertEqual([v['end_frame']-v['start_frame'] for v in s['shots']],[120,120]);self.assertEqual(s['frames'],240);self.assertAlmostEqual(s['duration'],10.01)
 @unittest.skipUnless(Path("/Applications/Final Cut Pro.app/Contents/Frameworks/Interchange.framework/Versions/A/Resources/FCPXMLv1_10.dtd").exists(), "Final Cut Pro XML schema required")
 def test_fixed_package_has_no_audio(self):
    self.data.update(timing_mode='fixed',seconds_per_clip=5);s=self.snap();s.update(export_id='e'*32,created_at='test')
    result=f.build_package(self.r,s,self.approved,Path);folder=Path(result['folder']);xml=f.ET.parse(folder/'Storyboard.fcpxml')
    self.assertEqual(xml.find('.//sequence').get('duration'),'10/1s');self.assertEqual(len(xml.findall('.//spine/video')),2)
    self.assertEqual(xml.findall('.//asset-clip'),[]);self.assertFalse(any(a.get('hasAudio') for a in xml.findall('.//asset')))
    self.assertEqual(len(list((folder/'Media').iterdir())),2);self.assertIn('No recording is included.',(folder/'README.txt').read_text())
 def test_fixed_uses_inserted_shots_in_saved_order(self):
    (self.r/'shot-workspace-data').mkdir();(self.r/'feedback/shot-structures').mkdir()
    (self.r/'shot-workspace-data'/f'{self.eid}.json').write_text(json.dumps({'shots':self.cat['slots']}))
    added={'title':'Inserted','direction':'Still frame','planning_duration':None,'script_start':None,'script_end':None}
    (self.r/'feedback/shot-structures'/f'{self.eid}.json').write_text(json.dumps({'revision':1,'order':['2','new','1'],'edits':{},'added':{'new':added}}))
    self.state['assignments']['new']='b';self.write();self.data.update(timing_mode='fixed',seconds_per_clip=5)
    self.assertEqual(f.options(self.r,self.eid)['shot_count'],3)
    s=self.snap();self.assertEqual([v['id'] for v in s['shots']],['2','new','1']);self.assertEqual(s['duration'],15)
    self.state['assignments']['new']=None;self.write()
    with self.assertRaisesRegex(f.ExportError,'select and save an image'):self.snap()
 def test_stale_fingerprint_and_idempotency(self):
    s=self.snap();data={**self.data,'fingerprint':'wrong','mutation_id':'d'*32}
    import threading
    atomic=lambda p,d:p.write_text(json.dumps(d))
    with self.assertRaises(f.Conflict):f.start_job(self.r,data,self.approved,Path,atomic,threading.RLock())
    self.assertFalse(f.job_path(self.r,'d'*32).exists())
    p=f.job_path(self.r,'d'*32);p.parent.mkdir(exist_ok=True);p.write_text(json.dumps({'fingerprint':s['fingerprint'],'status':'ready'}));data['fingerprint']=s['fingerprint']
    self.assertEqual(f.start_job(self.r,data,self.approved,Path,atomic,threading.RLock()),{'job_id':'d'*32})

if __name__=='__main__':unittest.main()
