import AppKit
let destination = CommandLine.arguments[1]
for size in [16,32,64,128,256,512,1024] {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let scale = CGFloat(size)/1024
    let transform = NSAffineTransform(); transform.scale(by: scale); transform.concat()
    NSColor(calibratedRed: 0.15,green: 0.29,blue: 0.24,alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 40,y: 40,width: 944,height: 944),xRadius: 210,yRadius: 210).fill()
    NSColor(calibratedRed: 0.93,green: 0.90,blue: 0.82,alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 225,y: 170,width: 610,height: 684),xRadius: 40,yRadius: 40).fill()
    NSColor(calibratedRed: 0.66,green: 0.54,blue: 0.36,alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 185,y: 170,width: 70,height: 684),xRadius: 20,yRadius: 20).fill()
    NSColor(calibratedRed: 0.15,green: 0.29,blue: 0.24,alpha: 1).setFill()
    for (y,width) in [(660,410),(525,410),(390,250)] { NSBezierPath(roundedRect: NSRect(x: 325,y: y,width: width,height: 48),xRadius: 10,yRadius: 10).fill() }
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png,properties: [:])!.write(to: URL(fileURLWithPath: destination+"/size_\(size).png"))
}
