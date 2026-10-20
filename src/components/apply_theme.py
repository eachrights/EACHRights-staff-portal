#!/usr/bin/env python3
"""
Re-themes AdminDashboard.jsx with a livelier palette.

Usage:  python apply_theme.py path/to/AdminDashboard.jsx
A backup is written next to the file as AdminDashboard.jsx.bak.
Logic, routing and accessibility attributes are untouched; only colours and
a few style props change.
"""
import re
import shutil
import sys

path = sys.argv[1]
shutil.copy(path, path + ".bak")
src = open(path, encoding="utf-8").read()


def sub(pattern, repl, label, flags=re.DOTALL):
    global src
    src, n = re.subn(pattern, repl, src, count=1, flags=flags)
    if not n:
        print(f"! not found, skipped: {label}")


# 1. One distinct colour per folder (used for tiles and the storage bar)
FOLDER_COLORS = {
    "finance": "#0EA47A",
    "education-justice": "#FF9F1C",
    "gender-justice": "#E5484D",
    "health-justice": "#F2589B",
    "environment-climate-change": "#7CB518",
    "economic-justice": "#3E7BFA",
    "communication": "#8E4EC6",
    "it": "#14B8C4",
    "executive-director": "#1B2A41",
    "business-human-rights": "#D9480F",
}
for fid, color in FOLDER_COLORS.items():
    sub(rf'(id: "{fid}",.*?color: ")#[0-9A-Fa-f]{{6}}', rf"\g<1>{color}", f"folder {fid}")

# 2. Folder tiles take their folder's colour
sub(
    r'<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-\[#FBF4E4\]">\s*'
    r'<Folder size=\{20\} className="fill-\[#F3D48A\] text-\[#C8963E\]" />\s*</span>',
    '<span\n'
    '                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"\n'
    '                                style={{ backgroundColor: `${folder.color}26` }}\n'
    '                              >\n'
    '                                <Folder size={20} style={{ color: folder.color, fill: `${folder.color}55` }} />\n'
    '                              </span>',
    "folder tile",
)

# 3. Saturated file-type badges
sub(
    r"const BADGE_STYLES = \{.*?\n\};",
    '''const BADGE_STYLES = {
  pdf: "bg-[#E5484D] text-white ring-[#C93A3F]",
  doc: "bg-[#3E7BFA] text-white ring-[#2F63D6]",
  docx: "bg-[#3E7BFA] text-white ring-[#2F63D6]",
  xls: "bg-[#0E8A45] text-white ring-[#0B7239]",
  xlsx: "bg-[#0E8A45] text-white ring-[#0B7239]",
  csv: "bg-[#0E8A45] text-white ring-[#0B7239]",
  ppt: "bg-[#FF8A1F] text-[#3A1D00] ring-[#E07200]",
  pptx: "bg-[#FF8A1F] text-[#3A1D00] ring-[#E07200]",
  png: "bg-[#8E4EC6] text-white ring-[#7539A8]",
  jpg: "bg-[#8E4EC6] text-white ring-[#7539A8]",
  jpeg: "bg-[#8E4EC6] text-white ring-[#7539A8]",
  txt: "bg-[#64748B] text-white ring-[#4B5A70]",
};''',
    "badge styles",
)
src = src.replace(
    '"bg-slate-100 text-slate-600 ring-slate-200"}`}\n    >',
    '"bg-[#64748B] text-white ring-[#4B5A70]"}`}\n    >',
)

# 4. Page background: soft mint wash with a marigold glow in the corner
src = src.replace(
    'className="min-h-screen bg-[#F5F6F2] text-[#16211C]"',
    'className="eachr-bg min-h-screen text-[#0C1F19]"',
)
src = src.replace(
    ".eachr-num {",
    ".eachr-bg { background: radial-gradient(900px 420px at 100% 0%, rgba(255,159,28,0.16), transparent 60%), "
    "radial-gradient(800px 420px at 0% 0%, rgba(0,163,122,0.16), transparent 60%), #EDF5F0; }\n.eachr-num {",
    1,
)

# 5. Thicker storage bar
src = src.replace(
    'className="mt-4 flex h-2.5 overflow-hidden rounded-full',
    'className="mt-4 flex h-3 overflow-hidden rounded-full',
)

# 6. Updated token comment
sub(
    r"/\*\n \* Design tokens.*?\*/",
    """/*
 * Design tokens
 * jade    #0A6B52  primary surface and headings
 * emerald #008060  links and icons
 * marigold#FF9F1C  warm accent (focus rings, selection)
 * mint    #EDF5F0  page background
 * line    #CFE3D8  hairlines and borders
 * ink     #0C1F19  body text
 * Each folder has its own colour in FOLDERS.
 */""",
    "token comment",
)

# 7. Remaining brand colours (old -> new)
HEX = {
    "#0F3D2E": "#0A6B52",
    "#0B2F23": "#07523F",
    "#2F6B4F": "#008060",
    "#C8963E": "#FF9F1C",
    "#B9852F": "#E07B00",
    "#F5F6F2": "#EDF5F0",
    "#DDE2DB": "#CFE3D8",
    "#16211C": "#0C1F19",
    "#B9CFC2": "#7FCDB0",
    "#F3F7F4": "#E3F4EC",
    "#F8F9F6": "#F1F8F4",
    "#E8F0EB": "#D9F0E5",
    "#E8ECE6": "#DCEBE3",
    "#EEF2EC": "#E1F1E9",
    "#EEF1EC": "#E3EFE8",
    "#FAFBF9": "#F6FBF8",
}
for old, new in HEX.items():
    src = src.replace(old, new)
src = src.replace("rgba(15, 61, 46", "rgba(10, 107, 82")

open(path, "w", encoding="utf-8").write(src)
print("Done. Backup saved as", path + ".bak")