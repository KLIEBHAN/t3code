-- Dock applet that updates T3 Code (Fork) by hand. install-applet.sh compiles
-- it to ~/Applications/T3 Code Fork Update.app and fills in the paths.
-- It starts manual-update.sh in the background and only watches its progress
-- and result files, so it stays responsive and closing it cannot stop the
-- update. It asks before it restarts a running app.

property repoPath : "@REPO@"
property stateDir : "@STATE@"
property appTitle : "T3 Code (Fork)"
property maxWaitSeconds : 3600
property totalSteps : 4

on run
	set summary to runInBackground("")
	if summary is "" then return
	set state to valueOf(summary, "status")
	if state is "waiting" then
		if not confirmRestart(valueOf(summary, "current"), valueOf(summary, "version"), valueOf(summary, "runs")) then return
		set summary to runInBackground("--restart")
		if summary is "" then return
		set state to valueOf(summary, "status")
	end if
	report(state, valueOf(summary, "version"))
end run

-- Starts manual-update.sh detached from this applet and waits for its result.
-- Returns "" when the user stops watching; the update goes on regardless.
on runInBackground(extraArgument)
	-- A run of its own: an earlier run this applet stopped watching writes to other files.
	set runId to do shell script "/usr/bin/uuidgen"
	set resultPath to stateDir & "/manual-result." & runId
	set progressPath to stateDir & "/manual-progress." & runId
	-- The script reads its state directory from the environment; passing it keeps both sides on the same files.
	do shell script "cd " & quoted form of repoPath & " && FORK_STATE_DIR=" & quoted form of stateDir & " MANUAL_RUN_ID=" & runId & " /usr/bin/nohup /bin/bash scripts/fork/manual-update.sh " & extraArgument & " >/dev/null 2>&1 &"
	set progress total steps to totalSteps
	set progress completed steps to 0
	set progress description to appTitle & " wird aktualisiert"
	set progress additional description to "Startet …"
	set started to current date
	try
		repeat
			set summary to do shell script "cat " & quoted form of resultPath & " 2>/dev/null || true"
			if summary is not "" then exit repeat
			set elapsed to (current date) - started
			if elapsed > maxWaitSeconds then return "status=slow"
			showProgress(do shell script "cat " & quoted form of progressPath & " 2>/dev/null || true", elapsed)
			delay 1
		end repeat
	on error number -128
		display notification "Das Update läuft im Hintergrund weiter. Ergebnis im Log oder beim nächsten Öffnen." with title appTitle
		return ""
	end try
	set progress completed steps to totalSteps
	do shell script "rm -f " & quoted form of resultPath
	return summary
end runInBackground

-- Shows a progress line `<step>|<text>` from manual-update.sh with the elapsed time.
on showProgress(progressLine, elapsed)
	if progressLine is "" then return
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "|"
	set parts to text items of progressLine
	set AppleScript's text item delimiters to saved
	if (count of parts) < 2 then return
	try
		set step to (item 1 of parts) as integer
	on error
		return
	end try
	set progress completed steps to step - 1
	set progress additional description to "Schritt " & step & " von " & totalSteps & ": " & (item 2 of parts) & "   " & elapsedText(elapsed)
end showProgress

on confirmRestart(currentVersion, newVersion, runs)
	set headline to "Update bereit" & return & versionLabel(currentVersion) & "  →  " & versionLabel(newVersion) & return & return
	if runs is "0" then
		set question to headline & "Die App wird dafür kurz beendet und wieder gestartet. Gerade läuft kein Thread."
		set preferred to "Jetzt neu starten"
	else if runs is "" then
		-- manual-update.sh leaves the count empty when it cannot read it.
		set question to headline & "Ob gerade Threads laufen, lässt sich nicht feststellen; ein Neustart würde sie unterbrechen." & return & return & "Ohne Neustart installiert der nächtliche Lauf das Update, sobald kein Thread mehr läuft."
		set preferred to "Später"
	else
		set question to headline & threadsText(runs) & " gerade; ein Neustart unterbricht sie. Unterstützte Threads laufen danach weiter." & return & return & "Ohne Neustart installiert der nächtliche Lauf das Update, sobald kein Thread mehr läuft."
		set preferred to "Später"
	end if
	set answer to button returned of (display dialog question with title appTitle buttons {"Später", "Jetzt neu starten"} default button preferred with icon dialogIcon())
	return answer is "Jetzt neu starten"
end confirmRestart

on threadsText(runs)
	if runs is "1" then return "1 Thread läuft"
	return runs & " Threads laufen"
end threadsText

-- "Nightly 4682 vom 14.11.2026" for "0.1.10-nightly.20261114.4682"; other versions unchanged.
on versionLabel(versionText)
	if versionText is "" then return "unbekannte Version"
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "-nightly."
	set parts to text items of versionText
	set AppleScript's text item delimiters to "."
	try
		set nightly to text items of (item 2 of parts)
		set AppleScript's text item delimiters to saved
		set datePart to item 1 of nightly
		set label to "Nightly " & (item 2 of nightly) & " vom " & (text 7 thru 8 of datePart) & "." & (text 5 thru 6 of datePart) & "." & (text 1 thru 4 of datePart)
		return label
	on error
		set AppleScript's text item delimiters to saved
		return versionText
	end try
end versionLabel

-- The applet's own icon, or the standard note icon if it is missing.
on dialogIcon()
	try
		return path to resource "applet.icns"
	on error
		return note
	end try
end dialogIcon

on elapsedText(elapsedSeconds)
	set minutesPart to elapsedSeconds div 60
	set secondsPart to elapsedSeconds mod 60
	if secondsPart < 10 then set secondsPart to "0" & secondsPart
	return "(" & minutesPart & ":" & secondsPart & ")"
end elapsedText

-- The value of `key=` in a line of space-separated key=value pairs, or "".
on valueOf(summary, key)
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to " "
	set fields to text items of summary
	set AppleScript's text item delimiters to saved
	repeat with field in fields
		if field starts with key & "=" then
			if (length of field) = (length of key) + 1 then return ""
			return text ((length of key) + 2) thru -1 of field
		end if
	end repeat
	return ""
end valueOf

on report(state, versionText)
	if state is "installed" then
		display dialog "Aktualisiert" & return & versionLabel(versionText) & return & return & "Die neue Version ist installiert." with title appTitle buttons {"OK"} default button "OK" with icon dialogIcon()
	else if state is "current" then
		display dialog "Alles aktuell" & return & versionLabel(versionText) & return & return & "Es gibt keine neuere Upstream-Version." with title appTitle buttons {"OK"} default button "OK" with icon dialogIcon()
	else if state is "waiting" then
		display dialog "Update wartet" & return & versionLabel(versionText) & return & return & "Es wird installiert, sobald die App beendet ist oder nachts kein Thread läuft." with title appTitle buttons {"OK"} default button "OK" with icon dialogIcon()
	else if state is "slow" then
		display dialog "Update läuft noch" & return & return & "Es läuft seit über einer Stunde und wird im Hintergrund fortgesetzt. Ob es durchkam, steht im Log." with title appTitle buttons {"OK"} default button "OK" with icon dialogIcon()
	else if state is "busy" then
		display dialog "Update läuft bereits" & return & return & "Ein anderes Update ist gerade aktiv. Versuche es in ein paar Minuten noch einmal." with title appTitle buttons {"OK"} default button "OK" with icon dialogIcon()
	else
		set answer to button returned of (display dialog "Update fehlgeschlagen" & return & return & "Die installierte App bleibt unverändert. Details stehen im Log." with title appTitle buttons {"Log öffnen", "OK"} default button "OK" with icon caution)
		if answer is "Log öffnen" then do shell script "open " & quoted form of (stateDir & "/logs/update.log")
	end if
end report
