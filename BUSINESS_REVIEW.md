# Rà soát nghiệp vụ SHOE STORE

Ngày rà soát: 14/10/2026. Cập nhật sửa ba lỗi P1 và bổ sung giao thất bại/kiểm hàng quay về: 15/10/2026. Cập nhật chẩn đoán kết nối: 22/10/2026. Tích hợp VNPAY Sandbox: 23/10/2026.

Phạm vi: sản phẩm/ảnh/biến thể, tồn kho, giỏ, checkout, thanh toán, hủy/hoàn tiền, voucher, tài khoản, nhân viên và báo cáo quản trị. Sau đợt rà soát, đã sửa ba lỗi P1 số 11–13 và bổ sung hồi quy. Không sửa hoặc in giá trị bí mật trong `.env`; lịch sử/kết quả kiểm tra MongoDB được ghi riêng.

P1: ưu tiên sửa trước khi bán thật vì có thể sai đơn, sai hoàn tiền, mất khả năng hoàn kho hoặc mất quyền quản trị. P2: gây tắc hoặc sai luồng trong điều kiện nêu rõ. P3: sai khác giao diện có ảnh hưởng thấp hơn.

## Trạng thái sau khi sửa lỗi

**Đã xử lý các trường hợp của lỗi 1–4, 6–8, 10–13 và 19.** Đã bổ sung luồng giao thất bại/từ chối COD, kiểm tra hàng quay về và xử lý kho/voucher/hoàn tiền theo chính sách người dùng chốt. Ngày 23/10/2026 sau tích hợp VNPAY Sandbox, cổng nhận IPN/trang chờ xác nhận và đối chiếu QueryDR thủ công: **310/310 backend đạt; 165 kiểm tra frontend đạt (20 luồng và 145 ca Node); build thành công**. Các kết quả này dùng model/API/phản hồi truy vấn giả lập và HTTP cục bộ, chưa xác nhận giao dịch đầu cuối qua IPN hoặc QueryDR thật của VNPAY. Các mục còn mở bên dưới chưa được sửa trong đợt này.

Các mục đang mở: **5, 9, 14–18 và 20**. Ba lỗi P1 số 11–13 và lỗi phản hồi danh sách cũ số 19 đã được chuyển thành kiểm tra hồi quy yêu cầu hành vi đúng. Bản này vẫn cần đối soát thủ công khi không xác định được kết quả ghi database; không cung cấp phục hồi tự động sau mọi sự cố.

## Kết quả rà soát bổ sung — các vấn đề đang mở

| Mục | Ưu tiên | Vấn đề và kết quả kiểm chứng |
| --- | --- | --- |
| 14 | P2 | Hủy A trả lượt voucher, B dùng lượt đó, hoàn tất hủy A lỗi rồi bù: `usedCount=2` trong khi `maxUses=1`, hai đơn còn hoạt động. |
| 15 | P2 | Chỉ sửa mô tả voucher làm thay giờ hiệu lực: voucher hết hạn lúc 10:00 được đổi thành hết hạn 23:59:59 cùng ngày. |
| 16 | P2 | Form voucher cũ ghi đè mức giảm mới; mức 20.000đ bị đổi lại 10.000đ dù chỉ định sửa mô tả. |
| 17 | P2 | API chỉnh kho cũ bỏ qua phiên bản gửi lên; kho đã giảm còn 9 vẫn bị yêu cầu cũ đổi lại thành 10. Giao diện hiện không có nút gọi endpoint này. |
| 18 | P2 | Callback thêm giỏ cũ tải lại giày A sau khi đã chuyển route B: màn hình hiển thị A nhưng lần thêm tiếp gửi ID B. |
| 5 | P2 | Dòng sản phẩm đã mất bị giấu khỏi GET giỏ. Hiện checkout trả 409 do giỏ xác nhận khác giỏ gốc, tải lại vẫn thiếu dòng để khách xóa. |
| 9 | P2 | Sau reverse proxy, 21 địa chỉ forwarded khác nhau vẫn dùng chung hạn mức; request thứ 21 nhận 429. |
| 20 | P3 | Nhãn Top khách hàng nói “Theo số đơn”, nhưng API sắp xếp theo tổng chi tiêu trước. |

Các mục 11–19 và hai lỗi cũ 5/9 đã được kiểm chứng ngoại tuyến bằng controller/component thật ở đợt rà soát. Các mục 11–13 và 19 hiện đã sửa. Mục 14 vẫn cần một lỗi ghi tạm thời để kích hoạt tình huống đã mô tả; không giả định tiến trình chết. Bằng chứng rà soát ban đầu dùng hooks/API giả lập; kết quả Chrome cho chức năng giao thất bại bổ sung được ghi riêng bên dưới.

## Lịch sử xác minh MongoDB thật — đợt tích hợp trước, ngày 14/10/2026

- Tại đợt tích hợp trước, kết nối thành công và ping MongoDB đạt. Đã xử lý lỗi xác minh chứng chỉ của Node bằng CA mặc định + CA hệ điều hành trong mongoOptions.js, không tắt kiểm tra TLS/hostname.
- Tại thời điểm đó, API /api/test và proxy qua frontend đều có databaseConnected=true; frontend trả 200, catalog không có X-Demo-Mode. Đây không phải kết quả kiểm tra kết nối mới của đợt rà soát này.
- Đã chạy 3 database thử nghiệm riêng có tên ngẫu nhiên, tạo dấu sở hữu và dọn đúng các database đó sau kiểm tra. Không seed/reset hoặc ghi fixture vào database cửa hàng. Ảnh thử tải lên đã được dọn theo đúng tệp và nội dung sở hữu.
- Đã kiểm chứng trên MongoDB thật: giỏ đổi cùng giá bị chặn trước giữ kho; chỉ một khách mua được đôi cuối; thanh toán/hủy đồng thời giữ đúng quyền hoàn tiền; hủy/thử lại hoàn biến thể và voucher một lần; lưu trữ giữa checkout vẫn giữ SKU để hoàn kho; không mất toàn bộ admin khi gỡ quyền đồng thời.
- Đã kiểm chứng thêm upload/lưu ảnh và biến thể, phiên bản sửa sản phẩm, đăng ký và giới hạn quyền, thanh toán COD khi giao thành công và điều kiện đánh giá sau mua.
- Chạy lại bằng npm run check:db và npm run test:integration. Hướng dẫn quyền database thử nghiệm, cách cô lập/dọn dữ liệu và cấu hình CA nằm trong README.

| Lỗi ưu tiên | Cách sửa | Kiểm tra hồi quy |
| --- | --- | --- |
| 1. Giỏ đổi cùng tổng tiền | Bắt buộc `expectedCart`, đối chiếu product/color/size/quantity trước giữ kho; khác danh sách trả 409 và yêu cầu xác nhận lại. | `backend/tests/orderLogic.test.js`, `frontend/tests/customer-flows.test.cjs` |
| 2. Thanh toán/hủy đồng thời | Điều kiện chiếm quyền hủy đối chiếu `isPaid` vừa đọc; trạng thái đổi trả 409 trước khi hoàn kho/trả voucher. | `backend/tests/cancellationConcurrency.test.js` |
| 3. Mất mọi admin | Khóa chung trong database, kiểm tra lại quyền và phiên sau khi giữ khóa, đếm admin Customer + Staff, chỉ chủ sở hữu được mở khóa. | `backend/tests/adminConcurrency.test.js` |
| 4. Xóa SKU giữa checkout | DELETE lưu trữ nguyên tử, giữ SKU/biến thể; chặn bán/sửa/bật lại. Hủy hoặc bù checkout vẫn hoàn đúng kho. | `backend/tests/productArchive.test.js`, `backend/tests/catalogApi.test.js` |

Lỗi **5, 9, 14–18 và 20** cùng các khoảng trống nghiệp vụ bên dưới vẫn cần xử lý. Lưu trữ SKU ngăn phát sinh mới dòng mất sản phẩm do DELETE, nhưng chưa sửa cách trả các dòng giỏ đã mất sản phẩm từ trước. Các bản sửa mới 11/12 bổ sung bảo vệ pending/commit và token giữ kho ngoài những trường hợp đã sửa ở mục 2/4. Quy trình hoàn hàng giao thất bại dùng dấu ghi nhận riêng, không sửa nhánh bù voucher của hủy thông thường ở lỗi 14.

## 1. P1 — Đã sửa: đơn khác màu/size khách đã xác nhận dù tổng tiền đúng

Trước sửa: tab A xác nhận Trắng/40, tổng 230.000đ; tab B đổi giỏ sang Đen/40 cùng giá. Frontend chỉ gửi tổng tiền, backend tạo đơn Đen và trả 201 dù tab A vẫn hiển thị Trắng.

Hiện tại: `frontend/src/pages/Checkout.jsx` gửi `expectedCart` là danh sách `{ product, color, size, quantity }` đã hiển thị. `backend/utils/checkoutCart.js` chuẩn hóa ID, màu Unicode/hoa thường, size và số lượng; so sánh độc lập thứ tự dòng. `backend/controllers/orderController.js` bắt buộc danh sách xác nhận, đối chiếu với giỏ sau khi giữ khóa và trước khi giữ hàng. Thay đổi sản phẩm, màu, size hoặc số lượng trả 409, không giữ kho hoặc tạo đơn. Frontend tải giỏ mới và trở về bước xác nhận. Giá vẫn lấy từ Product và được kiểm tra riêng.

Đã kiểm tra payload thiếu/sai, thay đổi từng trường dù tổng tiền không đổi, màu/size chuẩn hóa và đặt hàng thành công với danh sách khớp. Frontend có kiểm tra gửi đúng màu đã xem và yêu cầu xác nhận lại sau phản hồi 409.

Lưu ý tương thích: client API cũ phải thêm `expectedCart`; người dùng frontend cũ cần tải lại trang sau khi cập nhật.

## 2. P1 — Đã sửa: thanh toán/hủy đồng thời làm sai trạng thái hoàn tiền

Trước sửa: hủy đọc đơn chưa trả tiền; quản trị xác nhận chuyển khoản; hủy vẫn ghi theo bản đọc cũ. Kết quả có thể là `isPaid: true`, `refundStatus: 'not_required'`. UI báo chờ hoàn tiền nhưng không có nút xử lý do chỉ bật nút khi trạng thái là pending.

Hiện tại: điều kiện chiếm quyền hủy trong `backend/controllers/orderController.js` đối chiếu thêm `isPaid`. Nếu thanh toán thay đổi, yêu cầu hủy nhận 409 trước khi tác động tồn kho hoặc voucher. Thử lại đọc trạng thái mới và ghi pending nếu đã thanh toán, not_required nếu chưa thanh toán.

Đã kiểm tra cả hai chiều đổi thanh toán, hủy thắng trước xác nhận thanh toán, hai yêu cầu hủy cùng lúc và retry. Tồn kho biến thể và lượt voucher chỉ hoàn một lần; cơ chế bù khi lỗi vẫn được giữ.

## 3. P1 — Đã sửa: hai admin gỡ quyền nhau làm mất mọi admin

Trước sửa: hai yêu cầu cùng đếm thấy hai admin rồi lưu hai tài khoản khác nhau, cả hai thành công và không còn admin.

Hiện tại: `backend/models/adminGuardModel.js` và `backend/utils/adminGuard.js` cung cấp khóa chung trong collection `admin_guards`, ID `admin-role-changes`. Thay đổi quyền và kích hoạt tài khoản cùng giữ khóa này, kiểm tra lại phiên/quyền người yêu cầu rồi mới đếm admin Customer + Staff và ghi thay đổi. Yêu cầu tranh khóa nhận 409. Giải phóng khóa phải khớp token chủ sở hữu; lỗi giải phóng trả 503 trước khi gửi thành công.

Đã kiểm tra gỡ quyền lẫn nhau đồng thời, phiên bị thu hồi khi thử lại, admin từ hai collection, admin cuối cùng, tự gỡ quyền, cấp quyền cho tài khoản chưa kích hoạt, lỗi lưu và lỗi giải phóng khóa. Cấp quyền và vô hiệu hóa đồng thời cũng không tạo admin đã bị vô hiệu hóa.

Khóa không tự hết hạn để tránh một tiến trình chậm vẫn ghi khi tiến trình khác đã được cấp khóa. Nếu backend dừng đột ngột hoặc database lỗi khi mở khóa, cần dừng mọi backend rồi đối soát và giải phóng đúng khóa theo README; không tự xóa khóa khi còn request có thể đang xử lý.

## 4. P1 — Đã sửa: xóa SKU chen vào checkout làm mất khả năng hoàn kho

Trước sửa: checkout trừ đôi cuối về 0, chưa lưu đơn; DELETE thấy chưa có đơn và xóa SKU; checkout vẫn lưu đơn. Khi hủy, SKU không còn để hoàn hàng vào kho.

Hiện tại: `backend/controllers/productController.js` chuyển DELETE thành cập nhật nguyên tử `isArchived: true`, `isHidden: true` và tăng phiên bản. Không xóa vật lý document hoặc biến thể. Catalog thường không trả SKU lưu trữ; API sửa thông tin, chỉnh kho và bật hiển thị từ chối SKU đó. Thao tác sửa đã đọc trước lúc lưu trữ bị chặn bởi phiên bản Mongoose. Thêm giỏ và giữ kho cũng từ chối sản phẩm lưu trữ.

Đã kiểm tra đúng thứ tự giữ đôi cuối → lưu trữ → lưu đơn → hủy: SKU còn tồn tại và hoàn đúng màu/size một lần. Khi lưu đơn thất bại sau lưu trữ, bù kho cũng khôi phục đúng biến thể. DELETE lặp lại là idempotent. Các báo cáo lịch sử và hoàn kho vẫn dùng được document được giữ lại.

Lưu ý sử dụng: ẩn/hiện dành cho tạm ngừng bán; lưu trữ dành cho loại khỏi catalog lâu dài, không bật lại bằng API thông thường.

## Các lỗi khác và trạng thái xử lý

### 5. P2 — Dòng sản phẩm đã mất trở nên vô hình nhưng chặn đặt hàng

Nguồn hiện tại: `backend/controllers/customerController.js:23`, `backend/controllers/orderController.js:136`.

`cartResponse` vẫn lọc bỏ dòng product null. Sau khi thêm đối chiếu `expectedCart`, frontend chỉ xác nhận các dòng nhìn thấy còn backend so với giỏ gốc có cả dòng mất sản phẩm. Kết quả hiện tại là **409 trước khi đọc kho**, không còn chỉ là lỗi 400 được mô tả ở lần đầu. Checkout tải lại giỏ vẫn bị giấu cùng dòng, nên khách tiếp tục không thể xác nhận/xóa nó từ giao diện.

Đã tái hiện lại: giỏ gốc 2 dòng, một product null sau populate → GET trả 1 dòng → xác nhận dòng đó nhận 409, chưa đọc Product để trừ kho. DELETE lưu trữ mới không tạo thêm trường hợp này, nhưng dữ liệu đã mất từ trước vẫn cần xử lý. Script: `.tmp/business-review/remaining-cart-proxy.mjs`.

Hướng sửa: trả cả dòng không khả dụng bằng thông tin snapshot để khách xóa; bổ sung cách dọn giỏ lỗi rõ ràng.

### 6. P2 — Đã sửa: không giảm được giỏ khi tồn kho giảm nhiều

Trước sửa: giỏ có 20, kho còn 10; nhấn trừ xuống 19 bị chặn, số lượng giữ nguyên. Bấm tiếp vẫn là 19 nên khách phải xóa/thêm lại.

Hiện tại: `frontend/src/pages/Cart.jsx` đưa thao tác giảm trực tiếp về mức còn khả dụng của dòng đang chọn, có trừ số lượng ở các dòng dùng chung kho. Giỏ 20/kho 10 bấm “−” một lần gửi cập nhật về 10. Màu/size khác của giày có biến thể dùng kho riêng; các size của sản phẩm cũ vẫn tính chung kho. Giao diện hiển thị hướng dẫn số lượng sẽ điều chỉnh.

Nếu các dòng khác đã chiếm hết kho, dòng đang giảm được đưa về 1 để khách tiếp tục điều chỉnh các dòng còn lại; không tự xóa sản phẩm. Ví dụ hai size cũ đang 20 + 20, kho còn 10: giảm dòng đầu về 1, dòng sau về 9. `backend/controllers/customerController.js` cho phép giảm nghiêm ngặt số lượng nguyên dương ngay cả khi tổng giỏ tạm thời còn vượt kho; chỉnh giỏ không giữ hàng. Tăng/giữ nguyên số lượng vẫn kiểm tra tồn kho, và checkout tiếp tục từ chối mọi tổng vượt tồn. Sản phẩm không còn bán, size/màu mất, khóa checkout và khóa đối soát vẫn được bảo vệ.

Kiểm tra hồi quy: `backend/tests/cartReduction.test.js`, `frontend/tests/product-variants.test.cjs`. Đã thêm `backend/integration/cartReduction.integration.test.js` cho trường hợp biến thể 20 → 10 và giỏ cũ 20 + 20 → 1 + 9, gồm kiểm tra checkout bị chặn khi chưa điều chỉnh xong.

Lần chạy tích hợp mới cho lỗi 6 ngày 14/10/2026 chưa tới bước tạo fixture: kết nối MongoDB mới bị lỗi DNS ETIMEOUT. Kết quả này không được tính là đạt; cần chạy lại `node --test backend/integration/cartReduction.integration.test.js` khi DNS hoạt động. Kết nối đang mở của ứng dụng vẫn báo databaseConnected=true tại thời điểm kiểm tra.

### 7. P2 — Đã sửa: sửa thông tin sản phẩm cũ bị ép chuyển đổi kho

Trước sửa: `frontend/src/components/AdminProducts.jsx` luôn gửi variants và tạo dòng quantity rỗng khi sửa SKU cũ. Chỉ đổi tên/giá/ảnh cũng phải phân bổ lại kho; guard trong productController trả 409 nếu đang có giỏ/đơn chưa hoàn tất. Ảnh có thể đã upload trước khi lưu thất bại.

Hiện tại: form sửa sản phẩm cũ mặc định chỉ sửa thông tin, hiển thị tổng kho đang giữ và không hiện các ô biến thể bắt buộc. Payload bỏ `variants`, `countInStock`, `sizes`, `color`, nên cập nhật tên/giá/mô tả/ảnh không chạy guard chuyển đổi, giữ nguyên kho ngay cả khi có giỏ hoặc đơn đang xử lý. Phiên bản sản phẩm vẫn được đối chiếu; dữ liệu đã đổi sau khi mở form có thể trả 409 và yêu cầu tải lại.

Quản trị chọn **Chuyển sang quản lý kho theo màu và size** mới nhập phân bổ. Số lượng mỗi dòng để trống cho đến khi nhập rõ, không tự chia kho cũ. Bỏ chọn sẽ bỏ qua phần phân bổ đang nhập và chỉ lưu thông tin. Với sản phẩm đã có biến thể, các dòng không thay đổi không được gửi lại để sửa kho.

Khi thay ảnh lúc chỉnh sửa, frontend kiểm tra bằng `POST /api/products/:id/validate-update` trước khi upload. Endpoint yêu cầu admin, dùng chung guard và kiểm tra dữ liệu với cập nhật thật, nhưng không lưu document hoặc giữ kho. Chuyển đổi bị chặn bởi giỏ/đơn được phát hiện trước khi upload. Cập nhật thật vẫn đọc và kiểm tra lại, nên bước kiểm tra không bảo đảm dữ liệu sẽ đứng yên; nếu lưu thất bại sau khi upload, form giữ đường dẫn ảnh để thử lại mà không tải trùng.

Kiểm tra hồi quy: `frontend/tests/admin-products.test.cjs` kiểm tra sửa thông tin sản phẩm cũ, bật/tắt chuyển đổi, số lượng bắt buộc, thứ tự kiểm tra → upload → cập nhật, chặn upload khi nhận 409 và dùng lại ảnh khi thử lưu lại. `backend/tests/catalogApi.test.js` kiểm tra cập nhật giữ nguyên kho khi đang có giỏ/đơn, quyền endpoint mới, preflight không ghi dữ liệu và cập nhật thật kiểm tra lại sau khi giỏ thay đổi. Các ca mới là kiểm tra ngoại tuyến; chưa chạy riêng lỗi 7 trên MongoDB hoặc trình duyệt thật.

### 8. P2 — Đã sửa: phản hồi phiên cũ ghi đè tài khoản mới

Trước sửa: `frontend/src/context/AuthContext.jsx` chỉ theo dõi unmount bằng active. Profile A còn chờ → đăng nhập B thành công → phản hồi A về muộn → user hiển thị/localStorage là A, token vẫn B. Backend kiểm quyền theo B, nhưng tên/quyền hiển thị và thông tin giao hàng điền sẵn có thể sai tài khoản.

Hiện tại: AuthProvider gắn mỗi lần khôi phục với thế hệ phiên, token đã gửi và bộ điều khiển hủy riêng. Bắt đầu đăng nhập, đăng xuất, cập nhật hồ sơ hoặc cleanup tăng thế hệ và hủy request cũ. Nhánh thành công lẫn nhánh 401/403 chỉ xử lý khi vẫn thuộc phiên hiện tại, nên không ghi đè tên/quyền/localStorage hoặc đăng xuất tài khoản mới. `authAPI.getProfile` gửi đúng token đã chụp và nhận AbortSignal; việc bỏ phản hồi cũ vẫn được kiểm tra độc lập với khả năng hủy request.

Thao tác đăng nhập có thứ tự riêng: kết quả của lần cũ hoặc kết quả đến sau đăng xuất/unmount không được lưu. Đăng nhập mới được ưu tiên ngay khi bắt đầu, vì vậy lỗi token cũ về trong lúc chờ đăng nhập không hủy lần đăng nhập mới. Nếu lần mới thất bại và phiên trước vẫn còn token, provider khởi động lại việc kiểm tra phiên trước bằng request mới. Loading kết thúc theo request đang sở hữu, không chờ request đã bị thay thế và không cập nhật sau unmount; StrictMode cleanup/setup cũng không làm sống lại phản hồi đã bỏ.

Đồng thời, interceptor trong `frontend/src/utils/api.js` chỉ xóa phiên và chuyển đến đăng nhập khi lỗi 401 từ API có Authorization khớp token hiện tại. Yêu cầu cũ của A không thể xóa phiên B. Lỗi xác thực của request thuộc phiên hiện tại vẫn được xử lý như trước.

Kiểm tra hồi quy mới gồm **21 ca AuthProvider và 6 ca Axios**, nằm trong `frontend/tests/auth-context.test.cjs` và `frontend/tests/session-api.test.cjs`. Bộ đầu gọi mã AuthProvider thật bằng hooks/API giả lập và Promise điều khiển thứ tự; bộ sau dùng Axios/interceptor thật với adapter trong bộ nhớ. Bao phủ phản hồi cũ thành công/lỗi, logout, nhiều lần login, retry phiên cũ sau login thất bại, cập nhật hồ sơ, token đổi ngoài provider, StrictMode, unmount, loading và trạng thái quyền. Không dùng mạng hoặc MongoDB cho các ca này; chưa kiểm tra trình duyệt thật hoặc bổ sung đồng bộ đăng nhập giữa nhiều tab.

### 9. P2 — Limiter dùng chung IP sau reverse proxy

`backend/app.js` chưa cấu hình trusted proxy, `backend/middleware/rateLimit.js` dùng req.ip. Trong mô hình reverse proxy như README, mọi khách có thể bị tính cùng IP proxy.

Tái hiện HTTP cục bộ: 21 request với X-Forwarded-For khác nhau, request thứ 21 nhận 429. Login giới hạn 20 lần/15 phút, forgot-password 5 lần/15 phút.

Đã chạy lại trong lần rà soát này bằng `.tmp/business-review/remaining-cart-proxy.mjs`: `trust proxy=false`, 20 phản hồi 401 rồi phản hồi 429 cho địa chỉ forwarded thứ 21. Chỉ dùng HTTP loopback và model giả lập.

Hướng sửa: cấu hình tin đúng proxy/hop thực tế, kiểm tra IP tại topology triển khai; không tin tùy ý forwarded header. Lỗi này có điều kiện triển khai sau proxy, không áp dụng tương tự khi nhận kết nối trực tiếp từ từng khách.

### 10. P3 — Đã sửa: nút hủy xác nhận thanh toán không khớp API

Trước sửa: `frontend/src/components/AdminOrders.jsx` vẫn bật Hủy xác nhận cho đơn BANK đã trả tiền đang giao. Backend cấm bỏ xác nhận ở cả Đang giao và Đã giao; thao tác được UI đề nghị chắc chắn trả 400.

Hiện tại: điều kiện `canUpdatePayment` được dùng chung cho việc hiện nút và xử lý thao tác. Đơn đã thanh toán ở trạng thái Đang giao/Đã giao không có nút Hủy xác nhận; handler cũng chặn yêu cầu bỏ xác nhận ở hai trạng thái này. Quy tắc áp dụng cho BANK và COD theo backend. Đơn đang xử lý/đã xác nhận vẫn có thể hủy xác nhận; đơn chưa thanh toán vẫn được xác nhận theo điều kiện API. Đơn đã hủy không có thao tác đổi thanh toán, hoàn tiền được ghi nhận qua luồng riêng.

Nếu trạng thái thay đổi ở nơi khác sau khi màn hình đã tải, API vẫn kiểm tra và có thể từ chối. Khi cập nhật thanh toán nhận 400/409, giao diện hiển thị lỗi từ server rồi tải lại danh sách để đồng bộ nút. Backend không cần thay đổi quy tắc thanh toán.

Kiểm tra hồi quy **10 ca đạt** trong `frontend/tests/admin-orders.test.cjs`, gọi render/callback AdminOrders thật với hooks/API giả lập. Bao phủ trạng thái cho phép/cấm, BANK/COD, chặn handler dù gọi callback trực tiếp, yêu cầu đúng boolean, xác nhận người dùng, khóa thao tác đang chờ, luồng hoàn tiền và tải lại sau lỗi 400/409. Chưa kiểm tra riêng bản sửa này trên trình duyệt hoặc MongoDB thật.

## Các lỗi phát hiện trong lần rà soát bổ sung

### 11. P1 — Đã sửa: rollback checkout xóa đơn vừa xác nhận thanh toán hoặc hoàn kho hai lần

Nguồn hiện tại: `backend/models/orderModel.js:17`, `backend/controllers/orderController.js:18`, `:135`, `:251`, `:258`, `:273`.

Trước sửa, checkout lưu Order trước khi xóa giỏ và đánh dấu hoàn tất. Trong khoảng đó, đơn đã có thể được truy vấn và xử lý thanh toán/hủy. Nếu thao tác ghi hoàn tất giỏ gặp lỗi, catch checkout xóa Order chỉ theo `_id`, rồi hoàn toàn bộ lượng hàng đã giữ, không kiểm tra đơn đã được xử lý bởi yêu cầu khác.

Tái hiện trước sửa bằng controller thật và đúng một lỗi ghi ở bước hoàn tất giỏ:

- Xác nhận thanh toán trả **200**, đơn đã `isPaid=true`; checkout trả **500**, Order bị xóa, kho được trả lại và khóa giỏ được mở. Mất bản ghi đã xác nhận nhận tiền.
- Hủy đơn trả **200**, đã hoàn kho; checkout trả **500** rồi hoàn thêm lần nữa. Kho ban đầu **5**, cuối cùng **6**, không còn Order và không giữ khóa đối soát.

Hai kết quả là hậu quả của cùng một lỗi. Script lịch sử: `.tmp/business-review/order-interleavings.test.mjs`.

Hiện tại, đơn mới ở `pending`, có token sở hữu riêng; không hiện trong danh sách/báo cáo và mọi thao tác thanh toán, giao, hủy, hoàn tiền, xóa đều nhận 409. Checkout giữ khóa khách hàng khi xóa giỏ, sau đó chuyển sang `committed` bằng điều kiện token/trạng thái. Đơn cũ không có trường mới vẫn dùng được.

Rollback chỉ xóa đơn pending đúng token, chưa thanh toán, chưa hoàn kho và chưa bị hủy. Nếu không chứng minh được quyền sở hữu, không trả kho tùy ý: giữ bảo vệ và trả 503 cần đối soát. Nếu đơn đã commit nhưng phản hồi ghi bị mất, đọc lại đúng token để xác nhận kết quả; không xóa đơn hay trả kho. Lỗi dọn khóa sau commit cũng giữ nguyên đơn thành công. Giỏ gốc được khôi phục khi đã thử xóa giỏ nhưng abort vẫn thuộc quyền checkout đó.

Hồi quy: **12 ca** trong `backend/tests/checkoutPublication.test.js`, cùng các kiểm tra checkout/hủy/lưu trữ hiện có. Bao phủ HTTP pending bị ẩn/chặn, lỗi ghi giỏ, xung đột token/trạng thái, mất phản hồi commit, dọn khóa lỗi, hoàn kho lỗi và tương thích đơn cũ. Các ca MongoDB tương ứng nằm trong `backend/integration/p1Flows.integration.test.js`.

### 12. P1 — Đã sửa: xóa biến thể hoặc chuyển kho cũ giữa checkout làm mất khả năng hoàn kho

Nguồn hiện tại: `backend/models/productModel.js:62`, `backend/controllers/productController.js:62`, `:72`, `backend/controllers/orderController.js:233`, `backend/utils/checkoutReservations.js`.

Trước sửa: checkout vừa giữ đôi cuối, tăng phiên bản Product từ 0 lên 1 nhưng chưa lưu Order. Quản trị đọc Product phiên bản 1, nên kiểm tra phiên bản hợp lệ. `Order.exists` trả snapshot chưa có đơn; checkout sau đó lưu đơn và xóa giỏ; `Customer.exists` trả không có giỏ. Hai kiểm tra độc lập cùng vượt qua, dù sản phẩm đã thuộc một đơn vừa tạo.

Tái hiện trước sửa cho cả **xóa biến thể đang được giữ** và **chuyển sản phẩm cũ sang kho biến thể**: checkout **201**, sửa sản phẩm **200**, hủy đơn **409**, kho vẫn **0**. Mongoose save chấp nhận phiên bản 1, vì quản trị đọc sau bước reservation. Đây là lỗi khác với xóa vật lý SKU ở mục 4.

Hiện tại, token `checkoutReservations` được thêm vào SKU trong cùng thao tác nguyên tử trừ kho/tăng phiên bản. Khi còn token, API sửa và preflight chặn chuyển kho cũ hoặc xóa màu/size bằng 409, kể cả khi chưa thấy Order và giỏ vừa được xóa. Sửa thông tin, thêm biến thể hoặc giữ nguyên các dòng vẫn được phép theo kiểm tra phiên bản.

Token chỉ được gỡ sau khi đơn commit bền vững hoặc toàn bộ thao tác bù kho/voucher đã thành công. Gỡ đúng token, giữ token của checkout khác, tăng phiên bản để chặn bản đọc cũ; không có tự hết hạn. Token bị ẩn khỏi JSON, dữ liệu sản phẩm populate trong giỏ và không nhận từ payload client.

Hồi quy **18 ca** trong `backend/tests/productReservationGuard.test.js` và `backend/tests/checkoutReservations.test.js`. Bao phủ đọc trước/sau reservation, metadata, preflight, xóa/chuyển kho, giải phóng đúng chủ sở hữu, lỗi ghi và không lộ token. Script tái hiện cũ `.tmp/business-review/product-shape-race.mjs` được giữ làm lịch sử; kiểm tra MongoDB mới ở `backend/integration/p1Flows.integration.test.js`.

### 13. P1 — Đã sửa: phản hồi lưu hồ sơ cũ khôi phục tài khoản đã đăng xuất

Nguồn hiện tại: `frontend/src/pages/Profile.jsx:121`, `frontend/src/context/AuthContext.jsx:100`, `frontend/src/utils/api.js` phương thức `customersAPI.updateProfile`.

Trước sửa: lưu hồ sơ A còn chờ → đăng xuất và đăng nhập B thành công → phản hồi A về muộn → callback gọi `updateUser(response.data)` không kiểm phiên gửi. Backend trả cả token trong phản hồi lưu hồ sơ; provider nhận và ghi lại user/token của A, dù trang Profile cũ đã bị unmount.

Tái hiện trước sửa bằng Profile thật nối AuthProvider thật: trước phản hồi muộn là `customer-b/token-b`; sau đó thành `customer-a/token-a-after-profile-update`, localStorage cũng là A. Token thực tế bị thay bằng token A, không phải backend cấp quyền A cho token B.

Hiện tại Profile gọi `updateProfile` của AuthProvider. Provider chụp token, thế hệ phiên và thứ tự request; Axios gửi đúng token đã chụp. Chỉ kết quả của request mới nhất còn thuộc phiên hiện tại mới được ghi user/token. Đăng xuất/đăng nhập lại cùng tài khoản với cùng chuỗi token cũng làm request cũ hết hiệu lực. Đổi mật khẩu trong phiên hợp lệ vẫn nhận token mới. Component bỏ lỗi/state callback sau unmount hoặc đổi tài khoản.

Hồi quy **12 ca Profile/AuthProvider thật** tại `frontend/tests/profile-session.test.cjs`, thêm 1 ca Axios ghim token tại `frontend/tests/session-api.test.cjs`; các kiểm tra khôi phục/login cũ tiếp tục đạt. Script `.tmp/business-review/frontend-profile-session-repro.cjs` là bằng chứng lịch sử trước sửa.

### 14. P2 — Hủy lỗi rồi bù có thể vượt giới hạn lượt voucher

Nguồn: `backend/controllers/orderController.js:209`, `:286`, `:289`, `:296`, `:299`.

Voucher chỉ có 1 lượt, đã thuộc đơn A. Hủy A giảm lượt từ 1 xuống 0 trước khi ghi hoàn tất. Checkout B dùng lượt vừa giải phóng và tạo đơn thành công. Bước hoàn tất hủy A gặp một lỗi ghi; thao tác bù cộng lại lượt không kiểm giới hạn rồi đưa A về Đang xử lý.

Đã tái hiện: hủy A **500**, checkout B **201**, `usedCount=2`, `maxUses=1`, hai đơn còn hoạt động và khóa hủy A đã được mở. Các thao tác bù đều trả thành công, nên đây không chỉ là tình huống cần đối soát do bù lỗi đã biết.

Script: `.tmp/business-review/order-interleavings.test.mjs`. Hướng sửa: giữ quyền sở hữu lượt cho đến khi hủy hoàn tất bền vững, dùng transaction hoặc reservation có định danh. Khi không thể bù mà vẫn giữ quy tắc hạn mức, giữ trạng thái đối soát; chỉ ép số đếm về tối đa 1 sẽ làm sai số đếm so với hai đơn đang tồn tại.

### 15. P2 — Sửa mô tả voucher làm thay lịch hiệu lực

Nguồn: `frontend/src/components/AdminVouchers.jsx:21`, `:83`, `:85`, `:102`, `:132`.

Form bỏ giờ gốc khi mở sửa, rồi luôn gửi lại thời điểm đầu ngày/cuối ngày. Đã gọi handleEdit → đổi mô tả → handleSubmit thật với giờ Việt Nam: lúc **17:00 ngày 14/10/2026**, voucher hết hạn **10:00** được gửi thành hết hạn **23:59:59.999**, dù quản trị không sửa lịch. Ngày bắt đầu cũng bị lùi về 00:00. Voucher đang hết hạn có thể được kích hoạt lại ngoài ý muốn sau khi lưu.

Script: `.tmp/business-review/voucher-date-roundtrip.cjs`. Hướng sửa: giữ nguyên ISO/thời điểm gốc khi lịch chưa thay đổi; chỉ gửi trường lịch được sửa và thể hiện rõ giờ/múi giờ áp dụng nếu hỗ trợ lịch theo giờ.

### 16. P2 — Form voucher cũ ghi đè khuyến mãi mới

Nguồn: `frontend/src/components/AdminVouchers.jsx:102`, `:106`; `backend/controllers/voucherController.js:72`, `:77`.

Form mở khi mức giảm là 10.000đ. Một quản trị khác đổi thành 20.000đ. Người ở form cũ chỉ sửa mô tả nhưng form gửi lại tất cả trường, gồm mức 10.000đ; backend không đối chiếu phiên bản từ client và ghi đè mức giảm mới.

Đã kiểm chứng controller với Mongoose save thật và collection giả lập: hiện `__v=2`, giảm 20.000đ; payload cũ ghi phiên bản 1 vẫn **200**, mức giảm thành 10.000đ. `optimisticConcurrency` chỉ kiểm tra thay đổi sau khi controller đọc document, không tự nhận biết form đã cũ trước lúc đó.

Script: `.tmp/business-review/stale-stock-voucher.mjs`. Hướng sửa: gửi và đối chiếu phiên bản đã mở form, đồng thời chỉ gửi các trường được sửa; báo 409 thay vì ghi đè lịch/mức giảm/trạng thái mới.

### 17. P2 — API chỉnh tồn kho cũ bỏ qua phiên bản

Nguồn: `backend/controllers/productController.js:155`, `:166`; `frontend/src/utils/api.js` phương thức `updateStock`.

Nhánh cập nhật `variants` kiểm phiên bản, nhưng nhánh `countInStock` cho sản phẩm cũ không kiểm tra trường `version` kể cả khi client đã gửi. Sản phẩm đã bán bớt từ 10 xuống 9, phiên bản hiện là 2; yêu cầu cũ `{version:1,countInStock:10}` vẫn **200**, ghi kho về 10.

Script: `.tmp/business-review/stale-stock-voucher.mjs`. Điều kiện: sử dụng endpoint `PUT /api/products/:id/stock` cho sản phẩm cũ. Giao diện hiện không có nút chỉnh kho riêng gọi endpoint này; không coi đây là lỗi của form metadata đã sửa ở mục 7.

Hướng sửa: yêu cầu và kiểm tra phiên bản ở cả nhánh kho cũ; cập nhật client gọi API tương ứng. Nếu nghiệp vụ là nhập thêm/xuất bớt, cần thao tác có số lượng chênh lệch, lý do và lịch sử thay vì lấy số tuyệt đối đã đọc từ lâu để ghi đè.

### 18. P2 — Route B hiển thị giày A nhưng thêm ID B vào giỏ

Nguồn: `frontend/src/pages/ProductDetail.jsx:48`, `:61`, `:135`, `:139`.

Thêm giỏ A đang chờ → khách chuyển sang chi tiết B, B tải xong → callback thêm A gọi `fetchProduct()` còn giữ id A. Hàm tăng bộ đếm tải mới nhất, nên guard chỉ so thứ tự request không ngăn request A này ghi lại giao diện. Lần render sau có route id B nhưng product hiển thị là A.

Đã tái hiện callback component thật: `{route:'shoe-b',displayedProduct:'shoe-a',addToCartProduct:'shoe-b'}`. Đây là chọn/thêm giày không khớp màn hình; backend vẫn xử lý đúng ID được gửi.

Script: `.tmp/business-review/frontend-product-route-repro.cjs`. Hướng sửa: gắn mutation và mọi refetch sau mutation với route/id đang hoạt động; bỏ callback từ route cũ. Nếu dùng remount theo key, vẫn cần ngăn callback sau unmount phát sinh cập nhật không còn phù hợp.

### 19. P3 — Đã sửa: phản hồi danh sách cũ ghi đè đơn vừa hủy

Nguồn: `frontend/src/pages/MyOrders.jsx:15`, `:24`, `:29`, `:49`.

Trước sửa: hủy đơn đang chờ; cập nhật hồ sơ trả về làm đối tượng user đổi và effect mở request tải danh sách; hủy thành công trả Đã hủy/hoàn tiền pending; snapshot danh sách cũ đến sau ghi đè thành Đang xử lý. Thông báo chờ hoàn tiền biến mất dù server đã hủy đơn.

Hiện tại: MyOrders gắn lần tải với ID tài khoản và thế hệ request, làm mất hiệu lực GET trước mutation; callback hủy chỉ cập nhật khi tài khoản/thao tác còn hiện hành. Effect theo ID tài khoản, không tải lại chỉ vì object hồ sơ đổi. AdminOrders cũng bỏ GET cũ sau thao tác giao thất bại/hoàn hàng. Hồi quy `frontend/tests/delivery-return.test.cjs` kiểm tra danh sách cũ sau hủy, đổi tài khoản và phản hồi cũ sau giao thất bại. Script `.tmp/business-review/frontend-orders-refresh-repro.cjs` là bằng chứng lịch sử trước sửa.

### 20. P3 — Nhãn xếp hạng khách hàng không đúng tiêu chí API

Nguồn: `frontend/src/components/AdminDashboard.jsx:154`, `backend/controllers/orderController.js:462`.

Giao diện ghi “Top 10 khách hàng (Theo số đơn)” nhưng API sắp theo `totalSpent` trước rồi mới `totalOrders`. Với ví dụ một khách có 1 đơn 2 triệu và khách khác có 5 đơn tổng 500.000đ, khách có 1 đơn đứng trước. Đây là sai nhãn đã đối chiếu trực tiếp mã, không phải một kết quả aggregation mới trên MongoDB thật.

Hướng sửa: đổi nhãn sang tổng chi tiêu hoặc đổi thứ tự xếp hạng theo số đơn; giữ cùng tiêu chí ở API, bảng và tài liệu.

## Bằng chứng lịch sử và hồi quy sau sửa

Ở đợt rà soát trước đã chạy 8 script dưới `.tmp/business-review` để xác nhận hành vi lỗi. Những script này khẳng định hành vi **trước sửa**, không phải bộ kiểm tra đúng sau sửa; đặc biệt các script checkout/giữ kho/hồ sơ có thể không còn đạt hoặc phù hợp với giao thức mới. Giữ chúng làm bằng chứng lịch sử, không dùng làm tiêu chí xác nhận bản hiện tại.

```powershell
npm test
npm run test:frontend
npm run build
# MongoDB thử nghiệm riêng, cần kết nối hoạt động:
node --test backend/integration/p1Flows.integration.test.js
```

Sau sửa 11–13, bộ hồi quy chính yêu cầu hành vi đúng: `checkoutPublication.test.js`, `productReservationGuard.test.js`, `checkoutReservations.test.js`, `customerStats.test.js`, `profile-session.test.cjs` và kiểm tra Axios được thêm vào các lệnh chuẩn. Kết quả: **154 backend, 102 frontend đạt; build thành công**.

Đã thêm 5 ca MongoDB/HTTP thật trong `backend/integration/p1Flows.integration.test.js`, có pause/fault injection nhưng các ghi thành công vẫn vào database thử nghiệm. Lần chạy ngày **15/10/2026** dừng ở bước kết nối với **DNS ETIMEOUT**, trước khi tạo fixture; không tính là đạt và không sửa dữ liệu cửa hàng. Log: `.tmp/business-review/p1-integration-result-2026-10-15.log`. Cần chạy lại khi DNS/kết nối MongoDB hoạt động. Chưa kiểm tra trình duyệt thật.

## Đã bổ sung: giao thất bại / từ chối nhận COD

Quy tắc người dùng chốt ngày 15/10/2026:

- Đơn đã thanh toán: hoàn phần tiền hàng sau giảm giá, giữ đúng phí giao đã thu; cửa hàng chịu phí chuyển hoàn. Công thức `refundAmount = totalPrice - shippingPrice`; voucher miễn ship thì không giữ phí giao chưa thu. COD chưa thanh toán có tiền hoàn và phí giữ lại bằng 0.
- Kiểm tra từng dòng màu/size: số đôi bán lại được, hỏng và thất lạc phải cộng đúng số đã gửi. Chỉ hàng bán lại được nhập kho; hàng hỏng/thất lạc không cộng kho và không tự trừ vào tiền hoàn.
- Trả lại lượt voucher đúng một lần khi hoàn tất xử lý hàng quay về.

Luồng: **Đang giao → Giao thất bại → Đã xử lý hoàn hàng**. Hai bước cuối dùng endpoint riêng, không chuyển bằng dropdown trạng thái thông thường. Admin vào **Quản trị → Đơn hàng → Báo giao thất bại / từ chối nhận**, nhập lý do; sau khi nhận và kiểm hàng thực tế, chọn **Xác nhận hàng quay về và kiểm hàng**, nhập số lượng và chi phí rồi xác nhận. Báo thất bại không giao thành công, không thu COD, không cộng kho hoặc trả voucher ngay. Tiền hoàn được chốt sau xử lý; admin chỉ thấy nút **Xác nhận đã hoàn tiền** khi đã xử lý xong, đơn đã trả tiền và khoản hoàn lớn hơn 0. Nút ghi nhận khoản hoàn đã thực hiện bên ngoài hệ thống.

Kết quả kiểm hàng và chi phí được ghi thành snapshot trước các cập nhật kho/voucher. Dấu ghi nhận nguyên tử trên từng Product/Voucher bảo vệ thử lại, xác nhận đồng thời và trường hợp ghi thành công nhưng mất phản hồi. Khi lỗi giữa chừng, không đảo ngược lượng hàng đã nhập lại; đơn giữ trạng thái xử lý để tiếp tục đúng snapshot. Voucher có hold chặn xóa trong khoảng trả lượt đến chốt đơn. Dấu ghi nhận được giữ, không tự hết hạn; các token/hash không trả qua API. Đơn cũ không cần seed/reset.

Đơn giao thất bại/đã xử lý hoàn hàng bị loại khỏi doanh số, top sản phẩm và tổng chi tiêu mua giày. Phí giao giữ lại và phí chuyển hoàn ghi riêng trong đơn, chưa có báo cáo kế toán dòng tiền tổng hợp. Khách xem tiến độ, lý do và khoản hoàn ở **Đơn hàng**; API khách không trả chi phí cửa hàng, ghi chú nội bộ hay ID người thao tác. Đơn hoàn hàng không dùng `stockRestored=true` để giả định mọi đôi đều đã trở lại kho bán và không bị xóa qua API xóa đơn hủy.

Nguồn: `backend/controllers/deliveryController.js`, `backend/utils/deliveryReturn.js`, `backend/utils/orderPresentation.js`, `frontend/src/components/DeliveryReturnActions.jsx`, `frontend/src/components/AdminOrders.jsx`, `frontend/src/pages/MyOrders.jsx`.

Hồi quy mới: `deliveryReturn.test.js` (28 ca), `deliveryOrderGuards.test.js` (8 ca), `deliveryReports.test.js` (16 ca) và `frontend/tests/delivery-return.test.cjs` (17 ca). Toàn bộ bộ ngoại tuyến **206 backend, 131 frontend đạt; build thành công**. Bộ MongoDB/HTTP riêng `backend/integration/deliveryReturn.integration.test.js` có 4 ca nghiệp vụ trong database thử nghiệm có dấu sở hữu; kết quả chạy thật ở đoạn dưới.

Kiểm tra Chrome thật cho chức năng mới: **7/7 luồng đạt**, gồm báo thất bại COD, kiểm hàng, tiền hoàn BANK sau giảm giá/giữ phí giao, ghi nhận hoàn tiền, quyền xem của khách và form điện thoại 390px. Toàn bộ request ghi được chặn và trả bằng fixture trong trình duyệt thử, không gửi vào API/database cửa hàng; không có lỗi JavaScript hoặc tràn ngang sau khi chỉnh bố cục form. Bằng chứng: `.tmp/delivery-return-review/results.json` và ảnh cùng thư mục.

Lần chạy MongoDB thật ngày 15/10/2026 dừng ở bước kết nối với **DNS ETIMEOUT**, trước khi tạo fixture. Không có ca nghiệp vụ MongoDB mới nào được tính là đạt và dữ liệu cửa hàng không thay đổi. Log: `.tmp/delivery-return-review/mongo-integration.log`. Cần chạy lại bộ tích hợp khi DNS/kết nối hoạt động; kiểm tra Chrome bằng fixture không thay thế kết quả MongoDB thật.

## Khoảng trống nghiệp vụ cần quyết định

Các mục này cần chốt quy tắc trước khi bổ sung chức năng; không tự suy ra mọi chính sách còn thiếu là lỗi tính toán hiện tại.

- **Giao lại sau thất bại:** đã có luồng nhận/kiểm hàng quay về ở trên. Chưa có tự động giao lại hoặc tích hợp đơn vị vận chuyển; bản này xử lý kết thúc đơn giao thất bại, không dùng Đã giao để đóng đơn chưa giao thành công.
- **Hạn thanh toán BANK:** đơn giữ kho ngay nhưng chưa có hạn thanh toán/giải phóng tồn tự động. Cần chốt thời hạn, nhắc khách và xử lý tiền đến sau khi hết hạn; nếu không, đơn không được thanh toán có thể giữ hết tồn kho cho đến khi cửa hàng hủy thủ công. UI đã nói cửa hàng liên hệ cung cấp thông tin nhận tiền.
- **Đổi size/trả hàng sau giao:** chưa có luồng. Cần điều kiện đổi/trả, kiểm tra chất lượng, chuyển kho giữa biến thể, chênh lệch tiền và hoàn tiền toàn phần/một phần. Hiện hủy trước giao và ghi nhận đã hoàn tiền chưa thay thế được quy trình này.
- **Nhập/xuất/chỉnh tồn và giá vốn:** chỉ có số dư tồn kho, chưa có sổ biến động gắn người thực hiện, lý do, đơn/phiếu nhập. Cần quy tắc nhập thêm, kiểm kê, hàng hỏng, hàng trả lại và giá vốn nếu muốn báo cáo lợi nhuận; doanh thu hiện tại không phải lợi nhuận.
- **Công cụ đối soát:** có khóa recovery và hướng dẫn thao tác thủ công nhưng chưa có màn hình/công cụ xử lý checkout/hủy cần phục hồi, đối chiếu reservation với đơn/kho/voucher. Cần cho quản trị nhận biết đơn chưa hoàn tất, kho chưa trả hoặc khoản hoàn tiền chưa đủ điều kiện xử lý.
- **Vai trò nhân viên:** backend có Staff nhưng frontend chỉ dùng Customer; chưa có đăng nhập/hồ sơ/tác vụ riêng cho Staff, chưa phân quyền chi tiết bán hàng/kho/thu tiền/quản trị. Chuỗi `role` hiện chưa tạo ra các quyền nghiệp vụ tương ứng.
- **Lịch sử thao tác và chứng từ:** chưa có lịch sử người xác nhận thu/hoàn tiền, sửa giá/tồn/quyền cùng giá trị trước/sau. API vẫn cho xóa vật lý đơn đã hủy và hoàn tiền; cần chốt lưu trữ lịch sử/nhật ký riêng trước khi xóa để còn đối soát.
- **Định nghĩa báo cáo:** cần thống nhất đơn trả tiền trước nhưng chưa giao, tiền hàng/ship/voucher, đơn đã hủy đang chờ hoàn tiền và chi tiêu khách hàng. Chưa có báo cáo riêng tiền đã thu/đã hoàn/đang chờ hoàn hoặc giá vốn/lợi nhuận. Sai nhãn xếp hạng đã tách thành lỗi 20.
- **Vận chuyển:** phí hiện cố định 30.000đ, địa chỉ nhập tự do, chưa có mã vận đơn/theo dõi vận chuyển. Đã có ghi nhận giao thất bại thủ công; cần quyết định vùng phục vụ, phí theo khu vực, tích hợp hãng vận chuyển và giao lại.
- **Chính sách voucher nâng cao:** hiện hạn mức dùng chung toàn mã. Nếu cần mỗi khách chỉ dùng một số lần, mã cho khách mới/sản phẩm/danh mục cụ thể hoặc chống giữ lượt bằng đơn chưa thanh toán, phải định nghĩa thêm; chưa có quy tắc này trong schema/controller hiện tại.

## Các quy tắc đã được kiểm tra trong phạm vi rà soát

- Giá lấy từ Product, kiểm tra tiền VND và số lượng; trình duyệt không tự quyết định giá cuối.
- Tồn sản phẩm mới tách màu/size, trừ kho có điều kiện và bảo vệ phiên bản.
- Hủy thông thường hoàn kho một lần; có bù thay đổi và khóa cần đối soát nếu bù lỗi.
- Voucher kiểm tra thời gian, trạng thái, mức đơn và lượt; không giảm vượt tiền sản phẩm hoặc miễn ship hai lần.
- BANK chưa trả tiền bị chặn giao; đánh giá yêu cầu đơn đã thanh toán/giao thành công.
- API quản trị kiểm quyền, đổi mật khẩu/quyền hoặc vô hiệu hóa tài khoản thu hồi phiên cũ.
- Upload yêu cầu admin, giới hạn loại/dung lượng và sinh tên tệp tại server.

## Kiểm tra tiếp theo

1. Chạy lại các ca tích hợp mới cho **11–13** khi kết nối MongoDB hoạt động và kiểm tra phiên/route trên trình duyệt thật; bản sửa và hồi quy ngoại tuyến đã đạt.
2. Tiếp tục **14–18**, đồng thời xử lý **5 và 9**: reservation voucher, giữ giờ/phiên bản khi sửa voucher, phiên bản API kho cũ, route chi tiết, giỏ mất dòng và limiter theo topology proxy thực tế.
3. Xử lý **20**: nhãn báo cáo. Mục 19 đã được sửa cùng luồng giao thất bại/hoàn hàng.
4. Chốt đổi/trả sau giao, giao lại, hạn BANK, vai trò nhân viên, lịch sử tồn/tiền và công cụ đối soát. Giao thất bại/kiểm hàng quay về đã triển khai theo chính sách ở trên.

Các yêu cầu cho 11–13 đã có hồi quy: checkout không nhận thanh toán/hủy khi còn pending, không xóa đơn đã commit hoặc hoàn kho lần hai; SKU/biến thể đang giữ kho được bảo vệ; hồ sơ A không thay phiên B. Với các lỗi còn lại, tiếp tục bổ sung kiểm tra lượt voucher khớp đơn thực tế, sửa mô tả giữ nguyên lịch/giá trị khuyến mãi và giày hiển thị trùng ID đưa vào giỏ.

Lỗi 1–4 có lịch sử kiểm tra tích hợp Atlas trước đó; không dùng kết quả này để kết luận các ca mới 11–13 đã đạt trên database thật. Bản sửa vẫn dùng thao tác bù để hỗ trợ standalone, chưa có journal và công cụ phục hồi tự động sau mọi sự cố hoặc kết quả ghi không xác định. Trường hợp cần đối soát sẽ giữ bảo vệ thay vì tự giải phóng để thử lại.

## Kiểm tra kết nối ngày 22/10/2026

Lỗi kết nối hiện tại khác lần DNS `ETIMEOUT` đã ghi trong lịch sử: Node và Windows đều phân giải được SRV/TXT, cả ba máy chủ mở được TCP nhưng đều ngắt TLS với `ECONNRESET` trước bước xác thực. TLS bằng Windows cũng thất bại; ép riêng TLS 1.2 vẫn bị reset, còn TLS đến trang Atlas qua cổng 443 thành công. Người dùng xác nhận IP mạng hiện tại đã Active trong đúng project/cluster. Chưa đủ bằng chứng quy lỗi cho mật khẩu, IP Access List hoặc một thiết bị mạng cụ thể; cần đối chiếu mạng khác/Compass và trạng thái cluster.

API đã có thử lại kết nối ban đầu với khoảng chờ tăng dần, tối đa 30 giây, để không giữ trạng thái 503 mãi sau một lỗi mạng tạm thời. `check:db` kiểm tra bằng tiến trình riêng, không sửa kết nối API đang chạy. Thông báo lỗi backend và lệnh kiểm tra được phân loại từ nguyên nhân lồng trong lỗi Mongoose, chỉ dùng nội dung cố định và mã lỗi cho phép, không in URI/tài khoản/hostname.

Lần kiểm tra kết nối này không ghi dữ liệu cửa hàng và không chạy seed hoặc các ca nghiệp vụ MongoDB. Chưa tính các ca tích hợp đang chờ là đạt. Hướng xử lý kết nối nằm trong README.

Hồi quy ngoại tuyến sau thay đổi: **230/230 backend đạt**, gồm 15 ca chẩn đoán mới và 9 ca khởi động/thử lại. Các ca kiểm tra nguyên nhân lồng trong topology Mongoose, phân biệt timeout DNS/TCP, reset trước TLS, xác thực, chứng chỉ, lỗi cấu hình và bảo đảm thông báo không lộ bí mật. Những ca này không xác nhận kết nối Atlas đang hoạt động.

## Thanh toán VNPAY QR Sandbox — 23/10/2026

Đã thêm phương thức `VNPAY` trong checkout, mở cổng thử nghiệm sau khi tạo đơn và thanh toán tiếp từ Đơn hàng của tôi. Khách quay về website được kiểm tra kết quả tại backend; `GET /api/payments/vnpay/return` không ghi nhận thanh toán. Backend cập nhật qua IPN đã xác minh HMAC-SHA512 hoặc đối chiếu QueryDR thủ công được xác thực đầy đủ. Cả hai kiểm tra đúng merchant, mã yêu cầu, số tiền của đơn và trạng thái thành công. IPN không dùng phiên đăng nhập khách hàng; endpoint đối chiếu yêu cầu chủ đơn hoặc admin.

Cổng báo giao dịch thành công và trình duyệt quay về chưa chứng minh backend nhận được IPN. Trang Return hiển thị đang chờ và đọc lại trạng thái mỗi 3 giây, tối đa 20 lần hoặc 60 giây; hết giới hạn vẫn kiểm tra thủ công được. Vòng lặp này chỉ GET, không gọi QueryDR hoặc tự ghi thanh toán. Lỗi API/mạng dừng kiểm tra tự động và hiển thị lỗi để khách kiểm tra lại. Không yêu cầu thanh toán lại để khắc phục mất IPN. Cổng riêng 5010 chỉ chuyển tiếp `GET /api/payments/vnpay/ipn` về API cục bộ, giữ nguyên kiểm tra chữ ký ở backend.

Đã bổ sung `POST /api/orders/:id/vnpay/reconcile` cho chủ đơn hoặc admin, chỉ khi người dùng bấm **Đối chiếu với VNPAY**. Frontend có nút trong đơn hàng; Return chỉ hiện nút cho kết quả đã xác minh là đang chờ và người dùng đã đăng nhập. Admin có thể chọn chính xác mã tham chiếu khi nhiều yêu cầu chưa được xác nhận; không tự chọn yêu cầu mới nhất để suy ra kết quả của yêu cầu cũ. Payload không nhận số tiền hoặc cờ đã trả tiền từ trình duyệt. Backend dùng mã tham chiếu, thời điểm khởi tạo gốc và số tiền đã lưu; đối chiếu merchant với cấu hình và ký yêu cầu QueryDR tới API Sandbox cố định.

Phản hồi QueryDR phải được xác minh HMAC-SHA512, đúng merchant/mã tham chiếu/số tiền, có mã phản hồi truy vấn `00`, loại giao dịch thanh toán `01` và trạng thái giao dịch `00` mới ghi nhận trả tiền. Phản hồi thiếu/sai chữ ký, sai số tiền, lỗi truy vấn, đang chờ, hoàn tiền hoặc đảo giao dịch giữ nguyên trạng thái thanh toán. Giới hạn một lần đối chiếu mỗi **5 phút theo đơn** được ghi trong MongoDB trước khi gửi, nên timeout, khởi động lại backend hoặc gửi từ tiến trình khác không bỏ qua giới hạn này. Giao diện chặn bấm lặp và bỏ phản hồi cũ khi đổi tài khoản, trang hoặc đơn. Return đọc lại GET để hiển thị kết quả sau đối chiếu; không dùng dữ liệu URL để ghi thanh toán.

Mỗi yêu cầu thanh toán được lưu trong đơn, dùng lại khi còn hạn và giữ các yêu cầu cũ cho IPN đến muộn. IPN và QueryDR dùng chung thao tác ghi nhận với điều kiện phiên bản/trạng thái để bảo vệ cập nhật đồng thời với hủy đơn; nhận lặp qua hai đường không ghi thêm thanh toán. Đơn đã hủy vẫn hủy nếu tiền về muộn, ghi nhận chờ hoàn tiền và không trừ kho lại. Nhiều yêu cầu cùng thành công được giữ lịch sử, gắn cờ cần đối soát; đơn hủy/hoàn đã xác nhận hoàn tiền được chuyển lại sang chờ xử lý. API và UI chặn xác nhận hoàn tiền thông thường khi có cờ đối soát, kể cả khi cờ được đặt sau lúc admin đọc đơn.

VNPAY chưa thanh toán không được chuyển giao; admin không tự đổi `isPaid` hoặc xóa lịch sử đơn VNPAY. Chưa cấu hình Sandbox thì checkout bị từ chối trước khi khóa giỏ/trừ kho. Cấu hình chỉ hỗ trợ gateway Sandbox, số tiền từ 5.000đ; không lưu khóa ký trong đơn hoặc phản hồi API.

Kiểm tra mới gồm `vnpayProtocol.test.js`, `vnpayPayments.test.js`, `vnpayIpnRelay.test.js`, kiểm tra giao thức/phản hồi QueryDR và đối chiếu controller, cùng hồi quy giao diện VNPAY, kiểm tra tự động trang Return, API, quản trị và hoàn tiền. Toàn bộ **310 backend, 165 frontend đạt (20 luồng và 145 ca Node), build thành công**. Phạm vi gồm lựa chọn mã tham chiếu khi nhiều yêu cầu, quyền truy cập, chữ ký/số tiền/trạng thái truy vấn, giới hạn đối chiếu đồng thời và kết quả đến muộn. Esbuild cần chạy ngoài sandbox công cụ để đọc thư mục cha trên máy này; sau khi có quyền, frontend và build đều đạt.

Lịch sử kiểm tra vận hành ngày 23/10/2026: đã có cấu hình merchant Sandbox; ảnh người dùng xác nhận mục **Cấu hình IPN URL → Sửa → Cập nhật** trong SIT và URL IPN đúng đường dẫn. Frontend tại `http://localhost:5173` hoạt động (trên máy này localhost dùng IPv6), API cổng 5000 kết nối MongoDB và cổng nhận IPN 5010 hoạt động trong lần kiểm tra trước. Sau khi người dùng thêm ngoại lệ Avast cho `https://connect.ngrok-agent.com`, ngrok đã online tại `https://gawk-luckiness-unjustly.ngrok-free.dev`, chuyển về `http://127.0.0.1:5010`. Kiểm tra HTTPS từ bên ngoài: IPN không có chữ ký trả HTTP 200, `application/json`, `RspCode: "97"`, kể cả khi không có header bỏ qua cảnh báo ngrok; `/api/customers/profile`, `/api/orders`, `/api/products` đều trả 404. Xác minh TLS và ghim CA mặc định được giữ nguyên. Kết quả này không thay thế kiểm tra lại MongoDB/API ở mỗi lần chạy.

Phép đọc MongoDB gần nhất chỉ kiểm tra đơn hiện có đuôi `e8d367e6`: `isPaid` vẫn `false`, yêu cầu VNPAY vẫn `pending`; yêu cầu đã khoảng 6 giờ tại thời điểm kiểm tra. Inspector chưa ghi nhận IPN có chữ ký. Người dùng xác nhận SIT không hiện giao dịch và Merchant Admin mới có thống kê thành công chung, chưa mở chi tiết giao dịch khớp mã tham chiếu của đơn. Vì vậy chưa có bằng chứng kết luận đúng đơn này đã được VNPAY thanh toán thành công. Kiểm tra công khai không kèm chữ ký chỉ chứng minh đường nhận hoạt động; chưa xác nhận giao dịch đầu cuối qua IPN hoặc QueryDR thật. Có thể đối chiếu bằng QueryDR vừa bổ sung hoặc nhờ VNPAY kiểm tra/gửi lại IPN cho giao dịch cũ; không kỳ vọng tự thử lại vô hạn. Không yêu cầu khách thanh toán thêm, không tạo callback giả và không dùng Return URL để ghi thanh toán.

Cập nhật kiểm tra thật ngày 23/10/2026: sau khi thêm `MONGO_DNS_SERVERS=1.1.1.1,8.8.8.8` cho tiến trình Node, API kết nối MongoDB trở lại. DNS mặc định trước đó timeout khi tra SRV; hai resolver cấu hình đều trả đủ ba node. Không đổi DNS Windows. QueryDR thật của đúng yêu cầu đơn đuôi `e8d367e6` trả HTTP 200 với chữ ký hợp lệ, đúng merchant/mã tham chiếu/số tiền **3.000.000đ**, mã giao dịch **15712390**, loại `01`, mã truy vấn/trạng thái `00`. Đây là phép kiểm tra chỉ đọc; không tự ghi `isPaid` hay tạo callback. Cần bấm **Đối chiếu với VNPAY** bằng phiên chủ đơn/admin để ghi nhận qua endpoint đã kiểm thử. Chưa tính bước ghi nhận đầu cuối trên MongoDB là đã đạt.

Lỗi tunnel trước đó là TLS `x509: certificate signed by unknown authority` (`ERR_NGROK_8008`/`ERR_NGROK_8003`). Phép kiểm tra chứng chỉ đã thấy Subject `CN=connect.ngrok-agent.com, O=ngrok Inc.`, Issuer `CN=Avast Web/Mail Shield Untrusted Root` và `RemoteCertificateChainErrors`; phép kiểm tra luôn từ chối chứng chỉ, không gửi thông tin xác thực. Người dùng đã thêm ngoại lệ website hẹp theo [hướng dẫn Avast](https://support.avast.com/article/antivirus-scan-exclusions/) và tunnel hoạt động sau đó. Agent thực tế vẫn là **3.39.9-msix**: tải bản 3.39.12 trước đó không hoàn tất, không có tệp thực thi mới được giải nén hoặc chạy. Không tắt toàn bộ shield, không đổi sang `connect_cas: host` và không bỏ qua lỗi chứng chỉ. Xem [VNPAY_SANDBOX.md](VNPAY_SANDBOX.md) để cấu hình và chẩn đoán.

Theo [đặc tả IPN VNPAY](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html), tối đa 10 lần gọi với khoảng cách 5 phút; `RspCode` 00/02 dừng luồng, 01/04/97/99 hoặc timeout làm VNPAY thử lại. Vì vậy khoảng chờ tự động 60 giây trên trình duyệt có thể kết thúc trước lần gọi lại tiếp theo của máy chủ. Chưa có tài liệu công khai xác minh nút gửi lại IPN trong SIT; không suy ra đổi URL sẽ khởi động lại các lượt thử đã hết. Nếu cần gửi lại, dùng kênh hỗ trợ merchant cho đúng giao dịch hiện có, kèm mã merchant, mã tham chiếu/giao dịch, thời gian, số tiền và URL IPN; không gửi khóa ký.

Giới hạn vận hành: hết hạn link không tự hủy đơn/giải phóng kho; QueryDR chỉ chạy thủ công, chưa có lịch đối soát tự động hoặc API hoàn tiền VNPAY; khoản thanh toán dư cần đối soát thủ công. Nút hoàn tiền chỉ ghi nhận khoản đã xử lý bên ngoài. Cờ đối soát không được tự xóa và không cho phép bấm xác nhận hoàn toàn bộ tiền khi chưa xử lý khoản dư.
