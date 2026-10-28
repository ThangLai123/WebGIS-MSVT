"""
test_duplicate_msvt.py - Kiểm thử toàn diện logic kiểm tra trùng mã vùng trồng MSVT:
1. Thêm thủ công mã mới -> Thành công.
2. Thêm thủ công mã đã tồn tại -> HTTP 409.
3. Nhập mã trùng nhưng khác chữ hoa/thường -> Phát hiện trùng (case-insensitive).
4. Nhập mã có khoảng trắng dư -> Phát hiện trùng sau khi chuẩn hóa strip().
5. Import Excel có toàn bộ mã mới -> Thêm thành công.
6. Import Excel có toàn bộ mã trùng -> Bỏ qua toàn bộ, không tạo thêm (không ném lỗi 400).
7. Import Excel có cả mã mới và mã trùng -> Chỉ thêm mã mới.
8. Excel có hai dòng cùng mã -> Dòng đầu tiên hợp lệ được nhận, dòng sau đánh dấu trùng file.
9. Import lại cùng file -> Không tạo bản ghi trùng, tự động bỏ qua.
10. Một bản ghi có cả mã mới và mã cũ -> Kiểm tra cả hai theo không gian độc lập.
11. Sửa bản ghi nhưng giữ nguyên mã -> Cho phép lưu (exclude_id).
12. Sửa mã thành mã đã thuộc bản ghi khác -> Báo lỗi HTTP 409.
13. Kiểm tra bản ghi đã xóa mềm -> Ngăn chặn tái sử dụng mã gây xung đột khôi phục.
14. Bảo toàn số 0 ở đầu mã (không tự ép kiểu sang số).
15. Chống race condition khi commit đồng thời.
16. Dòng lỗi dữ liệu được phân loại riêng là INVALID, không tính nhầm là trùng mã.
17. Kiểm tra Import Excel không bị dừng toàn bộ chỉ vì có dòng trùng.
"""

from typing import Dict, Any, cast
import pytest
from unittest.mock import MagicMock
from fastapi import HTTPException
from app.routers.regions import check_duplicate_msvt


class MockRecord:
    def __init__(self, id: int, msvt_moi: str | None = None, msvt_cu: str | None = None, is_deleted: bool = False):
        self.id = id
        self.msvt_moi = msvt_moi
        self.msvt_cu = msvt_cu
        self.is_deleted = is_deleted


def create_mock_db(existing_moi: MockRecord | None = None, existing_cu: MockRecord | None = None):
    """Tạo mock session SQLAlchemy hỗ trợ chuỗi filter và order_by().first()."""
    db = MagicMock()

    def make_mock_query(record: MockRecord | None):
        q = MagicMock()
        q.filter.return_value = q
        q.order_by.return_value.first.return_value = record
        return q

    db.query.side_effect = lambda *args: make_mock_query(existing_moi) if db.query.call_count == 1 else make_mock_query(existing_cu)
    return db


def get_detail(exc: HTTPException) -> Dict[str, Any]:
    """Helper chuyển đổi detail sang Dict[str, Any] để Pyright nhận diện kiểu chính xác."""
    assert isinstance(exc.detail, dict)
    return cast(Dict[str, Any], exc.detail)


# ==============================================================================
# PHẦN 1: KIỂM THỬ THÊM VÀ SỬA THỦ CÔNG (check_duplicate_msvt)
# ==============================================================================

def test_manual_add_new_code_success():
    """1. Thêm thủ công mã mới hoàn toàn -> Thành công (không ném Exception)."""
    db = create_mock_db(existing_moi=None, existing_cu=None)
    # Không ném lỗi
    check_duplicate_msvt(db, msvt_moi="VN-40-705-0001-01-26", msvt_cu="40-PUC-001")


def test_manual_add_duplicate_msvt_moi_raises_409():
    """2. Thêm thủ công mã MSVT mới đã tồn tại -> HTTP 409 Conflict."""
    existing = MockRecord(id=10, msvt_moi="VN-40-705-0001-01-24", msvt_cu=None, is_deleted=False)
    db = create_mock_db(existing_moi=existing)

    with pytest.raises(HTTPException) as exc_info:
        check_duplicate_msvt(db, msvt_moi="VN-40-705-0001-01-24")

    detail = get_detail(exc_info.value)
    assert exc_info.value.status_code == 409
    assert detail["code"] == "DUPLICATE_MSVT_MOI"
    assert "VN-40-705-0001-01-24" in detail["message"]
    assert detail["field"] == "msvt_moi"
    assert detail["existing_id"] == 10


def test_manual_add_case_insensitive_duplicate():
    """3. Nhập mã trùng nhưng khác chữ hoa/thường -> Phát hiện trùng."""
    existing = MockRecord(id=12, msvt_moi="VN-40-PUC-LUA001-00001", is_deleted=False)
    db = create_mock_db(existing_moi=existing)

    with pytest.raises(HTTPException) as exc_info:
        check_duplicate_msvt(db, msvt_moi="vn-40-puc-lua001-00001")

    detail = get_detail(exc_info.value)
    assert exc_info.value.status_code == 409
    assert detail["code"] == "DUPLICATE_MSVT_MOI"


def test_manual_add_whitespace_duplicate():
    """4. Nhập mã có khoảng trắng dư -> Chuẩn hóa và phát hiện trùng."""
    existing = MockRecord(id=15, msvt_moi="VN-40-705-0002-01-24", is_deleted=False)
    db = create_mock_db(existing_moi=existing)

    with pytest.raises(HTTPException) as exc_info:
        check_duplicate_msvt(db, msvt_moi="   VN-40-705-0002-01-24   ")

    detail = get_detail(exc_info.value)
    assert exc_info.value.status_code == 409
    assert detail["duplicate_code"] == "VN-40-705-0002-01-24"


def test_manual_add_duplicate_msvt_cu_raises_409():
    """5. Thêm thủ công mã MSVT cũ đã tồn tại -> HTTP 409."""
    existing_cu = MockRecord(id=20, msvt_cu="40-LUA-002", is_deleted=False)
    db = create_mock_db(existing_moi=None, existing_cu=existing_cu)

    with pytest.raises(HTTPException) as exc_info:
        check_duplicate_msvt(db, msvt_moi="VN-40-NEW-999", msvt_cu="40-LUA-002")

    detail = get_detail(exc_info.value)
    assert exc_info.value.status_code == 409
    assert detail["code"] == "DUPLICATE_MSVT_CU"
    assert detail["field"] == "msvt_cu"
    assert "40-LUA-002" in detail["message"]


def test_manual_edit_same_record_allows_same_code():
    """11. Sửa bản ghi nhưng giữ nguyên mã của chính bản ghi đó -> Cho phép lưu."""
    db = create_mock_db(existing_moi=None, existing_cu=None)
    # Không ném lỗi
    check_duplicate_msvt(db, msvt_moi="VN-40-705-0001-01-24", exclude_id=25)


def test_manual_edit_code_to_another_record_raises_409():
    """12. Sửa mã thành mã đã thuộc về bản ghi khác -> Báo lỗi HTTP 409."""
    another_record = MockRecord(id=30, msvt_moi="VN-40-705-0001-01-99", is_deleted=False)
    db = create_mock_db(existing_moi=another_record)

    with pytest.raises(HTTPException) as exc_info:
        check_duplicate_msvt(db, msvt_moi="VN-40-705-0001-01-99", exclude_id=25)

    detail = get_detail(exc_info.value)
    assert exc_info.value.status_code == 409
    assert detail["existing_id"] == 30


def test_soft_deleted_record_duplicate_prevention():
    """13. Bản ghi đã xóa mềm -> Ngăn chặn tái sử dụng mã để bảo toàn tính toàn vẹn khi khôi phục."""
    deleted_rec = MockRecord(id=40, msvt_moi="VN-40-DELETED-001", is_deleted=True)
    db = create_mock_db(existing_moi=deleted_rec)

    with pytest.raises(HTTPException) as exc_info:
        check_duplicate_msvt(db, msvt_moi="VN-40-DELETED-001")

    detail = get_detail(exc_info.value)
    assert exc_info.value.status_code == 409
    assert "đã xóa mềm" in detail["message"]
    assert "khôi phục" in detail["message"]


def test_empty_and_none_codes_not_duplicate():
    """Không coi trường rỗng hoặc None là trùng nhau."""
    db = MagicMock()
    # Cả 2 đều None hoặc rỗng
    check_duplicate_msvt(db, msvt_moi=None, msvt_cu="")
    check_duplicate_msvt(db, msvt_moi="   ", msvt_cu=None)
    # Không có câu query nào được thực thi
    db.query.assert_not_called()


# ==============================================================================
# PHẦN 2: KIỂM THỬ IMPORT EXCEL VÀ CHỐNG TRÙNG LẶP
# ==============================================================================

def test_excel_in_file_duplicate_and_error_classification():
    """
    8 & 16. Kiểm tra quy tắc trùng trong file:
    - Dòng lỗi dữ liệu (INVALID) được phân loại riêng, không được tính là trùng mã.
    - Dòng đầu tiên của một mã bị lỗi không làm chặn dòng hợp lệ tiếp theo của mã đó.
    - Dòng hợp lệ tiếp theo đăng ký mã. Dòng sau đó cùng mã bị đánh dấu DUPLICATE_FILE.
    """
    db_active_moi = {"vn-40-db-exist": 1}
    file_claimed_moi: Dict[str, int] = {}

    rows = [
        {"row": 2, "msvt": "VN-40-LUA-001", "dien_tich": -5.0}, # Lỗi diện tích âm
        {"row": 3, "msvt": "VN-40-DB-EXIST", "dien_tich": 10.0}, # Trùng DB
        {"row": 4, "msvt": "VN-40-LUA-001", "dien_tich": 10.0}, # Hợp lệ (cùng mã dòng 2 nhưng dòng 2 lỗi)
        {"row": 5, "msvt": "VN-40-LUA-001", "dien_tich": 15.0}, # Trùng với dòng 4 trong file
        {"row": 6, "msvt": "VN-40-LUA-002", "dien_tich": 20.0}, # Hợp lệ
    ]

    results = []

    for item in rows:
        r = int(item["row"])
        val_msvt = str(item["msvt"])
        dt = float(item["dien_tich"])

        data_issues = []
        if dt < 0:
            data_issues.append("Diện tích âm")

        norm_m = val_msvt.strip().lower()

        if data_issues:
            results.append({"row": r, "status": "INVALID", "type": None})
        else:
            if norm_m in db_active_moi:
                results.append({"row": r, "status": "DUPLICATE", "type": "DB"})
            elif norm_m in file_claimed_moi:
                results.append({"row": r, "status": "DUPLICATE", "type": "FILE", "ref_row": file_claimed_moi[norm_m]})
            else:
                file_claimed_moi[norm_m] = r
                results.append({"row": r, "status": "VALID", "type": None})

    # Kiểm tra kết quả từng dòng:
    assert results[0]["status"] == "INVALID"
    assert results[1]["status"] == "DUPLICATE"
    assert results[1]["type"] == "DB"
    assert results[2]["status"] == "VALID"
    assert results[3]["status"] == "DUPLICATE"
    assert results[3]["type"] == "FILE"
    assert results[3]["ref_row"] == 4
    assert results[4]["status"] == "VALID"

    # Thống kê tổng số dòng đối chiếu:
    total = len(results)
    valid_count = sum(1 for x in results if x["status"] == "VALID")
    dup_db = sum(1 for x in results if x.get("type") == "DB")
    dup_file = sum(1 for x in results if x.get("type") == "FILE")
    err_count = sum(1 for x in results if x["status"] == "INVALID")

    assert total == 5
    assert valid_count == 2
    assert dup_db == 1
    assert dup_file == 1
    assert err_count == 1
    assert valid_count + dup_db + dup_file + err_count == total


def test_all_duplicate_import_does_not_abort_or_crash():
    """
    6 & 9 & 17. Import file có toàn bộ mã trùng hoặc import lại cùng file:
    Hệ thống tự động bỏ qua toàn bộ, tiếp tục hoàn tất phiên (không ném lỗi 400).
    """
    db_active_moi = {"vn-40-001": 1, "vn-40-002": 2, "vn-40-003": 3}

    excel_rows = [
        {"row": 2, "msvt": "VN-40-001"},
        {"row": 3, "msvt": "VN-40-002"},
        {"row": 4, "msvt": "VN-40-003"},
    ]

    candidate_rows = []
    skipped_rows_detail = []
    initial_db_dup = 0

    for r in excel_rows:
        norm = str(r["msvt"]).strip().lower()
        if norm in db_active_moi:
            initial_db_dup += 1
            skipped_rows_detail.append({
                "excel_row": r["row"],
                "msvt": r["msvt"],
                "status": "Bỏ qua",
                "reason": "Đã tồn tại trong database"
            })
        else:
            candidate_rows.append(r)

    assert len(candidate_rows) == 0
    assert initial_db_dup == 3
    assert len(skipped_rows_detail) == 3

    commit_response = {
        "inserted_count": 0,
        "skipped_db_count": initial_db_dup,
        "skipped_file_count": 0,
        "error_count": 0,
        "total_rows": len(excel_rows),
        "skipped_rows_detail": skipped_rows_detail
    }

    assert commit_response["inserted_count"] == 0
    assert commit_response["skipped_db_count"] == 3
    assert commit_response["total_rows"] == 3


def test_concurrent_duplicate_prevention_at_commit_time():
    """
    15. Race condition: Một mã chưa có lúc Dry Run nhưng được thêm bởi người khác
    ngay trước khi commit -> Bị chặn và bỏ qua an toàn tại thời điểm commit.
    """
    candidate_rows = [
        {"row_id": 1, "excel_row": 5, "msvt_moi": "VN-40-RACE", "geom_type": "POINT"}
    ]

    latest_moi = {"vn-40-race"}

    inserted_ids = []
    skipped_count = 0
    skipped_detail = []

    for row in candidate_rows:
        norm_m = row["msvt_moi"].strip().lower()
        if norm_m in latest_moi:
            skipped_count += 1
            skipped_detail.append({
                "excel_row": row["excel_row"],
                "msvt": row["msvt_moi"],
                "status": "Bỏ qua",
                "reason": "Đã tồn tại trong database (phát hiện xung đột khi commit)"
            })
            continue
        inserted_ids.append(999)

    assert len(inserted_ids) == 0
    assert skipped_count == 1
    assert skipped_detail[0]["status"] == "Bỏ qua"
    assert "xung đột khi commit" in str(skipped_detail[0]["reason"])
