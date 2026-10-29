@echo off
REM VTC Counter - put the Owner sign-in back to: owner / VTC-Owner-Demo26 (must choose a new password at next sign-in).
cd /d "%~dp0"
.venv\Scripts\python -m counter.reset_owner
pause
