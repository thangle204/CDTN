const db = require("../config/db"); // Import kết nối DB

const getMyOrders = async (req, res) => {
  try {
    // Log để debug
    console.log("Request user data:", req.user);
    console.log("Authorization header:", req.headers.authorization);

    const userId = req.user.user_id || req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại",
      });
    }

    console.log("Fetching orders for user:", userId);

    const query = `
      SELECT 
        o.order_id,
        o.total_price,
        o.status,
        o.created_at,
        od.order_detail_id,
        od.quantity,
        od.price,
        p.name as product_name,
        p.image,
        pv.size,
        pv.color
      FROM orders o
      JOIN orderdetails od ON o.order_id = od.order_id
      JOIN productvariants pv ON od.variant_id = pv.variant_id
      JOIN products p ON pv.product_id = p.product_id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
    `;

    console.log("Executing query with user_id:", userId);
    const [orders] = await db.query(query, [userId]);
    console.log("Found orders:", orders);

    // Nhóm các chi tiết đơn hàng theo order_id
    const groupedOrders = orders.reduce((acc, order) => {
      const existingOrder = acc.find((o) => o.order_id === order.order_id);
      if (existingOrder) {
        existingOrder.details.push({
          order_detail_id: order.order_detail_id,
          quantity: order.quantity,
          price: order.price,
          name: order.product_name,
          image_url: order.image,
          size: order.size,
          color: order.color,
        });
      } else {
        acc.push({
          order_id: order.order_id,
          total_price: order.total_price,
          status: order.status,
          created_at: order.created_at,
          details: [
            {
              order_detail_id: order.order_detail_id,
              quantity: order.quantity,
              price: order.price,
              name: order.product_name,
              image_url: order.image,
              size: order.size,
              color: order.color,
            },
          ],
        });
      }
      return acc;
    }, []);

    res.json({
      success: true,
      data: groupedOrders,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy danh sách đơn hàng",
      error: error.message,
    });
  }
};

const createOrder = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const userId = req.user.user_id || req.user.id;
    const { items, totalAmount } = req.body;

    // Log để debug
    console.log("Creating order:", { userId, items, totalAmount });

    // 1. Tạo đơn hàng mới
    const [orderResult] = await connection.query(
      `INSERT INTO orders (user_id, total_price, status, created_at) 
       VALUES (?, ?, 'PENDING', NOW())`,
      [userId, totalAmount]
    );

    const orderId = orderResult.insertId;

    // 2. Thêm chi tiết đơn hàng
    for (const item of items) {
      await connection.query(
        `INSERT INTO orderdetails 
          (order_id, product_id, variant_id, quantity, price) 
          VALUES (?, ?, ?, ?, ?)`,
        [
          orderId,
          item.product_id,
          item.variant_id,
          item.quantity,
          item.price * (1 - (item.discount || 0) / 100),
        ]
      );
    }

    // 3. Xóa giỏ hàng
    await connection.query("DELETE FROM cart WHERE user_id = ?", [userId]);

    await connection.commit();

    res.json({
      success: true,
      message: "Đặt hàng thành công",
      data: { orderId },
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create order error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi tạo đơn hàng: " + error.message,
    });
  } finally {
    connection.release();
  }
};

const getAllOrders = async (req, res) => {
  try {
    const query = `
      SELECT 
        o.order_id,
        o.user_id,
        o.total_price,
        o.status,
        o.created_at,
        od.order_detail_id,
        od.quantity,
        od.price,
        p.name as product_name,
        p.image,
        pv.size,
        pv.color,
        u.email as user_email,
        u.full_name as user_fullname
      FROM orders o
      JOIN orderdetails od ON o.order_id = od.order_id
      JOIN productvariants pv ON od.variant_id = pv.variant_id
      JOIN products p ON pv.product_id = p.product_id
      JOIN users u ON o.user_id = u.user_id
      ORDER BY o.created_at DESC
    `;

    const [orders] = await db.query(query);

    // Nhóm các chi tiết đơn hàng theo order_id
    const groupedOrders = orders.reduce((acc, order) => {
      const existingOrder = acc.find((o) => o.order_id === order.order_id);
      if (existingOrder) {
        existingOrder.details.push({
          order_detail_id: order.order_detail_id,
          quantity: order.quantity,
          price: order.price,
          name: order.product_name,
          image_url: order.image,
          size: order.size,
          color: order.color,
        });
      } else {
        acc.push({
          order_id: order.order_id,
          user_id: order.user_id,
          user_email: order.user_email,
          user_fullname: order.user_fullname,
          total_price: order.total_price,
          status: order.status,
          created_at: order.created_at,
          details: [
            {
              order_detail_id: order.order_detail_id,
              quantity: order.quantity,
              price: order.price,
              name: order.product_name,
              image_url: order.image,
              size: order.size,
              color: order.color,
            },
          ],
        });
      }
      return acc;
    }, []);

    res.json({
      success: true,
      data: groupedOrders,
    });
  } catch (error) {
    console.error("Error getting all orders:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách đơn hàng",
      error: error.message,
    });
  }
};

const updateOrderStatus = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { orderId } = req.params;
    const { status } = req.body;
    const upperStatus = status.toUpperCase();

    const validStatuses = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
    if (!validStatuses.includes(upperStatus)) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Trạng thái không hợp lệ" });
    }

    const [currentOrder] = await connection.query(
      "SELECT status FROM orders WHERE order_id = ?", [orderId]
    );

    if (currentOrder.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng" });
    }

    const oldStatus = currentOrder[0].status.toUpperCase();

    // LOGIC SỬA ĐỔI CHÍNH TẠI ĐÂY:
    if (upperStatus === "DELIVERED" && oldStatus !== "DELIVERED") {
      const [items] = await connection.query(
        "SELECT variant_id, quantity FROM orderdetails WHERE order_id = ?", [orderId]
      );

      for (const item of items) {
        // A. Trừ kho chi tiết (productvariants)
        await connection.query(
          "UPDATE productvariants SET stock = stock - ? WHERE variant_id = ?",
          [item.quantity, item.variant_id]
        );

        // B. Cập nhật kho tổng (products) - ĐỂ DASHBOARD HIỂN THỊ ĐÚNG
        await connection.query(
          `UPDATE products p 
           JOIN productvariants pv ON p.product_id = pv.product_id 
           SET p.stock = p.stock - ? 
           WHERE pv.variant_id = ?`,
          [item.quantity, item.variant_id]
        );
      }
    }

    await connection.query(`UPDATE orders SET status = ? WHERE order_id = ?`, [
      upperStatus,
      orderId,
    ]);

    await connection.commit();
    res.json({
      success: true,
      message: "Cập nhật thành công và đã đồng bộ kho hàng",
      data: { orderId, status: upperStatus },
    });
  } catch (error) {
    await connection.rollback();
    console.error("Update error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};
const getAdminStats = async (req, res) => {
  try {
    // 1. Đếm đơn hàng mới (Trạng thái PENDING)
    const [newOrders] = await db.query(
      "SELECT COUNT(*) as count FROM orders WHERE UPPER(status) = 'PENDING'"
    );

    // 2. Tính tổng doanh thu (Chỉ tính các đơn đã giao thành công - DELIVERED)
    const [revenue] = await db.query(
      "SELECT SUM(total_price) as total FROM orders WHERE UPPER(status) = 'DELIVERED'"
    );

    res.json({
      success: true,
      data: {
        newOrders: newOrders[0].count,
        totalRevenue: revenue[0].total || 0,
      }
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy thống kê",
      error: error.message,
    });
  }
};


module.exports = {
  getMyOrders,
  createOrder,
  getAllOrders,
  updateOrderStatus,
  getAdminStats,
};
