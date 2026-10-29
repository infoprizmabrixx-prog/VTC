"""Tiny .xlsx reader/writer (standard library only) for the go-live Excel template.

Writes plain sheets of text cells (so phone numbers keep their digits) and reads back
text, numbers and Excel date numbers from any sheet saved by Excel, LibreOffice or Google Sheets.
"""
import io
import re
import zipfile
from datetime import date, timedelta
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}


def _col(n: int) -> str:
    s = ""
    while n:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s


def write(sheets: list[tuple[str, list[list[str]]]]) -> bytes:
    """sheets: [(name, rows)], first row = headers (bold)."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                             for i in range(1, len(sheets) + 1)) + "</Types>")
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join(f'<sheet name="{escape(n)}" sheetId="{i}" r:id="rId{i}"/>' for i, (n, _) in enumerate(sheets, 1)) + "</sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                             for i in range(1, len(sheets) + 1))
                   + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        z.writestr("xl/styles.xml", '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
                   '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
                   '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
                   '<cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="49" applyNumberFormat="1"/></cellXfs></styleSheet>')
        for i, (_, rows) in enumerate(sheets, 1):
            width = max((len(r) for r in rows), default=1)
            xml = ['<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
                   '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
                   "<cols>" + "".join(f'<col min="{c}" max="{c}" width="24" style="2" customWidth="1"/>' for c in range(1, width + 1)) + "</cols><sheetData>"]
            for r, row in enumerate(rows, 1):
                xml.append(f'<row r="{r}">' + "".join(
                    # v1.7: real numbers stay numbers so the accountant can add them up in Excel
                    f'<c r="{_col(c)}{r}" s="{1 if r == 1 else 0}"><v>{v}</v></c>' if isinstance(v, (int, float)) and not isinstance(v, bool) else
                    f'<c r="{_col(c)}{r}" t="inlineStr" s="{1 if r == 1 else 2}"><is><t xml:space="preserve">{escape(str(v))}</t></is></c>'
                    for c, v in enumerate(row, 1) if v != "") + "</row>")
            xml.append("</sheetData></worksheet>")
            z.writestr(f"xl/worksheets/sheet{i}.xml", "".join(xml))
    return out.getvalue()


def _num(v: str):
    f = float(v)
    return int(f) if f.is_integer() else f


def read(data: bytes) -> dict[str, list[list]]:
    """Every sheet as rows of values (str, int/float). Raises ValueError if it isn't an .xlsx file."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as e:
        raise ValueError("not an xlsx file") from e
    target = {r.get("Id"): r.get("Target") for r in rels.findall("rel:Relationship", NS)}
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    out = {}
    for sh in wb.findall("m:sheets/m:sheet", NS):
        path = target[sh.get(f"{{{NS['r']}}}id")].lstrip("/")
        path = path if path.startswith("xl/") else "xl/" + path
        rows = []
        for row in ET.fromstring(z.read(path)).findall("m:sheetData/m:row", NS):
            vals = {}
            for cell in row.findall("m:c", NS):
                col = re.match(r"[A-Z]+", cell.get("r", "A")).group(0)
                idx = 0
                for ch in col:
                    idx = idx * 26 + ord(ch) - 64
                t, v = cell.get("t"), cell.find("m:v", NS)
                if t == "inlineStr":
                    val = "".join(x.text or "" for x in cell.iter(f"{{{NS['m']}}}t"))
                elif v is None:
                    continue
                elif t == "s":
                    val = shared[int(v.text)]
                elif t in ("str", "e"):
                    val = v.text or ""
                elif t == "b":
                    val = v.text == "1"
                else:
                    val = _num(v.text)
                vals[idx - 1] = val
            if vals:
                rows.append([vals.get(i, "") for i in range(max(vals) + 1)])
        out[sh.get("name")] = rows
    return out


def excel_date(v) -> str | None:
    """A date cell as YYYY-MM-DD: Excel day numbers, 2026-10-27, 27-10-2026 or 27/10/2026."""
    if v in ("", None):
        return None
    if isinstance(v, (int, float)):
        return (date(1899, 12, 30) + timedelta(days=int(v))).isoformat()
    s = str(v).strip()
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s) or None
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", s)
        if not m:
            raise ValueError("date")
        d, mo, y = map(int, m.groups())
    return date(y, mo, d).isoformat()
