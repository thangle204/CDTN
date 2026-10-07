const path = require("path");
const fs = require("fs");
const db = require("../config/db");

const getProductImage = async (req, res) => {
  try {
    const { filename } = req.params;
    const imagePath = path.join(__dirname, "../uploads", filename);

    // Kiểm tra xem file có tồn tại không
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy ảnh",
      });
    }

    // Xác định loại MIME của file
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
    };

    // Set Content-Type header
    res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");

    // Gửi file
    res.sendFile(imagePath);
  } catch (error) {
    console.error("Error serving image:", error);
    res.status(500).json({
      success: false,
      message: "Không thể tải ảnh",
    });
  }
};

// Upload ảnh sản phẩm
const uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Không có file được tải lên",
      });
    }

    // Lưu tên file vào database
    const filename = req.file.filename;
    const productId = req.body.productId; // Giả sử bạn gửi productId khi upload

    await db.query("UPDATE products SET image = ? WHERE product_id = ?", [
      filename,
      productId,
    ]);

    res.json({
      success: true,
      message: "Tải ảnh lên thành công",
      data: {
        filename: filename,
        path: `/uploads/${filename}`,
      },
    });
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({
      success: false,
      message: "Không thể tải ảnh lên",
    });
  }
};

module.exports = {
  getProductImage,
  uploadProductImage,
};
