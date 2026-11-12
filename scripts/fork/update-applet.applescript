-- Dock applet that updates T3 Code (Fork) by hand. setup.sh compiles it to
-- ~/Applications/T3 Code Fork Update.app and fills in the checkout path.
-- It runs manual-update.sh and asks before it restarts a running app.

property repoPath : "@REPO@"
property logPath : "@LOG@"
property appTitle : "T3 Code (Fork)"

on run
	display notification "Sucht nach Updates und baut bei Bedarf. Das kann einige Minuten dauern." with title appTitle
	set summary to runUpdate("")
	set state to valueOf(summary, "status")
	if state is "waiting" then
		set version to valueOf(summary, "version")
		set runs to valueOf(summary, "runs")
		if runs is "" or runs is "0" then
			set question to "Version " & version & " ist bereit. Die App wird dafür kurz beendet und wieder gestartet."
			set preferred to "Jetzt neu starten"
		else
			set question to "Version " & version & " ist bereit. Gerade laufen " & runs & " Threads; ein Neustart unterbricht sie. Unterstützte Threads laufen danach weiter." & return & return & "Ohne Neustart installiert der nächtliche Lauf das Update, sobald kein Thread mehr läuft."
			set preferred to "Später"
		end if
		set answer to button returned of (display dialog question with title appTitle buttons {"Später", "Jetzt neu starten"} default button preferred)
		if answer is "Später" then return
		set summary to runUpdate("--restart")
		set state to valueOf(summary, "status")
	end if
	report(state, valueOf(summary, "version"))
end run

-- Runs manual-update.sh and returns its summary line.
on runUpdate(extraArgument)
	try
		return do shell script "cd " & quoted form of repoPath & " && /bin/bash scripts/fork/manual-update.sh " & extraArgument & " | tail -n 1"
	on error
		return "status=failed"
	end try
end runUpdate

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
	else if state is "busy" then
		display dialog "Gerade läuft schon ein Update. Versuche es in ein paar Minuten noch einmal." with title appTitle buttons {"OK"} default button "OK"
	else
		set answer to button returned of (display dialog "Das Update ist fehlgeschlagen. Die installierte App bleibt unverändert." with title appTitle buttons {"Log öffnen", "OK"} default button "OK")
		if answer is "Log öffnen" then do shell script "open " & quoted form of logPath
	end if
end report
