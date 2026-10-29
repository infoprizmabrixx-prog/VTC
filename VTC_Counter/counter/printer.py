"""Send raw ESC/POS bytes to a printer installed in Windows (the ATPOS driver's queue), like POS software does.

Uses pywin32 (installed on Windows by start_counter.bat). On other systems, direct printing is unavailable
and the app falls back to printing through the browser.
"""
import sys


class PrintError(Exception):
    pass


def available() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import win32print  # noqa: F401
        return True
    except ImportError:
        return False


def printers() -> dict:
    if not available():
        return {"available": False, "printers": [], "default": ""}
    import win32print
    names = [p[2] for p in win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS)]
    try:
        default = win32print.GetDefaultPrinter()
    except Exception:
        default = ""
    return {"available": True, "printers": names, "default": default}


def send(data: bytes, name: str = "", title: str = "VTC bill") -> None:
    if not available():
        raise PrintError("Direct printing works only on the Windows counter PC.")
    import win32print
    try:
        name = name or win32print.GetDefaultPrinter()
    except Exception:
        raise PrintError("No default printer is set in Windows.")
    try:
        h = win32print.OpenPrinter(name)
    except Exception:
        raise PrintError(f"Printer '{name}' was not found in Windows.")
    try:
        win32print.StartDocPrinter(h, 1, (title, None, "RAW"))
        try:
            win32print.StartPagePrinter(h)
            win32print.WritePrinter(h, data)
            win32print.EndPagePrinter(h)
        finally:
            win32print.EndDocPrinter(h)
    except PrintError:
        raise
    except Exception as e:
        raise PrintError(f"The printer refused the bill: {e}")
    finally:
        win32print.ClosePrinter(h)
