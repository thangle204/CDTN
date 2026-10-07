const db = require("../config/db");

// Lấy tất cả reviews của một sản phẩm
const getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;

    const [reviews] = await db.query(
      `SELECT r.review_id, r.user_id, r.product_id, r.rating, r.comment, 
              r.created_at, u.username
       FROM reviews r
       JOIN users u ON r.user_id = u.user_id
       WHERE r.product_id = ?
       ORDER BY r.created_at DESC`,
      [productId]
    );

    res.json({
      success: true,
      data: reviews,
    });
  } catch (error) {
    console.error("Error getting reviews:", error);
    res.status(500).json({
      success: false,
      message: "Không thể lấy đánh giá sản phẩm",
    });
  }
};

// Thêm review mới
const createReview = async (req, res) => {
  try {
    const { product_id, rating, comment } = req.body;
    const user_id = req.user.user_id;

    // Kiểm tra xem người dùng đã review sản phẩm này chưa
    const [existingReview] = await db.query(
      "SELECT * FROM reviews WHERE user_id = ? AND product_id = ?",
      [user_id, product_id]
    );

    if (existingReview.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Bạn đã đánh giá sản phẩm này rồi",
      });
    }

    // Thêm review mới
    const [result] = await db.query(
      `INSERT INTO reviews (user_id, product_id, rating, comment)
       VALUES (?, ?, ?, ?)`,
      [user_id, product_id, rating, comment]
    );

    res.json({
      success: true,
      message: "Đánh giá sản phẩm thành công",
      data: {
        review_id: result.insertId,
        user_id,
        product_id,
        rating,
        comment,
        created_at: new Date(),
      },
    });
  } catch (error) {
    console.error("Error creating review:", error);
    res.status(500).json({
      success: false,
      message: "Không thể tạo đánh giá",
    });
  }
};

// Cập nhật review
const updateReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { rating, comment } = req.body;
    const user_id = req.user.user_id;

    // Kiểm tra review có tồn tại và thuộc về user không
    const [review] = await db.query(
      "SELECT * FROM reviews WHERE review_id = ? AND user_id = ?",
      [reviewId, user_id]
    );

    if (review.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đánh giá hoặc bạn không có quyền chỉnh sửa",
      });
    }

    // Cập nhật review
    await db.query(
      `UPDATE reviews 
       SET rating = ?, comment = ?
       WHERE review_id = ?`,
      [rating, comment, reviewId]
    );

    res.json({
      success: true,
      message: "Cập nhật đánh giá thành công",
    });
  } catch (error) {
    console.error("Error updating review:", error);
    res.status(500).json({
      success: false,
      message: "Không thể cập nhật đánh giá",
    });
  }
};

// Xóa review
const deleteReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const user_id = req.user.user_id;

    // Kiểm tra review có tồn tại và thuộc về user không
    const [review] = await db.query(
      "SELECT * FROM reviews WHERE review_id = ? AND user_id = ?",
      [reviewId, user_id]
    );

    if (review.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đánh giá hoặc bạn không có quyền xóa",
      });
    }

    // Xóa review
    await db.query("DELETE FROM reviews WHERE review_id = ?", [reviewId]);

    res.json({
      success: true,
      message: "Xóa đánh giá thành công",
    });
  } catch (error) {
    console.error("Error deleting review:", error);
    res.status(500).json({
      success: false,
      message: "Không thể xóa đánh giá",
    });
  }
};

module.exports = {
  getProductReviews,
  createReview,
  updateReview,
  deleteReview,
};
