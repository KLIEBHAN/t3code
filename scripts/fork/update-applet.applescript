-- Dock applet that updates T3 Code (Fork) by hand. setup.sh compiles it to
-- ~/Applications/T3 Code Fork Update.app and fills in the paths.
-- It starts manual-update.sh in the background and only watches its progress
-- and result files, so it stays responsive and closing it cannot stop the
-- update. It asks before it restarts a running app.

property repoPath : "@REPO@"
property stateDir : "@STATE@"
property appTitle : "T3 Code (Fork)"
property maxWaitSeconds : 3600

on run
	set summary to runInBackground("")
	if summary is "" then return
	set state to valueOf(summary, "status")
	if state is "waiting" then
		if not confirmRestart(valueOf(summary, "version"), valueOf(summary, "runs")) then return
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
	set progress total steps to -1
	set progress completed steps to 0
	set progress description to "Update von " & appTitle
	set progress additional description to "Startet …"
	set started to current date
	try
		repeat
			set summary to do shell script "cat " & quoted form of resultPath & " 2>/dev/null || true"
			if summary is not "" then exit repeat
			set elapsed to (current date) - started
			if elapsed > maxWaitSeconds then return "status=slow"
			set phase to do shell script "cat " & quoted form of progressPath & " 2>/dev/null || true"
			set progress additional description to phase & "   " & elapsedText(elapsed)
			delay 1
		end repeat
	on error number -128
		display notification "Das Update läuft im Hintergrund weiter. Ergebnis im Log oder beim nächsten Öffnen." with title appTitle
		return ""
	end try
	do shell script "rm -f " & quoted form of resultPath
	return summary
end runInBackground

on confirmRestart(version, runs)
	if runs is "0" then
		set question to "Version " & version & " ist bereit. Die App wird dafür kurz beendet und wieder gestartet."
		set preferred to "Jetzt neu starten"
	else if runs is "" then
		-- manual-update.sh leaves the count empty when it cannot read it.
		set question to "Version " & version & " ist bereit. Ob gerade Threads laufen, lässt sich nicht feststellen; ein Neustart würde sie unterbrechen." & return & return & "Ohne Neustart installiert der nächtliche Lauf das Update, sobald kein Thread mehr läuft."
		set preferred to "Später"
	else
		set question to "Version " & version & " ist bereit. Gerade laufen " & runs & " Threads; ein Neustart unterbricht sie. Unterstützte Threads laufen danach weiter." & return & return & "Ohne Neustart installiert der nächtliche Lauf das Update, sobald kein Thread mehr läuft."
		set preferred to "Später"
	end if
	set answer to button returned of (display dialog question with title appTitle buttons {"Später", "Jetzt neu starten"} default button preferred)
	return answer is "Jetzt neu starten"
end confirmRestart

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

on report(state, version)
	if state is "installed" then
		display dialog "Aktualisiert auf Version " & version & "." with title appTitle buttons {"OK"} default button "OK"
	else if state is "current" then
		display dialog "Die App ist aktuell (Version " & version & ")." with title appTitle buttons {"OK"} default button "OK"
	else if state is "waiting" then
		display dialog "Das Update auf Version " & version & " wartet noch, weil die App läuft." with title appTitle buttons {"OK"} default button "OK"
	else if state is "slow" then
		display dialog "Das Update läuft seit über einer Stunde und wird im Hintergrund fortgesetzt. Ob es durchkam, steht im Log." with title appTitle buttons {"OK"} default button "OK"
	else if state is "busy" then
		display dialog "Gerade läuft schon ein Update. Versuche es in ein paar Minuten noch einmal." with title appTitle buttons {"OK"} default button "OK"
	else
		set answer to button returned of (display dialog "Das Update ist fehlgeschlagen. Die installierte App bleibt unverändert." with title appTitle buttons {"Log öffnen", "OK"} default button "OK")
		if answer is "Log öffnen" then do shell script "open " & quoted form of (stateDir & "/logs/update.log")
	end if
end report
