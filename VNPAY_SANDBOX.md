# Thanh toán VNPAY QR Sandbox

Tính năng đã có trong trang Thanh toán và Đơn hàng của tôi. Khách chọn **VNPAY Sandbox (QR / thẻ test)**; sau khi tạo đơn, website mở cổng VNPAY thử nghiệm. Nếu chưa mở được cổng hoặc khách quay lại, có thể bấm **Thanh toán VNPAY** trong đơn đó, không cần đặt lại đơn. Nếu đã thanh toán nhưng website còn chờ, dùng **Đối chiếu với VNPAY** để truy vấn giao dịch cũ; không mở một lần thanh toán mới để xử lý mất IPN.

## 1. Đăng ký merchant thử nghiệm

Đăng ký tại [VNPAY Sandbox](https://sandbox.vnpayment.vn/devreg/) bằng email của bạn. Lấy `vnp_TmnCode` và `vnp_HashSecret` từ thông tin VNPAY cấp, rồi điền trực tiếp vào `backend/.env`. Giữ file này ở máy; không đưa khóa lên Git hoặc gửi vào chat. Không dùng khóa mẫu của merchant khác.

## 2. Chuẩn bị địa chỉ nhận IPN

VNPAY gọi IPN từ máy chủ của họ, nên không truy cập được `localhost` trên máy bạn. Dự án có cổng riêng **5010** chỉ tiếp nhận `GET /api/payments/vnpay/ipn` và chuyển thông báo về backend cục bộ. Các đường dẫn sản phẩm, tài khoản, đơn hàng và quản trị không được chuyển qua cổng này. Backend vẫn kiểm tra chữ ký và số tiền như bình thường.

Sau khi cài và đăng nhập [ngrok theo hướng dẫn chính thức](https://ngrok.com/docs/getting-started/), mở một terminal riêng:

```powershell
ngrok http http://127.0.0.1:5010
```

Giả sử ngrok cấp địa chỉ `https://TEN-MIEN-CUA-BAN.ngrok-free.app`, URL IPN sẽ là:

```text
https://TEN-MIEN-CUA-BAN.ngrok-free.app/api/payments/vnpay/ipn
```

Đăng ký **đúng URL IPN này** với VNPAY cho merchant Sandbox. Đặt biến môi trường trong dự án chưa thay thế việc đăng ký bên VNPAY: URL IPN không phải tham số của link thanh toán. Khi địa chỉ tunnel đổi, cập nhật ở cả hai nơi. Giữ terminal tunnel chạy trong lúc test.

Truy cập [VNPAY Sandbox SIT Testing](https://sandbox.vnpayment.vn/vnpaygw-sit-testing/) bằng tài khoản VNPAY cấp, chọn **Cấu hình IPN URL → Sửa**, điền đầy đủ URL HTTPS ở trên rồi chọn **Cập nhật**. Đây là menu đã được xác nhận từ ảnh người dùng; trang có đường dẫn `/vnpaygw-sit-testing/ipn`. Đối chiếu URL đã lưu với cấu hình backend và địa chỉ tunnel đang online. Quyền truy cập tùy tài khoản; nếu không có mục cấu hình hoặc không được phép sửa, dùng kênh hỗ trợ trong email cấp merchant để nhờ VNPAY đăng ký URL. Không gửi khóa ký cho người khác.

Nội dung yêu cầu để bạn tự gửi cho bộ phận hỗ trợ:

```text
Tôi đang tích hợp VNPAY Sandbox cho merchant [vnp_TmnCode].
Nhờ hỗ trợ cấu hình IPN URL:
https://[ten-mien-ngrok]/api/payments/vnpay/ipn
API hỗ trợ GET và xác minh HMAC-SHA512 phiên bản 2.1.0.
Giao dịch test cần đối chiếu vì hệ thống chưa nhận IPN.
Mã tham chiếu merchant (vnp_TxnRef): [ma-tham-chieu-giao-dich-cu]
Mã giao dịch VNPAY (vnp_TransactionNo): [ma-giao-dich]
Thời gian thanh toán và số tiền: [thoi-gian], [so-tien-VND]
Nhờ kiểm tra cấu hình và hỗ trợ gửi lại thông báo cho giao dịch này.
```

Return URL là trang khách được chuyển về trên trình duyệt. Khi trình duyệt chạy trên cùng máy với frontend, dùng `http://localhost:5173/payment/vnpay/return`. Nếu test từ điện thoại hoặc máy khác, dùng địa chỉ frontend mà thiết bị đó truy cập được.

## 3. Cấu hình backend

Các biến mẫu đã được thêm vào `backend/.env.example`. Điền vào `backend/.env`, giữ nguyên cấu hình MongoDB và JWT hiện có:

```dotenv
VNPAY_ENABLED=true
VNPAY_TMN_CODE=MA_MERCHANT_8_KY_TU
VNPAY_HASH_SECRET=KHOA_KY_DO_VNPAY_CAP
VNPAY_RETURN_URL=http://localhost:5173/payment/vnpay/return
VNPAY_IPN_URL=https://TEN-MIEN-CUA-BAN.ngrok-free.app/api/payments/vnpay/ipn
VNPAY_BANK_CODE=
VNPAY_TIMEOUT_MINUTES=15
VNPAY_IPN_PORT=5010
```

Hai giá trị merchant/khóa và tên miền trong đoạn trên là chỗ để thay bằng thông tin của bạn. `http://` đứng một mình không phải URL hợp lệ. Mặc định để trống `VNPAY_BANK_CODE` để chọn phương thức hỗ trợ trên cổng và thử thẻ NCB. Chỉ đặt `VNPAY_BANK_CODE=VNPAYQR` để mở thẳng QR khi merchant Sandbox đã hỗ trợ phương thức đó.

Gateway được cố định ở `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html`. Bản tích hợp này dùng môi trường thử nghiệm. Không quét QR Sandbox để chuyển tiền thật; dùng phương tiện test được VNPAY hỗ trợ cho merchant của bạn. Nếu phương thức QR chưa được bật trên merchant, dùng thẻ Sandbox để kiểm tra toàn bộ IPN và liên hệ VNPAY về quyền thử QR.

## 4. Kiểm tra cấu hình và chạy

Chạy từ thư mục có `package.json` gốc, trên máy hiện tại là `C:\Users\thang\web-main\web-main`:

```powershell
npm run check:vnpay
npm run check:db
npm run dev:vnpay
```

`dev:vnpay` chạy backend, frontend và cổng nhận IPN riêng. Nếu website đã chạy bằng `npm run dev`, mở thêm một terminal và chạy `npm run vnpay:ipn` thay vì khởi động thêm một backend/frontend nữa.

`check:vnpay` chỉ kiểm tra cấu hình cục bộ, không xác minh merchant với VNPAY hoặc khả năng truy cập IPN từ Internet. `check:db` phải kết nối MongoDB thành công để đặt đơn và ghi nhận thanh toán. Sau khi đổi `.env`, khởi động lại backend. Mở `http://localhost:5173`, đăng nhập khách hàng, thêm giày vào giỏ và chọn VNPAY khi đặt hàng.

Đơn VNPAY cần tổng tiền ít nhất **5.000đ**. Số tiền lấy từ đơn đã lưu ở backend; trình duyệt không quyết định số tiền gửi sang cổng.

## 5. Thử thanh toán thành công

Để kiểm tra dễ dàng bằng thẻ, đặt `VNPAY_BANK_CODE=` rồi khởi động lại backend. Chọn **Thẻ ATM / tài khoản ngân hàng nội địa → NCB** trên cổng. Thông tin thử nghiệm từ [VNPAY](https://sandbox.vnpayment.vn/apis/vnpay-demo/):

| Trường | Giá trị test |
| --- | --- |
| Ngân hàng | NCB |
| Số thẻ | 9704198526191432198 |
| Tên chủ thẻ | NGUYEN VAN A |
| Ngày phát hành | 07/15 |
| OTP | 123456 |

Sau giao dịch, trang kết quả sẽ đọc trạng thái từ backend. Cổng báo thành công và trình duyệt quay về chưa chứng minh máy chủ đã nhận IPN. Nếu IPN chưa đến, trang hiện **Đang chờ xác nhận thanh toán** và tự kiểm tra lại mỗi 3 giây, tối đa 20 lần hoặc 60 giây. Hết khoảng này, trang báo rõ chưa nhận xác nhận; vẫn có thể bấm **Kiểm tra lại kết quả** hoặc kiểm tra trong **Đơn hàng của tôi**. Các lần đọc tự động không gọi QueryDR và không tự ghi thanh toán. Nếu API/mạng lỗi, kiểm tra tự động dừng và trang hiển thị lỗi; dùng nút kiểm tra lại sau khi kết nối hoạt động.

Khi mất IPN, đăng nhập và bấm **Đối chiếu với VNPAY** theo hướng dẫn dưới đây. Chỉ IPN hợp lệ hoặc kết quả QueryDR được backend xác minh đầy đủ mới ghi nhận **Đã thanh toán** và cho phép chuyển sang giao hàng. Return URL vẫn không ghi thanh toán. Không cần thanh toán lại để khắc phục việc website chưa nhận xác nhận.

Để thử hiển thị QR, đặt lại `VNPAY_BANK_CODE=VNPAYQR`, khởi động lại backend và mở thanh toán cho một đơn chưa thanh toán. Khi có yêu cầu đang còn hạn, backend dùng lại mã yêu cầu đó; không tạo hai yêu cầu chỉ vì bấm nút liên tiếp.

## 6. Khi kết quả vẫn đang chờ

- Kiểm tra MongoDB có kết nối và API có chạy không.
- Kiểm tra tunnel còn chạy, URL IPN đúng đường dẫn và đã đăng ký với đúng merchant.
- Kiểm tra cổng nhận IPN 5010 có chạy bằng `npm run vnpay:ipn` hoặc `npm run dev:vnpay`.
- Nếu URL công khai báo `ERR_NGROK_3200`, endpoint đang offline hoặc URL không còn đúng. Khởi động lại tunnel tới cổng 5010 và đối chiếu địa chỉ trong `.env` với phía VNPAY. Xem [hướng dẫn ngrok cho lỗi 3200](https://ngrok.com/docs/errors/err_ngrok_3200).
- Mở URL IPN không kèm tham số sẽ nhận JSON `RspCode: "97"`: điều này chỉ kiểm tra đường dẫn có hoạt động, không xác nhận giao dịch hay chứng minh VNPAY đã gọi được.
- Kiểm tra mã merchant và khóa ký đúng cặp Sandbox. Không tự thêm `isPaid=true` từ trình duyệt hoặc dùng Return URL để thay IPN.
- Với giao dịch chưa được website ghi nhận, bấm **Đối chiếu với VNPAY** để backend truy vấn giao dịch cũ bằng QueryDR. Nếu vẫn chưa xác minh được, nhờ VNPAY kiểm tra/gửi lại IPN cho chính giao dịch đó. Khởi động lại tunnel không tự khôi phục IPN nếu cổng đã hết lượt thử lại; không thanh toán thêm để sửa tình trạng này. IPN hợp lệ đến muộn vẫn được kiểm tra với yêu cầu cũ, kể cả khi link thanh toán đã hết hạn. Không tự suy ra đã nhận tiền từ trang Return hoặc thống kê chung của Merchant Admin.

Lịch sử kiểm tra ngày 23/10/2026 sau khi thêm ngoại lệ Avast: frontend, MongoDB/API và cổng nhận IPN 5010 hoạt động trong lần kiểm tra trước; tunnel `https://gawk-luckiness-unjustly.ngrok-free.dev` đã online và chuyển về `http://127.0.0.1:5010`. HTTPS thông thường từ bên ngoài, không có header bỏ qua cảnh báo ngrok, gọi `/api/payments/vnpay/ipn` không có chữ ký nhận HTTP 200, `application/json`, `RspCode: "97"`; `/api/customers/profile`, `/api/orders`, `/api/products` đều trả 404. Kiểm tra chỉ đọc đơn hiện có đuôi `e8d367e6` vẫn thấy `isPaid: false`, yêu cầu thanh toán `pending`; inspector chưa ghi nhận IPN có chữ ký. Người dùng sau đó xác nhận chỉ thấy thống kê thành công chung trong Merchant Admin, chưa mở chi tiết đúng giao dịch; SIT không hiện giao dịch. Chưa đủ bằng chứng kết luận đơn này đã được VNPAY thanh toán thành công và chưa xác nhận ghi nhận giao dịch đầu cuối. Kết nối MongoDB cần được kiểm tra lại khi chạy thử.

### Đối chiếu thủ công khi mất IPN

Kiểm tra thật ngày 23/10/2026: QueryDR trả HTTP 200 và xác minh thành công đúng yêu cầu của đơn đuôi `e8d367e6`, số tiền **3.000.000đ**, giao dịch **15712390**, thời điểm trả tiền **01:16:15 ngày 23/10/2026 (GMT+7)**. Chữ ký, merchant, mã tham chiếu, số tiền và các mã trạng thái đều hợp lệ. Phép kiểm tra chỉ đọc không cập nhật đơn: đăng nhập và bấm **Đối chiếu với VNPAY** để ghi nhận qua luồng có kiểm quyền; không thanh toán lại.

MongoDB đã kết nối lại sau khi cấu hình `MONGO_DNS_SERVERS=1.1.1.1,8.8.8.8` trong `backend/.env`: DNS mặc định tra SRV bị timeout, hai resolver này trả đủ ba máy chủ và API báo `databaseConnected: true`. Đây chỉ là tùy chọn DNS của tiến trình Node cho các phép `resolve*`, không sửa DNS Windows; để trống để giữ mặc định.

1. Khách đăng nhập đúng tài khoản đặt đơn, mở **Đơn hàng của tôi** và bấm **Đối chiếu với VNPAY** ở đơn chưa thanh toán. Trên trang kết quả Return, nút này chỉ xuất hiện khi backend đã xác minh dữ liệu Return là đang chờ, có mã đơn và người dùng đã đăng nhập. Return gửi đúng mã tham chiếu trong dữ liệu đã xác minh để đối chiếu lần thanh toán đó.
2. Admin vào **Quản trị → Đơn hàng**, tìm đơn và bấm **Đối chiếu với VNPAY**. Nút chỉ có ở đơn VNPAY chưa thanh toán đã lưu yêu cầu thanh toán, không đang bị khóa xử lý. Nếu có nhiều yêu cầu chưa xác nhận, chọn đúng **Giao dịch cần đối chiếu** trước khi bấm; danh sách không tự chọn một lần thanh toán thay admin. Nếu nút khách hàng báo có nhiều yêu cầu, nhờ admin chọn mã tham chiếu tương ứng.
3. Chờ kết quả từ backend. Khi xác minh thành công, trạng thái đơn được cập nhật; nếu chưa xác minh được, trạng thái thanh toán được giữ nguyên và giao diện hiển thị thông báo. Đợi đủ **5 phút tính từ lần đối chiếu trước** rồi mới thử lại, kể cả khi lần trước timeout, mất mạng hoặc backend khởi động lại. Hạn này lưu trong MongoDB theo đơn, nên chọn mã tham chiếu khác không bỏ qua thời gian chờ.

Endpoint `POST /api/orders/:id/vnpay/reconcile` yêu cầu đăng nhập và quyền chủ đơn hoặc admin. Payload chỉ nhận `txnRef` tùy chọn để chọn một yêu cầu đã lưu; không nhận số tiền hay trạng thái do trình duyệt quyết định. Backend lấy mã merchant, mã tham chiếu, thời điểm khởi tạo gốc và số tiền từ dữ liệu đã lưu; ký yêu cầu `querydr` tới API Sandbox cố định. Phản hồi phải có HMAC-SHA512 hợp lệ, đúng merchant/mã tham chiếu/số tiền; mã phản hồi truy vấn `00`, loại giao dịch thanh toán `01` và trạng thái giao dịch `00` mới đủ điều kiện ghi nhận trả tiền. Phản hồi thiếu chữ ký, sai số tiền, lỗi truy vấn, đang chờ, hoàn tiền hoặc đảo giao dịch không tự ghi thành đã thanh toán.

QueryDR dùng chung thao tác ghi nhận với IPN, giữ kiểm tra phiên bản, khóa hủy/hoàn hàng và bảo vệ hoàn tiền. Đơn đã hủy không được mở lại hoặc trừ kho khi xác nhận tiền đến muộn; thanh toán dư tiếp tục được gắn cờ để đối soát. `GET /api/payments/vnpay/return` luôn chỉ đọc; việc bấm đối chiếu gọi POST riêng, rồi trang Return đọc lại kết quả đã xác minh. Không tự gọi QueryDR theo vòng lặp 3 giây.

Việc SIT trống nhưng Merchant Admin có thống kê chung không xác nhận một đơn cụ thể. Nếu đối chiếu vẫn thất bại, mở chi tiết giao dịch Merchant Admin và kiểm tra đúng merchant, `vnp_TxnRef`, thời gian, số tiền; thống kê tổng không thay thế bước này. QueryDR không cần ngrok để gửi truy vấn từ backend, nhưng MongoDB và kết nối HTTPS tới VNPAY phải hoạt động; tunnel vẫn cần chạy để nhận IPN mới hoặc thử lại.

### Nhận lại IPN cho giao dịch đã thành công

[Đặc tả VNPAY](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html) quy định tối đa **10 lần gọi IPN**, khoảng cách **5 phút**. Merchant trả `RspCode` 00/02 thì VNPAY dừng; 01/04/97/99 hoặc timeout thì thử lại. Khoảng kiểm tra tự động 60 giây trên trình duyệt có thể kết thúc trước lần thử tiếp theo của VNPAY.

Giữ tunnel, API và cổng nhận IPN chạy để nhận lượt thử còn lại. Nếu VNPAY đã hết lượt hoặc giao dịch vẫn chưa được xác nhận, dùng kênh hỗ trợ trong email cấp merchant để yêu cầu gửi lại IPN cho **giao dịch cũ**, theo mẫu ở bước 2. Không thanh toán thêm, không tự tạo callback và không đổi trạng thái đã trả tiền từ trình duyệt. Chưa xác minh có nút gửi lại IPN trong SIT qua tài liệu công khai; không tự đoán tên/vị trí nút. Việc cập nhật URL IPN không được tài liệu xác nhận là sẽ khởi động lại các lượt thử đã hết.

Yêu cầu thanh toán của đơn đuôi `e8d367e6` đã khoảng 6 giờ trong lần kiểm tra ngày 23/10/2026, nên không kỳ vọng IPN được thử lại vô hạn. Chưa tìm được giao dịch khớp trong SIT; thống kê thành công chung của Merchant Admin chưa xác nhận đúng đơn. Có thể dùng QueryDR vừa bổ sung để đối chiếu mã đã lưu, hoặc nhờ hỗ trợ VNPAY kiểm tra và gửi lại IPN nếu xác nhận giao dịch đó thành công. Không cần thanh toán lại để kiểm tra.

### Lỗi TLS của ngrok

Lỗi này đã được xử lý trên máy hiện tại ngày 23/10/2026: người dùng thêm ngoại lệ Avast cho `https://connect.ngrok-agent.com` và tunnel hoạt động sau đó. Xác minh TLS và ghim CA mặc định được giữ nguyên. Trước khi có ngoại lệ, bản **3.39.9-msix** báo `x509: certificate signed by unknown authority`; `ngrok diagnose` ghi nhận lỗi TLS (`ERR_NGROK_8008`/`ERR_NGROK_8003`).

Kiểm tra chứng chỉ khi lỗi xác định Avast Web/Mail Shield thay chứng chỉ cho `connect.ngrok-agent.com`: Issuer là `Avast Web/Mail Shield Untrusted Root`, kèm lỗi `RemoteCertificateChainErrors`. Phép kiểm tra luôn từ chối chứng chỉ và không gửi thông tin xác thực. Agent thực tế vẫn là **3.39.9-msix**; các lần tải 3.39.12 trước đó không hoàn tất, không có tệp thực thi mới được giải nén hoặc chạy.

Ngoại lệ website hẹp đã được người dùng thêm theo [hướng dẫn Avast](https://support.avast.com/article/antivirus-scan-exclusions/):

1. Mở **Avast → Menu → Settings → General → Exceptions → Add exception**.
2. Chọn **Website / Domain**, nhập đúng `https://connect.ngrok-agent.com`, rồi lưu ngoại lệ.
3. Kiểm tra lại tunnel hiện tại và xác minh chuỗi chứng chỉ, giữ nguyên origin IPN đã đăng ký. Chỉ sau khi tunnel online mới kiểm tra IPN từ Internet.

Chỉ thêm ngoại lệ cho host đã xác định; không tắt toàn bộ shield và không thêm wildcard cho mọi website/ngrok. Tunnel hiện tại đã qua kiểm tra HTTPS từ bên ngoài; nhận IPN có chữ ký và cập nhật đơn vẫn cần kiểm tra riêng.

Chạy `ngrok diagnose` để phân biệt lỗi DNS, TCP và TLS; chỉ chia sẻ kết quả đã bỏ thông tin riêng. Đối chiếu ngày giờ máy và chế độ CA trong cấu hình, giữ `root_cas` (cấu hình v2) hoặc `agent.connect_cas` (v3) ở mặc định/`trusted` để giữ ghim CA của ngrok. Không tắt xác minh TLS/CRL, không tự chuyển sang `host` hoặc thêm CA tùy ý. Nếu có proxy HTTPS, kiểm tra cấu hình và chuỗi chứng chỉ mà không công khai thông tin đăng nhập proxy.

Khi cập nhật bản cài Microsoft Store, dùng Store; không dùng lệnh tự cập nhật của agent cho bản cài qua trình quản lý gói. [Bản 3.39.12](https://ngrok.com/docs/gateway/agent/changelog) có sửa đọc/ghi cấu hình MSIX và bản vá CA, nhưng lần xử lý tunnel hiện tại hoàn tất bằng ngoại lệ Avast, chưa nâng cấp agent.

Nếu sau ngoại lệ hẹp vẫn lỗi, kiểm tra lại chuỗi chứng chỉ trước khi cân nhắc ngoại lệ khác hoặc nhờ quản trị mạng hỗ trợ. [Hướng dẫn firewall của ngrok](https://ngrok.com/docs/gateway/running-behind-firewalls) liệt kê `connect.ngrok-agent.com` và các Connect URL theo vùng trên cổng 443, `update.ngrok-agent.com`, cùng CRL `http://crl.ngrok-agent.com/ngrok.crl` trên cổng 80. Đây là danh sách để chẩn đoán theo lỗi thực tế, không phải yêu cầu thêm ngoại lệ cho tất cả các host. Giữ nguyên origin IPN đã đăng ký khi kiểm tra lại tunnel; không cần đổi đường dẫn nhận IPN để xử lý lỗi TLS của agent.

### Mã lỗi 76: Ngân hàng thanh toán không được hỗ trợ

Nếu cổng hiển thị lỗi này khi đang cấu hình `VNPAY_BANK_CODE=VNPAYQR`, đường thanh toán QR đang chọn chưa được cổng chấp nhận. Để kiểm tra giao dịch bằng phương thức khác, đặt `VNPAY_BANK_CODE=` trong `backend/.env`, khởi động lại backend rồi vào **Đơn hàng của tôi → Thanh toán VNPAY** trên chính đơn chưa thanh toán đó. Cổng sẽ hiển thị lựa chọn phương thức; dùng thẻ NCB test ở bước 5.

Mở liên kết mới từ website; tải lại trang lỗi cũ vẫn dùng mã phương thức trong URL cũ. Không cần đặt thêm đơn. Khi cần mở thẳng QR, kiểm tra quyền hỗ trợ QR của merchant với VNPAY trước khi bật lại `VNPAYQR`. Nếu vẫn bị ép QR sau khi sửa file, kiểm tra terminal có biến môi trường `VNPAY_BANK_CODE` riêng và khởi động lại backend với giá trị để trống.

Theo [đặc tả VNPAY](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html), Return URL hiển thị kết quả; IPN cập nhật giao dịch sau kiểm tra chữ ký và số tiền. Backend dùng HMAC-SHA512, đối chiếu merchant, mã yêu cầu, số tiền và cả hai trạng thái thành công. IPN lặp không ghi thanh toán thêm lần nữa; lỗi tạm thời trả mã để VNPAY thử lại. Nhánh QueryDR đối chiếu thủ công xác minh riêng chữ ký phản hồi theo đặc tả truy vấn trước khi dùng chung thao tác ghi nhận.

## Phạm vi xử lý

- Mỗi đơn giữ lịch sử tối đa 20 lần khởi tạo; yêu cầu còn hạn được dùng lại. Hết hạn link không tự hủy đơn hoặc hoàn kho. Có thể mở lại thanh toán hoặc hủy theo quy tắc đơn hiện tại.
- Nếu tiền được ghi nhận sau khi hủy, đơn vẫn hủy, không trừ kho lại và chuyển sang chờ hoàn tiền.
- Hai yêu cầu khác nhau cùng thành công được lưu đầy đủ và gắn cờ cần đối soát khoản dư. Khi đó hệ thống chặn xác nhận hoàn tiền thông thường để không báo nhầm đã hoàn tất; cần xử lý đối soát thủ công.
- Quản trị không đánh dấu/hủy dấu thanh toán VNPAY bằng nút thủ công. Đơn VNPAY được giữ để đối chiếu callback đến muộn.
- Đã tích hợp API truy vấn giao dịch QueryDR thủ công có xác thực. Chưa tích hợp API hoàn tiền VNPAY; nút xác nhận hoàn tiền hiện có chỉ ghi nhận việc hoàn tiền đã xử lý bên ngoài.
- Bộ kiểm tra ngoại tuyến dùng mã merchant, callback và phản hồi QueryDR giả có chữ ký, không dùng khóa merchant thật. Chỉ tính là hoàn tất kiểm tra đầu cuối khi IPN hoặc QueryDR thật được xác minh và trạng thái đúng đơn được cập nhật; kết nối MongoDB, URL IPN đã cấu hình, thống kê chung hoặc Return báo thành công riêng lẻ chưa đủ.

Kiểm tra ngày 23/10/2026 sau bổ sung QueryDR và DNS: `npm test` **310/310 đạt**; `npm run test:frontend` **20 luồng và 145 ca đạt (165 tổng cộng)**; `npm run build` thành công. Đã xác minh phản hồi QueryDR thật như phần đối chiếu ở trên; bước ghi nhận đơn thật qua phiên chủ đơn/admin vẫn cần kiểm tra riêng.
