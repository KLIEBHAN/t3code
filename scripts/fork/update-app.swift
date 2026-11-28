// Dock app that updates T3 Code (Fork) by hand. install-applet.sh compiles it
// to ~/Applications/T3 Code Fork Update.app and writes this checkout's paths
// into its Info.plist. It starts manual-update.sh in the background and only
// watches its progress and result files, so closing the window cannot stop the
// update. One window shows the steps, the question before a restart, and the
// result. See FORK.md.

import AppKit
import SwiftUI

@main
struct UpdateApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

  var body: some Scene {
    Window("T3 Code Fork Update", id: "main") {
      UpdateView(model: UpdateModel.shared)
    }
    .windowResizability(.contentSize)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    let model = UpdateModel.shared
    // The app works in the background while the update runs, and macOS keeps a
    // background app's window behind others, so a result brings it to the front.
    model.onAttention = {
      NSApp.activate()
      NSApp.windows.first?.makeKeyAndOrderFront(nil)
    }
    NSApp.activate()
    model.start()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    UpdateModel.shared.announceBackground()
  }
}

// MARK: - Model

/// What install-applet.sh writes into Info.plist.
struct UpdateConfig {
  var repoPath: String
  var stateDir: String
  var appPath: String
  /// The Mac this one fetches its builds from; empty on the build Mac.
  var buildHost: String

  static func fromBundle() -> UpdateConfig {
    let info = Bundle.main.infoDictionary ?? [:]
    func value(_ key: String) -> String { info[key] as? String ?? "" }
    return UpdateConfig(
      repoPath: value("T3ForkRepoPath"), stateDir: value("T3ForkStateDir"),
      appPath: value("T3ForkAppPath"), buildHost: value("T3ForkBuildHost"))
  }
}

/// The run's state; the raw values are manual-update.sh's `status=` values.
enum Phase: String {
  case running, waiting, installed, current, slow, busy, failed
}

enum StepState { case pending, active, waiting, done, skipped, failed }

/// One of manual-update.sh's four steps; `id` is its step number.
struct Step: Identifiable {
  let id: Int
  let title: String
  /// manual-update.sh's text while the step runs.
  var detail = ""
  var state = StepState.pending
  var started: Date?
  var duration: TimeInterval?
}

@MainActor @Observable
final class UpdateModel {
  static let shared = UpdateModel(config: .fromBundle())
  /// A run that takes longer is reported as still running.
  static let maxWait: TimeInterval = 3600
  /// A result nobody answers closes the app, so update.sh can refresh it; an
  /// unanswered restart question counts as "Später".
  static let idleClose: TimeInterval = 600
  static let releases = "https://github.com/pingdotgg/t3code/releases/tag/v"

  let config: UpdateConfig
  var phase = Phase.running
  var steps: [Step]
  /// The installed app's version.
  var installed: String
  /// The new version: waiting to be installed, or installed by this run.
  var offered = ""
  /// The app's unfinished runs a restart would interrupt; empty when unknown.
  var runs = ""
  /// Why a run failed, as far as the log tells.
  var failure = ""
  /// The app's version before the run, from its summary.
  var before = ""
  var now = Date()
  var onAttention: () -> Void = {}

  private var runId = ""
  /// The detached manual-update.sh; 0 before it started.
  private var runPid: pid_t = 0
  /// Where this run's lines start in update.log.
  private var logOffset: UInt64 = 0
  private var started = Date()
  private var timer: Timer?
  private var closeItem: DispatchWorkItem?

  init(config: UpdateConfig) {
    self.config = config
    steps = Self.plannedSteps(buildHost: config.buildHost)
    installed = Self.version(ofApp: config.appPath)
  }

  /// manual-update.sh's steps for this Mac; one that fetches neither merges nor builds.
  static func plannedSteps(buildHost: String) -> [Step] {
    if buildHost.isEmpty {
      return [
        Step(id: 1, title: "Auf neue Version prüfen"), Step(id: 2, title: "Upstream einspielen"),
        Step(id: 3, title: "App bauen"), Step(id: 4, title: "Installieren"),
      ]
    }
    return [
      Step(id: 1, title: "Auf neue Version prüfen"), Step(id: 3, title: "Von \(buildHost) laden"),
      Step(id: 4, title: "Installieren"),
    ]
  }

  static func version(ofApp path: String) -> String {
    let plist = URL(fileURLWithPath: path).appendingPathComponent("Contents/Info.plist")
    return NSDictionary(contentsOf: plist)?["CFBundleShortVersionString"] as? String ?? ""
  }

  /// The value of `key=` in manual-update.sh's summary line, or "".
  static func value(_ summary: String, _ key: String) -> String {
    for field in summary.split(whereSeparator: { $0 == " " || $0 == "\n" })
    where field.hasPrefix(key + "=") {
      return String(field.dropFirst(key.count + 1))
    }
    return ""
  }

  /// Starts manual-update.sh detached from this app and watches it.
  func start(restart: Bool = false) {
    closeItem?.cancel()
    phase = .running
    failure = ""
    started = Date()
    now = started
    steps = Self.plannedSteps(buildHost: config.buildHost)
    steps[0].state = .active
    steps[0].started = started
    let files = FileManager.default
    // Runs this app stopped watching wrote to files nobody reads any more; they
    // report through banners and the log.
    for name in (try? files.contentsOfDirectory(atPath: config.stateDir)) ?? []
    where name.hasPrefix("manual-result.") || name.hasPrefix("manual-progress.") {
      try? files.removeItem(atPath: config.stateDir + "/" + name)
    }
    guard files.fileExists(atPath: config.repoPath + "/scripts/fork/manual-update.sh") else {
      fail("Kein Checkout unter \(config.repoPath)")
      return
    }
    runId = UUID().uuidString
    runPid = 0
    let log = (try? files.attributesOfItem(atPath: logPath))?[.size] as? NSNumber
    logOffset = log?.uint64Value ?? 0
    // `&` covers only the update command, whose input and output are
    // redirected, so sh returns at once with its PID; nohup keeps the run going
    // when this app quits. The script reads its state directory from the
    // environment, so both sides use the same files.
    let shell = Process()
    let output = Pipe()
    shell.executableURL = URL(fileURLWithPath: "/bin/sh")
    shell.arguments = [
      "-c",
      #"cd "$1" || exit 1; FORK_STATE_DIR="$2" MANUAL_RUN_ID="$3" /usr/bin/nohup /bin/bash scripts/fork/manual-update.sh ${4:+"$4"} </dev/null >/dev/null 2>&1 & echo $!"#,
      "sh", config.repoPath, config.stateDir, runId, restart ? "--restart" : "",
    ]
    shell.standardOutput = output
    do {
      try shell.run()
      shell.waitUntilExit()
    } catch {
      fail("manual-update.sh ließ sich nicht starten: \(error.localizedDescription)")
      return
    }
    let pid = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard shell.terminationStatus == 0, let pid = pid_t(pid) else {
      fail("manual-update.sh ließ sich nicht starten (Status \(shell.terminationStatus)).")
      return
    }
    runPid = pid
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick() }
    }
  }

  func tick() {
    now = Date()
    // Progress first: the run removes it right after it writes its result.
    readProgress()
    if let summary = takeResult() {
      finish(summary)
      return
    }
    if runPid > 0 && kill(runPid, 0) != 0 && errno == ESRCH {
      // The run ended; its result may have landed since the check above.
      readProgress()
      if let summary = takeResult() {
        finish(summary)
      } else {
        finish("status=failed")
        if failure.isEmpty { failure = "manual-update.sh endete ohne Ergebnis." }
      }
      return
    }
    if now.timeIntervalSince(started) > Self.maxWait {
      finish("status=slow")
    }
  }

  private var logPath: String { config.stateDir + "/logs/update.log" }

  private func readProgress() {
    let progressPath = config.stateDir + "/manual-progress." + runId
    if let line = try? String(contentsOfFile: progressPath, encoding: .utf8) {
      advance(line)
    }
  }

  /// This run's summary line, which it then no longer needs, or nil while it runs.
  private func takeResult() -> String? {
    let resultPath = config.stateDir + "/manual-result." + runId
    guard let summary = try? String(contentsOfFile: resultPath, encoding: .utf8),
      !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return nil }
    try? FileManager.default.removeItem(atPath: resultPath)
    return summary
  }

  /// Applies a progress line `<step>|<text>` from manual-update.sh. Steps
  /// before it are done if they ran and not needed if they never showed.
  func advance(_ line: String) {
    let parts = line.trimmingCharacters(in: .whitespacesAndNewlines)
      .split(separator: "|", maxSplits: 1)
    guard parts.count == 2, let number = Int(parts[0]) else { return }
    let text = parts[1].replacingOccurrences(of: " …", with: "")
    for index in steps.indices {
      if steps[index].id < number {
        if steps[index].state == .active {
          complete(index)
        } else if steps[index].state == .pending {
          steps[index].state = .skipped
        }
      } else if steps[index].id == number {
        if steps[index].state != .active {
          steps[index].state = .active
          steps[index].started = now
        }
        steps[index].detail = text
      }
    }
  }

  /// Shows manual-update.sh's summary line.
  func finish(_ summary: String) {
    timer?.invalidate()
    timer = nil
    now = Date()
    phase = Phase(rawValue: Self.value(summary, "status")) ?? .failed
    let version = Self.value(summary, "version")
    before = Self.value(summary, "current")
    if !before.isEmpty { installed = before }
    runs = Self.value(summary, "runs")
    switch phase {
    case .waiting, .installed: offered = version
    // A failed run can still have installed a build it found staged.
    case .current, .failed: if !version.isEmpty { installed = version }
    default: break
    }
    for index in steps.indices {
      let isInstall = steps[index].id == 4
      switch steps[index].state {
      case .active:
        if phase == .failed {
          complete(index, as: .failed)
        } else if phase == .waiting && isInstall {
          steps[index].state = .waiting
        } else if phase != .slow && phase != .busy {
          complete(index)
        }
      case .pending:
        if phase == .waiting && isInstall {
          steps[index].state = .waiting
        } else if [.installed, .current, .waiting].contains(phase) {
          steps[index].state = .skipped
        }
      default: break
      }
    }
    if phase == .failed && failure.isEmpty { failure = lastTellingLogLine() }
    onAttention()
    let close = DispatchWorkItem { NSApp.terminate(nil) }
    closeItem = close
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.idleClose, execute: close)
  }

  func restartNow() { start(restart: true) }

  func openLog() {
    NSWorkspace.shared.open(URL(fileURLWithPath: config.stateDir + "/logs/update.log"))
  }

  func openReleaseNotes(_ version: String) {
    if let url = URL(string: Self.releases + version) { NSWorkspace.shared.open(url) }
  }

  /// The banner for a run this app stops watching; it reports through banners and the log.
  func announceBackground() {
    guard phase == .running else { return }
    let script = Process()
    script.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    script.arguments = [
      "-e", "on run argv",
      "-e", #"display notification (item 1 of argv) with title "T3 Code (Fork)""#,
      "-e", "end run",
      "Das Update läuft im Hintergrund weiter. Installation und Fehler meldet eine Mitteilung, Details stehen im Log.",
    ]
    try? script.run()
    script.waitUntilExit()
  }

  var failedStep: Step? { steps.first { $0.state == .failed } }

  private func fail(_ reason: String) {
    finish("status=failed")
    failure = reason
  }

  private func complete(_ index: Int, as state: StepState = .done) {
    steps[index].state = state
    if let begin = steps[index].started { steps[index].duration = now.timeIntervalSince(begin) }
  }

  /// The last line of this run in update.log that names a failure, else its last line.
  private func lastTellingLogLine() -> String {
    guard let log = FileHandle(forReadingAtPath: logPath) else { return "" }
    defer { try? log.close() }
    let size = (try? log.seekToEnd()) ?? 0
    // From where this run started, or the last 64 KiB of it; all of a log that shrank.
    let from = logOffset <= size ? max(logOffset, size > 65_536 ? size - 65_536 : 0) : 0
    try? log.seek(toOffset: from)
    let lines = String(decoding: log.readDataToEndOfFile(), as: UTF8.self)
      .split(separator: "\n").map(String.init)
    let messages = lines.map {
      $0.replacingOccurrences(of: #"^\[[^\]]*\] "#, with: "", options: .regularExpression)
    }.filter { !$0.isEmpty }
    let telling = messages.last {
      $0.range(
        of: "fail|could not|error|fatal|diverged|nicht|kein",
        options: [.regularExpression, .caseInsensitive]) != nil
    }
    return telling ?? messages.last ?? ""
  }
}

// MARK: - Views

/// "Nightly 5385" and "28.11.2026" for "0.1.14-nightly.20261128.5385"; other versions as they are.
struct VersionLabel {
  let number: String
  let name: String
  let date: String

  init(_ version: String) {
    let parts = version.components(separatedBy: "-nightly.")
    let nightly = parts.count == 2 ? parts[1].split(separator: ".").map(String.init) : []
    if nightly.count == 2, nightly[0].count == 8 {
      let day = Array(nightly[0])
      number = nightly[1]
      name = "Nightly"
      date = "\(String(day[6...7])).\(String(day[4...5])).\(String(day[0...3]))"
    } else {
      number = ""
      name = version.isEmpty ? "unbekannte Version" : version
      date = ""
    }
  }

  var text: Text { number.isEmpty ? Text(name) : Text("\(name) \(Text(number).bold())") }
}

struct UpdateView: View {
  let model: UpdateModel

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      header
      versions
      if model.phase == .running || model.phase == .waiting {
        StepList(steps: model.steps, now: model.now)
      }
      message
      buttons.padding(.top, 2)
    }
    .padding(16)
    .frame(width: 380)
  }

  private var header: some View {
    HStack(spacing: 12) {
      Image(nsImage: NSApp.applicationIconImage)
        .resizable()
        .frame(width: 44, height: 44)
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text("T3 Code (Fork)").font(.headline)
          Badge(text: badge.0, tint: badge.1)
        }
        Text(model.config.buildHost.isEmpty ? "Baut auf diesem Mac" : "Build-Mac: \(model.config.buildHost)")
          .foregroundStyle(.secondary)
      }
    }
  }

  private var badge: (String, Color) {
    switch model.phase {
    case .running: ("läuft", .blue)
    case .waiting: ("Neustart nötig", .orange)
    case .installed: ("aktualisiert", .green)
    case .current: ("aktuell", .green)
    case .slow: ("läuft noch", .blue)
    case .busy: ("läuft bereits", .orange)
    case .failed: ("fehlgeschlagen", .red)
    }
  }

  private var versions: some View {
    let from = VersionLabel(model.installed)
    let showsNew = !model.offered.isEmpty && (model.phase == .waiting || model.phase == .installed)
    let to = VersionLabel(model.offered)
    return HStack(spacing: 8) {
      from.text
      if showsNew {
        Image(systemName: "arrow.right").foregroundStyle(.secondary)
        to.text
      }
      Spacer(minLength: 8)
      Text(showsNew ? to.date : from.date).foregroundStyle(.secondary)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
  }

  @ViewBuilder private var message: some View {
    switch model.phase {
    case .running:
      EmptyView()
    case .waiting:
      Hint(symbol: "exclamationmark.triangle.fill", tint: .orange, text: restartText)
    case .installed:
      Text("Die neue Version ist installiert.").foregroundStyle(.secondary)
    case .current:
      Text(
        model.config.buildHost.isEmpty
          ? "Es gibt keine neuere Upstream-Version, und alle Fork-Änderungen sind gebaut."
          : "„\(model.config.buildHost)“ bietet keinen neueren Build an. Neue Fork-Änderungen baut er innerhalb einer Stunde."
      )
      .foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)
    case .slow:
      Text("Das Update läuft seit über einer Stunde und wird im Hintergrund fortgesetzt. Ob es durchkam, steht im Log.")
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    case .busy:
      Text("Ein anderes Update ist gerade aktiv. Versuche es in ein paar Minuten noch einmal.")
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    case .failed:
      VStack(alignment: .leading, spacing: 8) {
        Hint(symbol: "xmark.octagon.fill", tint: .red, text: failureText)
        if !model.before.isEmpty && model.installed != model.before {
          Text("\(VersionLabel(model.installed).name) \(VersionLabel(model.installed).number) wurde trotzdem installiert.")
            .foregroundStyle(.secondary)
        } else {
          Text("Die installierte App bleibt unverändert.").foregroundStyle(.secondary)
        }
      }
    }
  }

  private var restartText: Text {
    let later = Text("„Später“: Der nächtliche Lauf installiert es, sobald kein Thread läuft.")
    switch model.runs {
    case "0":
      return Text("Gerade läuft kein Thread. Die App wird kurz beendet und wieder gestartet.")
    case "":
      return Text("Ob Threads laufen, lässt sich nicht feststellen; ein Neustart würde sie unterbrechen. \(later)")
    default:
      let threads = model.runs == "1" ? "1 Thread läuft" : "\(model.runs) Threads laufen"
      return Text("\(Text(threads).bold()) und wird beim Neustart unterbrochen; unterstützte Threads laufen danach weiter. \(later)")
    }
  }

  private var failureText: Text {
    let detail = Text(model.failure.isEmpty ? "Details stehen im Log." : model.failure)
      .font(.system(.callout, design: .monospaced))
    guard let step = model.failedStep else { return detail }
    return Text("\(Text(step.title).bold()): \(detail)")
  }

  @ViewBuilder private var buttons: some View {
    HStack(spacing: 8) {
      switch model.phase {
      case .running:
        Button("Log", action: model.openLog).buttonStyle(.link)
        Spacer()
        Button("Im Hintergrund") { NSApp.terminate(nil) }
      case .waiting:
        if !model.offered.isEmpty {
          Button("Was ist neu?") { model.openReleaseNotes(model.offered) }.buttonStyle(.link)
        }
        Spacer()
        Button("Jetzt neu starten", action: model.restartNow)
        // Return means "Später": the window comes to the front while the user
        // may be typing elsewhere, and Return must not restart the app.
        Button("Später") { NSApp.terminate(nil) }.keyboardShortcut(.defaultAction)
      case .installed, .current:
        let version = model.phase == .installed ? model.offered : model.installed
        if !version.isEmpty {
          Button("Was ist neu?") { model.openReleaseNotes(version) }.buttonStyle(.link)
        }
        Spacer()
        Button("OK") { NSApp.terminate(nil) }.keyboardShortcut(.defaultAction)
      case .slow, .busy:
        Button("Log", action: model.openLog).buttonStyle(.link)
        Spacer()
        Button("OK") { NSApp.terminate(nil) }.keyboardShortcut(.defaultAction)
      case .failed:
        Button("Log öffnen", action: model.openLog).buttonStyle(.link)
        Spacer()
        Button("Schließen") { NSApp.terminate(nil) }.keyboardShortcut(.cancelAction)
        Button("Erneut versuchen") { model.start() }.keyboardShortcut(.defaultAction)
      }
    }
  }
}

struct Badge: View {
  let text: String
  let tint: Color

  var body: some View {
    Text(text)
      .font(.caption.weight(.medium))
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .foregroundStyle(tint)
      .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 4))
  }
}

struct Hint: View {
  let symbol: String
  let tint: Color
  let text: Text

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(systemName: symbol).foregroundStyle(tint)
      text.fixedSize(horizontal: false, vertical: true)
    }
    .font(.callout)
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
  }
}

struct StepList: View {
  let steps: [Step]
  let now: Date

  var body: some View {
    VStack(spacing: 0) {
      ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
        if index > 0 { Divider() }
        StepRow(step: step, now: now)
      }
    }
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
  }
}

struct StepRow: View {
  let step: Step
  let now: Date

  var body: some View {
    HStack(spacing: 10) {
      icon.frame(width: 16, height: 16)
      Text(step.state == .active && !step.detail.isEmpty ? step.detail : step.title)
        .fontWeight(step.state == .active ? .semibold : .regular)
        .foregroundStyle(
          step.state == .pending || step.state == .skipped
            ? HierarchicalShapeStyle.secondary : .primary)
      Spacer(minLength: 8)
      Text(trailing).font(.callout).foregroundStyle(.secondary).monospacedDigit()
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 7)
  }

  private var trailing: String {
    switch step.state {
    case .active: step.started.map { clock(now.timeIntervalSince($0)) } ?? ""
    case .done, .failed: step.duration.map(clock) ?? ""
    case .waiting: "wartet"
    case .skipped: "nicht nötig"
    case .pending: ""
    }
  }

  @ViewBuilder private var icon: some View {
    switch step.state {
    case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
    case .active: ProgressView().controlSize(.small).scaleEffect(0.8)
    case .waiting: Image(systemName: "pause.circle.fill").foregroundStyle(.orange)
    case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
    case .skipped: Image(systemName: "minus.circle").foregroundStyle(.secondary)
    case .pending: Image(systemName: "circle").foregroundStyle(.tertiary)
    }
  }
}

/// "1:05" for 65 seconds.
func clock(_ seconds: TimeInterval) -> String {
  let total = max(0, Int(seconds))
  return String(format: "%d:%02d", total / 60, total % 60)
}
