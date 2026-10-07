const db = require("../config/db"); // Import kết nối DB

const getCart = async (req, res) => {
  try {
    // Log để debug
    console.log("Request user data:", req.user);
    console.log("Authorization header:", req.headers.authorization);

    if (!req.user || !req.user.user_id) {
      console.log("No user data found in request");
      return res.status(401).json({
        success: false,
        message: "Không tìm thấy thông tin người dùng",
      });
    }

    const userId = req.user.user_id;
    console.log("Getting cart for user:", userId);

    const query = `
      SELECT 
        c.cart_id,
        c.quantity,
        p.product_id,
        p.name,
        p.price,
        p.image,
        p.discount, -- BỔ SUNG: Lấy thêm cột % giảm giá gửi về cho Frontend hiển thị
        pv.variant_id,
        pv.size,
        pv.color
      FROM cart c
      JOIN products p ON c.product_id = p.product_id
      JOIN productvariants pv ON c.variant_id = pv.variant_id
      WHERE c.user_id = ?
    `;

    console.log("Executing query with user_id:", userId);
    const [cartItems] = await db.query(query, [userId]);
    console.log("Found cart items:", cartItems);

    // Xử lý đường dẫn ảnh
    const cleanedCartItems = cartItems.map((item) => {
      let imageUrl = item.image;
      if (!imageUrl.startsWith("http")) {
        if (imageUrl.startsWith("/uploads/")) {
          imageUrl = imageUrl;
        } else {
          imageUrl = `/uploads/${imageUrl}`;
        }
      }
      return {
        ...item,
        image: imageUrl,
      };
    });

    console.log("Cart items with cleaned image paths:", cleanedCartItems);

    res.json({
      success: true,
      data: cleanedCartItems,
    });
  } catch (error) {
    console.error("Error getting cart:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy giỏ hàng",
      error: error.message,
    });
  }
};

const addToCart = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { productId, variantId, quantity } = req.body; // Chỉ lấy productId và quantity

    console.log("Đang thêm vào giỏ hàng:", { userId, productId, variantId, quantity });

    // 1. Kiểm tra sản phẩm có tồn tại không
    const [variants] = await db.query(
      "SELECT * FROM productvariants WHERE variant_id = ?",
      [variantId]
    );

    if (variants.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Biến thể sản phẩm không tồn tại",
      });
    }

    // 2. Kiểm tra xem cặp (User + Product + Variant) này đã có trong giỏ chưa
    // Phải kiểm tra cả variant_id để tránh việc cộng dồn sai Size/Màu
    const [existingItems] = await db.query(
      `SELECT * FROM cart 
       WHERE user_id = ? AND product_id = ? AND variant_id = ?`,
      [userId, productId, variantId]
    );

    if (existingItems.length > 0) {
      // Nếu đã có, cập nhật thêm số lượng
      const newQuantity = existingItems[0].quantity + parseInt(quantity);
      await db.query(
        `UPDATE cart 
         SET quantity = ? 
         WHERE cart_id = ?`,
        [newQuantity, existingItems[0].cart_id]
      );
    } else {
      // Nếu chưa có, thêm mới hoàn toàn (bao gồm cả variant_id)
      await db.query(
        `INSERT INTO cart (user_id, product_id, variant_id, quantity) 
         VALUES (?, ?, ?, ?)`,
        [userId, productId, variantId, quantity]
      );
    }

    res.json({
      success: true,
      message: "Đã thêm vào giỏ hàng thành công",
    });
  } catch (error) {
    console.error("Lỗi thêm giỏ hàng:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi hệ thống khi thêm vào giỏ hàng",
      error: error.message,
    });
  }
};

const updateCartItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity } = req.body;
    const userId = req.user.user_id;

    // Sửa lại câu query
    const [cartItem] = await db.query(
      `SELECT c.*, p.stock 
       FROM cart c
       JOIN products p ON c.product_id = p.product_id 
       WHERE c.cart_id = ? AND c.user_id = ?`,
      [itemId, userId]
    );

    if (!cartItem.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy sản phẩm trong giỏ hàng",
      });
    }

    if (quantity > cartItem[0].stock) {
      return res.status(400).json({
        success: false,
        message: "Số lượng vượt quá tồn kho",
      });
    }

    if (quantity <= 0) {
      // Sửa lại DELETE query
      await db.query("DELETE FROM cart WHERE cart_id = ?", [itemId]);
    } else {
      // Sửa lại UPDATE query
      await db.query("UPDATE cart SET quantity = ? WHERE cart_id = ?", [
        quantity,
        itemId,
      ]);
    }

    res.json({ success: true, message: "Cập nhật giỏ hàng thành công" });
  } catch (error) {
    console.error("Update cart error:", error); // Thêm log
    res.status(500).json({
      success: false,
      message: "Lỗi server",
      error: error.message,
    });
  }
};

const removeFromCart = async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user.user_id;

    // Sửa lại DELETE query
    const [result] = await db.query(
      "DELETE FROM cart WHERE cart_id = ? AND user_id = ?",
      [itemId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy sản phẩm trong giỏ hàng",
      });
    }

    res.json({
      success: true,
      message: "Xóa sản phẩm khỏi giỏ hàng thành công",
    });
  } catch (error) {
    console.error("Remove cart error:", error); // Thêm log
    res.status(500).json({
      success: false,
      message: "Lỗi server",
      error: error.message,
    });
  }
};

const updateCartQuantity = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const cartId = req.params.cartId;
    const { quantity } = req.body;

    console.log("Received update request:", {
      userId,
      cartId,
      quantity,
    });

    // Validate input
    if (!quantity || isNaN(quantity) || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Số lượng không hợp lệ",
      });
    }

    // Update quantity in database
    const [result] = await db.query(
      `UPDATE cart 
       SET quantity = ? 
       WHERE cart_id = ? AND user_id = ?`,
      [quantity, cartId, userId]
    );

    console.log("Update result:", result);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy sản phẩm trong giỏ hàng",
      });
    }

    res.json({
      success: true,
      message: "Cập nhật số lượng thành công",
      data: {
        cart_id: cartId,
        quantity: quantity,
      },
    });
  } catch (error) {
    console.error("Update cart error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi cập nhật số lượng",
      error: error.message,
    });
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  updateCartQuantity,
};
