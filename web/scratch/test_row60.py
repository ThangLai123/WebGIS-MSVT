import sys
from pathlib import Path
import openpyxl

sys.stdout.reconfigure(encoding='utf-8')


sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "database"))
from coord_parser import parse_and_validate_coordinates

wb = openpyxl.load_workbook('database/imports/Cơ sở dữ liệu xd bản đồ MSVT 13.10.xlsx', data_only=True)
ws = wb['Sheet1']
coords = ws.cell(row=60, column=8).value
res = parse_and_validate_coordinates(coords)

print("Total points:", res['total_points'])
print("Total groups:", res['total_groups'])
for g in res['groups']:
    print(f"{g['name']}: {len(g['points'])} pts, valid={g['is_valid']}, geom_type={g['geom_type']}, reason={g['reason']}, area={g['area_ha']} ha, is_narrow={g['is_narrow']}")
