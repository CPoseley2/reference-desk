"""Read-only connection from Storyboards to saved, library-scoped Crescendo results."""
import copy, json, re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent

def index(root):
    data=json.loads((Path(root)/'crescendo-analysis.json').read_text())
    for record in data['records']:
        if not record.get('job_id'):continue
        directory=job_directory(record)
        try:
            job=json.loads((directory/'job.json').read_text())
            record['status']=job['status']
            if job.get('error'):record['error']=job['error']
            if job['status']=='ready':
                review_path=directory/'review.json'
                review=json.loads(review_path.read_text()) if review_path.exists() else {}
                record['saved_review_revision']=review.get('saved_revision',0)
                record['confirmed_beats']=sum(b['status']=='confirmed' for b in (review.get('map') or {}).get('beats',[]))
                record['cut_suggestions_stale']=bool(review.get('map',{}))
                record.setdefault('links',{})['current_map']='/library-api/crescendo-map?film='+record['id']
                record['favorite_moments']=[]
                record['favorites_revision']=0
                try:
                    favorites_path=directory/'favorites.json'
                    favorites=json.loads(favorites_path.read_text()) if favorites_path.exists() else {}
                    if favorites:
                        if favorites.get('source_sha256')!=record['analysis_sha256'] or not isinstance(favorites.get('moments'),list):
                            raise ValueError('Favorites belong to a different recording')
                        record['favorite_moments']=favorites['moments']
                        record['favorites_revision']=favorites.get('revision',0)
                except (OSError,ValueError,KeyError,TypeError):
                    record['favorites_error']='Saved favorites are unavailable. Open Crescendo to retry.'
        except (OSError,ValueError,KeyError):
            record['status']='unavailable';record['error']='Saved analysis is unavailable. Reconnect Reference Desk or inspect the recording.'
    return data

def job_directory(record):
    lid,jid=record.get('library_id',''),record.get('job_id','')
    if not re.fullmatch(r'[a-f0-9]{32}',lid) or not re.fullmatch(r'[a-f0-9]{32}',jid):raise ValueError('Invalid library or job identity')
    return APP/'libraries'/lid/'.state/crescendo'/jid

def current_map(root,film):
    if not re.fullmatch(r'a[1-5]-\d{2}',film):raise ValueError('Unknown film')
    record=next((r for r in index(root)['records'] if r['id']==film),None)
    if not record or record['status']!='ready':raise ValueError('Analysis is not ready')
    directory=job_directory(record)
    original=json.loads((directory/'result/beat-map.json').read_text())
    if original['source']['sha256']!=record['analysis_sha256']:raise ValueError('Recording identity changed')
    review_path=directory/'review.json'
    review=json.loads(review_path.read_text()) if review_path.exists() else {}
    value=review.get('map') or original
    if value['source']!=original['source'] or value['timing']!=original['timing']:raise ValueError('Review belongs to another recording or timing')
    result=copy.deepcopy(value)
    result['storyboard_integration']={
        'film_id':film,'entry_id':record['entry_id'],'library_id':record['library_id'],'job_id':record['job_id'],
        'original_recording_path':record['source_path'],'original_recording_sha256':record['original_sha256'],
        'selection_basis':record['selection_basis'],'timing_basis':record['timing_basis'],
        'saved_review_revision':review.get('saved_revision',0),'cut_suggestions_stale':bool(review.get('map')),
        'favorite_moments':record.get('favorite_moments',[]),'favorites_revision':record.get('favorites_revision',0),
        'timeline_alignment_verified':record.get('timeline_alignment_verified',False),
        'notice':'Use song seconds unless the film offset has been verified. Automatic cues are not listening approval. Regenerate cut proposals after beat edits.'}
    return result
