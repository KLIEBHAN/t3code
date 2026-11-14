// Draws the Dock applet's icon: the fork app's icon with an update badge.
// Run once when the look changes; install-applet.sh uses the committed PNG.
//   swift scripts/fork/applet-icon.swift assets/dev/blueprint-macos-1024.png scripts/fork/applet-icon.png
import AppKit

let arguments = CommandLine.arguments
guard arguments.count == 3, let base = NSImage(contentsOfFile: arguments[1]) else {
  FileHandle.standardError.write("usage: applet-icon.swift <base.png> <out.png>\n".data(using: .utf8)!)
  exit(2)
}
let size = 512
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
  hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let canvas = NSRect(x: 0, y: 0, width: size, height: size)
base.draw(in: canvas)

// Badge in the lower right, inside the icon's rounded square.
let diameter = CGFloat(size) * 0.42
let badge = NSRect(x: CGFloat(size) * 0.52, y: CGFloat(size) * 0.08, width: diameter, height: diameter)
let shadow = NSShadow()
shadow.shadowBlurRadius = CGFloat(size) * 0.025
shadow.shadowOffset = NSSize(width: 0, height: -CGFloat(size) * 0.008)
shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
NSGraphicsContext.saveGraphicsState()
shadow.set()
NSColor(srgbRed: 0.19, green: 0.74, blue: 0.35, alpha: 1).setFill()
NSBezierPath(ovalIn: badge).fill()
NSGraphicsContext.restoreGraphicsState()
NSColor.white.setStroke()
let ring = NSBezierPath(ovalIn: badge.insetBy(dx: CGFloat(size) * 0.006, dy: CGFloat(size) * 0.006))
ring.lineWidth = CGFloat(size) * 0.012
ring.stroke()

let configuration = NSImage.SymbolConfiguration(pointSize: diameter * 0.52, weight: .bold)
  .applying(NSImage.SymbolConfiguration(paletteColors: [.white]))
if let symbol = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: nil)?
  .withSymbolConfiguration(configuration)
{
  let symbolSize = symbol.size
  let origin = NSPoint(x: badge.midX - symbolSize.width / 2, y: badge.midY - symbolSize.height / 2)
  symbol.draw(at: origin, from: .zero, operation: .sourceOver, fraction: 1)
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: arguments[2]))
