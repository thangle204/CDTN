# SHOE STORE frontend

React, Vite, Tailwind CSS, React Router và Axios.

Từ thư mục gốc dự án:

    npm ci --prefix frontend
    npm run client
    npm run test:frontend
    npm run build

Frontend dùng /api theo mặc định. Vite chuyển tiếp tới http://localhost:5000; đổi API_PROXY_TARGET trong .env.local khi dùng cổng khác. Khi deploy frontend và API ở hai origin riêng, đặt VITE_API_URL trước khi build. Không đặt bí mật trong VITE_*.

Giao diện hỗ trợ chọn size giày, giỏ theo từng size, checkout, voucher, đơn hàng, khôi phục mật khẩu và quản trị. Backend xác định giá cuối cùng và xác nhận thanh toán.

Trang chủ `/` và danh sách `/products` dùng chung bố cục catalog: bộ lọc bên trái, danh mục phía trên, lưới 4 cột trên màn hình lớn và 2 cột trên điện thoại. Trên tablet/điện thoại, nút **Bộ lọc** mở bảng chọn; Escape, nút đóng hoặc nền bên ngoài đều đóng được bảng.

Bộ lọc thương hiệu, màu, size, giá và còn hàng lấy từ dữ liệu API. Màu và size phải thuộc cùng một biến thể còn hàng; sản phẩm cũ dùng tồn kho chung. Có sắp xếp mới nhất, giá và đánh giá, phân trang 20 sản phẩm; bộ lọc và trang được giữ trên URL khi tải lại hoặc quay lại. Nhấn sản phẩm/Chọn size mở trang chi tiết để chọn đúng màu và size trước khi thêm giỏ.

Không tự tạo giá gốc, phần trăm giảm giá, số đánh giá hoặc giới tính khi dữ liệu sản phẩm chưa có. Khi API trả `X-Demo-Mode`, catalog hiển thị thông báo đang xem sản phẩm mẫu. Thay đổi giao diện nằm trong `src/components/ShoeCatalog.jsx`, `shoe-catalog.css`, `Navbar.jsx` và `storefront-header.css`.

Kiểm tra ngày 15/10/2026: 114 kiểm tra frontend đạt, build thành công. Chrome thật đạt 12 luồng catalog ở 1440px/390px bằng dữ liệu GET mẫu chỉ trong phiên kiểm tra; không ghi dữ liệu MongoDB. Ảnh và kết quả ở `.tmp/storefront-review/` tại thư mục gốc. Đây là kiểm tra giao diện, không thay cho kiểm tra checkout/thanh toán trên MongoDB thật.

Xem README.md ở gốc để cấu hình MongoDB/SMTP, kiểm tra backend và dùng dữ liệu mẫu.

Chức năng **Quản trị → Đơn hàng** đã có báo giao thất bại/từ chối nhận ở đơn Đang giao, rồi xác nhận hàng quay về với số lượng tốt/hỏng/thất lạc của từng dòng màu/size. Chỉ hàng tốt cộng kho; cửa hàng giữ phí giao đã thu, chịu phí chuyển hoàn và hoàn phần tiền hàng thực trả sau giảm giá. COD chưa thu tiền không có khoản hoàn. Sau khi xử lý hoàn tất, admin ghi nhận khoản tiền đã hoàn bên ngoài hệ thống. Khách theo dõi tại **Đơn hàng**; không thấy ghi chú nội bộ hoặc chi phí của cửa hàng.

Đã thêm kiểm tra giao thất bại, dữ liệu kiểm hàng, khóa thử lại, quyền xem và chống phản hồi danh sách cũ ghi đè trạng thái. Toàn bộ frontend sau bổ sung: **131 kiểm tra đạt; build thành công**. Đây là chức năng hàng giao thất bại quay về, chưa phải khách yêu cầu trả hàng sau khi đã nhận thành công.
