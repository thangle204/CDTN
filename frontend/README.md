# SHOE STORE frontend

React, Vite, Tailwind CSS, React Router và Axios.

Địa chỉ giao hàng: **Tài khoản → Chỉnh sửa thông tin** có phần địa chỉ mặc định (người nhận, số điện thoại và địa chỉ). Checkout lấy `user.shippingAddress` và hỏi có đổi thông tin giao hàng không. Chọn Có mở form chỉ dùng cho đơn hiện tại; chọn Không lấy lại địa chỉ đã lưu. Tài khoản chưa có địa chỉ được yêu cầu điền và lưu ở bước Tiếp tục xác nhận; `updateProfile` dùng `onlyIfAddressMissing: true`, backend ghi có điều kiện để không đè địa chỉ từ tab khác. Ghi chú không lưu vào tài khoản. Các hàm chuẩn hóa/kiểm tra dùng `src/utils/shippingAddress.js`; phản hồi muộn sau đổi tài khoản không được điền địa chỉ của người cũ.

Kiểm tra địa chỉ ngày **29/10/2026**: **394 backend, 221 frontend**, build đạt; 5 ca HTTP/MongoDB trong database thử riêng đã dọn và 15 ca Chrome (1440/390/320px, toàn bộ API giả lập) đạt.

Giảm giá sản phẩm: **Quản trị → Sản phẩm → Chỉnh sửa / Thêm sản phẩm → Giảm giá sản phẩm (%)**. Nhập số nguyên 0–100; form xem trước giá bán và có nút **Bỏ giảm giá**. Giá gốc được giữ riêng, áp dụng cùng mức giảm cho mọi màu/size. Catalog và chi tiết có giá gạch ngang, nhãn giảm; lọc/sắp xếp giá, giỏ và checkout dùng giá sau giảm. `src/utils/productPricing.js` dùng công thức chung trong `../shared/productPricing.js` với backend. Khi triển khai cần giữ thư mục `shared` bên cạnh `frontend` và `backend`. Voucher được tính giảm thêm trên tiền hàng sau giảm; đơn đã đặt giữ nguyên giá mua.

Từ thư mục gốc dự án:

    npm ci --prefix frontend
    npm run client
    npm run test:frontend
    npm run build

Frontend dùng /api theo mặc định. Vite chuyển tiếp tới http://localhost:5000; đổi API_PROXY_TARGET trong .env.local khi dùng cổng khác. Khi deploy frontend và API ở hai origin riêng, đặt VITE_API_URL trước khi build. Không đặt bí mật trong VITE_*.

Giao diện hỗ trợ chọn size giày, giỏ theo từng size, checkout, voucher, đơn hàng, khôi phục mật khẩu và quản trị. Backend xác định giá cuối cùng và xác nhận thanh toán.

Ưu đãi có trang **Kho ưu đãi** (`/offers`) và **Mã của tôi** (`/my-vouchers`), dùng `VoucherCard.jsx` và `vouchers.css`. Khách phải lưu mã công khai trước khi dùng; lưu không giữ lượt. Thẻ đã lưu trong Kho ưu đãi tự mờ, không có nút/link thao tác và hiện **Mã đã được lưu** ở cuối; tải lại vẫn giữ trạng thái. Dùng ngay hoặc bỏ lưu thực hiện trong Mã của tôi. Mã riêng được cấp cho đúng tài khoản đủ điều kiện và không xuất hiện trong kho công khai. Checkout bỏ ô nhập mã tự do, dùng `VoucherSelector.jsx` chỉ chọn mã đã lưu/được cấp của tài khoản, gợi ý mã tiết kiệm nhất và hiển thị lý do chưa dùng được. Backend kiểm tra sở hữu ở cả preview và đặt hàng; không tự lưu khi truyền mã qua URL. Phản hồi cũ sau đổi tài khoản/giỏ không ghi đè kết quả mới.

**Quản trị → Mã ưu đãi** hỗ trợ công khai/riêng, lần mua đầu/quà sau giao, lượt mỗi khách, trần phần trăm và giờ Việt Nam UTC+7. Form chỉ gửi trường sửa và phiên bản; không đổi giờ gốc khi sửa mô tả. Mã đã phát hành giữ quyền lợi ổn định; tạo chương trình mới để đổi điều kiện. Đơn VNPAY mới có hạn chờ 30 phút và thông báo tự đối soát; hủy gián đoạn có nút tiếp tục xử lý. Xem [quy tắc đầy đủ](../VOUCHER_REVIEW.md).

Kiểm tra mới nhất ngày **29/10/2026**: **391 backend, 213 frontend đạt**, build thành công; 22 ca HTTP/MongoDB trong các database thử riêng và 17 trường hợp Chrome (1440/390/320px) đạt. Chrome chặn mọi API, xử lý 20 thao tác ghi trong bộ nhớ, gồm lưu/làm mờ thẻ và chỉ dùng mã trong tài khoản tại checkout. Chưa thử một giao dịch VNPAY mới qua worker tự động với cổng thật; các phản hồi QueryDR trong kiểm tra worker được giả lập.

Trang chi tiết giày có bộ ảnh trong `ProductGallery.jsx`, bài giới thiệu trong `ProductStory.jsx` và giao diện chung tại `product-detail.css`. Khách chọn ảnh nhỏ, bấm ảnh chính để phóng to, dùng phím mũi tên chuyển ảnh hoặc Escape để đóng. Các liên kết giới thiệu/thông số/đánh giá cuộn đến nội dung mà vẫn giữ màu và size đang chọn.

Để nhập nội dung, mở **Quản trị → Sản phẩm → Thêm sản phẩm/Chỉnh sửa**:

- Chọn ảnh bìa, rồi chọn nhiều tệp ở **Ảnh bổ sung**. Tối đa 10 ảnh JPG/PNG/WebP, 5 MB/ảnh; có xem trước, đổi thứ tự, xóa và đổi ảnh bìa.
- Nhập mô tả ngắn và các thông tin tùy chọn: mã mẫu, chất liệu, xuất xứ, kiểu dáng, giới tính sử dụng.
- Bấm **+ Thêm mục giới thiệu**, nhập tiêu đề/nội dung và chọn ảnh minh họa từ bộ ảnh, thêm chú thích nếu cần. Tối đa 12 mục, 10.000 ký tự/mục và 40.000 ký tự toàn bài. Dùng dòng trống chia đoạn; các dòng bắt đầu bằng `- ` được trình bày thành danh sách. Nội dung là văn bản, không cần nhập HTML.
- Bấm **Thêm sản phẩm** hoặc **Cập nhật sản phẩm** để tải ảnh và lưu. Khi một ảnh tải lỗi, form giữ các ảnh đã tải thành công để thử tiếp. Sửa nội dung không yêu cầu chuyển đổi kho của sản phẩm cũ. Sản phẩm chỉ có một ảnh vẫn hoạt động.

Kiểm tra bổ sung bộ ảnh/bài giới thiệu ngày **27/10/2026**: **342 backend, 189 frontend đạt** (21 luồng và 168 ca Node), build thành công. Chrome đạt **12 trường hợp** ở 1440px, 390px và 320px: chuyển/phóng to ảnh, bàn phím/focus, đọc bài vẫn giữ màu/size, tải nhiều tệp từ máy tính, thêm/sửa nội dung và giữ tham chiếu ảnh khi đổi bìa/thứ tự. Trình duyệt chặn toàn bộ API và mô phỏng 7 thao tác ghi trong bộ nhớ; kiểm tra HTTP dùng model/ghi database giả lập. Không ghi dữ liệu MongoDB thật trong đợt này. Kết quả và ảnh chụp lưu ở `.tmp/product-content-ui/` trong thư mục gốc ứng dụng, được Git bỏ qua.

Đánh giá sản phẩm được viết/sửa tại **Đơn hàng của tôi → đơn Đã giao → Đánh giá sản phẩm**, chỉ khi đơn đã thanh toán và giao thành công. Chọn **Viết đánh giá**, chọn 1–5 sao và nhập cảm nhận; đã gửi thì dùng **Sửa đánh giá**. Các dòng màu/size cùng một mẫu giày dùng chung một đánh giá của khách. Trang thông tin giày chỉ đọc đánh giá; không có form hoặc nút chỉnh sửa tại đây. Backend kiểm tra chủ đơn và sản phẩm trong đúng đơn, giữ điểm trung bình/số đánh giá nhất quán khi gửi đồng thời. Xung đột hoặc mất phản hồi yêu cầu tải lại để kiểm tra trước khi gửi tiếp.

Kiểm tra luồng đánh giá ngày 26/10/2026: **331 backend, 176 frontend đạt**, build thành công; Chrome đạt 9 trường hợp viết/sửa/xem đánh giá ở 1440px, 390px và 320px. Các kiểm tra HTTP dùng model đọc giả lập và thao tác lưu thật của Mongoose với lớp ghi database giả lập để kiểm chứng kiểm tra phiên bản. Trình duyệt chặn toàn bộ API, xử lý 6 lần gửi/sửa trong bộ nhớ; không ghi MongoDB thật. Ca tích hợp MongoDB trong `backend/integration/orders.integration.test.js` đã cập nhật sang API theo đơn hàng nhưng chưa chạy lại trên database thật trong đợt này. Client cũ gọi POST đánh giá trực tiếp ở sản phẩm sẽ nhận 410 và cần cập nhật frontend.

Đợt hoàn thiện giao diện ngày 23/10/2026 thống nhất tông đỏ, trắng và xám đậm; cỡ chữ, khoảng cách, thẻ nội dung, biểu mẫu và nút bấm dùng chung cấu hình trong `tailwind.config.js` và `src/index.css`. Header đánh dấu mục đang mở; chân trang xuất hiện trên mọi trang. Các trang đăng nhập, đăng ký và khôi phục mật khẩu dùng chung `AuthLayout.jsx`, có bố cục gọn trên điện thoại. Trang giỏ hàng, checkout, tài khoản và quản trị dùng cùng kiểu thẻ; lựa chọn thanh toán được làm nổi bật, tiền hiển thị theo định dạng Việt Nam.

Trang chủ có banner lấy ảnh, tên, thương hiệu và giá trực tiếp từ sản phẩm còn hàng; bấm ảnh mở đúng trang chi tiết. Không tự tạo nhãn giảm giá, giá gốc hoặc thứ hạng bán chạy. Hover ảnh và nút có hiệu ứng nhẹ, tôn trọng thiết lập giảm chuyển động; bàn phím có trạng thái focus và liên kết đến nội dung chính. Banner thu gọn trên điện thoại để ưu tiên xem sản phẩm.

Kiểm tra đợt này: **166 kiểm tra frontend đạt, build thành công**, cùng **43 trường hợp giao diện/thao tác trên Chrome ở 1440px, 390px và 320px**. Đã xem các trang chính, menu, bộ lọc và form thêm sản phẩm. Chrome dùng hồ sơ riêng và API giả lập chỉ trong trang kiểm tra, không tạo đơn hoặc ghi dữ liệu MongoDB. Ảnh chụp và kết quả lưu trong `.tmp/ui-polish/` ở thư mục gốc, được Git bỏ qua.

Trang chủ `/` và danh sách `/products` dùng chung bố cục catalog: bộ lọc bên trái, danh mục phía trên, lưới 4 cột trên màn hình lớn và 2 cột trên điện thoại. Trên tablet/điện thoại, nút **Bộ lọc** mở bảng chọn; Escape, nút đóng hoặc nền bên ngoài đều đóng được bảng.

Bộ lọc thương hiệu, màu, size, giá và còn hàng lấy từ dữ liệu API. Màu và size phải thuộc cùng một biến thể còn hàng; sản phẩm cũ dùng tồn kho chung. Có sắp xếp mới nhất, giá và đánh giá, phân trang 20 sản phẩm; bộ lọc và trang được giữ trên URL khi tải lại hoặc quay lại. Nhấn sản phẩm/Chọn size mở trang chi tiết để chọn đúng màu và size trước khi thêm giỏ.

Không tự tạo giá gốc, phần trăm giảm giá, số đánh giá hoặc giới tính khi dữ liệu sản phẩm chưa có. Khi API trả `X-Demo-Mode`, catalog hiển thị thông báo đang xem sản phẩm mẫu. Thay đổi giao diện nằm trong `src/components/ShoeCatalog.jsx`, `shoe-catalog.css`, `Navbar.jsx` và `storefront-header.css`.

Kiểm tra ngày 15/10/2026: 114 kiểm tra frontend đạt, build thành công. Chrome thật đạt 12 luồng catalog ở 1440px/390px bằng dữ liệu GET mẫu chỉ trong phiên kiểm tra; không ghi dữ liệu MongoDB. Ảnh và kết quả ở `.tmp/storefront-review/` tại thư mục gốc. Đây là kiểm tra giao diện, không thay cho kiểm tra checkout/thanh toán trên MongoDB thật.

Xem README.md ở gốc để cấu hình MongoDB/SMTP, kiểm tra backend và dùng dữ liệu mẫu.

Chức năng **Quản trị → Đơn hàng** đã có báo giao thất bại/từ chối nhận ở đơn Đang giao, rồi xác nhận hàng quay về với số lượng tốt/hỏng/thất lạc của từng dòng màu/size. Chỉ hàng tốt cộng kho; cửa hàng giữ phí giao đã thu, chịu phí chuyển hoàn và hoàn phần tiền hàng thực trả sau giảm giá. COD chưa thu tiền không có khoản hoàn. Sau khi xử lý hoàn tất, admin ghi nhận khoản tiền đã hoàn bên ngoài hệ thống. Khách theo dõi tại **Đơn hàng**; không thấy ghi chú nội bộ hoặc chi phí của cửa hàng.

Đã thêm kiểm tra giao thất bại, dữ liệu kiểm hàng, khóa thử lại, quyền xem và chống phản hồi danh sách cũ ghi đè trạng thái. Toàn bộ frontend sau bổ sung: **131 kiểm tra đạt; build thành công**. Đây là chức năng hàng giao thất bại quay về, chưa phải khách yêu cầu trả hàng sau khi đã nhận thành công.
