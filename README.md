# SHOE STORE

Website bán giày với React/Vite, Express và MongoDB/Mongoose. Khách hàng có thể tìm giày, chọn size, quản lý giỏ, đặt hàng COD/chuyển khoản, theo dõi đơn và đánh giá sản phẩm sau khi nhận hàng. Quản trị viên quản lý sản phẩm, đơn hàng, tài khoản, voucher và doanh thu.

Trang chủ và trang sản phẩm dùng giao diện catalog với bộ lọc thương hiệu, màu, size, giá và còn hàng; lưới 4 cột trên màn hình lớn, 2 cột trên điện thoại. Có sắp xếp, phân trang và giữ lựa chọn trên URL. Xem [README frontend](frontend/README.md) để chỉnh giao diện. Đợt thiết kế lại ngày 15/10/2026 đạt 114 kiểm tra frontend, build và 12 luồng trên Chrome với dữ liệu mẫu riêng; không thay đổi dữ liệu cửa hàng.

## Chạy dự án

Yêu cầu Node.js >= 22.12 và MongoDB; khuyến nghị Node.js 24 LTS để dùng kho chứng chỉ hệ điều hành. Chạy các lệnh từ thư mục có package.json gốc:

    npm ci
    npm ci --prefix frontend

Dùng backend/.env.example làm mẫu cấu hình backend/.env. Giữ nguyên file .env đang sử dụng nếu đã cấu hình; đặt MONGO_URI và JWT_SECRET bằng giá trị riêng. Không đưa .env vào Git.

    npm run dev

Frontend: http://localhost:5173. API: http://localhost:5000/api. Có thể chạy riêng bằng npm run server và npm run client.

Frontend mặc định gọi /api qua Vite proxy. Nếu đổi cổng backend, cấu hình API_PROXY_TARGET trong frontend/.env.local. Khi triển khai ở hai tên miền khác nhau, đặt VITE_API_URL thành URL API đầy đủ và FRONTEND_URL thành origin frontend. VITE_* được công khai trong bản build, chỉ chứa địa chỉ API.

## Kiểm tra và build

    npm test
    npm run test:frontend
    npm run build
    npm run check:db

npm test chạy kiểm tra backend bằng Node test runner, mocks và HTTP cục bộ. npm run test:frontend kiểm tra cú pháp, bindings và các luồng giao diện bằng API/hooks giả lập. Cả hai không cần MongoDB và không sửa dữ liệu thật. check:db là lệnh kiểm tra kết nối MongoDB thật theo cấu hình; trả mã lỗi khác 0 nếu kết nối thất bại.

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
- COD được ghi nhận thanh toán khi quản trị xác nhận giao thành công. BANK chờ quản trị đối chiếu chuyển khoản và xác nhận đã nhận tiền; thông tin ngân hàng người gửi không phải bằng chứng đã thanh toán.
- Quản trị chỉ hủy xác nhận thanh toán khi đơn đang xử lý hoặc đã xác nhận. Đơn đang giao/đã giao không hiện nút này; đơn đã hủy xử lý qua luồng hoàn tiền. Giao diện kiểm tra điều kiện trước khi gửi và tải lại danh sách nếu API báo trạng thái không còn cho phép thao tác (400/409).
- Đơn đi theo Đang xử lý → Đã xác nhận → Đang giao → Đã giao. Khách chỉ hủy khi Đang xử lý; quản trị có thể hủy thêm ở Đã xác nhận. Đơn hủy hoàn tồn kho một lần.
- Đơn đã thanh toán bị hủy được đánh dấu chờ hoàn tiền. Nếu trạng thái thanh toán đổi trong lúc yêu cầu hủy đang xử lý, API trả 409 trước khi hoàn kho để đọc và xử lý lại theo trạng thái mới. Quản trị chỉ xác nhận hoàn tiền sau khi đã thực hiện bên ngoài hệ thống; website chưa tự chuyển hoặc hoàn tiền qua cổng thanh toán.
- Chỉ quản trị được xóa đơn đã hủy và hoàn kho, đồng thời đã hoàn tiền nếu trước đó đã thanh toán. DELETE sản phẩm thực hiện lưu trữ (`isArchived`, `isHidden`), giữ nguyên SKU và tồn kho để hoàn hàng/hủy đơn. Sản phẩm lưu trữ không xuất hiện trong catalog thường, không sửa hoặc bật bán lại bằng API thông thường. Dùng chức năng ẩn/hiện cho sản phẩm chỉ tạm ngừng bán.
- Đánh giá yêu cầu đơn đã thanh toán và giao thành công; mỗi khách đánh giá một lần cho mỗi sản phẩm.
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
