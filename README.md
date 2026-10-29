# SHOE STORE

Website bán giày với React/Vite, Express và MongoDB/Mongoose. Khách hàng có thể tìm giày, chọn size, quản lý giỏ, đặt hàng COD/VNPAY Sandbox, theo dõi đơn và đánh giá sản phẩm sau khi nhận hàng. Quản trị viên quản lý sản phẩm, đơn hàng, tài khoản, voucher và doanh thu.

Trang chủ và trang sản phẩm dùng giao diện catalog với bộ lọc thương hiệu, màu, size, giá và còn hàng; lưới 4 cột trên màn hình lớn, 2 cột trên điện thoại. Có sắp xếp, phân trang và giữ lựa chọn trên URL. Xem [README frontend](frontend/README.md) để chỉnh giao diện. Đợt thiết kế lại ngày 15/10/2026 đạt 114 kiểm tra frontend, build và 12 luồng trên Chrome với dữ liệu mẫu riêng; không thay đổi dữ liệu cửa hàng.

## Bộ ảnh và bài giới thiệu giày

Trong **Quản trị → Sản phẩm → Thêm sản phẩm** hoặc **Chỉnh sửa**, chọn ảnh bìa và thêm nhiều ảnh từ máy tính ở **Ảnh bổ sung**. Mỗi sản phẩm có tối đa **10 ảnh**, gồm ảnh bìa; hỗ trợ JPG, PNG, WebP, tối đa **5 MB/ảnh**. Có xem trước, xóa, đổi thứ tự ảnh bổ sung và chọn ảnh làm bìa.

Phần **Bài giới thiệu chi tiết → + Thêm mục giới thiệu** cho phép viết các mục về thiết kế, thương hiệu, chất liệu, cách bảo quản hoặc chọn size. Mỗi mục có tiêu đề, nội dung và ảnh minh họa chọn từ bộ ảnh, kèm chú thích. Tối đa **12 mục**, **10.000 ký tự/mục**, tổng nội dung **40.000 ký tự**; xuống dòng trống để chia đoạn, bắt đầu các dòng bằng `- ` để tạo danh sách. Các ô mã mẫu, chất liệu, xuất xứ, kiểu dáng và giới tính sử dụng là tùy chọn.

Trang chi tiết hiển thị bộ ảnh có ảnh nhỏ để chọn và cửa sổ phóng to; bên dưới là bài giới thiệu, thông số và đánh giá của khách. Sản phẩm cũ có một ảnh vẫn hiển thị bình thường. Sửa ảnh/nội dung giữ nguyên kho khi không thay đổi các dòng màu/size. Cập nhật đồng thời frontend và backend; không cần seed hoặc chuyển đổi dữ liệu cũ.

## Giảm giá sản phẩm theo phần trăm

Vào **Quản trị → Sản phẩm → Thêm sản phẩm / Chỉnh sửa**, nhập **Giá gốc (₫)** và **Giảm giá sản phẩm (%)** rồi lưu. Mức giảm là số nguyên **0–100%**, áp dụng cho tất cả màu và size của sản phẩm; giá sau giảm được xem trước ngay trong form. Chọn **Bỏ giảm giá** hoặc nhập `0` để bán theo giá gốc. Ví dụ: giá gốc 1.000.000₫, giảm 20% → giá bán 800.000₫/đôi.

Danh sách giày và trang chi tiết hiển thị giá sau giảm, giá gốc gạch ngang và nhãn phần trăm; bộ lọc/sắp xếp giá, giỏ hàng và checkout đều dùng giá sau giảm. Backend tính lại giá từ sản phẩm, làm tròn tiền giảm đến đồng trên từng đôi rồi nhân số lượng. Voucher được xét mức đơn tối thiểu và tính giảm thêm trên tiền hàng sau giảm. Đơn đã tạo lưu giá mua và mức giảm tại thời điểm đặt; thay đổi giảm giá về sau không làm đổi tiền đơn cũ, thanh toán hay hoàn tiền của đơn đó.

Sản phẩm cũ chưa có `discountPercent` được hiểu là giảm 0%; sửa giảm giá không chuyển đổi kho, không cần seed hoặc cập nhật dữ liệu hàng loạt. Khi giá/ưu đãi đổi trong lúc khách xác nhận, checkout kiểm tra lại và trả 409 để khách xác nhận tổng mới. Cập nhật cả backend, frontend và thư mục `shared` chứa công thức giá dùng chung.

Kiểm tra ngày **29/10/2026**: **388 backend**, **207 frontend** (186 ca Node và 21 luồng), build thành công; **5 tình huống HTTP/MongoDB thật** đạt trên cơ sở dữ liệu thử có kiểm tra quyền sở hữu và đã dọn. **15 kiểm tra Chrome** đạt ở 1440px, 390px và 320px bằng dữ liệu/API giả lập, gồm nhập/lưu mức giảm và giá tại catalog, chi tiết, giỏ hàng, checkout. Không chỉnh giá, kho hay chương trình ưu đãi của dữ liệu cửa hàng trong quá trình kiểm tra.

## Địa chỉ giao hàng trong tài khoản

Vào **Tài khoản → Chỉnh sửa thông tin → Địa chỉ giao hàng mặc định**, nhập người nhận, số điện thoại nhận hàng, số nhà/tên đường và tỉnh/thành phố; quận/huyện, phường/xã là tùy chọn. Bấm **Lưu thay đổi** để lưu địa chỉ vào tài khoản. Thông tin người nhận có thể khác tên và số điện thoại của tài khoản.

Checkout tự dùng địa chỉ mặc định và hỏi **Bạn có muốn thay đổi thông tin giao hàng không?** Chọn **Không** để dùng thông tin đã lưu; chọn **Có, đổi cho đơn này** để mở form khác. Địa chỉ thay thế và ghi chú chỉ lưu theo đơn, không ghi đè tài khoản. Chuyển lại Không sẽ lấy lại thông tin mặc định.

Nếu tài khoản chưa có địa chỉ, checkout hiện form và lưu địa chỉ đầu tiên khi bấm **Tiếp tục xác nhận**, trước khi tạo đơn. Lưu lỗi thì giữ nội dung đang nhập và chưa chuyển bước. Backend lưu lần đầu có điều kiện: hai tab cùng lưu chỉ một tab thắng, không ghi đè địa chỉ đã được lưu bởi tab khác. Khi gặp xung đột, tải lại để xem địa chỉ hiện tại. Đơn đã đặt giữ nguyên thông tin giao hàng kể cả khi tài khoản thay đổi địa chỉ về sau. Khách cũ chưa có địa chỉ vẫn đăng nhập bình thường, không cần seed/chuyển đổi dữ liệu.

Kiểm tra ngày **29/10/2026**: **394 backend, 221 frontend** (200 ca Node + 21 luồng), build đạt; **5 ca HTTP/MongoDB thật** đạt trong database thử riêng đã dọn, và **15 ca Chrome** ở 1440/390/320px đạt bằng API giả lập. Không ghi địa chỉ hoặc tạo đơn trong dữ liệu cửa hàng khi kiểm tra.

## Chạy dự án

Chức năng ưu đãi mới: **Ưu đãi** (`/offers`) cho mã công khai; **Mã của tôi** (`/my-vouchers`) cho mã đã lưu và quà riêng đúng tài khoản. Quản trị tạo chương trình tại **Mã ưu đãi**, cấu hình lượt mỗi khách, mức giảm tối đa, kênh phát hành và điều kiện lần mua đầu/sau giao thành công. Lưu mã không giữ lượt. Xem [quy tắc và kiểm tra mã giảm giá](VOUCHER_REVIEW.md#chức-năng-đã-hoàn-thiện).

Checkout chỉ dùng mã đã lưu hoặc được cấp trong **Mã của tôi**, không nhập mã tự do. Tại **Kho ưu đãi**, lưu mã thành công làm thẻ mờ, khóa mọi thao tác và hiện **Mã đã được lưu** ở cuối; tải lại vẫn giữ trạng thái. Khách dùng hoặc bỏ lưu tại **Mã của tôi**. Backend kiểm tra sở hữu khi xem trước và tạo đơn; biết mã hoặc sửa URL không thay thế bước lưu mã.

Đơn VNPAY mới chờ tối đa 30 phút trước bước tự đối soát; chỉ tự hủy/trả kho và lượt khi xác minh chưa thu tiền. Kết quả chưa rõ được giữ để đối soát, không ép hủy theo đồng hồ. Đơn cũ không có hạn chờ không bị hủy hồi tố. Worker chạy cùng backend; cập nhật frontend/backend đồng thời, không cần seed lại.

Yêu cầu Node.js >= 22.12 và MongoDB; khuyến nghị Node.js 24 LTS để dùng kho chứng chỉ hệ điều hành. Chạy các lệnh từ thư mục có package.json gốc:

    npm ci
    npm ci --prefix frontend

Dùng backend/.env.example làm mẫu cấu hình backend/.env. Giữ nguyên file .env đang sử dụng nếu đã cấu hình; đặt MONGO_URI và JWT_SECRET bằng giá trị riêng. Không đưa .env vào Git.

    npm run dev

Frontend: http://localhost:5173. API: http://localhost:5000/api. Có thể chạy riêng bằng npm run server và npm run client.

`npm run dev` nhận diện dịch vụ đã chạy từ đúng thư mục dự án và chỉ bật dịch vụ còn thiếu. Khi `VNPAY_ENABLED=true`, lệnh cũng chạy cổng IPN; `npm run dev:vnpay` luôn yêu cầu cổng này. Chạy lại lệnh khi dự án đã hoạt động sẽ in địa chỉ website và thoát, không tạo thêm backend/frontend trùng cổng.

Nếu cổng thuộc chương trình hoặc bản dự án khác, lệnh báo rõ cổng bị chiếm và không tự dừng tiến trình đó. Dừng bản trước bằng **Ctrl+C** trong terminal đã chạy nó rồi thử lại. Nếu một dịch vụ mới khởi động bị lỗi, các dịch vụ cùng lần khởi động được dừng để tránh sót tiến trình. Các dịch vụ được dùng lại từ lần chạy trước vẫn tiếp tục hoạt động.

Kiểm tra sửa lỗi chạy trùng ngày 23/10/2026: **317/317 backend đạt**, build frontend thành công. Đã kiểm tra khởi động khi các cổng trống và gọi lại `npm run dev` khi API/frontend/IPN đang chạy, gồm frontend chỉ nghe IPv6 và IPN chỉ nghe IPv4.

Frontend mặc định gọi /api qua Vite proxy. Nếu đổi cổng backend, cấu hình API_PROXY_TARGET trong frontend/.env.local. Khi triển khai ở hai tên miền khác nhau, đặt VITE_API_URL thành URL API đầy đủ và FRONTEND_URL thành origin frontend. VITE_* được công khai trong bản build, chỉ chứa địa chỉ API.

## Kiểm tra và build

    npm test
    npm run test:frontend
    npm run build
    npm run check:db
    npm run check:vnpay

npm test chạy kiểm tra backend bằng Node test runner, mocks và HTTP cục bộ. npm run test:frontend kiểm tra cú pháp, bindings và các luồng giao diện bằng API/hooks giả lập. Cả hai không cần MongoDB và không sửa dữ liệu thật. check:db là lệnh kiểm tra kết nối MongoDB thật theo cấu hình; trả mã lỗi khác 0 nếu kết nối thất bại.

### Thanh toán VNPAY QR Sandbox

Đã thêm lựa chọn **VNPAY Sandbox (QR / thẻ test)** ở checkout và nút thanh toán tiếp trong **Đơn hàng của tôi**. Backend tạo link từ số tiền đơn đã lưu, xác thực chữ ký IPN rồi tự ghi nhận thanh toán. Return URL chỉ đọc và hiển thị kết quả, không ghi thanh toán. Khi đang chờ, trang tự kiểm tra trạng thái đã lưu mỗi 3 giây, tối đa 20 lần hoặc 60 giây; các lần đọc này không gọi API truy vấn VNPAY. Đơn chưa được xác nhận trả tiền bị chặn giao hàng.

Nếu mất IPN, khách bấm **Đối chiếu với VNPAY** trong đơn hàng hoặc trên trang kết quả đang chờ; admin có nút này trong **Quản trị → Đơn hàng**. Backend gọi API QueryDR có chữ ký từ máy chủ, kiểm tra đúng merchant, mã tham chiếu và số tiền trước khi ghi nhận. Nếu đơn có nhiều lần thanh toán chưa xác nhận, admin phải chọn đúng mã tham chiếu. Mỗi đơn được đối chiếu tối đa một lần trong 5 phút, kể cả lần trước bị timeout. Return vẫn là GET chỉ đọc; đối chiếu là POST riêng có đăng nhập và quyền chủ đơn/admin. Không cần thanh toán lại để khắc phục mất IPN.

Làm theo [hướng dẫn VNPAY Sandbox](VNPAY_SANDBOX.md) để đăng ký merchant, điền cấu hình và thử QR/thẻ NCB. Cần merchant Sandbox riêng, URL IPN HTTPS công khai được đăng ký với VNPAY và MongoDB đang kết nối. `npm run check:vnpay` kiểm tra cấu hình cục bộ; chưa thay thế giao dịch thử trên cổng.

Kiểm tra ngày **23/10/2026** sau bổ sung QueryDR và cấu hình DNS: **310 backend, 165 frontend đạt (20 luồng và 145 ca Node); build thành công**. Các ca VNPAY dùng dữ liệu/callback/phản hồi truy vấn giả có chữ ký và HTTP cục bộ, bao gồm cổng nhận IPN riêng **5010**, trang chờ xác nhận và đối chiếu thủ công. Trong SIT, cấu hình qua **Cấu hình IPN URL → Sửa → Cập nhật**; đường dẫn và URL đã được đối chiếu từ ảnh người dùng.

Lịch sử kiểm tra đường nhận IPN cùng ngày: frontend tại `http://localhost:5173`, API kết nối MongoDB và cổng nhận IPN 5010 hoạt động trong lần kiểm tra trước. Sau khi người dùng thêm ngoại lệ Avast cho `https://connect.ngrok-agent.com`, tunnel đã online tại `https://gawk-luckiness-unjustly.ngrok-free.dev`, chuyển về `http://127.0.0.1:5010`; xác minh TLS và ghim CA mặc định được giữ nguyên. Yêu cầu HTTPS thông thường từ bên ngoài, không có header bỏ qua cảnh báo ngrok, nhận HTTP 200/`RspCode: "97"` khi gọi IPN không có chữ ký; các đường dẫn `/api/customers/profile`, `/api/orders`, `/api/products` đều trả 404. Cần kiểm tra lại kết nối MongoDB bằng `npm run check:db` và `/api/test` ở lần chạy hiện tại.

Đã truy vấn QueryDR thật cho đúng yêu cầu của đơn đuôi `e8d367e6`: VNPAY trả HTTP 200, chữ ký hợp lệ, đúng merchant/mã tham chiếu/số tiền **3.000.000đ**, mã giao dịch **15712390**, loại thanh toán `01`, mã truy vấn và trạng thái đều `00`. Phép kiểm tra chỉ đọc không cập nhật MongoDB; bước ghi nhận đơn cần thực hiện bằng nút **Đối chiếu với VNPAY** với tài khoản chủ đơn hoặc admin. Không cần thanh toán lại. Xem [hướng dẫn đối chiếu khi mất IPN](VNPAY_SANDBOX.md#đối-chiếu-thủ-công-khi-mất-ipn). API hoàn tiền VNPAY chưa được tích hợp; nút hoàn tiền chỉ ghi nhận khoản đã xử lý bên ngoài.

### Khi đăng nhập báo chưa kết nối cơ sở dữ liệu

`npm run check:db` mở một kết nối riêng để kiểm tra rồi đóng lại; lệnh này không khởi động hoặc thay đổi kết nối của API đang chạy. Kiểm tra API thực tế tại `http://localhost:5000/api/test`: `databaseConnected` phải là `true`. Sau khi đổi `.env`, khởi động lại API. API hiện tự thử lại khi lần kết nối đầu thất bại, với khoảng chờ tăng từ 1 đến tối đa 30 giây; sau khi đã kết nối, MongoDB driver phụ trách kết nối lại.

Ngày 23/10/2026, DNS mặc định tra SRV MongoDB bị timeout, trong khi 1.1.1.1 và 8.8.8.8 đều trả đủ ba máy chủ. Đã thêm tùy chọn `MONGO_DNS_SERVERS=1.1.1.1,8.8.8.8` trong backend/.env và khởi động lại: API trả `databaseConnected: true`. Tùy chọn này chỉ cấu hình các phép `resolve*` trong tiến trình Node, gồm SRV/TXT; không đổi DNS Windows. Để trống để dùng DNS mặc định; tối đa ba địa chỉ IP phân cách bằng dấu phẩy.

Backend và `check:db` phân loại lỗi bằng thông báo cố định, không in URI, mật khẩu hoặc hostname trong lỗi gốc:

| Lỗi | Cách kiểm tra |
| --- | --- |
| DNS (`ENOTFOUND`, `EAI_AGAIN`, timeout truy vấn DNS) | Đối chiếu địa chỉ cluster trong Atlas và khả năng phân giải DNS của mạng đang dùng. |
| Xác thực (`18`) | Kiểm tra **Database User**, mật khẩu và `authSource`; tài khoản đăng nhập website là tài khoản khác. |
| Chứng chỉ TLS | Kiểm tra ngày giờ máy, CA tin cậy và phần mềm kiểm tra kết nối HTTPS/TLS. |
| Ngắt trước bắt tay TLS (`ECONNRESET_BEFORE_TLS`) | Kết nối bị ngắt trước bước xác thực tài khoản. Đối chiếu mạng khác/Compass, trạng thái cluster và phần mềm kiểm tra TLS. |
| Kết nối bị ngắt (`ECONNRESET`) | Kiểm tra IP Access List của đúng project/cluster và đường mạng. Mã này không tự chứng minh sai mật khẩu hoặc thiếu IP. |
| Hết thời gian chọn máy chủ | Kiểm tra trạng thái cluster, quyền truy cập IP và khả năng kết nối đến cổng MongoDB; không kết luận nguyên nhân chỉ từ timeout. |

Nếu IP hiện tại đã **Active** nhưng vẫn bị ngắt, thử mạng Wi-Fi phát từ điện thoại, cập nhật IP của mạng mới trong Atlas rồi chạy lại `npm run check:db`. Có thể đối chiếu cùng URI bằng MongoDB Compass trên máy; chỉ dán URI trong ứng dụng của bạn. Tham khảo [hướng dẫn xử lý kết nối Atlas](https://www.mongodb.com/docs/atlas/troubleshoot-connection/) và [quản lý IP Access List](https://www.mongodb.com/docs/atlas/security/ip-access-list/).

Kiểm tra ngày **22/10/2026** trên máy hiện tại: Node và Windows đều phân giải được DNS, TCP đến cả ba máy chủ thành công, nhưng TLS của cả ba bị ngắt với `ECONNRESET` trước xác thực. TLS bằng Windows và thử riêng TLS 1.2 cũng thất bại; TLS đến trang Atlas qua cổng 443 thành công. Người dùng xác nhận IP hiện tại đã Active. Chưa xác định được thành phần ngắt kết nối và chưa kết nối MongoDB thành công trong lần kiểm tra này; cần đối chiếu mạng khác/Compass hoặc trạng thái cluster. Các phép kiểm tra không thay đổi dữ liệu cửa hàng.

Hồi quy backend sau bổ sung chẩn đoán và thử lại kết nối: **230/230 đạt**, gồm 15 ca chẩn đoán lỗi lồng trong Mongoose và 9 ca khởi động/thử lại. Kết quả này không thay thế kiểm tra kết nối MongoDB thật.

### Kiểm tra tích hợp MongoDB thật

    npm run check:db
    npm run test:integration

Lệnh tích hợp gọi HTTP API thật và dùng MongoDB thật. Các bộ thông thường không thay model/controller bằng dữ liệu giả; bộ P1 có hook tạm dừng/chèn một lỗi ghi để kiểm tra thứ tự đồng thời, còn các thao tác ghi thành công vẫn đi vào MongoDB. Runner lấy MONGO_TEST_URI nếu có, nếu không dùng MONGO_URI; luôn chọn một database ngẫu nhiên mới có tiền tố shoe_store_it_, không dùng database cửa hàng để tạo tài khoản/sản phẩm/đơn thử. Tài khoản MongoDB cần quyền đọc/ghi, tạo collection/index và xóa database kiểm thử trên cluster đó.

Mỗi nhóm kiểm tra có database và dấu sở hữu riêng. Teardown chỉ xóa khi tên database, tiền tố và token sở hữu đều khớp lần chạy; nếu không khớp hoặc mất kết nối sẽ báo lỗi và giữ dữ liệu để kiểm tra. Tên database giới hạn 38 byte để phù hợp [Atlas Free](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/). Test tải ảnh chỉ dọn đúng tệp ngẫu nhiên đã tạo và đối chiếu nội dung trước khi xóa. Không chạy seed/reset để kiểm tra tích hợp.

Đã xác minh ngày 14/10/2026: 16 ca nghiệp vụ trong 3 nhóm (Node báo 19 mục kiểm tra) đều đạt trên MongoDB Atlas thật. Phạm vi gồm upload/lưu sản phẩm, phiên bản chỉnh sửa, đăng ký/phân quyền, giỏ đổi cùng giá, tranh đôi cuối, thanh toán/hủy đồng thời, voucher/hoàn kho, lưu trữ SKU, giao COD và đánh giá sau mua. Kiểm tra frontend bằng trình duyệt tự động chưa được thực hiện.

Sau sửa P1 ngày 15/10/2026, bộ ngoại tuyến đạt **154 backend, 102 frontend**, build thành công. Đã thêm 5 ca tích hợp cho pending/commit, lỗi ghi giỏ, giữ biến thể và mất phản hồi commit trong `backend/integration/p1Flows.integration.test.js`. Lần chạy mới dừng trước tạo fixture vì DNS `ETIMEOUT`, nên chưa tính các ca này là đạt. Chạy lại riêng bằng `node --test backend/integration/p1Flows.integration.test.js` khi kết nối hoạt động.

### Chứng chỉ kết nối

Backend, check:db, seed và bộ tích hợp dùng chung backend/config/mongoOptions.js. Helper kết hợp CA mặc định của Node với CA tin cậy của hệ điều hành khi Node hỗ trợ; vẫn xác minh chuỗi chứng chỉ và hostname. Cấu hình ca/secureContext/tlsCAFile riêng được giữ nguyên. Cách này xử lý lỗi UNABLE_TO_VERIFY_LEAF_SIGNATURE trên máy hiện tại mà không tắt TLS. Tham khảo [Node.js về kho CA hệ thống](https://nodejs.org/api/cli.html#--use-system-ca) và [MongoDB về cấu hình TLS](https://www.mongodb.com/docs/drivers/node/current/security/tls/).

npm run build tạo frontend/dist. Triển khai thư mục này bằng hosting hỗ trợ SPA fallback về index.html. Reverse proxy /api và /uploads tới backend hoặc cấu hình VITE_API_URL trước khi build. Khởi động API bằng npm start.

Khi MongoDB chưa kết nối, chỉ API đọc catalog trả sản phẩm mẫu và header X-Demo-Mode. Đăng nhập, giỏ, đơn hàng và quản trị trả 503; sản phẩm mẫu không dùng để đặt hàng.

## Thêm sản phẩm và hình ảnh

Trong quản trị sản phẩm, chọn ảnh JPG, PNG hoặc WebP từ máy tính (tối đa 5 MB). Form hiển thị ảnh xem trước; khi lưu, ảnh được tải lên backend và đường dẫn được lưu cùng sản phẩm. Ảnh nằm trong backend/uploads/products; cần giữ và sao lưu thư mục này khi triển khai. Vite đã proxy /uploads trong môi trường phát triển.

Nhập từng dòng gồm màu sắc, size và số lượng, ví dụ Trắng / 40 / 20. Bấm Thêm để nhập dòng tiếp theo, hoặc nút thùng rác để bỏ dòng. Mỗi tổ hợp màu và size chỉ xuất hiện một lần; tổng tồn kho được cộng tự động. Số lượng 0 dùng để ngừng bán một tổ hợp. Những dòng đã có trong giỏ hoặc đơn hàng được giữ để bảo đảm hoàn kho đúng khi hủy đơn.

Sản phẩm cũ chưa có tồn kho theo từng màu và size vẫn sử dụng được. Mở **Chỉnh sửa** để đổi tên, giá, thương hiệu, danh mục, mô tả hoặc ảnh mà giữ nguyên kho; không cần nhập lại số lượng dù sản phẩm đang có trong giỏ hoặc đơn chưa hoàn tất. Muốn phân bổ kho, chọn **Chuyển sang quản lý kho theo màu và size**, nhập số lượng thực tế cho từng dòng rồi lưu. Bỏ chọn để chỉ lưu thông tin. Không tự chia tổng kho cũ; chỉ chuyển đổi khi sản phẩm không nằm trong giỏ hàng và không có đơn đang xử lý/đang hoàn kho.

Sản phẩm đã có biến thể cũng chỉ gửi lại `variants` khi các dòng màu/size/số lượng thay đổi. Form vẫn kiểm tra phiên bản để tránh ghi đè dữ liệu vừa thay đổi. Khi thay ảnh sản phẩm đang sửa, frontend gọi `POST /api/products/:id/validate-update` trước khi upload để phát hiện dữ liệu sai hoặc chuyển đổi bị chặn. Endpoint này yêu cầu admin, chỉ kiểm tra, không lưu hoặc giữ kho; thao tác cập nhật thật luôn kiểm tra lại. Nếu dữ liệu thay đổi sau bước kiểm tra khiến lưu thất bại, form giữ ảnh đã tải để dùng lại khi thử tiếp.

## Quy tắc mua hàng

- Mỗi dòng giỏ phân biệt theo sản phẩm, màu sắc và size; size hỗ trợ bước 0.5. Tồn kho sản phẩm mới được quản lý riêng theo từng màu và size; sản phẩm cũ giữ cách tính chung cho đến khi được chuyển đổi.
- Khi tồn kho giảm khiến giỏ vượt số còn hàng, bấm “−” điều chỉnh trực tiếp về mức khả dụng của dòng đó, có tính các dòng dùng chung kho. Nếu dòng khác đã chiếm hết kho, có thể giảm dòng đang chọn về 1 rồi điều chỉnh các dòng còn lại. Giảm giỏ không giữ hàng; số lượng phải nguyên dương, tăng số lượng và checkout vẫn kiểm tra tồn kho đầy đủ.
- Backend lấy giá sản phẩm hiện tại, kiểm tra số lượng nguyên dương, màu/size còn bán và tồn kho tương ứng. Giá gửi từ trình duyệt không quyết định tổng tiền đơn. Checkout gửi `expectedCart` gồm từng dòng `{ product, color, size, quantity }` khách đã xác nhận, cùng `expectedTotalPrice`. Backend đối chiếu nội dung giỏ sau khi giữ khóa, trước khi giữ hàng; đổi sản phẩm/màu/size/số lượng kể cả tổng tiền không đổi đều trả 409 để khách xem lại và xác nhận lại. API tạo đơn yêu cầu `expectedCart`; client cũ cần tải lại frontend hoặc cập nhật payload.
- Phí giao hàng là 30.000 VND/đơn. Voucher fixed giảm số tiền cố định; percent giảm phần trăm nguyên từ 0 tới 100; mức giảm không vượt tiền sản phẩm. Voucher shipping miễn phí giao hàng một lần.
- Voucher được kiểm tra ngày bắt đầu/kết thúc, trạng thái, đơn tối thiểu và lượt còn lại khi tạo đơn. Hủy đơn hoàn lại lượt voucher.
- Đơn mới chỉ nhận COD hoặc VNPAY Sandbox; đã bỏ lựa chọn và form chuyển khoản ngân hàng. API từ chối `BANK` trước khi khóa giỏ hoặc giữ kho. COD được ghi nhận thanh toán khi quản trị xác nhận giao thành công; VNPAY được xác nhận qua IPN/QueryDR đã xác thực. Đơn BANK đã tạo trước đây vẫn được hiển thị và xử lý, chờ quản trị đối chiếu chuyển khoản và xác nhận đã nhận tiền.
- Quản trị chỉ hủy xác nhận thanh toán khi đơn đang xử lý hoặc đã xác nhận. Đơn đang giao/đã giao không hiện nút này; đơn đã hủy xử lý qua luồng hoàn tiền. Giao diện kiểm tra điều kiện trước khi gửi và tải lại danh sách nếu API báo trạng thái không còn cho phép thao tác (400/409).
- Đơn đi theo Đang xử lý → Đã xác nhận → Đang giao → Đã giao. Khách chỉ hủy khi Đang xử lý; quản trị có thể hủy thêm ở Đã xác nhận. Đơn hủy hoàn tồn kho một lần.
- Đơn đã thanh toán bị hủy được đánh dấu chờ hoàn tiền. Nếu trạng thái thanh toán đổi trong lúc yêu cầu hủy đang xử lý, API trả 409 trước khi hoàn kho để đọc và xử lý lại theo trạng thái mới. Quản trị chỉ xác nhận hoàn tiền sau khi đã thực hiện bên ngoài hệ thống; website chưa tự chuyển hoặc hoàn tiền qua cổng thanh toán.
- Chỉ quản trị được xóa đơn đã hủy và hoàn kho, đồng thời đã hoàn tiền nếu trước đó đã thanh toán. DELETE sản phẩm thực hiện lưu trữ (`isArchived`, `isHidden`), giữ nguyên SKU và tồn kho để hoàn hàng/hủy đơn. Sản phẩm lưu trữ không xuất hiện trong catalog thường, không sửa hoặc bật bán lại bằng API thông thường. Dùng chức năng ẩn/hiện cho sản phẩm chỉ tạm ngừng bán.
- Đánh giá nằm trong **Đơn hàng của tôi → đơn Đã giao → Đánh giá sản phẩm**. Đơn phải thuộc khách đang đăng nhập, đã thanh toán và giao thành công; sản phẩm phải có trong đúng đơn đó. Mỗi khách có một đánh giá cho mỗi mẫu giày, có thể sửa trong đơn đủ điều kiện. Trang chi tiết giày chỉ hiển thị đánh giá và điểm trung bình. Hai tab sửa cùng lúc phải tải lại nếu bản đánh giá đã thay đổi; không ghi đè âm thầm.
- Doanh thu bán hàng tính các đơn đã thanh toán, loại đơn đã hủy, giao thất bại và đã xử lý hoàn hàng; thời gian thống kê theo Việt Nam. Phí giao giữ lại và chi phí chuyển hoàn được ghi riêng ở chi tiết đơn, không tính là doanh số bán giày.

## Giao thất bại / khách từ chối nhận

Chức năng áp dụng cho đơn **Đang giao** chưa giao thành công. Đây là xử lý hàng vận chuyển quay về; luồng đổi size hoặc khách trả hàng sau khi đã nhận vẫn chưa được bổ sung.

1. Vào **Quản trị → Đơn hàng**, chọn đơn đang giao và bấm **Báo giao thất bại / từ chối nhận**. Nhập lý do và ghi chú rồi xác nhận. Đơn chuyển thành **Giao thất bại**, chờ hàng quay về; chưa cộng kho, chưa trả lượt voucher và không tự ghi nhận thanh toán COD.
2. Khi đã nhận lại và kiểm hàng thực tế, bấm **Xác nhận hàng quay về và kiểm hàng**. Với từng dòng màu/size, nhập số đôi **tốt nhập lại kho**, **hỏng không nhập kho**, **thất lạc/không nhận lại**. Tổng ba số phải bằng số đã gửi; phải nhập rõ cả số 0. Nhập phí vận chuyển hàng quay về cửa hàng chịu và ghi chú kiểm hàng.
3. Kiểm tra phần tiền hoàn rồi bấm **Xác nhận đã kiểm hàng và xử lý**. Chỉ số đôi tốt được cộng về đúng SKU/màu/size; hàng hỏng hoặc thất lạc không tăng kho bán. Lượt voucher được trả lại một lần. Đơn chuyển thành **Đã xử lý hoàn hàng**.
4. Với đơn đã thanh toán và có tiền hoàn, cửa hàng hoàn tiền bên ngoài hệ thống rồi bấm **Xác nhận đã hoàn tiền**. Nút chỉ xuất hiện sau khi xử lý hàng quay về hoàn tất; website chỉ ghi nhận, không tự chuyển tiền.

Quy tắc đã chốt: **tiền hoàn = tổng tiền đã trả − phí giao thực tế đã thu**. Đây là phần tiền hàng sau giảm giá; không trừ thêm phí chuyển hoàn hay số hàng hỏng/thất lạc. Ví dụ khách đã trả 780.000₫, trong đó ship 30.000₫, sẽ nhận lại 750.000₫; cửa hàng giữ 30.000₫ và chịu phí hàng quay về. Nếu voucher miễn ship thì phí đã thu bằng 0, không giữ lại khoản ship giả định. COD chưa thu tiền có tiền hoàn và phí giao giữ lại bằng 0.

Khách vào **Đơn hàng** để xem lý do, tiến độ, kết quả kiểm hàng và tiền hoàn/phí giao đã giữ lại. Chi phí của cửa hàng, ghi chú nội bộ và người thao tác chỉ được trả cho admin. Đơn giao thất bại không được chuyển thành Đã giao, hủy hoặc thay thanh toán qua các nút thông thường; bản ghi hoàn hàng được giữ để đối soát.

Kết quả kiểm hàng được chốt trước khi ghi kho/voucher. Nếu xử lý gián đoạn, giao diện khóa dữ liệu đã lưu và cho **Tiếp tục xử lý kết quả đã chốt**. Mỗi lần cộng kho/trả voucher có dấu ghi nhận nguyên tử trong cùng document, nên thử lại hoặc xác nhận đồng thời không cộng/trả hai lần; không đảo ngược lượng hàng đã nhập lại kho. Voucher đang hoàn tất được bảo vệ khỏi xóa cho đến khi đơn chốt xong. Các dấu ghi nhận không tự hết hạn và không công khai qua API. Không sửa trực tiếp snapshot hoặc xóa các dấu này để thử lại.

Kiểm tra ngoại tuyến sau bổ sung ngày 15/10/2026: **206 backend, 131 frontend đạt; build thành công**. Bộ tích hợp riêng: `node --test backend/integration/deliveryReturn.integration.test.js`, tạo database thử nghiệm có dấu sở hữu theo runner hiện có, không seed/reset dữ liệu cửa hàng. Kết quả MongoDB/trình duyệt mới nhất được ghi trong BUSINESS_REVIEW.md.

Checkout dùng khóa giỏ và cập nhật tồn có điều kiện, đồng thời bù thay đổi khi thao tác thất bại để chạy được trên MongoDB standalone. Bản này chưa cung cấp giao dịch nhiều collection với khả năng phục hồi tự động sau sự cố tiến trình/database; nên dùng MongoDB replica set cùng giao dịch và cơ chế phục hồi bền vững trước khi mở bán quy mô lớn.

Đơn mới chỉ được công bố sau khi checkout xóa giỏ và chuyển từ `pending` sang `committed` bằng token sở hữu. Trong giai đoạn pending, API chặn thanh toán/giao/hủy/hoàn tiền/xóa và loại đơn khỏi danh sách/báo cáo. Rollback chỉ xóa đơn pending đúng token, chưa thanh toán/chưa hoàn kho; không xóa hoặc trả kho cho đơn đã commit. Nếu kết quả ghi không xác định hoặc không chứng minh được quyền sở hữu, API trả 503 và giữ khóa cần đối soát. Lỗi dọn khóa sau commit vẫn giữ đơn thành công.

Mỗi lần trừ kho đồng thời thêm token nội bộ `checkoutReservations` vào SKU. Khi còn token, không thể chuyển kho cũ hoặc xóa màu/size; sửa thông tin và giữ nguyên các dòng vẫn được phép theo kiểm tra phiên bản. Token chỉ được gỡ sau commit hoặc sau khi mọi thao tác bù thành công, không tự hết hạn và không xuất hiện trong JSON API. Đơn/sản phẩm cũ thiếu các trường này vẫn dùng được; không cần seed/reset dữ liệu để áp dụng bản sửa.

Nếu có khóa cần đối soát, dừng các tiến trình backend trước khi can thiệp dữ liệu. Đối chiếu `Customer.checkoutLock.token`, `Product.checkoutReservations` và `Order.checkoutToken/checkoutState`, trạng thái thanh toán/hoàn kho và lượng hàng thực tế trước khi giải phóng đúng token. Không tự gỡ token chỉ vì quá hạn: bản này chưa có journal/công cụ phục hồi tự động cho mọi lỗi ghi. Khi triển khai, cập nhật đồng bộ các tiến trình backend để cùng tuân theo quy tắc pending và giữ kho.

## Tài khoản và khôi phục mật khẩu

JWT gắn loại tài khoản và phiên bản xác thực. Đổi/reset mật khẩu, thay đổi quyền hoặc vô hiệu hóa tài khoản sẽ thu hồi phiên cũ. Chỉ quản trị được tạo tài khoản nhân viên; API mua sắm dùng tài khoản khách hàng.

Frontend khôi phục tài khoản theo token đã gửi và phiên đang hoạt động. Bắt đầu đăng nhập, đăng xuất hoặc cập nhật hồ sơ sẽ hủy yêu cầu khôi phục cũ; phản hồi đến muộn, kể cả 401/403, không được ghi đè hoặc đăng xuất tài khoản mới. Đăng nhập hoàn tất sau đăng xuất hoặc sau lần đăng nhập khác cũng bị bỏ qua. Nếu lần đăng nhập mới thất bại và vẫn còn token trước đó, ứng dụng kiểm tra lại phiên trước bằng yêu cầu mới. Lỗi 401 từ API khác chỉ xóa phiên khi token của yêu cầu vẫn trùng token hiện tại.

Lưu hồ sơ cũng đi qua AuthProvider: request được gắn với token, thế hệ phiên và thứ tự cập nhật khi gửi. Phản hồi/lỗi cũ sau logout/login hoặc đổi tài khoản không được ghi user/token mới. Đổi mật khẩu vẫn nhận token mới khi request còn thuộc phiên hợp lệ; cập nhật mới nhất được ưu tiên.

Kiểm tra các thứ tự phản hồi bằng `npm run test:frontend`: `auth-context.test.cjs` chạy trực tiếp AuthProvider với hooks/API giả lập; `profile-session.test.cjs` nối Profile và AuthProvider thật; `session-api.test.cjs` chạy interceptor Axios thật với adapter trong bộ nhớ. Các ca này không cần MongoDB hoặc gửi yêu cầu mạng; chưa thay thế kiểm tra trình duyệt thật.

Cấp/gỡ quyền và kích hoạt/vô hiệu hóa tài khoản dùng khóa chung trong MongoDB để tránh hai quản trị viên đồng thời gỡ hết quyền của nhau. Quyền và phiên của người yêu cầu được kiểm tra lại sau khi giữ khóa. Yêu cầu trùng thời điểm nhận 409 và có thể thử lại; chỉ yêu cầu sở hữu khóa được giải phóng khóa.

Khóa quyền không tự hết hạn để tránh hai thao tác cùng ghi khi một tiến trình bị chậm. Nếu backend bị dừng đột ngột hoặc MongoDB lỗi lúc giải phóng khóa, quản trị hệ thống cần dừng **tất cả** tiến trình backend, xác minh thao tác cấp/gỡ quyền đã kết thúc và vẫn còn admin hoạt động, rồi kiểm tra document `_id: 'admin-role-changes'` trong collection `admin_guards` của đúng database. Sau khi đối soát, đặt `token` và `startedAt` về null bằng điều kiện khớp token đang giữ khóa. Khởi động lại backend sau khi hoàn tất. Không xóa khóa khi còn tiến trình có thể đang xử lý thay đổi quyền; không reset database để xử lý khóa này.

Để gửi email khôi phục, cấu hình SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD và SMTP_FROM trong backend/.env. Nếu SMTP không cần đăng nhập, có thể bỏ SMTP_USER/SMTP_PASSWORD nhưng vẫn cần SMTP_FROM. Link đặt lại mật khẩu dùng FRONTEND_URL, hết hạn sau 15 phút và chỉ dùng một lần. Khi chưa cấu hình SMTP, giao diện báo dịch vụ chưa sẵn sàng thay vì giả lập đã gửi email.

## Dữ liệu mẫu

Lệnh dưới đây xóa customers, products, orders và vouchers trong database đã cấu hình, rồi tạo 2 tài khoản cùng 10 mẫu giày. Chỉ dùng trên database dành cho phát triển.

Đặt SEED_ADMIN_PASSWORD và SEED_USER_PASSWORD, mỗi mật khẩu ít nhất 6 ký tự không chỉ là khoảng trắng, tối đa 72 byte UTF-8. Sau đó chạy:

    npm run seed -- --reset

Tài khoản mẫu: admin@shoeshop.com và user1@example.com. Mật khẩu lấy từ các biến môi trường trên; không có mật khẩu mặc định. Script không thực hiện reset nếu thiếu --reset hoặc cấu hình không hợp lệ.

## Cấu trúc

- frontend/src/pages: giao diện khách hàng và trang quản trị.
- frontend/src/components/Admin*: các phần quản lý.
- frontend/src/context/AuthContext.jsx: trạng thái phiên đăng nhập.
- frontend/src/utils/api.js: API client dùng chung.
- backend/app.js: cấu hình Express, routes và xử lý lỗi; không tự kết nối DB khi import.
- backend/controllers, routes, models: nghiệp vụ, API và schema.
- backend/utils: kiểm tra dữ liệu, giỏ hàng, tính giá và token.
- backend/tests: kiểm tra nghiệp vụ và API ngoại tuyến.
- backend/integration: kiểm tra HTTP + MongoDB thật trên các database thử nghiệm riêng.
