#!/usr/bin/env python3
"""Install save hooks into a compatible existing Storyboard Command Center.
Validates all anchors before changing files. Re-running is safe. Keeps a backup.
"""
import argparse, datetime, shutil
from pathlib import Path

EDITS = {'index.html': [('</head>', '<script src="reference-desk-bridge.js"></script></head>')], 'viewer.html': [('</head>', '<script src="reference-desk-bridge.js"></script></head>')], 'viewer.js': [('window.initStoryboardEditor?.();', 'Promise.resolve(window.initStoryboardEditor?.()).finally(()=>window.ReferenceDeskBridge?.ready());'), ('', "// Reference Desk waits for every pending note before switching modules.\nwindow.ReferenceDeskBridge?.register('notes',{\n state:()=>({dirty:Object.keys(pending).length>0,inflight:saving,conflicted:!$('conflict').hidden}),\n flush:async()=>{\n  await window.ReferenceDeskBridge.waitUntil(()=>saving);\n  if(!$('conflict').hidden)throw Error('Resolve the note conflict before leaving this storyboard.');\n  for(const k of Object.keys(pending)){await save(k);if(pending[k])throw Error('A storyboard note has not saved. Check Save to disk and resolve any conflict before leaving.');}\n }\n});\n")], 'storyboard-editor.js': [(" window.addEventListener('beforeunload',e=>{if(dirty){remember();e.preventDefault();e.returnValue=''}});", " window.ReferenceDeskBridge?.register('arrangement',{\n  state:()=>({dirty:dirty||[...tagInfo.values()].some(s=>s?.draft?.trim()),inflight:busy||[...tagInfo.values()].some(s=>s?.busy),conflicted:conflict}),\n  flush:async()=>{\n   await window.ReferenceDeskBridge.waitUntil(()=>busy||[...tagInfo.values()].some(s=>s?.busy));\n   if(conflict)throw Error('Resolve the arrangement conflict before leaving.');\n   if([...tagInfo.values()].some(s=>s?.draft?.trim()))throw Error('Save or clear the image tag text before leaving.');\n   clearTimeout(saveTimer);if(dirty)await saveArrangement();\n   if(dirty||conflict)throw Error('The shot arrangement has not saved. Use Save arrangement and retry.');\n  }\n });\n window.addEventListener('beforeunload',e=>{if(dirty){remember();e.preventDefault();e.returnValue=''}});"), ("}catch(e){host.textContent='Shot editor unavailable:", "}catch(e){if(localStorage.getItem('owl-arrangement-draft-'+id))window.ReferenceDeskBridge?.register('arrangement',{state:()=>({dirty:true}),flush:async()=>{throw Error('Reconnect the shot editor to recover and save your arrangement draft.')}});host.textContent='Shot editor unavailable:")], 'beat-edit.js': [(" window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});", " window.ReferenceDeskBridge?.register('timing',{\n  state:()=>({dirty,inflight:busy}),\n  flush:async()=>{\n   await window.ReferenceDeskBridge.waitUntil(()=>busy);\n   if(dirty)await q('beat-save').onclick();\n   if(dirty)throw Error('Timing changes have not saved. Check Save timing before leaving.');\n  }\n });\n window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});"), ("}catch(e){host.innerHTML='<h2>Beat timing unavailable", "}catch(e){if(localStorage.getItem('owl-beat-draft-'+id))window.ReferenceDeskBridge?.register('timing',{state:()=>({dirty:true}),flush:async()=>{throw Error('Reconnect the timing editor to recover your unsaved timing.')}});host.innerHTML='<h2>Beat timing unavailable")]}

def install(root):
    root=Path(root).resolve();changes={}
    for name,edits in EDITS.items():
        path=root/name;original=path.read_text();updated=original
        for old,new in edits:
            if new in updated: continue
            if not old: updated += '\n'+new
            else:
                if updated.count(old)!=1: raise ValueError('Unsupported Command Center version: '+name+'. No files changed.')
                updated=updated.replace(old,new,1)
        if updated!=original: changes[name]=updated
    bridge=(Path(__file__).parent/'storyboard-bridge.js').read_text()
    if not (root/'reference-desk-bridge.js').exists() or (root/'reference-desk-bridge.js').read_text()!=bridge:
        changes['reference-desk-bridge.js']=bridge
    if changes:
        backup=root/'.reference-desk-backups'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        backup.mkdir(parents=True,exist_ok=True)
        for name,content in changes.items():
            path=root/name
            if path.exists(): shutil.copy2(path,backup/name)
            temp=root/(name+'.desk-tmp');temp.write_text(content);temp.replace(path)
    return len(changes)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder');args=parser.parse_args()
    print('Updated',install(args.folder),'Command Center files.')
