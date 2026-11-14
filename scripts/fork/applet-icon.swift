// Draws the update badge as a transparent 1024 px layer for the applet's
// Icon Composer icon; make-applet-icon.sh puts it on top of the fork's icon.
//   swift scripts/fork/applet-icon.swift <out.png>
import AppKit

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write("usage: applet-icon.swift <out.png>\n".data(using: .utf8)!)
  exit(2)
}
let size = CGFloat(1024)
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
  bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// Lower right, clear of the icon's rounded corner.
let diameter = size * 0.44
let badge = NSRect(x: size * 0.50, y: size * 0.06, width: diameter, height: diameter)
NSColor.white.setFill()
NSBezierPath(ovalIn: badge).fill()
NSColor(srgbRed: 0.19, green: 0.74, blue: 0.35, alpha: 1).setFill()
NSBezierPath(ovalIn: badge.insetBy(dx: size * 0.016, dy: size * 0.016)).fill()

let configuration = NSImage.SymbolConfiguration(pointSize: diameter * 0.5, weight: .bold)
  .applying(NSImage.SymbolConfiguration(paletteColors: [.white]))
if let symbol = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: nil)?
  .withSymbolConfiguration(configuration)
{
  let symbolSize = symbol.size
  symbol.draw(
    at: NSPoint(x: badge.midX - symbolSize.width / 2, y: badge.midY - symbolSize.height / 2),
    from: .zero, operation: .sourceOver, fraction: 1)
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
