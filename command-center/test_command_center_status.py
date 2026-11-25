import unittest
from command_center import storyboard_status

class StatusTests(unittest.TestCase):
 def test_versions_do_not_become_unmade_when_selection_disappears(self):
  self.assertEqual(storyboard_status(None,None,[{'id':'existing'}]),'Storyboard versions available')
 def test_completed_and_incomplete_storyboards(self):
  self.assertEqual(storyboard_status({'slots':72,'available_slots':72},None,[]),'Storyboard available')
  self.assertEqual(storyboard_status({'slots':72,'available_slots':52},None,[]),'Storyboard in progress')
 def test_unmade_and_film_exports(self):
  self.assertEqual(storyboard_status(None,None,[]),'Not yet made')
  self.assertEqual(storyboard_status(None,{'height':1080},[]),'HD export')
  self.assertEqual(storyboard_status(None,{'height':720},[]),'Film export')
  self.assertEqual(storyboard_status(None,{'height':1080,'archive':True},[]),'Earlier film available')

if __name__=='__main__':unittest.main()
