# Rà soát nghiệp vụ mã giảm giá

Ngày rà soát: **28/10/2026**. Phạm vi: cách khách tìm/nhận/chọn mã, quản trị chương trình, tính tiền, giữ/trả lượt khi checkout/hủy/giao thất bại và tương tác với VNPAY.

Đã triển khai ngày **28/10/2026**, hoàn thiện ngày **29/10/2026** theo hướng người dùng chọn: **kho ưu đãi công khai + mã riêng theo điều kiện**. Các nhận định từ mục “Lịch sử hiện trạng” trở xuống được giữ làm lịch sử trước khi sửa; trạng thái và hướng dẫn hiện tại nằm ngay bên dưới. Không seed/reset dữ liệu cửa hàng, không tự tạo chương trình giảm giá bằng các số tiền minh họa.

Trước khi sửa: 8 kiểm tra sẵn có về voucher/giá đơn đạt nhưng 3 kịch bản độc lập vẫn tái hiện lỗi giờ hiệu lực, ghi đè form cũ và vượt hạn mức khi hủy lỗi. Các script cũ trong `.tmp/business-review/` là bằng chứng lịch sử, không phải kiểm tra yêu cầu hành vi đúng của bản hiện tại.

## Chức năng đã hoàn thiện

| Phần | Hành vi hiện tại |
| --- | --- |
| Kho ưu đãi `/offers` | Chỉ công khai mã thuộc kênh công khai, đang hiệu lực và còn lượt; thể hiện mức giảm, trần, điều kiện, hạn dùng, lưu/bỏ lưu và Dùng ngay. |
| Mã của tôi `/my-vouchers` | Mã công khai đã lưu và mã riêng đúng chủ tài khoản; phân biệt có thể dùng, đang được đơn giữ, đã hết lượt hoặc hết hạn. Mã riêng không bị lộ qua kho công khai. |
| Lưu mã | Chỉ tạo dấu lưu trong tài khoản, không giữ hoặc trừ lượt và không gia hạn. Dùng mã công khai không bắt buộc lưu. |
| Mã riêng | Cấp một quyền nhận mã mỗi khách mỗi chương trình khi đủ điều kiện. Có nguồn cấp và hạn sử dụng; nhiều callback hoặc nhận lại không cấp trùng/đẩy hạn. Số lần dùng theo hạn mức chương trình. |
| Lần mua đầu | Chưa có đơn giao thành công và không có đơn khác đang xử lý, giữ ưu đãi, hủy chưa hoàn tất hoặc giao thất bại đang chờ xử lý. Đơn đã hủy/hoàn hàng xử lý xong không chặn lần mua đầu. Một lượt mỗi khách. |
| Quà sau mua | Cấp sau đơn đã giao và đã thanh toán, có thời điểm giao trong kỳ chương trình. Nếu bước cấp quà gặp lỗi, vào Mã của tôi sẽ thử nhận lại; không ảnh hưởng đơn đã giao. |
| Checkout | Gợi ý mã có tổng phải trả thấp nhất, tính cả ship; phân biệt mã chưa đủ điều kiện và lý do. Một mã mỗi đơn, không tự thay mã khách đã chọn. Dùng ngay giữ mã qua URL giỏ → checkout để kiểm tra/áp dụng. |
| Giới hạn | Có tổng lượt, lượt mỗi khách và trần tiền cho giảm phần trăm. Backend kiểm tra quyền/điều kiện khi xem trước và đặt hàng; giữ lượt nguyên tử, gắn với đơn và khách. |
| Quản trị | Giờ Việt Nam UTC+7, giữ nguyên thời điểm gốc nếu không sửa. Chỉ gửi trường thay đổi và phiên bản; dữ liệu cũ nhận 409. Ngừng áp dụng khác với kênh công khai/riêng. |
| Mã đã phát hành | Không đổi code; đã được lưu/cấp hoặc dùng thì giữ quyền lợi/đối tượng ổn định, tạo chương trình mới để đổi. Vẫn có thể sửa mô tả, lịch hiệu lực, hạn mức tổng phù hợp và trạng thái bằng phiên bản mới. |
| Hủy đơn | Đã chiếm quyền hủy thì không mở lại hoặc cộng bù lượt vào mã đã trả. Kho và lượt có dấu ghi nhận bền vững, thử lại chỉ tiếp tục phần còn thiếu. Có nút Tiếp tục hoàn tất hủy đơn cho khách/admin. |

Phạm vi mã hiện tại là **toàn bộ tiền sản phẩm trong đơn**, cộng phí ship theo quy tắc hiện có; chưa thêm điều kiện riêng cho sản phẩm/danh mục hoặc cộng nhiều mã. Mã cũ vẫn là mã công khai và giữ các điều kiện cũ; không tự áp hạn một lần mỗi khách cho chương trình đã tồn tại. Form tạo mới gợi ý một lần/khách; admin chọn mức giảm, ngưỡng, trần, tổng lượt và hạn trước khi kích hoạt. Không tự phát các mã ví dụ ở phần lịch sử.

### Đơn VNPAY quá 30 phút — chính sách người dùng đã chốt

- Đơn VNPAY mới có `paymentDeadline` 30 phút từ lúc tạo. Link thanh toán không vượt hạn này; không mở/đổi link sau hạn. Đơn cũ thiếu trường này không bị hủy hồi tố.
- Worker chạy trong backend khoảng mỗi phút, tối đa 5 đơn/lần; mỗi đơn dùng chung giới hạn đối soát 5 phút với thao tác thủ công. Không xử lý hai lượt quét chồng nhau trong cùng tiến trình và có chiếm quyền nguyên tử giữa nhiều tiến trình.
- Kiểm tra **mọi lần thanh toán đã tạo**, không chỉ lần cuối. QueryDR có xác thực cho đúng merchant/mã tham chiếu/số tiền, trả thành công và trạng thái giao dịch `02` mới đủ để tự hủy. Giao dịch thành công được ghi nhận thanh toán, không hủy. Đơn chưa từng được cấp link có thể hủy mà không gọi cổng.
- `01` chưa hoàn tất, `04` đảo giao dịch, trạng thái hoàn tiền, không tìm thấy, lỗi chữ ký, timeout hoặc thay đổi đơn trong khi đối soát đều giữ đơn/ưu đãi để kiểm tra lại. Chưa trả lượt chỉ vì hết 30 phút. [Bảng trạng thái QueryDR chính thức của VNPAY](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html).
- Tự hủy đi qua cùng quy trình có receipt với hủy thủ công, không hoàn kho/trả lượt hai lần. Nếu gián đoạn, worker tiếp tục claim đã tạo. Thanh toán đến sau hủy vẫn ghi nhận nghĩa vụ hoàn tiền theo luồng VNPAY hiện có.
- COD không áp hạn chờ thanh toán này. Giao thất bại vẫn chỉ trả lượt khi hoàn tất kiểm hàng theo chính sách trước đó.

### Dùng và triển khai

1. Cập nhật frontend và backend cùng lúc, chạy `npm run dev`. API chỉnh sửa/kích hoạt mã yêu cầu phiên bản mới; frontend cũ cần được cập nhật.
2. Vào **Quản trị → Mã ưu đãi → Tạo ưu đãi**, chọn kênh, đối tượng, loại giảm, trần, hạn mức và lịch UTC+7. Mã riêng có hạn tính từ lúc nhận, tối đa đến hết kỳ chương trình.
3. Khách xem **Ưu đãi** ở menu hoặc **Mã của tôi** trong tài khoản. Mở Mã của tôi kiểm tra/cấp những quyền đủ điều kiện; bấm Kiểm tra và nhận mã mới để thử lại khi cần.
4. Worker đối soát tự động cần backend còn chạy và kết nối được MongoDB/VNPAY. Kết quả chưa rõ hiện trong đơn của khách và quản trị; có thể đối soát thủ công tại quản trị.

Không cần chuyển đổi/seed dữ liệu cũ. Khóa hủy tồn từ phiên bản trước mà chưa có receipt không được tự phát lại thao tác kho: cần đối soát thủ công để tránh hoàn trùng. Giới hạn mỗi khách tính theo tài khoản, không phải cam kết xác minh một người chỉ có một tài khoản. Các receipt không tự hết hạn và được ẩn khỏi API; cần lưu giữ để xử lý các lần thử lại muộn. Dấu bảo vệ xóa được giữ ngay cả khi bỏ lưu hết hoặc cấp mã bị gián đoạn; dùng Ngừng áp dụng thay vì xóa chương trình đã phát hành.

### Kết quả kiểm tra sau sửa

- **381 kiểm tra backend, 201 frontend đạt** (21 luồng và 180 ca Node); build thành công.
- **7 ca nghiệp vụ HTTP + MongoDB thật** trong `backend/integration/vouchers.integration.test.js` đạt (Node tính 8 mục gồm nhóm cha). Chạy trong database thử nghiệm sinh ngẫu nhiên, có dấu sở hữu, đã dọn đúng database đó; không sửa dữ liệu cửa hàng. Gồm mã riêng/quyền sở hữu, lưu không trừ lượt, hạn mỗi khách, tranh lượt cuối, phiên bản/lịch, quà sau giao và hai worker tự hủy cùng đơn chưa mở thanh toán.
- **13 trường hợp Chrome** ở 1440px, 390px và 320px đạt; chặn mọi API, mô phỏng 14 thao tác ghi trong bộ nhớ. Có xem/lưu/bỏ lưu, mã riêng, lý do không dùng được, truyền mã qua giỏ, áp dụng/tổng tiền, form quản trị và sửa mô tả giữ lịch. Kết quả/ảnh ở `.tmp/voucher-implementation/`.
- Các trạng thái QueryDR, chữ ký, lỗi mạng, thanh toán đến khi đối soát và deadline được kiểm tra ngoại tuyến. Đợt này không tạo giao dịch VNPAY Sandbox thật mới; kiểm tra MongoDB tự hủy dùng đơn thử chưa có link thanh toán.

## Lịch sử hiện trạng và điểm cần điều chỉnh trước sửa

### 1. Chưa có luồng nhận mã hoặc nơi xem ưu đãi trước khi mua

Nguồn: `frontend/src/App.jsx`, `frontend/src/pages/Checkout.jsx:43`, `:230`, `:236`; `backend/routes/voucherRoutes.js`; `backend/models/customerModel.js`.

Hiện khách vào checkout mới được tải danh sách mã đang hoạt động và bấm chọn hoặc nhập mã. Chưa có trang ưu đãi, mã của tôi, thao tác lưu/nhận, quyền sở hữu mã hoặc cấp mã sau sự kiện. Vì vậy hiện trạng là **chọn một mã công khai khi thanh toán**, chưa phải cơ chế nhận mã cá nhân.

Không có bước nhận mã không tự nó là lỗi: mã công khai có thể dùng trực tiếp. Điểm cần bổ sung là nơi khách khám phá ưu đãi sớm hơn và cách phân phối mã riêng có ý nghĩa.

### 2. Mọi mã hoạt động đều được công khai; chưa tách quyền sử dụng

Nguồn: `backend/controllers/voucherController.js:40`, `:51`, `:81`; `backend/models/voucherModel.js`.

API danh sách lọc trạng thái, thời gian và lượt chung, không phân biệt mã công khai/mã riêng hay khách được cấp. `isActive=false` vừa làm mã biến mất khỏi danh sách vừa khiến nhập mã bị từ chối. Nút “Ẩn” hiện thực chất là ngừng áp dụng mã, chưa thể giấu mã khỏi kho công khai nhưng cho người nhận dùng.

Cần tách **đang có hiệu lực**, **kênh công khai/riêng tư**, **đối tượng đủ điều kiện** và **quyền sở hữu mã riêng**. Kiểm tra các điều kiện này tại backend cả khi xem trước và khi đặt hàng; chỉ giấu nút trên frontend không đủ.

### 3. Giới hạn hiện chỉ áp dụng cho toàn mã

Nguồn: `backend/models/voucherModel.js`, `backend/utils/orderPricing.js:46`, `backend/controllers/orderController.js:183`, `:225`.

`maxUses` là tổng lượt chung, không phải số lượt mỗi khách. Một tài khoản có thể dùng lại mã qua nhiều đơn đến khi hết hạn hoặc hết lượt chung. Chưa có điều kiện khách mới, tài khoản cụ thể, sản phẩm/danh mục hoặc giới hạn một lần mỗi khách.

Cần hai giới hạn độc lập: tổng lượt chương trình và lượt mỗi khách. Với mã dành cho lần mua đầu, backend còn phải chặn việc cùng khách tạo nhiều đơn giữ ưu đãi lần đầu đồng thời; chỉ đếm đơn đã giao là chưa đủ. Giới hạn theo tài khoản không đồng nghĩa xác minh một người chỉ có một tài khoản.

### 4. Giảm phần trăm chưa có mức trần

Nguồn: `backend/utils/orderPricing.js:34`, `backend/models/voucherModel.js`.

Hiện mức giảm phần trăm chỉ được chặn tại tổng tiền sản phẩm. Ví dụ 10% của 10.000.000đ giảm 1.000.000đ; không thể cấu hình “10%, tối đa 100.000đ”. Đây là khả năng kiểm soát khuyến mãi còn thiếu, không phải phép tính sai.

Nên thêm số tiền giảm tối đa cho mã phần trăm. Ví dụ minh họa: `min(tiền hàng đủ điều kiện × tỷ lệ, mức trần, tiền hàng đủ điều kiện)`, làm tròn VND nhất quán ở backend. Chưa tự chọn mức trần hoặc mức giảm cho cửa hàng.

### 5. Danh sách chọn mã chưa giúp khách hiểu mã nào dùng được

Nguồn: `frontend/src/pages/Checkout.jsx:236`, `backend/controllers/voucherController.js:40`.

Danh sách chung không xét tổng giỏ; mã chưa đạt đơn tối thiểu vẫn xuất hiện dưới dạng nút bấm bình thường và chỉ báo lỗi sau khi chọn. Thẻ mã chỉ hiển thị code, mô tả và đơn tối thiểu; chưa thể hiện đầy đủ mức giảm từ dữ liệu có cấu trúc, hạn dùng, số tiền còn thiếu hoặc số tiền thực tiết kiệm. Chưa xếp theo mã giúp tổng phải trả thấp nhất.

Nên tách “Dùng được” và “Chưa đủ điều kiện”, ghi rõ lý do, ví dụ “Mua thêm 120.000đ”. Gợi ý mã tiết kiệm nhất dựa trên **tổng phải trả, gồm ship**, cho khách xác nhận trước khi thay mã đã chọn. Xem trước không giữ lượt và vẫn kiểm tra lại ở checkout.

### 6. Đơn chưa thanh toán có thể chiếm lượt lâu dài

Nguồn: `backend/controllers/orderController.js:225`, `backend/controllers/vnpayController.js:38`, `backend/server.js`.

Tạo đơn tăng `usedCount` ngay, nên số này gồm cả đơn chưa thanh toán, không chỉ đơn bán thành công. Hết hạn link/lần thanh toán VNPAY không tự hết hạn đơn hoặc trả lượt voucher. Khách bỏ đơn mà chưa hủy có thể giữ lượt đến khi được xử lý thủ công.

Nên tách số lượt đang giữ và đã dùng, có định danh theo đơn. Cần chính sách hết hạn **đơn chờ thanh toán** và cơ chế đối soát trước khi trả lượt. Không trả lượt chỉ vì trình duyệt quay lại, một lần thanh toán thất bại hay hết hạn link: đơn hiện cho phép thanh toán lại và có thể nhận IPN muộn. Tiền đến sau khi đơn hủy phải tiếp tục đi qua quy trình đối soát/hoàn tiền hiện có.

COD giữ lượt trong thời gian đơn còn hiệu lực; không áp hạn chờ thanh toán trước cho COD. Hủy/hoàn hàng chỉ trả lượt sau khi thao tác nghiệp vụ được chốt an toàn.

## Ba lỗi cần sửa trước khi mở rộng

### 7. P2 — Chỉ sửa mô tả làm đổi giờ hiệu lực

Nguồn: `frontend/src/components/AdminVouchers.jsx:21`, `:82`, `:85`, `:102`, `:123`.

Form chuyển thời điểm gốc thành ngày rồi luôn gửi lại đầu ngày/cuối ngày. Đã chạy lại callback component thật bằng API/hooks giả lập: voucher hết hạn lúc **10:00**, mở sửa lúc **17:00** cùng ngày rồi chỉ sửa mô tả, payload chuyển hạn sang **23:59:59.999**. Mã đã hết hạn có thể hoạt động trở lại trong ngày. Ngày bắt đầu cũng thay đổi.

Hướng sửa: giữ nguyên ISO khi lịch chưa đổi; cập nhật theo các trường đã sửa. Nếu hỗ trợ theo giờ, hiển thị giờ và múi giờ cửa hàng rõ ràng. Không dùng múi giờ tùy máy admin để quyết định lịch chương trình.

Bằng chứng: `.tmp/business-review/voucher-date-roundtrip.cjs`. Kịch bản cố định đồng hồ ngày 14/10/2026 để tái hiện, được chạy lại ngày 28/10/2026.

### 8. P2 — Form cũ ghi đè chương trình mới

Nguồn: `frontend/src/components/AdminVouchers.jsx:102`, `backend/controllers/voucherController.js:72`.

Đã chạy lại controller với Mongoose save thật và lớp ghi database giả lập: dữ liệu hiện tại phiên bản 2, giảm **20.000đ**; gửi form cũ phiên bản 1, chỉ định sửa mô tả nhưng kèm toàn bộ trường cũ; API vẫn **200**, mức giảm trở lại **10.000đ**. `optimisticConcurrency` hiện có không tự so sánh với phiên bản lúc trình duyệt mở form.

Hướng sửa: gửi/đối chiếu phiên bản form, chỉ gửi trường thay đổi, trả 409 khi dữ liệu đã đổi. Mã đã phát hành nên giữ code ổn định; thay đổi lớn về điều kiện nên tạo chương trình mới hoặc thông báo rõ với người nhận. Không hồi tố giảm giá của đơn đã tạo.

Bằng chứng: `.tmp/business-review/stale-stock-voucher.mjs`, phần voucher.

### 9. P2 — Hủy lỗi giữa chừng có thể làm vượt hạn mức

Nguồn: `backend/controllers/orderController.js:344`, `:349`, `:355`.

Hủy A trả lượt trước khi chốt hủy; checkout B dùng lượt vừa trống; chốt hủy A lỗi; thao tác bù cộng lại lượt không có quyền sở hữu lượt. Đã tái hiện lại bằng controller thật và model giả lập với checkout COD hiện hành: hủy A **500**, checkout B **201**, `usedCount=2`, `maxUses=1`, hai đơn còn hoạt động và khóa A được mở.

Hướng sửa: reservation/receipt có định danh theo đơn hoặc transaction cho toàn bộ thao tác liên quan; không giải phóng quyền sử dụng khi hủy chưa chốt an toàn. Nếu không chứng minh được trạng thái sau lỗi thì giữ trạng thái cần đối soát. Chặn số đếm ở maxUses bằng phép cắt không sửa được việc có hai đơn cùng chiếm một lượt.

Bằng chứng: `.tmp/business-review/voucher-interleavings-current.test.mjs`, chạy riêng ca `a consumed last voucher`. Fixture cập nhật từ kịch bản cũ sang COD và xử lý đúng thao tác dọn reservation không đổi số lượng kho. Không dùng hai ca tái hiện checkout cũ trong cùng file để kết luận các lỗi đã sửa còn tồn tại.

## Luồng đề xuất theo hướng đã chọn

### Kho ưu đãi công khai

- Có mục **Ưu đãi** ở menu, hiển thị các chương trình công khai trước khi khách đặt hàng. Khách chưa đăng nhập vẫn xem được điều kiện.
- Mỗi thẻ nêu mức giảm, trần, đơn tối thiểu, hạn dùng và giới hạn mỗi khách. Chỉ hiển thị điều kiện thực sự được backend hỗ trợ.
- Nút **Dùng ngay** đưa tới giỏ/sản phẩm phù hợp. Tại checkout, khách chọn mã hợp lệ trực tiếp; không bắt buộc lưu mã công khai trước.
- Nếu có **Lưu mã**, thao tác này chỉ lưu vào tài khoản để tìm lại, không trừ lượt, không gia hạn và không bảo đảm mã còn lượt lúc đặt hàng.

### Mã riêng theo điều kiện

- Có mục **Mã của tôi** trong tài khoản và bộ chọn tại checkout: có thể dùng, đang giữ bởi đơn, đã dùng, hết hạn.
- Backend cấp mã/quyền sử dụng cho đúng tài khoản khi điều kiện đạt, ví dụ ưu đãi lần mua đầu hoặc quà sau đơn **đã giao và đã thanh toán**. Đây là hai loại điều kiện khác nhau, không suy ra từ việc biết chuỗi code.
- Với quà sau mua, mỗi đơn đủ điều kiện chỉ cấp một lần dù admin cập nhật lại hoặc callback thanh toán được gửi lại. Hủy/giao thất bại không phát quà thành công.
- Khách khác biết mã riêng vẫn không dùng được. Mã riêng không xuất hiện trong API kho công khai. Kiểm tra tài khoản/điều kiện tại backend khi xem trước lẫn tạo đơn.
- Mã có thời hạn theo chương trình hoặc từ lúc cấp; cần ghi rõ trước khi cấp. Lưu/nhận lại không được tự đẩy hạn về sau.

### Ví dụ để cân nhắc, chưa phải chính sách đã áp dụng

| Loại | Ví dụ quyền lợi | Cách khách có mã |
| --- | --- | --- |
| Công khai | Miễn ship cho đơn từ 800.000đ | Xem ở Ưu đãi, dùng trực tiếp; giới hạn mỗi khách theo chương trình. |
| Lần mua đầu | Giảm 50.000đ từ 500.000đ | Hiện cho khách đủ điều kiện; một lần/tài khoản, kiểm tra cả đơn đang giữ ưu đãi. |
| Quà sau mua | Giảm 5%, tối đa 100.000đ cho lần sau, hạn 14 ngày | Cấp một lần khi đơn đủ điều kiện giao thành công và đã thanh toán; chỉ chủ tài khoản dùng. |

Các giá trị chỉ minh họa. Cần chốt mức giảm, ngưỡng đơn, hạn dùng, ngân sách và số lượt mỗi khách trước khi kích hoạt. Giai đoạn đầu nên giữ **một mã cho mỗi đơn**; việc cộng mã tiền hàng với mã ship cần quy tắc riêng, chưa cần mở rộng cùng đợt.

## Phần nên giữ

- Tiền sản phẩm lấy từ database khi tạo đơn, không chấp nhận giá cuối cùng do trình duyệt quyết định.
- Kiểm tra thời gian, trạng thái, đơn tối thiểu và lượt còn lại tại backend; giữ lượt bằng cập nhật có điều kiện.
- Giảm cố định không vượt tiền hàng; đơn tối thiểu xét tiền hàng, không cộng ship; miễn ship không trừ hai lần.
- Áp dụng mã xem trước không tự tiêu thụ lượt. Một đơn hiện chỉ dùng một mã.
- Chính sách đã chốt về giao thất bại: chỉ trả lượt một lần sau khi kiểm hàng/hoàn tất xử lý. Thiết kế mới phải giữ nguyên quy tắc này.

## Thứ tự thực hiện và kiểm tra chấp nhận

1. Sửa lỗi 7–9 về lịch, phiên bản và hoàn lượt; bổ sung hồi quy thao tác đồng thời.
2. Bổ sung phân loại công khai/riêng, điều kiện tài khoản, giới hạn mỗi khách, mức trần và cơ chế giữ lượt theo đơn.
3. Làm trang Ưu đãi, Mã của tôi và bộ chọn tại checkout có lý do không dùng được; bổ sung cấp mã theo sự kiện có bảo vệ trùng.
4. Chốt quy trình đơn VNPAY bỏ dở, IPN muộn và báo cáo giữ/đã dùng/đã trả lượt trước khi tự động hóa hết hạn.

Các ca quan trọng: người khác không dùng được mã riêng; mỗi khách không vượt lượt dù hai tab đặt cùng lúc; lưu mã không trừ lượt; một sự kiện không phát quà hai lần; mã hết hạn không hồi sinh do sửa mô tả; form cũ nhận 409; hủy lỗi/thử lại không cấp lượt hai lần; VNPAY thất bại một lần không trả lượt khi đơn vẫn còn hiệu lực; gợi ý mã dựa trên tổng tiền thực phải trả và yêu cầu xác nhận khi thay đổi.

Tham khảo thiết kế: [Shopify — điều kiện khách hàng và giới hạn sử dụng mã](https://help.shopify.com/en/manual/discounts/discount-types/percentage-fixed-amount) phân biệt tổng lượt với lượt mỗi khách, hỗ trợ đối tượng cụ thể và phạm vi sản phẩm; [Shopify — mã đang được checkout giữ và thời gian hết hạn](https://help.shopify.com/en/manual/discounts/discounts-faq) giải thích giữ lượt và múi giờ. Đây là nguồn đối chiếu; đề xuất luồng của dự án ở trên là đánh giá riêng theo mã nguồn và lựa chọn của người dùng.
