import sys,unittest,tempfile,json,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import numpy as np
import soundfile as sf
from analyze import detect,coordinates,build,analysis_channel
from plan_cuts import plan

def clicks(times,duration,sr=22050):
    y=np.zeros(round(duration*sr),dtype='float32')
    pulse=np.sin(2*np.pi*1500*np.arange(300)/sr)*np.exp(-np.arange(300)/45)
    for t in times:
        i=round(t*sr);n=min(len(pulse),len(y)-i)
        if n>0:y[i:i+n]+=pulse[:n]
    return y

class Analysis(unittest.TestCase):
    def match(self,times,duration):
        b,_,_,_=detect(clicks(times,duration),22050);pred=np.array([x['seconds'] for x in b]);truth=np.array(times)
        self.assertGreater(len(pred),0)
        precision=np.mean([min(abs(truth-p))<.07 for p in pred]);recall=np.mean([min(abs(pred-t))<.07 for t in truth])
        self.assertGreater(precision,.92);self.assertGreater(recall,.92)
        self.assertTrue(all(x['status']=='uncertain' and x['downbeat'] is None for x in b))
    def test_steady_tempos(self):
        for bpm in [75,120,150]:
            with self.subTest(bpm=bpm):self.match(np.arange(1,30,60/bpm),32)
    def test_half_tempo_ambiguity_is_exposed(self):
        b,t,_,w=detect(clicks(np.arange(1,30,1/3),32),22050)
        self.assertTrue(all(x["status"]=="uncertain" for x in b))
        self.assertTrue(any(abs(x["bpm"]-180)<5 or any(abs(a-180)<5 for a in x["alternatives_bpm"]) for x in t))
        self.assertTrue(any("Half/double" in x for x in w))
    def test_pickup_silence_tempo_change(self):
        self.match(np.r_[np.arange(.73,16,.6),np.arange(20.73,39,.4)],42)
    def test_silence(self):self.assertEqual(detect(np.zeros(22050*4),22050)[0],[])
    def test_phase_cancellation(self):
        y=clicks(np.arange(1,12,.5),14);mono,method,w=analysis_channel(np.stack([y,-y],axis=1));self.assertGreater(np.max(abs(mono)),.1);self.assertTrue(w);self.assertIn('channel',method)
    def test_frame_offset(self):
        for fps in [25,30000/1001]:
            for t in [0,.02,1.234567,249.35997916666668]:
                c=coordinates(t,fps,22.123);self.assertAlmostEqual(c['film_seconds'],t+22.123)
                self.assertLessEqual(abs(c['film_frame']/fps-(t+22.123)),.5/fps+1e-10)
    def test_build_source_preserved_exact_duration(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp);y=clicks(np.arange(.5,8,.5),9);sf.write(p/'source.wav',y,22050);before=(p/'source.wav').read_bytes()
            m=build(p/'source.wav',p/'out','Test',25,22)
            self.assertEqual((p/'source.wav').read_bytes(),before);self.assertEqual(m['source']['duration_seconds'],len(y)/22050)
            self.assertEqual(sf.info(p/'out/audio-preview.wav').frames,len(y));self.assertTrue((p/'out/index.html').is_file())
            with self.assertRaises(ValueError):build(p/'source.wav',p/'out','Test')
    def test_planning_conflict_not_invented_coverage(self):
        m={'source':{'duration_seconds':6,'sha256':'x'},'timing':{'fps':25,'film_offset_seconds':22},'beats':[{'id':'b','seconds':2.96,'status':'confirmed'}]}
        inv={'shots':[{'id':'a','start':0,'end':3,'image':'missing.png','boundary_locked':True},{'id':'b','start':3,'end':6,'image':'missing.png'}]}
        r=plan(m,inv,{'max_shot_seconds_exclusive':3,'setting_first':True})
        self.assertEqual(r['max_shot_frames'],74);self.assertEqual(len(r['suggestions']),2);self.assertEqual(r['suggestions'][0]['proposed_end_seconds'],3);self.assertGreater(len(r['conflicts']),0)

if __name__=='__main__':unittest.main()
