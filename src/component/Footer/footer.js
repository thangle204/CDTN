import React from "react";
const Footer = () => {
  return (
    <footer className="bg-light text-dark pt-4 my-5 d-lg ">
      <div className="container">
        <div className="row row-cols-lg-5 row-cols-2">
          {/* Hỗ trợ khách hàng */}
          <div>
            <h5>Hỗ trợ khách hàng</h5>
            <p>
              Hotline:{" "}
              <a
                className="text-decoration-none text-dark fw-bold"
                href="tel:19006035"
              >
                1900-6035
              </a>
              <p>(1000 đ/phút, 8-21h kể cả T7, CN)</p>
            </p>
            <ul className="list-unstyled">
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Các câu hỏi thường gặp
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Gửi yêu cầu hỗ trợ
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Hướng dẫn đặt hàng
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Phương thức vận chuyển
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Chính sách đổi trả
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Hướng dẫn trả góp
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Chính sách hàng nhập khẩu
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Hỗ trợ khách hàng: hotro@tiki.vn
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Báo lỗi bảo mật: security@tiki.vn
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h5>Về SNEAKER NICE DAY</h5>
            <ul className="list-unstyled">
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Giới thiệu{" "}
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  My Blog
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Tuyển dụng
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Chính sách bảo mật
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Chính sách giải quyết khiếu nại
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Điều khoản sử dụng
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h5>Hợp tác và liên kết</h5>
            <ul className="list-unstyled">
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Quy chế hoạt động
                </a>
              </li>
              <li>
                <a className="text-decoration-none text-secondary" href="#">
                  Bán hàng cùng Tiki
                </a>
              </li>
            </ul>
            <h5>Chứng nhận bởi</h5>
            <a href="">
              <img
                src="https://frontend.tikicdn.com/_desktop-next/static/img/footer/bo-cong-thuong.svg"
                alt="Chứng nhận"
                width="100"
              />
            </a>
          </div>

          <div>
            <h5>Phương thức thanh toán</h5>

            <h5>Dịch vụ giao hàng</h5>
          </div>

          <div>
            <h5>Kết nối với chúng tôi</h5>
            <div className="d-flex" style={{ marginLeft: "63px" }}>
              <a href="#" className="me-2">
                <img
                  className="rounded-circle"
                  src="data:image/jpeg;base64,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"
                  alt="Facebook"
                  width="30"
                />
              </a>
              <a href="#" className="me-2">
                <img
                  className="rounded-circle"
                  src="data:image/jpeg;base64,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"
                  alt="YouTube"
                  width="30"
                />
              </a>
              <a href="#" className="me-2">
                <img
                  className="rounded-circle"
                  src="data:image/png;base64,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"
                  alt="Zalo"
                  width="30"
                />
              </a>
            </div>
            <h5 className="mt-3">Tải ứng dụng trên điện thoại</h5>
          </div>
        </div>
        <div className="footer-bottom mt-4 pt-3 border-top">
          <h2 style={{ fontWeight: "bold", color: "#7749F8" }}>
            SNEAKER NICE DAY
          </h2>
          <p>
            Địa chỉ trụ sở: Tòa nhà Viettel, Số 285, Đường Cách Mạng Tháng 8,
            Phường 12, Quận 10, Thành phố Hồ Chí Minh
          </p>
          <p>
            Giấy chứng nhận đăng ký doanh nghiệp số 0309532909 do Sở Kế Hoạch và
            Đầu Tư Thành phố Hồ Chí Minh cấp lần đầu vào ngày 06/01/2010.
          </p>
          <p>
            Hotline: <a href="tel:19006035">1900 6035</a>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
