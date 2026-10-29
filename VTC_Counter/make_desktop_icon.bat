@echo off
REM Puts a "VTC Counter" icon on the desktop. Double-click the icon to open the counter.
cd /d "%~dp0"
powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\VTC Counter.lnk'); $s.TargetPath = '%~dp0start_counter.bat'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0static\vtc.ico'; $s.Description = 'Open VTC Counter Sales'; $s.Save()" && echo "VTC Counter" icon added to your desktop. || echo Could not make the desktop icon. Right-click start_counter.bat - Send to - Desktop instead.
if not "%1"=="quiet" pause
