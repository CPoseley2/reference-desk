#!/usr/bin/env python3
"""Build a local native Mac app. Existing libraries stay outside the bundle."""
import os, plistlib, subprocess, tempfile, struct
from pathlib import Path
root = Path(__file__).resolve().parent.parent
app = root.parent/'Reference Desk.app'
contents = app/'Contents'
for directory in ['MacOS','Resources']:(contents/directory).mkdir(parents=True,exist_ok=True)
info = {'CFBundleName':'Reference Desk','CFBundleDisplayName':'Reference Desk','CFBundleIdentifier':'com.reference-desk.mac','CFBundleExecutable':'ReferenceDesk','CFBundlePackageType':'APPL','CFBundleShortVersionString':'1.0','CFBundleVersion':'1','LSMinimumSystemVersion':'13.0','NSHighResolutionCapable':True,'CFBundleIconFile':'AppIcon','ReferenceDeskFrameworkPath':str(root),'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},'NSHumanReadableCopyright':'Reference Desk — local reference libraries'}
(contents/'Info.plist').write_bytes(plistlib.dumps(info))
env = dict(os.environ, CLANG_MODULE_CACHE_PATH='/private/tmp/reference-desk-clang-cache', SWIFT_MODULECACHE_PATH='/private/tmp/reference-desk-swift-cache')
subprocess.run(['/usr/bin/xcrun','swiftc','-swift-version','5','-O','-framework','Cocoa','-framework','WebKit',str(root/'mac-app/ReferenceDesk.swift'),'-o',str(contents/'MacOS/ReferenceDesk')],check=True,env=env)
with tempfile.TemporaryDirectory(prefix='desk-icon-') as temporary:
    temp = Path(temporary); icons = temp/'AppIcon.iconset'; icons.mkdir()
    subprocess.run(['/usr/bin/xcrun','swift',str(root/'mac-app/Icon.swift'),str(temp)],check=True,env=env)
    chunks = []
    for kind,size in [('icp4',16),('icp5',32),('icp6',64),('ic07',128),('ic08',256),('ic09',512),('ic10',1024)]:
        data = (temp/('size_'+str(size)+'.png')).read_bytes()
        chunks.append(kind.encode()+struct.pack('>I',len(data)+8)+data)
    data = b''.join(chunks)
    (contents/'Resources/AppIcon.icns').write_bytes(b'icns'+struct.pack('>I',len(data)+8)+data)
subprocess.run(['/usr/bin/codesign','--force','--sign','-',str(app)],check=True)
print(app)
