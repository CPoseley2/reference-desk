import unittest,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from dynamics import analyze_dynamics
class DynamicsTests(unittest.TestCase):
    def test_silence_and_steady_tone(self):
        sr=8000;t=np.arange(sr*20)/sr
        for y in [np.zeros_like(t),.1*np.sin(2*np.pi*80*t)]:
            d=analyze_dynamics(y,sr,[])
            self.assertEqual(d['swells'],[]);self.assertEqual(d['impacts'],[]);self.assertEqual(d['breaks'],[])
    def test_ramp_drop_impact_and_coordinates(self):
        sr=8000;t=np.arange(sr*30)/sr
        amp=np.interp(t,[0,4,5,13,14,16,16.1,17,20,30],[.03,.03,.03,.3,.3,.3,.015,.015,.03,.03])
        y=amp*np.sin(2*np.pi*400*t)
        y+=np.where((t>=23)&(t<24),.4*np.exp(-np.maximum(t-23,0)*5)*np.sin(2*np.pi*70*t),0)
        beats=[dict(seconds=float(v),id=str(v),status='uncertain') for v in np.arange(.5,30,.5)]
        d=analyze_dynamics(y,sr,beats,25,22)
        self.assertTrue(any(12<s['seconds']<15 and s['gain_db']>10 for s in d['swells']))
        self.assertTrue(any(abs(s['seconds']-23)<.3 for s in d['impacts']))
        self.assertTrue(any(16<s['seconds']<17 for s in d['breaks']))
        for kind in ['swells','impacts','breaks']:
            for e in d[kind]:
                self.assertAlmostEqual(e['film_seconds']-e['seconds'],22)
                self.assertEqual(e['film_frame']-e['song_frame'],550)
                self.assertEqual(e['status'],'unreviewed')
        for burst in d['cut_bursts']:
            self.assertTrue(all(c['beat_id'] in {b['id'] for b in beats} for c in burst['candidate_cuts']))
if __name__=='__main__':unittest.main()
