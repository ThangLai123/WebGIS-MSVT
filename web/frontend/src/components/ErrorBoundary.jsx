import React from 'react';

/**
 * ErrorBoundary - Ngăn chặn lỗi runtime làm trắng toàn bộ màn hình React
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Đã chặn lỗi runtime:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div style={{
          padding: '28px 24px',
          margin: '20px auto',
          maxWidth: '560px',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
          border: '1px solid #fee2e2',
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <div style={{ fontSize: '42px', marginBottom: '8px' }}>⚠️</div>
          <h3 style={{ color: '#b91c1c', margin: '0 0 8px 0', fontSize: '18px', fontWeight: 700 }}>
            Đã xảy ra sự cố trong thành phần giao diện
          </h3>
          <p style={{ color: '#4b5563', fontSize: '13.5px', lineHeight: 1.5, margin: '0 0 16px 0' }}>
            {this.state.error?.message || 'Có lỗi ngoài dự kiến trong thành phần giao diện. Vui lòng bấm thử lại bên dưới.'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '9px 20px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '13.5px',
              boxShadow: '0 2px 6px rgba(37,99,235,0.3)'
            }}
          >
            🔄 Thử lại
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
