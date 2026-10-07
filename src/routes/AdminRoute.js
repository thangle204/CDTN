import React from "react";
import { Navigate, useLocation } from "react-router-dom";

const AdminRoute = ({ children }) => {
  const location = useLocation();
  const token = localStorage.getItem("token");
  
  // Dùng "|| {}" để tránh lỗi nếu localStorage trống
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  // Dùng dấu "?." (Optional Chaining) để cực kỳ an toàn
  // Nếu user.role không tồn tại, nó sẽ trả về undefined chứ không làm sập app
  const isAdmin = token && user?.role?.toLowerCase() === "admin";

  if (!isAdmin) {
    // Lưu lại trang đang định vào để sau khi login có thể quay lại
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export default AdminRoute;