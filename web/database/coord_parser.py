# -*- coding: utf-8 -*-
"""
coord_parser.py - Bộ parser tọa độ GPS thông minh hỗ trợ:
1. Đánh số đỉnh (Đ1, Đ2, Đ3..., P1, P2..., Điểm 1, Điểm 2...)
2. Ký hiệu hướng địa lý (N, S, E, W) và tự động nhận diện Vĩ độ / Kinh độ
3. Khoảng trắng bất thường trong số thập phân (105. 523277 -> 105.523277)
4. Độ-phút-giây (DMS) và các biến thể ký hiệu
5. Phân chia nhiều nhóm ranh giới độc lập trong cùng một ô Excel / văn bản
6. Kiểm định hình học từng nhóm (Tự giao cắt, hẹp sliver, hợp lệ)
"""

import math
import re
from typing import List, Dict, Tuple, Optional, Any
from shapely.geometry import Polygon
from shapely.validation import explain_validity


def clean_raw_coordinate_text(raw_text: str) -> str:
    """
    Chuẩn hóa văn bản tọa độ thô:
    - Loại bỏ thẻ HTML (<br>, <br/>, <p>)
    - Thay thế HTML entities (&nbsp;, &#160;, &#x20;)
    - Loại bỏ dấu kẻ bảng Markdown (|)
    - Sửa khoảng trắng bất thường trong số thập phân: '105. 523277' -> '105.523277'
    """
    if not raw_text:
        return ""
    
    s = str(raw_text)
    
    # 1. Thẻ HTML xuống dòng
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.IGNORECASE)
    s = re.sub(r'</?(?:p|div|tr|td|th)>', '\n', s, flags=re.IGNORECASE)
    
    # 2. HTML entities
    s = s.replace('&nbsp;', ' ').replace('&#160;', ' ').replace('&#x20;', ' ').replace('&amp;', '&')
    s = s.replace('\xa0', ' ')
    
    # 3. Ký tự phân cách bảng Markdown
    s = re.sub(r'^[|\s]+|[|\s]+$', '', s)
    s = s.replace('|', ' ')
    
    # 4. Sửa lỗi khoảng trắng bất thường giữa phần nguyên và phần thập phân:
    # Ví dụ: '105. 523277' hoặc '105 .523277' hoặc '105 . 523277'
    s = re.sub(r'(\d+)\s*\.\s+(\d+)', r'\1.\2', s)
    s = re.sub(r'(\d+)\s+\.\s*(\d+)', r'\1.\2', s)

    # 5. Sửa khoảng trắng giữa số độ DMS và ký hiệu độ
    s = re.sub(r'(\d{1,3})\s+([o°d])\s*', r'\1\2', s, flags=re.IGNORECASE)

    return s.strip()


def parse_single_coord_token(token: str) -> Tuple[Optional[float], Optional[str], Optional[str]]:
    """
    Phân tích 1 token tọa độ (chứa vĩ độ hoặc kinh độ).
    Trả về: (giá trị float, hướng 'N'|'S'|'E'|'W'|None, định dạng 'Decimal'|'DMS'|None)
    """
    if not token:
        return None, None, None
    t = token.strip()
    
    # Kiểm tra ký hiệu hướng ở đầu hoặc cuối token
    direction = None
    m_dir = re.search(r'([NSEWnsew])$', t)
    if m_dir:
        direction = m_dir.group(1).upper()
        t = t[:m_dir.start()].strip()
    else:
        m_dir_start = re.search(r'^([NSEWnsew])', t)
        if m_dir_start:
            direction = m_dir_start.group(1).upper()
            t = t[m_dir_start.end():].strip()

    # Dạng DMS chuẩn hoặc có o/°/d: 19o10'50.90'', 19°10'50.90"
    m_dms = re.match(r'''^(\d{1,3})[o°d]\s*(\d{1,2})['’′]\s*(\d{1,2}(?:[.,]\d+)?)['"”″]*$''', t, re.IGNORECASE)
    if m_dms:
        deg, mn, sec = m_dms.groups()
        sec = sec.replace(',', '.')
        deg_f = float(deg)
        mn_f = float(mn)
        sec_f = float(sec)
        if mn_f >= 60 or sec_f >= 60:
            return None, None, None
        val = deg_f + mn_f / 60.0 + sec_f / 3600.0
        if direction in ('S', 'W'):
            val = -val
        return val, direction, 'DMS'

    # Dạng số thập phân Decimal: 18.997412, -18.997412
    t_clean = t.replace(',', '.')
    m_dec = re.match(r'^[-+]?\d+(?:\.\d+)?$', t_clean)
    if m_dec:
        val = float(t_clean)
        # Kiểm tra mâu thuẫn giữa dấu âm và hướng
        if val < 0 and direction in ('N', 'E'):
            return None, None, None
        if direction in ('S', 'W'):
            val = -abs(val)
        return val, direction, 'Decimal'

    return None, None, None


def parse_coordinate_pair(c1_str: str, c2_str: str) -> Tuple[Optional[float], Optional[float], Optional[str]]:
    """
    Ghép 2 token thành cặp tọa độ WGS84 chuẩn: (latitude, longitude, format_type).
    Tự động nhận diện hướng:
    - Nếu c1 có hướng E/W và c2 có hướng N/S -> c1 là Longitude, c2 là Latitude
    - Mặc định: c1 là Latitude, c2 là Longitude
    """
    v1, d1, f1 = parse_single_coord_token(c1_str)
    v2, d2, f2 = parse_single_coord_token(c2_str)

    if v1 is None or v2 is None:
        return None, None, 'Invalid'

    fmt: str = (f1 if f1 == f2 else 'Mixed') if f1 is not None else 'Decimal'

    # Trường hợp có ký hiệu hướng giúp phân định rõ ràng
    if d1 in ('E', 'W') and d2 in ('N', 'S'):
        # Token 1 là Kinh độ (Longitude), Token 2 là Vĩ độ (Latitude)
        lon = v1
        lat = v2
    elif d1 in ('N', 'S') and d2 in ('E', 'W'):
        # Token 1 là Vĩ độ (Latitude), Token 2 là Kinh độ (Longitude)
        lat = v1
        lon = v2
    else:
        # Mặc định theo quy ước Latitude trước, Longitude sau
        lat = v1
        lon = v2

    # Kiểm tra phạm vi tọa độ hợp lệ toàn cầu
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        # Thử đảo lại nếu người dùng nhập ngược thứ tự mà không ghi N/E
        if -90.0 <= lon <= 90.0 and -180.0 <= lat <= 180.0:
            lat, lon = lon, lat
        else:
            return None, None, 'OutOfBounds'

    return lat, lon, fmt


def extract_raw_points_and_groups(raw_text: str) -> List[Dict[str, Any]]:
    """
    Trích xuất toàn bộ các điểm từ chuỗi thô kèm nhãn và phân nhóm.
    Hỗ trợ cả trường hợp nằm trên nhiều dòng hoặc dồn trong một ô duy nhất.
    """
    cleaned = clean_raw_coordinate_text(raw_text)
    if not cleaned:
        return []

    # Regex trích xuất từng cặp tọa độ:
    # Nhóm 1-2: Nhãn (Đ1, P1, Điểm 1...)
    # Nhóm 3: Token tọa độ 1
    # Nhóm 4: Dấu phân cách (, hoặc ;)
    # Nhóm 5: Token tọa độ 2
    item_regex = re.compile(
        r'(?:([ĐDđdP]|Điểm|Diem|Point|Mốc)\s*(\d+)[\s:.-]*)?'
        r'([^\s,;]+(?:\s*[o°d\']+[^\s,;]*)?\s*[NSEWnsew]?)'
        r'[\s,;]+'
        r'([^\s,;]+(?:\s*[o°d\']+[^\s,;]*)?\s*[NSEWnsew]?)'
        r'(?:[\s,;]*([;\n])?)',
        re.UNICODE
    )

    matches = list(item_regex.finditer(cleaned))
    raw_points = []

    for idx, m in enumerate(matches, 1):
        prefix, num_str, c1, c2, delimiter = m.groups()
        num = int(num_str) if num_str else None
        label = f"{prefix or ''}{num_str or ''}".strip()
        
        lat, lon, fmt = parse_coordinate_pair(c1, c2)
        is_valid = (lat is not None and lon is not None and fmt != 'OutOfBounds')

        raw_points.append({
            'raw_index': idx,
            'label': label or f"#{idx}",
            'label_prefix': prefix,
            'label_num': num,
            'c1_raw': c1,
            'c2_raw': c2,
            'lat': round(lat, 8) if lat is not None else None,
            'lng': round(lon, 8) if lon is not None else None,
            'format': fmt,
            'is_valid': is_valid,
            'delimiter': delimiter or ''
        })

    return raw_points


def partition_into_groups(raw_points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Phân chia danh sách điểm thô thành các nhóm ranh giới độc lập (Section V đề bài):
    1. Một nhóm bắt đầu khi gặp Đ1 (hoặc số 1).
    2. Các nhãn Đ2, Đ3, Đ4... tiếp theo được ghép vào nhóm đang xử lý.
    3. Khi sau một chuỗi nhãn đã đánh số lại xuất hiện Đ1, tạo nhóm mới.
    4. Nếu không có nhãn nhưng có dấu chấm phẩy ';' ngăn cách các khối >= 3 điểm -> tạo nhóm mới.
    5. Phát hiện thứ tự nhãn bị nhảy (ví dụ Đ1 -> Đ3 thiếu Đ2) để cảnh báo.
    """
    if not raw_points:
        return []

    groups = []
    current_group_pts = []
    
    # Kiểm tra xem dữ liệu có đánh số nhãn hay không
    has_labels = any(p['label_num'] is not None for p in raw_points)

    for i, pt in enumerate(raw_points):
        num = pt['label_num']
        
        # Điều kiện tách nhóm khi có nhãn: Gặp lại số 1 (Đ1, P1, Điểm 1) khi nhóm hiện tại đã có điểm
        start_new_by_label = (has_labels and num == 1 and len(current_group_pts) > 0)
        
        # Điều kiện tách nhóm phụ trợ: Điểm trước đó kết thúc bằng dấu chấm phẩy ';' và nhóm hiện tại >= 3 điểm
        prev_pt = raw_points[i - 1] if i > 0 else None
        start_new_by_semicolon = (
            prev_pt and prev_pt.get('delimiter') == ';' 
            and len(current_group_pts) >= 3 
            and (num == 1 or not has_labels)
        )

        if start_new_by_label or start_new_by_semicolon:
            groups.append(current_group_pts)
            current_group_pts = []

        current_group_pts.append(pt)

    if current_group_pts:
        groups.append(current_group_pts)

    # Đóng gói và kiểm tra hình học cho từng nhóm
    structured_groups = []
    for g_idx, pts in enumerate(groups, 1):
        g_info = analyze_single_group_geometry(g_idx, pts)
        structured_groups.append(g_info)

    return structured_groups


def analyze_single_group_geometry(group_id: int, points: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Kiểm tra hình học độc lập cho một nhóm tọa độ (Section VII đề bài):
    - Tối thiểu 3 đỉnh phân biệt
    - Phát hiện điểm trùng lặp
    - Phát hiện tự giao cắt (Self-intersection)
    - Nhận diện đa giác quá hẹp (sliver polygon)
    - Tính diện tích bằng WGS84
    """
    group_name = f"Nhóm {group_id}"
    valid_pts = [p for p in points if p['is_valid']]
    
    # Kiểm tra nhãn bị thiếu (ví dụ Đ1 -> Đ3)
    label_warnings = []
    nums = [p['label_num'] for p in points if p['label_num'] is not None]
    if nums:
        for idx in range(len(nums) - 1):
            if nums[idx + 1] > nums[idx] + 1:
                label_warnings.append(f"Nhảy nhãn từ Đ{nums[idx]} lên Đ{nums[idx + 1]} (thiếu đỉnh ở giữa)")

    # 1. Trường hợp 0 hoặc tọa độ lỗi
    if len(valid_pts) == 0:
        return {
            'group_id': group_id,
            'name': group_name,
            'points': points,
            'valid_count': 0,
            'geom_type': 'INVALID',
            'is_valid': False,
            'reason': 'Không có tọa độ hợp lệ trong nhóm',
            'area_ha': None,
            'is_narrow': False,
            'geojson': None,
            'warnings': label_warnings
        }

    # 2. Trường hợp 1 điểm (Point)
    if len(valid_pts) == 1:
        p0 = valid_pts[0]
        return {
            'group_id': group_id,
            'name': group_name,
            'points': points,
            'valid_count': 1,
            'geom_type': 'POINT',
            'is_valid': True,
            'reason': 'Điểm mốc đại diện đơn',
            'area_ha': 0.0,
            'is_narrow': False,
            'geojson': {'type': 'Point', 'coordinates': [p0['lng'], p0['lat']]},
            'warnings': label_warnings
        }

    # 3. Trường hợp 2 điểm (LineString / Cần thêm 1 đỉnh)
    if len(valid_pts) == 2:
        return {
            'group_id': group_id,
            'name': group_name,
            'points': points,
            'valid_count': 2,
            'geom_type': 'TWO_POINTS',
            'is_valid': False,
            'reason': 'Chỉ có 2 điểm, chưa đủ xác định ranh giới Polygon (cần tối thiểu 3 đỉnh)',
            'area_ha': None,
            'is_narrow': False,
            'geojson': None,
            'warnings': label_warnings
        }

    # 4. Trường hợp >= 3 điểm (Polygon)
    coords = [(p['lng'], p['lat']) for p in valid_pts]
    
    # Loại bỏ điểm cuối trùng điểm đầu nếu người dùng tự khép kín
    distinct_coords = coords[:-1] if (len(coords) > 1 and coords[0] == coords[-1]) else coords
    
    # Phát hiện điểm trùng lặp
    coord_set = set()
    has_duplicates = False
    for c in distinct_coords:
        if c in coord_set:
            has_duplicates = True
            break
        coord_set.add(c)

    if has_duplicates:
        return {
            'group_id': group_id,
            'name': group_name,
            'points': points,
            'valid_count': len(valid_pts),
            'geom_type': 'INVALID',
            'is_valid': False,
            'reason': 'Phát hiện điểm trùng lặp trong nhóm, không thể tạo Polygon',
            'area_ha': None,
            'is_narrow': False,
            'geojson': None,
            'warnings': label_warnings + ['Có đỉnh trùng lặp']
        }

    # Kiểm tra tính hợp lệ không gian bằng Shapely
    try:
        poly = Polygon(distinct_coords)
        is_poly_valid = poly.is_valid and poly.area > 0
        validity_reason = explain_validity(poly) if not poly.is_valid else "Valid Geometry"
        
        # Nhận diện đa giác hẹp (sliver polygon): diện tích nhỏ nhưng chu vi dài
        is_narrow = False
        area_ha = None
        
        if is_poly_valid:
            # Ước tính diện tích WGS84 tương đương
            lat_rad = math.radians(distinct_coords[0][1])
            m_per_deg_lat = 111132.954 - 559.822 * math.cos(2 * lat_rad) + 1.175 * math.cos(4 * lat_rad)
            m_per_deg_lon = 111412.84 * math.cos(lat_rad) - 93.5 * math.cos(3 * lat_rad)
            
            # Tính diện tích mét vuông bằng Shoelace trên tọa độ trắc địa cục bộ
            n = len(distinct_coords)
            metric_area_m2 = 0.0
            for i in range(n):
                j = (i + 1) % n
                x1 = distinct_coords[i][0] * m_per_deg_lon
                y1 = distinct_coords[i][1] * m_per_deg_lat
                x2 = distinct_coords[j][0] * m_per_deg_lon
                y2 = distinct_coords[j][1] * m_per_deg_lat
                metric_area_m2 += (x1 * y2 - x2 * y1)
            
            metric_area_m2 = abs(metric_area_m2) / 2.0
            area_ha = round(metric_area_m2 / 10000.0, 4)

            # Tính chu vi mét
            perimeter_m = 0.0
            for i in range(n):
                j = (i + 1) % n
                dx = (distinct_coords[j][0] - distinct_coords[i][0]) * m_per_deg_lon
                dy = (distinct_coords[j][1] - distinct_coords[i][1]) * m_per_deg_lat
                perimeter_m += math.sqrt(dx * dx + dy * dy)

            # Tiêu chí nhận diện đa giác rất hẹp (sliver):
            # Chiều rộng trung bình = Area / (Perimeter / 2) < 2 mét hoặc Isoperimetric quotient rất nhỏ
            if perimeter_m > 0 and (2.0 * metric_area_m2 / perimeter_m) < 3.0:
                is_narrow = True

        # Khép kín GeoJSON ring
        geojson_coords = list(distinct_coords)
        if geojson_coords[0] != geojson_coords[-1]:
            geojson_coords.append(geojson_coords[0])

        return {
            'group_id': group_id,
            'name': group_name,
            'points': points,
            'valid_count': len(valid_pts),
            'geom_type': 'POLYGON' if is_poly_valid else 'INVALID',
            'is_valid': is_poly_valid,
            'reason': validity_reason if not is_poly_valid else ('Hình học hợp lệ nhưng rất hẹp (cần rà soát)' if is_narrow else 'Hình học hợp lệ'),
            'area_ha': area_ha,
            'is_narrow': is_narrow,
            'geojson': {'type': 'Polygon', 'coordinates': [geojson_coords]} if is_poly_valid else None,
            'warnings': label_warnings + (['Ranh giới rất hẹp, chiều rộng trung bình dưới 3 mét'] if is_narrow else [])
        }

    except Exception as e:
        return {
            'group_id': group_id,
            'name': group_name,
            'points': points,
            'valid_count': len(valid_pts),
            'geom_type': 'INVALID',
            'is_valid': False,
            'reason': f"Lỗi tạo hình học: {str(e)}",
            'area_ha': None,
            'is_narrow': False,
            'geojson': None,
            'warnings': label_warnings
        }


def parse_and_validate_coordinates(raw_text: str) -> Dict[str, Any]:
    """
    Hàm phân tích tổng thể: nhận diện tất cả các định dạng, chuẩn hóa N/E, tách nhóm và đánh giá hình học.
    Trả về cấu trúc đầy đủ phục vụ cả Form Thêm/Sửa, API Backend và Import Excel.
    """
    raw_points = extract_raw_points_and_groups(raw_text)
    groups = partition_into_groups(raw_points)

    total_pts = len(raw_points)
    valid_pts = sum(1 for p in raw_points if p['is_valid'])
    total_groups = len(groups)
    
    all_groups_valid = (total_groups > 0 and all(g['is_valid'] for g in groups))
    has_self_intersection = any('Self-intersection' in g.get('reason', '') for g in groups)

    return {
        'total_points': total_pts,
        'valid_points': valid_pts,
        'total_groups': total_groups,
        'all_groups_valid': all_groups_valid,
        'has_self_intersection': has_self_intersection,
        'groups': groups,
        'raw_points': raw_points
    }
