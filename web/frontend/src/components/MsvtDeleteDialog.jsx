import React, { useState } from 'react';
import adminApi from '../services/adminApi';
import './MsvtDeleteDialog.css';

const MsvtDeleteDialog = ({ isOpen, region, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen || !region) return null;

  const handleDelete = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      await adminApi.deleteRegion(region.id);
      if (onSuccess) {
        onSuccess(region);
      }
      onClose();
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi xóa vùng trồng. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const msvtCode = region.msvt_moi || region.msvt_cu || `ID #${region.id}`;

  return (
    <div className="msvt-delete-overlay" onClick={onClose}>
      <div className="msvt-delete-modal" onClick={(e) => e.stopPropagation()}>
        <div className="msvt-delete-header">
          <h3>🗑️ Xác nhận Xóa mềm Vùng trồng MSVT</h3>
          <button
            type="button"
            className="msvt-delete-close-btn"
            onClick={onClose}
            disabled={loading}
          >
            ✕
          </button>
        </div>

        <div className="msvt-delete-body">
          {errorMessage && (
            <div style={{
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              padding: '10px 12px',
              borderRadius: '6px',
              fontSize: '13px',
              border: '1px solid #fecaca'
            }}>
              ⚠️ {errorMessage}
            </div>
          )}

          <p style={{ margin: 0, fontSize: '13.5px', color: '#334155', lineHeight: 1.5 }}>
            Bạn có chắc chắn muốn xóa vùng trồng sau đây khỏi danh sách đang hoạt động không?
          </p>

          <div className="msvt-delete-info-card">
            <div className="msvt-delete-info-row">
              <span className="msvt-delete-info-label">Mã số vùng trồng:</span>
              <span className="msvt-delete-info-value" style={{ color: '#15803d' }}>{msvtCode}</span>
            </div>
            <div className="msvt-delete-info-row">
              <span className="msvt-delete-info-label">Tổ chức / Cá nhân:</span>
              <span className="msvt-delete-info-value">{region.to_chuc_ca_nhan || 'Chưa có'}</span>
            </div>
            <div className="msvt-delete-info-row">
              <span className="msvt-delete-info-label">Cây trồng / Thị trường:</span>
              <span className="msvt-delete-info-value">{region.loai_cay_trong || 'N/A'} - {region.thi_truong || 'N/A'}</span>
            </div>
          </div>

          <div className="msvt-delete-warning-box">
            <strong>⚠️ LƯU Ý BẢO TOÀN DỮ LIỆU (XÓA MỀM):</strong>
            <div style={{ marginTop: '4px' }}>
              Thao tác này sử dụng cơ chế <strong>Xóa mềm (Soft Delete)</strong>. Bản ghi sẽ bị ẩn khỏi bản đồ WebGIS và các thống kê công khai, nhưng <strong>không bị xóa vĩnh viễn</strong> khỏi cơ sở dữ liệu. Hệ thống sẽ ghi nhận tài khoản thực hiện và thời điểm xóa.
            </div>
          </div>
        </div>

        <div className="msvt-delete-footer">
          <button
            type="button"
            className="msvt-delete-btn-cancel"
            onClick={onClose}
            disabled={loading}
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            className="msvt-delete-btn-confirm"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading ? 'Đang thực hiện...' : 'Xác nhận xóa mềm'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MsvtDeleteDialog;
